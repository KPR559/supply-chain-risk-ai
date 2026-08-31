import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { riskColor } from "../utils/helpers.js";

export default function RouteMap({ graph: routeId, nodes }) {
  const [graph, setGraph] = useState(null);

  useEffect(() => {
    if (!routeId) return;
    let alive = true;
    api
      .graph(routeId)
      .then((g) => alive && setGraph(g))
      .catch(() => alive && setGraph(null));
    return () => {
      alive = false;
    };
  }, [routeId]);

  if (!graph?.nodes?.length) {
    return <div className="placeholder">Loading route map…</div>;
  }

  const probs = Object.fromEntries((nodes || []).map((n) => [n.node_id, n.delay_probability ?? 0]));
  const lons = graph.nodes.map((n) => n.lon);
  const lats = graph.nodes.map((n) => n.lat);
  const minLon = Math.min(...lons) - 5;
  const maxLon = Math.max(...lons) + 5;
  const minLat = Math.min(...lats) - 6;
  const maxLat = Math.max(...lats) + 6;
  const W = 760;
  const H = 320;
  const sx = (lon) => ((lon - minLon) / (maxLon - minLon)) * W;
  const sy = (lat) => H - ((lat - minLat) / (maxLat - minLat)) * H;
  const pos = Object.fromEntries(graph.nodes.map((n) => [n.node_id, { x: sx(n.lon), y: sy(n.lat) }]));

  return (
    <div className="map-container">
      <svg viewBox={`0 0 ${W} ${H}`} className="map">
        <defs>
          <radialGradient id="mapGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1a2744" />
            <stop offset="100%" stopColor="#0b1524" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={W} height={H} rx={8} fill="url(#mapGlow)" />

        {/* Grid lines */}
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <line key={`h${f}`} x1={0} y1={H * f} x2={W} y2={H * f} stroke="#1a2744" strokeWidth={0.5} />
        ))}

        {graph.edges.map((e, i) => {
          const a = pos[e.src];
          const b = pos[e.dst];
          const midProb = ((probs[e.src] ?? 0) + (probs[e.dst] ?? 0)) / 2;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={riskColor(midProb)}
              strokeWidth={2.5}
              strokeDasharray="6 4"
              opacity={0.7}
            />
          );
        })}

        {graph.nodes.map((n) => {
          const p = probs[n.node_id] ?? 0;
          const c = riskColor(p);
          const { x, y } = pos[n.node_id];
          return (
            <g key={n.node_id}>
              <circle cx={x} cy={y} r={14} fill={c} opacity={0.25} />
              <circle cx={x} cy={y} r={8} fill={c} opacity={0.95} />
              <circle cx={x} cy={y} r={3.5} fill="#fff" opacity={0.9} />
              <text x={x} y={y - 18} textAnchor="middle" className="node-label">
                {n.label}
              </text>
              {p >= 0.3 && (
                <text x={x} y={y + 24} textAnchor="middle" className="node-risk-label">
                  {Math.round(p * 100)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><i style={{ background: riskColor(0.15) }} /> Low Risk (&lt;30%)</span>
        <span><i style={{ background: riskColor(0.45) }} /> Medium Risk (30–60%)</span>
        <span><i style={{ background: riskColor(0.75) }} /> High Risk (&gt;60%)</span>
        <span className="legend-route">{graph.name}</span>
      </div>
    </div>
  );
}
