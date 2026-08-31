"""Graph construction, routing and delay propagation.

Builds a :class:`networkx.DiGraph` from the topology definition, extracts route
subgraphs, computes node/edge features carriers and implements **downstream
delay propagation** (delay cascade) used by the simulation engine.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

import networkx as nx
import numpy as np
import pandas as pd

from core.graph import topology
from core.logging_util import get_logger

log = get_logger(__name__)


class LogisticsGraph:
    """Wrapper around a networkx digraph with route and feature helpers."""

    def __init__(self, graph: nx.DiGraph):
        self.graph = graph

    # ------------------------------------------------------------------
    @classmethod
    def from_topology(cls, node_data: Optional[Dict[str, Dict]] = None,
                      edge_data: Optional[Dict[tuple, Dict]] = None) -> "LogisticsGraph":
        g = nx.DiGraph()
        for n in topology.NODE_DEFS:
            g.add_node(n["id"], label=n["label"], kind=n["kind"], lon=n["lon"], lat=n["lat"])
        for e in topology.EDGE_DEFS:
            g.add_edge(e.src, e.dst, mode=e.mode, distance_km=e.distance_km,
                       baseline_days=e.baseline_days, reliability=e.reliability)
        # overlay runtime data
        if node_data:
            for nid, attrs in node_data.items():
                if nid in g:
                    g.nodes[nid].update(attrs)
        if edge_data:
            for (a, b), attrs in edge_data.items():
                if g.has_edge(a, b):
                    g.edges[a, b].update(attrs)
        return cls(g)

    # ------------------------------------------------------------------
    def route_subgraph(self, route_id: str) -> nx.DiGraph:
        route = topology.route_by_id(route_id)
        if route is None:
            raise ValueError(f"Unknown route: {route_id}")
        sub = self.graph.subgraph(route.node_ids).copy()
        # keep only the route's directed edges in order
        ordered = list(zip(route.node_ids, route.node_ids[1:]))
        for (a, b) in list(sub.edges()):
            if (a, b) not in ordered:
                sub.remove_edge(a, b)
        return sub

    def upstream(self, node_id: str, route_id: str) -> List[str]:
        """Node IDs strictly upstream of `node_id` along the route."""
        route = topology.route_by_id(route_id).node_ids
        try:
            idx = route.index(node_id)
        except ValueError:
            return []
        return route[:idx]

    def downstream(self, node_id: str, route_id: str) -> List[str]:
        route = topology.route_by_id(route_id).node_ids
        try:
            idx = route.index(node_id)
        except ValueError:
            return []
        return route[idx + 1:]

    def neighbors(self, node_id: str) -> List[str]:
        return list(self.graph.successors(node_id)) + list(self.graph.predecessors(node_id))

    # ------------------------------------------------------------------
    def topo_order(self, route_id: str) -> List[str]:
        """Topological (route order) node list."""
        route = topology.route_by_id(route_id).node_ids
        return route


@dataclass
class NodePrediction:
    node_id: str
    label: str
    delay_probability: float       # P(delayed)
    risk_level: str                # low | medium | high
    expected_delay_hours: float
    p50: float
    p80: float
    p90: float
    congestion: float
    weather: float
    conflict: float
    regime: int
    top_factors: Dict[str, float] = field(default_factory=dict)


def risk_level_from_probability(p: float) -> str:
    if p < 0.35:
        return "low"
    if p < 0.60:
        return "medium"
    return "high"


def risk_color(level: str) -> str:
    return {"low": "green", "medium": "amber", "high": "red", "disrupted": "purple"}.get(level, "grey")


def propagate_delay_cascade(node_delays: Dict[str, float],
                            route_id: str,
                            attenuation: float = 1.0) -> Dict[str, float]:
    """Propagate delays downstream along a route (delay cascade).

    A node's propagated delay accounts for its own expected delay plus a damped
    fraction of upstream accumulated delay. Damping avoids double counting when
    upstream effects are already represented in downstream predictions.

    Parameters
    ----------
    node_delays : expected delay (hours) keyed by node_id for the route
    attenuation : fraction of the upstream delay that carries forward
    """
    route = topology.route_by_id(route_id).node_ids
    out: Dict[str, float] = {}
    cum = 0.0
    for node in route:
        own = float(node_delays.get(node, 0.0))
        eff = own + attenuation * cum
        out[node] = eff
        cum = cum + own * attenuation  # only own (raw) accumulates, damped
    return out


def edge_transit_samples(route_id: str, seed: int = 0, size: int = 1) -> pd.DataFrame:
    """Sample base transit times per edge (log-normal) for the simulation."""
    rng = np.random.default_rng(seed)
    edges = topology.route_edges(topology.route_by_id(route_id))
    rows = []
    for e in edges:
        # log-normal around baseline_days with node-appropriate spread
        mu = np.log(e.baseline_days) - 0.5 * (0.15 ** 2)
        transit = rng.lognormal(mu, 0.15, size=size)
        rows.append({"src": e.src, "dst": e.dst, "transit_days": transit,
                     "mode": e.mode, "distance_km": e.distance_km})
    return pd.DataFrame(rows)
