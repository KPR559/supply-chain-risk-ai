"""Route / network topology — 19-node port-to-port global scope.

Nodes/edges are data-driven (also persisted as data/silver/checkpoints.parquet
and data/silver/route_edges.parquet for DuckDB). This module is the
in-memory source of truth for the API, GNN and Monte Carlo.

Scope: 9 ports + 2 canals + 5 straits + 3 seas (port-to-port, global).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

# ---------------------------------------------------------------------------
# Nodes (19) — mirrors backend/core/data/global_nodes.py FINAL_NODES
# ---------------------------------------------------------------------------
NODE_DEFS: List[Dict] = [
    {"id": "shanghai", "label": "Shanghai Port", "kind": "port", "lon": 121.48, "lat": 31.23, "country": "CN"},
    {"id": "singapore", "label": "Singapore Port", "kind": "port", "lon": 103.82, "lat": 1.26, "country": "SG"},
    {"id": "busan", "label": "Busan Port", "kind": "port", "lon": 129.04, "lat": 35.10, "country": "KR"},
    {"id": "rotterdam", "label": "Port of Rotterdam", "kind": "port", "lon": 4.14, "lat": 51.95, "country": "NL"},
    {"id": "los_angeles", "label": "Port of Los Angeles", "kind": "port", "lon": -118.26, "lat": 33.73, "country": "US"},
    {"id": "new_york", "label": "Port of New York", "kind": "port", "lon": -74.02, "lat": 40.68, "country": "US"},
    {"id": "dubai", "label": "Jebel Ali Port", "kind": "port", "lon": 55.06, "lat": 25.01, "country": "AE"},
    {"id": "mumbai", "label": "Mumbai Port", "kind": "port", "lon": 72.88, "lat": 18.94, "country": "IN"},
    {"id": "colombo", "label": "Colombo Port", "kind": "port", "lon": 79.86, "lat": 6.93, "country": "LK"},
    {"id": "suez", "label": "Suez Canal", "kind": "canal", "lon": 32.55, "lat": 30.05},
    {"id": "panama_canal", "label": "Panama Canal", "kind": "canal", "lon": -79.68, "lat": 9.08},
    {"id": "strait_of_malacca", "label": "Strait of Malacca", "kind": "strait", "lon": 101.0, "lat": 2.5},
    {"id": "strait_of_hormuz", "label": "Strait of Hormuz", "kind": "strait", "lon": 56.25, "lat": 26.57},
    {"id": "bab_el_mandeb", "label": "Bab el-Mandeb", "kind": "strait", "lon": 43.33, "lat": 12.58},
    {"id": "strait_of_gibraltar", "label": "Strait of Gibraltar", "kind": "strait", "lon": -5.60, "lat": 35.97},
    {"id": "taiwan_strait", "label": "Taiwan Strait", "kind": "strait", "lon": 119.0, "lat": 24.0},
    {"id": "indian_ocean", "label": "Indian Ocean", "kind": "sea", "lon": 60.0, "lat": -5.0},
    {"id": "cape_of_good_hope", "label": "Cape of Good Hope", "kind": "sea", "lon": 18.42, "lat": -34.36},
    {"id": "english_channel", "label": "English Channel", "kind": "sea", "lon": 0.50, "lat": 50.50},
]


@dataclass(frozen=True)
class EdgeDef:
    src: str
    dst: str
    mode: str
    distance_km: float
    baseline_days: float
    reliability: float = 0.9


# 25 directed edges — Haversine distances from global_nodes coords, 800 km/day sea speed
EDGE_DEFS: List[EdgeDef] = [
    EdgeDef("shanghai", "taiwan_strait", "sea", 840.2, 1.1, 0.88),
    EdgeDef("taiwan_strait", "singapore", "sea", 3010.8, 3.8, 0.91),
    EdgeDef("shanghai", "busan", "sea", 824.5, 1.0, 0.91),
    EdgeDef("busan", "taiwan_strait", "sea", 1568.5, 2.0, 0.88),
    EdgeDef("singapore", "strait_of_malacca", "sea", 342.4, 0.4, 0.90),
    EdgeDef("strait_of_malacca", "indian_ocean", "sea", 4630.3, 5.8, 0.91),
    EdgeDef("indian_ocean", "colombo", "sea", 2572.4, 3.2, 0.91),
    EdgeDef("colombo", "mumbai", "sea", 1534.0, 1.9, 0.91),
    EdgeDef("mumbai", "colombo", "sea", 1534.0, 1.9, 0.91),
    EdgeDef("indian_ocean", "strait_of_hormuz", "sea", 3533.6, 4.4, 0.82),
    EdgeDef("strait_of_hormuz", "dubai", "sea", 210.4, 0.3, 0.91),
    EdgeDef("dubai", "mumbai", "sea", 1955.4, 2.4, 0.91),
    EdgeDef("indian_ocean", "bab_el_mandeb", "sea", 2686.0, 3.4, 0.75),
    EdgeDef("bab_el_mandeb", "suez", "sea", 2237.4, 2.8, 0.80),
    EdgeDef("suez", "strait_of_gibraltar", "sea", 3594.4, 4.5, 0.91),
    EdgeDef("strait_of_gibraltar", "english_channel", "sea", 1688.1, 2.1, 0.91),
    EdgeDef("english_channel", "rotterdam", "sea", 300.4, 0.4, 0.91),
    EdgeDef("rotterdam", "new_york", "sea", 5834.2, 7.3, 0.91),
    EdgeDef("new_york", "panama_canal", "sea", 3557.9, 4.4, 0.88),
    EdgeDef("panama_canal", "new_york", "sea", 3557.9, 4.4, 0.88),
    EdgeDef("panama_canal", "los_angeles", "sea", 4797.5, 6.0, 0.91),
    EdgeDef("los_angeles", "panama_canal", "sea", 4797.5, 6.0, 0.91),
    EdgeDef("shanghai", "los_angeles", "sea", 10456.9, 13.1, 0.91),
    EdgeDef("singapore", "los_angeles", "sea", 14146.5, 17.7, 0.91),
    EdgeDef("indian_ocean", "cape_of_good_hope", "sea", 5378.3, 6.7, 0.92),
    EdgeDef("cape_of_good_hope", "english_channel", "sea", 9598.8, 12.0, 0.91),
    EdgeDef("cape_of_good_hope", "strait_of_gibraltar", "sea", 8207.8, 10.3, 0.91),
]


@dataclass
class Route:
    route_id: str
    name: str
    description: str
    node_ids: List[str]


ROUTES: List[Route] = [
    Route(
        "asia_europe_suez",
        "Asia–Europe via Suez",
        "Shanghai → Singapore → Malacca → Indian Ocean → Bab el-Mandeb → Suez → Gibraltar → Rotterdam (primary).",
        ["shanghai", "taiwan_strait", "singapore", "strait_of_malacca", "indian_ocean", "bab_el_mandeb", "suez", "strait_of_gibraltar", "english_channel", "rotterdam"],
    ),
    Route(
        "asia_europe_cape",
        "Asia–Europe via Cape of Good Hope",
        "Shanghai → Singapore → Malacca → Indian Ocean → Cape → Rotterdam (Suez bypass, longer, lower chokepoint risk).",
        ["shanghai", "taiwan_strait", "singapore", "strait_of_malacca", "indian_ocean", "cape_of_good_hope", "english_channel", "rotterdam"],
    ),
    Route(
        "trans_pacific",
        "Trans-Pacific Direct",
        "Shanghai → Los Angeles (direct Pacific crossing).",
        ["shanghai", "los_angeles"],
    ),
    Route(
        "asia_us_east_panama",
        "Asia–US East via Panama",
        "Shanghai → Los Angeles → Panama Canal → New York (Pacific + Panama).",
        ["shanghai", "los_angeles", "panama_canal", "new_york"],
    ),
]

DEFAULT_ROUTE = "asia_europe_suez"

# Legacy IDs from the earlier single-corridor app still resolve to the nearest
# existing global route so old callers/stored shipments keep working.
ROUTE_ALIASES = {
    "suez": "asia_europe_suez",
    "cape": "asia_europe_cape",
    "dubai": "asia_europe_suez",
}


def resolve_route_id(route_id: str) -> str:
    """Map a legacy route id (suez/cape/dubai) to its canonical global route."""
    return ROUTE_ALIASES.get(route_id, route_id)

RISK_PRONE_KINDS = {"canal", "strait", "port", "sea"}


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
