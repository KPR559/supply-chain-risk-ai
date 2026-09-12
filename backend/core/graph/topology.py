"""Route / network topology definition for the Frankfurt -> India corridor.

The network is kept **data-driven**: nodes, edges and routes are declared here
(and can be loaded from JSON in the future) rather than being hardcoded in
model or propagation logic.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------
# Each node: id, label, kind, coordinates (for visualisation), risk-relevant
# attributes used by the generator and models.

NODE_DEFS: List[Dict] = [
    {"id": "frankfurt", "label": "Frankfurt", "kind": "origin", "lon": 8.68, "lat": 50.11},
    {"id": "european_hub", "label": "European Hub", "kind": "warehouse", "lon": 4.42, "lat": 51.93},
    {"id": "suez", "label": "Suez Canal", "kind": "canal", "lon": 32.55, "lat": 30.05},
    {"id": "cape_of_good_hope", "label": "Cape of Good Hope", "kind": "sea", "lon": 18.42, "lat": -34.36},
    {"id": "indian_ocean", "label": "Indian Ocean", "kind": "sea", "lon": 60.0, "lat": -5.0},
    {"id": "colombo", "label": "Colombo", "kind": "transshipment", "lon": 79.86, "lat": 6.93},
    {"id": "dubai", "label": "Dubai", "kind": "transshipment", "lon": 55.27, "lat": 25.20},
    {"id": "mumbai", "label": "Mumbai Port", "kind": "port", "lon": 72.88, "lat": 18.94},
    {"id": "customs", "label": "Customs", "kind": "customs", "lon": 72.88, "lat": 19.0},
    {"id": "final_destination", "label": "Final Destination", "kind": "destination", "lon": 77.21, "lat": 28.61},
]


@dataclass(frozen=True)
class EdgeDef:
    src: str
    dst: str
    mode: str
    distance_km: float
    baseline_days: float  # typical transit time in days
    reliability: float = 0.9  # 1.0 = perfectly reliable


# All possible directed edges across the corridor. Routes select subsets.
EDGE_DEFS: List[EdgeDef] = [
    EdgeDef("frankfurt", "european_hub", "road", 260.0, 0.4, 0.95),
    EdgeDef("european_hub", "suez", "sea", 11500.0, 5.5, 0.80),
    EdgeDef("european_hub", "cape_of_good_hope", "sea", 19000.0, 15.0, 0.88),
    EdgeDef("suez", "indian_ocean", "sea", 3000.0, 3.5, 0.82),
    EdgeDef("cape_of_good_hope", "indian_ocean", "sea", 5000.0, 4.0, 0.90),
    EdgeDef("indian_ocean", "colombo", "sea", 1500.0, 2.0, 0.92),
    EdgeDef("indian_ocean", "mumbai", "sea", 3000.0, 2.8, 0.90),
    EdgeDef("suez", "dubai", "sea", 3000.0, 4.0, 0.85),
    EdgeDef("dubai", "mumbai", "sea", 1900.0, 2.5, 0.90),
    EdgeDef("colombo", "mumbai", "sea", 2000.0, 2.6, 0.91),
    EdgeDef("mumbai", "customs", "port", 0.0, 1.5, 0.75),
    EdgeDef("customs", "final_destination", "road", 300.0, 1.0, 0.85),
]


@dataclass
class Route:
    route_id: str
    name: str
    description: str
    node_ids: List[str]


ROUTES: List[Route] = [
    Route(
        "suez",
        "Route A - Suez Canal",
        "Reference route through Suez Canal and Colombo transshipment to Mumbai.",
        ["frankfurt", "european_hub", "suez", "indian_ocean", "colombo", "mumbai", "customs", "final_destination"],
    ),
    Route(
        "cape",
        "Route B - Cape of Good Hope",
        "Bypasses Suez via the Cape of Good Hope - longer but avoids Suez risk.",
        ["frankfurt", "european_hub", "cape_of_good_hope", "indian_ocean", "colombo", "mumbai", "customs", "final_destination"],
    ),
    Route(
        "dubai",
        "Route C - Dubai Transshipment",
        "Suez to Dubai transshipment then direct to Mumbai (west coast).",
        ["frankfurt", "european_hub", "suez", "dubai", "mumbai", "customs", "final_destination"],
    ),
]

DEFAULT_ROUTE = "suez"

# Node kinds that are most sensitive to risk (used for critical-node analysis).
RISK_PRONE_KINDS = {"canal", "port", "customs", "transshipment"}


def node_index() -> Dict[str, Dict]:
    return {n["id"]: n for n in NODE_DEFS}


def node_label(node_id: str) -> str:
    return node_index().get(node_id, {}).get("label", node_id)


def edge_map() -> Dict[str, Dict[str, EdgeDef]]:
    m: Dict[str, Dict[str, EdgeDef]] = {}
    for e in EDGE_DEFS:
        m.setdefault(e.src, {})[e.dst] = e
    return m


def route_by_id(route_id: str) -> Optional[Route]:
    for r in ROUTES:
        if r.route_id == route_id:
            return r
    return None


def all_route_ids() -> List[str]:
    return [r.route_id for r in ROUTES]


def route_edges(route: Route) -> List[EdgeDef]:
    em = edge_map()
    edges: List[EdgeDef] = []
    for a, b in zip(route.node_ids, route.node_ids[1:]):
        e = em.get(a, {}).get(b)
        if e is None:
            raise ValueError(f"No edge {a} -> {b} for route {route.route_id}")
        edges.append(e)
    return edges


def route_distance_km(route: Route) -> float:
    return sum(e.distance_km for e in route_edges(route))


def route_baseline_days(route: Route) -> float:
    return sum(e.baseline_days for e in route_edges(route))
