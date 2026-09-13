"""NetworkX-driven layout and graph analytics for the route map.

Positions are computed with :func:`networkx.spring_layout`, seeded from the
geographic lon/lat projection and anchored on origin & destination so the
resulting schematic stays recognisably geographic while being a genuine
NetworkX layout. Per-node networkx metrics (centrality, hop distances) power
the tooltips / detail panel on the map.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import networkx as nx

from backend.core.graph.network import LogisticsGraph
from backend.core.logging_util import get_logger

log = get_logger(__name__)

_ANCHORS = ["frankfurt", "final_destination"]

_CACHE: Dict[str, Dict] = {}


def corridor_graph() -> nx.DiGraph:
    """Directed networkx graph of the whole corridor (all nodes/edges)."""
    return LogisticsGraph.from_topology().graph


def node_layout(g: nx.DiGraph, seed: int = 7) -> Dict[str, Dict[str, float]]:
    """Normalised 0..1 {x, y} positions per node (networkx spring layout)."""
    lons = {n: g.nodes[n]["lon"] for n in g}
    lats = {n: g.nodes[n]["lat"] for n in g}
    span_lon = (max(lons.values()) - min(lons.values())) or 1.0
    span_lat = (max(lats.values()) - min(lats.values())) or 1.0
    geo = {
        n: ((lons[n] - min(lons.values())) / span_lon,
            (lats[n] - min(lats.values())) / span_lat)
        for n in g
    }
    fixed = [a for a in _ANCHORS if a in g]
    pos = nx.spring_layout(g, pos=geo, k=0.05, iterations=6, seed=seed,
                           fixed=fixed, weight=None)
    xs = [float(v[0]) for v in pos.values()]
    ys = [float(v[1]) for v in pos.values()]
    sx = (max(xs) - min(xs)) or 1.0
    sy = (max(ys) - min(ys)) or 1.0
    return {
        n: {
            "x": round((float(pos[n][0]) - min(xs)) / sx, 4),
            "y": round((float(pos[n][1]) - min(ys)) / sy, 4),
        }
        for n in g
    }


def node_metrics(g: nx.DiGraph) -> Dict[str, Dict]:
    """Centrality + hop distances per node (all networkx)."""
    btw = nx.betweenness_centrality(g)
    clo = nx.closeness_centrality(g)
    deg = nx.degree_centrality(g)
    hops_from = nx.single_source_shortest_path_length(g, _ANCHORS[0])
    out: Dict[str, Dict] = {}
    for n in g:
        try:
            hops_to = nx.shortest_path_length(g, n, _ANCHORS[1])
        except nx.NetworkXNoPath:
            hops_to = None
        out[n] = {
            "betweenness": round(float(btw[n]), 4),
            "closeness": round(float(clo[n]), 4),
            "degree": round(float(deg[n]), 4),
            "hops_from_origin": hops_from.get(n),
            "hops_to_dest": hops_to,
        }
    return out


def network_summary(g: nx.DiGraph) -> Dict:
    und = g.to_undirected()
    connected = nx.is_connected(und)
    return {
        "nodes": g.number_of_nodes(),
        "edges": g.number_of_edges(),
        "diameter": nx.diameter(und) if connected else None,
        "avg_shortest_path": round(float(nx.average_shortest_path_length(und)), 3) if connected else None,
        "sources": _ANCHORS[0],
        "sink": _ANCHORS[1],
    }


def build_map_analytics(seed: int = 7) -> Dict:
    """Lazily build the shared layout + metrics payload (cached)."""
    key = f"map:{seed}"
    if key in _CACHE:
        return _CACHE[key]
    g = corridor_graph()
    payload = {
        "positions": node_layout(g, seed=seed),
        "metrics": node_metrics(g),
        "network": network_summary(g),
    }
    _CACHE[key] = payload
    return payload