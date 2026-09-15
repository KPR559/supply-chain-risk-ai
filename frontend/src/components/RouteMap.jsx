import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import Globe from "react-globe.gl";
import { feature } from "topojson-client";
import { Maximize2, Minus, Plus } from "lucide-react";
import landTopo from "world-atlas/land-110m.json";
import { api } from "../api.js";
import AiSection from "./llm/AiSection.jsx";
import { riskColor, riskClass } from "../utils/helpers.js";
import { loadUiPrefs, saveUiPrefs } from "../prefs.js";

const SHORT_NAMES = {
  asia_europe_suez: "Suez",
  asia_europe_cape: "Cape",
  trans_pacific: "Trans-Pac",
  asia_us_east_panama: "Panama",
  suez: "Suez",
  cape: "Cape",
  dubai: "Dubai",
};
const KIND_LABELS = {
  origin: "Origin",
  warehouse: "Hub",
  canal: "Canal",
  sea: "Open Sea",
  transshipment: "Transshipment",
  port: "Port",
  customs: "Customs",
  destination: "Final Destination",
};

const VIEW_W = 1000;
const VIEW_H = 460;

// Fixed equirectangular corridor window (Europe → India via Suez/Cape/Dubai).
// Node extremes: lon 4.4–79.9, lat −34.4–51.9 — all sit inside with margin.
const LON_MIN = -15;
const LON_MAX = 95;
const LAT_MIN = -40;
const LAT_MAX = 57;
const wx = (lon) => ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * VIEW_W;
const wy = (lat) => (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * VIEW_H;

const CY_STYLE = [
  {
    selector: "node",
    style: {
      width: 30,
      height: 30,
      "background-opacity": 0.95,
      label: "data(label)",
      color: "#94a3b8",
      "font-size": 10,
      "font-family": "Inter, system-ui, sans-serif",
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 12,
      "text-wrap": "wrap",
      "text-max-width": 110,
      "z-index": 10,
    },
  },
  { selector: "node.risk-low", style: { "background-color": "#22c55e" } },
  { selector: "node.risk-med", style: { "background-color": "#f59e0b" } },
  { selector: "node.risk-high", style: { "background-color": "#ef4444" } },
  { selector: "node.kind-origin", style: { shape: "round-rectangle", width: 34, height: 34 } },
  { selector: "node.kind-destination", style: { shape: "star", width: 34, height: 34 } },
  { selector: "node.kind-customs", style: { shape: "diamond", width: 26, height: 26 } },
  {
    selector: "node.halo",
    style: { label: "", width: 52, height: 52, "background-opacity": 0.18, "z-index": 1 },
  },
  {
    selector: "edge",
    style: {
      width: 2.2,
      "line-color": "#22c55e",
      "curve-style": "bezier",
      "control-point-distance": "data(bow)",
      "control-point-weight": 0.5,
      "line-cap": "round",
      label: "data(label)",
      "font-size": 8.5,
      color: "#94a3b8",
      "text-background-color": "#0b1524",
      "text-background-opacity": 0.75,
      "text-background-padding": 2,
    },
  },
  { selector: "edge.mode-sea", style: { "line-style": "dashed" } },
  { selector: "edge.mode-port", style: { "line-style": "dotted" } },
  { selector: "edge.risk-med", style: { "line-color": "#f59e0b" } },
  { selector: "edge.risk-high", style: { "line-color": "#ef4444" } },
  { selector: "edge.route-active", style: { width: 2.4, opacity: 0.85 } },
  { selector: "edge.route-alt", style: { "line-color": "#3d4d6d", width: 1.5, opacity: 0.35 } },
];

export default function RouteMap({ activeRouteId = "suez", nodes = [], prediction = null, aiAvailable = null }) {
  const [routes, setRoutes] = useState([]);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState({});
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selEdge, setSelEdge] = useState(null);
  const [aiNode, setAiNode] = useState({ id: null, text: null });
  const [aiNodeLoading, setAiNodeLoading] = useState(false);
  const [aiEdge, setAiEdge] = useState({ key: null, text: null });
  const [aiEdgeLoading, setAiEdgeLoading] = useState(false);
  const [layout, setLayout] = useState(() => {
    const saved = loadUiPrefs().mapLayout;
    return saved === "graph" || saved === "world" ? saved : "globe";
  }); // 'globe' | 'world' | 'graph'
  const [view, setView] = useState({ x: 0, y: 0, z: 1 }); // shared cy pan/zoom for the bg layer
  const wrapRef = useRef(null);
  const cyRef = useRef(null);
  const globeRef = useRef(null);
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 460 });

  // Continent silhouettes (world-atlas land-110m + topojson-client),
  // projected once through the same corridor projection as the nodes.
  const landPath = useMemo(() => {
    try {
      const fc = feature(landTopo, landTopo.objects.land);
      const parts = [];
      const pushRing = (ring) => {
        if (!ring || ring.length < 4) return;
        parts.push(
          "M" + ring.map(([lo, la]) => `${wx(lo).toFixed(1)},${wy(la).toFixed(1)}`).join("L") + "Z"
        );
      };
      for (const f of fc.features || []) {
        const g = f.geometry;
        if (!g) continue;
        if (g.type === "Polygon") g.coordinates.forEach(pushRing);
        else if (g.type === "MultiPolygon") g.coordinates.forEach((poly) => poly.forEach(pushRing));
      }
      return parts.join("");
    } catch {
      return "";
    }
  }, []);

  // GeoJSON land features for react-globe.gl polygons layer
  const landPolygons = useMemo(() => {
    try {
      return (feature(landTopo, landTopo.objects.land).features || []);
    } catch { return []; }
  }, []);

const sizeRef = useRef({ width: 800, height: 460 });
  const graphsLoadRef = useRef(null);

  useEffect(() => {
    // One in-flight graphs fetch shared across re-mounts/StrictMode double-invoke;
    // setRoutes is safe to call after cleanup (React treats it as a no-op).
    if (graphsLoadRef.current) return;
    graphsLoadRef.current = (async () => {
      try {
        const g = await api.graphs();
        setRoutes(g.routes || []);
        setVisible(Object.fromEntries((g.routes || []).map((r) => [r.route_id, true])));
      } catch (e) {
        try {
          const list = await Promise.all(["suez", "cape", "dubai"].map((rid) => api.graph(rid)));
          setRoutes(list);
          setVisible(Object.fromEntries(list.map((r) => [r.route_id, true])));
        } catch (e2) {
          setFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const cy = cytoscape({
      container: wrapRef.current,
      boxSelectionEnabled: false,
      autoungrabify: true,
      autounselectify: true,
      minZoom: 0.4,
      maxZoom: 3,
    });
    cy.style(CY_STYLE);
    cy.on("tap", (e) => {
      if (e.target === cy) {
        setSelected(null);
        setSelEdge(null);
      }
    });
    cy.on("tap", "node", (e) => {
      const id = e.target.id();
      if (id.startsWith("halo-")) return;
      setSelEdge(null);
      setSelected((prev) => (prev === id ? null : id));
    });
    cy.on("tap", "edge", (e) => {
      const ed = e.target;
      setSelected(null);
      setSelEdge({
        key: ed.id(),
        from: ed.data("srcLabel"),
        to: ed.data("dstLabel"),
        mode: ed.data("mode"),
        distance_km: ed.data("distance_km"),
        baseline_days: ed.data("baseline_days"),
      });
    });
    cy.on("mouseover", "node", (e) => {
      const n = e.target;
      if (n.id().startsWith("halo-")) return;
      setHover({ kind: "node", nid: n.id(), pos: n.renderedPosition() });
    });
    cy.on("mouseover", "edge", (e) => {
      const ed = e.target;
      setHover({
        kind: "edge",
        src: ed.data("srcLabel"),
        dst: ed.data("dstLabel"),
        mode: ed.data("mode"),
        distance_km: ed.data("distance_km"),
        baseline_days: ed.data("baseline_days"),
        pos: ed.renderedPosition(),
      });
    });
    cy.on("mouseout", "node,edge", () => setHover(null));
    cy.on("pan zoom", () => {
      const p = cy.pan();
      setView({ x: p.x, y: p.y, z: cy.zoom() });
    });
    cyRef.current = cy;
    const onResize = () => {
      if (wrapRef.current) {
        const r = wrapRef.current.getBoundingClientRect();
        sizeRef.current = { width: r.width, height: r.height };
      }
      cy.resize();
    };
    onResize();
    requestAnimationFrame(() => cy.resize());
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  const merged = useMemo(() => {
    const m = {};
    for (const r of routes) {
      for (const n of r.nodes) {
        m[n.node_id] = {
          node_id: n.node_id,
          label: n.label,
          kind: n.kind,
          lon: n.lon,
          lat: n.lat,
          px: null,
          py: null,
          gx: 0,
          gy: 0,
          hasPos: Boolean(n.pos && typeof n.pos.x === "number" && typeof n.pos.y === "number"),
          posx: n.pos?.x,
          posy: n.pos?.y,
          prob: n.risk?.delay_probability ?? 0,
          expectedH: n.risk?.expected_delay_hours,
          regime: n.risk?.regime,
          metrics: n.metrics || {},
        };
      }
    }
    const flat = Object.values(m);
    if (layout === "world" || layout === "globe") {
      // Equirectangular lon/lat → VIEW space (world uses px/py; globe uses lat/lon directly).
      for (const n of flat) {
        n.px = wx(n.lon);
        n.py = wy(n.lat);
      }
    } else {
      // Graph schematic (NetworkX spring layout seeded from geo); fall back to a
      // data-fitted geo projection for any node missing NetworkX pos.
      const useGeo = flat.some((n) => !n.hasPos);
      let minLon = Infinity;
      let maxLon = -Infinity;
      let minLat = Infinity;
      let maxLat = -Infinity;
      if (useGeo) {
        for (const n of flat) {
          minLon = Math.min(minLon, n.lon);
          maxLon = Math.max(maxLon, n.lon);
          minLat = Math.min(minLat, n.lat);
          maxLat = Math.max(maxLat, n.lat);
        }
      }
      const padLon = Math.max((maxLon - minLon) * 0.06, 3);
      const padLat = Math.max((maxLat - minLat) * 0.08, 3);
      for (const n of flat) {
        if (n.hasPos) {
          n.px = n.posx * VIEW_W;
          n.py = (1 - n.posy) * VIEW_H;
        } else {
          n.px = ((n.lon - minLon + padLon) / (maxLon - minLon + 2 * padLon)) * VIEW_W;
          n.py = (1 - (n.lat - minLat + padLat) / (maxLat - minLat + 2 * padLat)) * VIEW_H;
        }
      }
    }
    for (const p of nodes) {
      const base = m[p.node_id];
      if (!base) continue;
      m[p.node_id] = {
        ...base,
        prob: p.delay_probability ?? base.prob,
        expectedH: p.expected_delay_hours ?? base.expectedH,
        regime: p.regime ?? base.regime,
        p50: p.p50,
        p80: p.p80,
        p90: p.p90,
        congestion: p.congestion,
        weather: p.weather,
        conflict: p.conflict,
      };
    }
    return m;
  }, [routes, nodes, layout]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !routes.length) return;
    setHover(null);
    cy.startBatch();
    cy.elements().remove();
    for (const [nid, n] of Object.entries(merged)) {
      const p = { x: n.px, y: n.py };
      if (n.prob >= 0.6) {
        cy.add({
          group: "nodes",
          data: { id: `halo-${nid}`, nid },
          classes: `halo risk-${riskClass(n.prob)}`,
          position: p,
        });
      }
      const label = n.label + (n.prob >= 0.3 ? `\n${Math.round(n.prob * 100)}%` : "");
      cy.add({
        group: "nodes",
        data: { id: nid, nid, label },
        classes: `risk-${riskClass(n.prob)} kind-${n.kind}`,
        position: p,
      });
    }
    for (const route of routes) {
      if (!visible[route.route_id]) continue;
      const isActive = route.route_id === activeRouteId;
      for (const e of route.edges) {
        const a = merged[e.src];
        const b = merged[e.dst];
        if (!a || !b) continue;
        const midProb = (a.prob + b.prob) / 2;
        cy.add({
          group: "edges",
          data: {
            id: `${route.route_id}:${e.src}>${e.dst}`,
            source: e.src,
            target: e.dst,
            mode: e.mode,
            distance_km: e.distance_km,
            baseline_days: e.baseline_days,
            srcLabel: a.label || e.src,
            dstLabel: b.label || e.dst,
            bow: 0,
            label: isActive ? `~${e.baseline_days}d` : "",
          },
          classes: `mode-${e.mode} risk-${riskClass(midProb)} ${isActive ? "route-active" : "route-alt"}`,
        });
      }
    }
    cy.endBatch();
    cy.resize();
    cy.layout({ name: "preset", fit: true, padding: 45 }).run();
    const p = cy.pan();
    setView({ x: p.x, y: p.y, z: cy.zoom() });
  }, [routes, visible, activeRouteId, merged, layout]);

  const toggle = (rid) => setVisible((v) => ({ ...v, [rid]: !v[rid] }));
  const chooseLayout = (next) => {
    setLayout(next);
    try {
      saveUiPrefs({ ...loadUiPrefs(), mapLayout: next === "graph" ? "graph" : next });
    } catch {
      // ignore
    }
  };

  const zoomBy = (factor) => {
    const cy = cyRef.current;
    if (!cy) return;
    const el = wrapRef.current?.getBoundingClientRect();
    cy.zoom({
      level: Math.min(3, Math.max(0.4, cy.zoom() * factor)),
      renderedPosition: el ? { x: el.width / 2, y: el.height / 2 } : undefined,
    });
  };
  const fitView = () => {
    const cy = cyRef.current;
    if (!cy || !cy.elements().length) return;
    cy.fit(cy.elements(), 45);
  };

  const hoverNode = hover?.kind === "node" ? merged[hover.nid] : null;
  const flip = hover?.pos && hover.pos.x > sizeRef.current.width - 190;

  // AI explanation for the selected checkpoint (graph stays authoritative).
  useEffect(() => {
    if (!selected || !prediction || aiAvailable === false) {
      setAiNode({ id: null, text: null });
      setAiNodeLoading(false);
      return;
    }
    let alive = true;
    setAiNodeLoading(true);
    api
      .llmExplain({ prediction, panels: ["node"], nodeId: selected })
      .then((res) => {
        if (alive) setAiNode({ id: selected, text: res?.panels?.node || null });
      })
      .catch(() => {
        if (alive) setAiNode({ id: selected, text: null });
      })
      .finally(() => {
        if (alive) setAiNodeLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected, prediction, aiAvailable]);

  // AI explanation for the selected segment.
  useEffect(() => {
    if (!selEdge || !prediction || aiAvailable === false) {
      setAiEdge({ key: null, text: null });
      setAiEdgeLoading(false);
      return;
    }
    let alive = true;
    setAiEdgeLoading(true);
    const { key, ...edge } = selEdge;
    api
      .llmExplain({ prediction, panels: ["edge"], edge })
      .then((res) => {
        if (alive) setAiEdge({ key, text: res?.panels?.edge || null });
      })
      .catch(() => {
        if (alive) setAiEdge({ key, text: null });
      })
      .finally(() => {
        if (alive) setAiEdgeLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selEdge, prediction, aiAvailable]);

  // ── react-globe.gl data (real 3D globe) ──
  const globePoints = useMemo(() => {
    return Object.values(merged)
      .filter((n) => n.lat != null && n.lon != null)
      .map((n) => ({
        node_id: n.node_id,
        label: n.label,
        kind: n.kind,
        lat: n.lat,
        lng: n.lon,
        prob: n.prob,
        expectedH: n.expectedH,
        color: riskColor(n.prob),
      }));
  }, [merged]);

  const globeArcs = useMemo(() => {
    const out = [];
    for (const route of routes) {
      if (!visible[route.route_id]) continue;
      const isActive = route.route_id === activeRouteId;
      for (const e of route.edges) {
        const a = merged[e.src];
        const b = merged[e.dst];
        if (!a || !b || a.lat == null || b.lat == null) continue;
        const midProb = (a.prob + b.prob) / 2;
        const isSea = e.mode === "sea";
        out.push({
          startLat: a.lat,
          startLng: a.lon,
          endLat: b.lat,
          endLng: b.lon,
          color: isActive ? riskColor(midProb) : "rgba(61,77,109,0.55)",
          stroke: isActive ? 1.5 : 0.8,
          altitudeAutoScale: isActive ? 0.4 : 0.25,
          dashLength: isActive ? (isSea ? 0.5 : 0.92) : 1,
          dashGap: isActive ? (isSea ? 0.25 : 0.08) : 0,
          dashAnimateTime: isActive ? (isSea ? 4000 : 6000) : 0,
          route_id: route.route_id,
          src: e.src,
          dst: e.dst,
          mode: e.mode,
          distance_km: e.distance_km,
          baseline_days: e.baseline_days,
          srcLabel: a.label || e.src,
          dstLabel: b.label || e.dst,
          isActive,
        });
      }
    }
    return out;
  }, [routes, visible, activeRouteId, merged]);

  const globeLabels = useMemo(() => {
    return Object.values(merged)
      .filter((n) => n.lat != null && n.lon != null)
      .map((n) => ({
        lat: n.lat,
        lng: n.lon,
        text: n.label,
        color: riskColor(n.prob),
      }));
  }, [merged]);

  // Keep the react-globe.gl canvas sized to its container (responsive).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setContainerSize({ width: Math.round(r.width), height: Math.round(r.height) });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Enable gentle idle auto-rotation on the OrbitControls and frame the corridor.
  const onGlobeReady = useCallback(() => {
    const g = globeRef.current;
    if (!g) return;
    g.pointOfView({ lat: 18, lng: 55, altitude: 2.2 });
    try {
      const controls = g.controls();
      if (controls) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.4;
      }
    } catch {
      // controls unavailable — user can still drag to rotate
    }
  }, []);

  const onGlobePointClick = useCallback((point) => {
    setSelEdge(null);
    setSelected((prev) => (prev === point.node_id ? null : point.node_id));
  }, []);

  const onGlobeArcClick = useCallback((arc) => {
    setSelected(null);
    setSelEdge({
      key: `${arc.route_id}:${arc.src}>${arc.dst}`,
      from: arc.srcLabel,
      to: arc.dstLabel,
      mode: arc.mode,
      distance_km: arc.distance_km,
      baseline_days: arc.baseline_days,
    });
  }, []);

  const onGlobeClick = useCallback(() => {
    setSelected(null);
    setSelEdge(null);
  }, []);

  return (
    <div>
      <div className="route-toggles">
        {routes.map((r) => {
          const on = visible[r.route_id];
          const isActive = r.route_id === activeRouteId;
          const dist = Math.round(r.edges.reduce((s, e) => s + e.distance_km, 0));
          const days = r.edges.reduce((s, e) => s + e.baseline_days, 0);
          return (
            <button
              key={r.route_id}
              className={`route-chip ${on ? "on" : "off"} ${isActive ? "active" : ""}`}
              onClick={() => toggle(r.route_id)}
              title={on ? "Hide this route" : "Show this route"}
            >
              <span className="chip-dot" />
              {isActive ? "★ " : ""}
              {SHORT_NAMES[r.route_id] || r.route_id}
              <span className="chip-meta">· {dist.toLocaleString()} km · ~{Math.round(days)}d</span>
            </button>
          );
        })}
        <span className="seg" role="group" aria-label="Map layout">
          <button className={`seg-btn ${layout === "globe" ? "on" : ""}`} onClick={() => chooseLayout("globe")} title="Real 3D globe (drag to rotate, scroll to zoom)">Globe</button>
          <button className={`seg-btn ${layout === "world" ? "on" : ""}`} onClick={() => chooseLayout("world")} title="Flat world map (lon/lat projection)">World</button>
          <button className={`seg-btn ${layout === "graph" ? "on" : ""}`} onClick={() => chooseLayout("graph")} title="Graph schematic layout">Graph</button>
        </span>
      </div>

      <div className={`map-container ${layout}`} ref={containerRef}>
        {layout === "world" && (
          <svg className="map-bg" aria-hidden="true">
            <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
              <path d={landPath} className="map-land" fillRule="evenodd" />
            </g>
          </svg>
        )}
        {layout === "globe" && (
          <div className="map-globe3d">
            <Globe
              ref={globeRef}
              width={containerSize.width}
              height={containerSize.height}
              backgroundColor="rgba(0,0,0,0)"
            globeImageUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%231a2e4f'/%3E%3C/svg%3E"
            showGraticules
            showAtmosphere
            atmosphereColor="#4f9df9"
            atmosphereAltitude={0.18}
            onGlobeReady={onGlobeReady}
            polygonsData={landPolygons}
            polygonCapColor={() => "#1a2e4f"}
            polygonSideColor={() => "rgba(40, 80, 140, 0.35)"}
            polygonStrokeColor={() => "rgba(120, 160, 220, 0.25)"}
            polygonAltitude={0.004}
            polygonsTransitionDuration={400}
            pointsData={globePoints}
            pointLat="lat"
            pointLng="lng"
            pointColor="color"
            pointAltitude={0.02}
            pointRadius={(d) => (d.prob >= 0.6 ? 0.5 : d.prob >= 0.35 ? 0.36 : 0.26)}
            pointResolution={12}
            pointLabel={(d) =>
              `<div style="background:#0a1020;border:1px solid #1e2d4a;border-radius:8px;padding:8px 10px;font-size:11px;color:#cbd5e1;font-family:Inter,system-ui,sans-serif;min-width:120px;line-height:1.4;">
                <div style="font-weight:600;margin-bottom:3px;color:#f1f5f9;">${d.label}</div>
                <div style="color:#94a3b8;">${KIND_LABELS[d.kind] || d.kind} · <span style="color:${d.color};">${Math.round(d.prob * 100)}% risk</span></div>
                ${d.expectedH != null ? `<div style="color:#94a3b8;margin-top:1px;">Expected +${d.expectedH}h delay</div>` : ""}
              </div>`
            }
            onPointClick={onGlobePointClick}
            arcsData={globeArcs}
            arcStartLat="startLat"
            arcStartLng="startLng"
            arcEndLat="endLat"
            arcEndLng="endLng"
            arcColor="color"
            arcStroke="stroke"
            arcAltitudeAutoScale="altitudeAutoScale"
            arcCurveResolution={72}
            arcDashLength="dashLength"
            arcDashGap="dashGap"
            arcDashAnimateTime="dashAnimateTime"
            onArcClick={onGlobeArcClick}
            labelsData={globeLabels}
            labelLat="lat"
            labelLng="lng"
            labelText="text"
            labelColor="color"
            labelSize={1.2}
            labelAltitude={0.032}
            labelResolution={2}
            labelIncludeDot={false}
            onGlobeClick={onGlobeClick}
          />
          </div>
        )}
        <div className={`map-cv ${layout === "globe" ? "map-cv-hidden" : ""}`} ref={wrapRef} />
        {layout !== "globe" && (
          <div className="map-ctl" role="group" aria-label="Map controls">
            <button className="icon-btn" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
              <Plus size={15} aria-hidden="true" />
            </button>
            <button className="icon-btn" onClick={() => zoomBy(0.8)} title="Zoom out" aria-label="Zoom out">
              <Minus size={15} aria-hidden="true" />
            </button>
            <button className="icon-btn" onClick={fitView} title="Fit route in view" aria-label="Fit route in view">
              <Maximize2 size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        {!routes.length && (
          <div className="map-status">
            {failed ? "Route map unavailable — the map request failed." : "Loading route map…"}
          </div>
        )}
        {hover?.pos && (
          <div
            className={`map-tip ${flip ? "flip" : ""}`}
            style={{ left: hover.pos.x, top: hover.pos.y }}
          >
            {hoverNode ? (
              <div>
                <div className="tip-title">{hoverNode.label}</div>
                <div className="tip-row">
                  <span className="tip-kind">{KIND_LABELS[hoverNode.kind] || hoverNode.kind}</span>
                  <span className={`risk-badge ${riskClass(hoverNode.prob)}`}>{Math.round(hoverNode.prob * 100)}% risk</span>
                </div>
                <div className="tip-row">
                  <span>{hoverNode.expectedH != null ? `Expected +${hoverNode.expectedH}h` : "No delay signal"}</span>
                  <span>{hoverNode.regime === 1 && "Disrupted"}</span>
                </div>
                {hoverNode.metrics?.betweenness != null && (
                  <div className="tip-row">
                    <span className="tip-kind">NetworkX</span>
                    <span>betweenness {hoverNode.metrics.betweenness}</span>
                  </div>
                )}
              </div>
            ) : (
              hover.kind === "edge" && (
                <div>
                  <div className="tip-title">{hover.src} → {hover.dst}</div>
                  <div className="tip-row">
                    <span className="tip-kind">{hover.mode}</span>
                    <span>{Math.round(hover.distance_km).toLocaleString()} km</span>
                  </div>
                  <div className="tip-row">
                    <span>~{hover.baseline_days}d baseline</span>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="legend">
        <span><i style={{ background: riskColor(0.15) }} /> Low (&lt;30%)</span>
        <span><i style={{ background: riskColor(0.45) }} /> Medium (30–60%)</span>
        <span><i style={{ background: riskColor(0.75) }} /> High (&gt;60%)</span>
        <span className="legend-mode solid">road</span>
        <span className="legend-mode dashed">sea</span>
        <span className="legend-mode dotted">port</span>
        <span className="legend-hint">layout: {layout === "globe" ? "interactive 3D globe · drag to rotate, scroll to zoom" : layout === "world" ? "World map (lon/lat)" : "Graph"} · click a node or segment to inspect</span>
      </div>

      {selected && merged[selected] && (
        <div className="node-detail">
          <div className="node-detail-head">
            <div>
              <span className="view-title">{merged[selected].label}</span>
              <span className="tip-kind">{KIND_LABELS[merged[selected].kind] || merged[selected].kind}</span>
            </div>
            <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close">×</button>
          </div>
          <div className="metric-strip">
            {[
              ["Delay prob.", merged[selected].prob != null ? `${Math.round(merged[selected].prob * 100)}%` : "—"],
              ["Expected delay", merged[selected].expectedH != null ? `+${merged[selected].expectedH}h` : "—"],
              ["P50 / P80 / P90", [merged[selected].p50, merged[selected].p80, merged[selected].p90].some((v) => v != null) ? `${merged[selected].p50 ?? "?"} / ${merged[selected].p80 ?? "?"} / ${merged[selected].p90 ?? "?"}h` : "—"],
              ["Congestion", merged[selected].congestion != null ? merged[selected].congestion.toFixed(2) : "—"],
              ["Weather", merged[selected].weather != null ? merged[selected].weather.toFixed(2) : "—"],
              ["Conflict", merged[selected].conflict != null ? merged[selected].conflict.toFixed(2) : "—"],
              ["Regime", merged[selected].regime === 1 ? "Disrupted" : merged[selected].regime === 0 ? "Stable" : "—"],
            ].map(([k, v]) => (
              <div key={k} className="metric-cell">
                <div className="metric-label">{k}</div>
                <div className="metric-value">{v}</div>
              </div>
            ))}
          </div>
          {merged[selected].metrics && (
            <div className="metric-strip" style={{ marginTop: 6 }}>
              {[
                ["Betweenness", merged[selected].metrics.betweenness ?? "—"],
                ["Closeness", merged[selected].metrics.closeness ?? "—"],
                ["Degree", merged[selected].metrics.degree ?? "—"],
                ["Hops from origin", merged[selected].metrics.hops_from_origin ?? "—"],
                ["Hops to dest", merged[selected].metrics.hops_to_dest ?? "—"],
              ].map(([k, v]) => (
                <div key={k} className="metric-cell">
                  <div className="metric-label">{k} · NetworkX</div>
                  <div className="metric-value">{v}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <AiSection
              title="AI Checkpoint Insight"
              text={selected === aiNode.id ? aiNode.text : null}
              loading={aiNodeLoading}
            />
          </div>
        </div>
      )}

      {selEdge && (
        <div className="node-detail">
          <div className="node-detail-head">
            <div>
              <span className="view-title">{selEdge.from} → {selEdge.to}</span>
              <span className="tip-kind">
                {selEdge.mode} · {selEdge.distance_km != null ? `${Math.round(selEdge.distance_km).toLocaleString()} km` : "—"} · ~{selEdge.baseline_days ?? "—"}d baseline
              </span>
            </div>
            <button className="icon-btn" onClick={() => setSelEdge(null)} aria-label="Close">×</button>
          </div>
          <AiSection
            title="AI Segment Insight"
            text={selEdge.key === aiEdge.key ? aiEdge.text : null}
            loading={aiEdgeLoading}
          />
        </div>
      )}
    </div>
  );
}