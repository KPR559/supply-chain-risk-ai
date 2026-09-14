"""Final collection scope: port-to-port global supply chains.

Scope decision: AI-powered predictive risk & decision intelligence for GLOBAL
supply chains, port (incl. customs attributes) -> port (incl. customs).
Inland nodes (frankfurt, customs-as-single-node, final_destination) are
dropped. european_hub is renamed rotterdam (same port, honest name).

19 nodes: 9 ports + 2 canals + 5 straits + 3 seas.
Customs lives as per-port attributes (holidays + LPI + queue proxy),
not as separate nodes.
"""
from __future__ import annotations

# Ports (endpoints; each carries customs attributes for its country)
PORT_NODES = [
    {"id": "shanghai", "label": "Shanghai Port", "kind": "port", "lon": 121.48, "lat": 31.23, "country": "CN"},
    {"id": "singapore", "label": "Singapore Port", "kind": "port", "lon": 103.82, "lat": 1.26, "country": "SG"},
    {"id": "busan", "label": "Busan Port", "kind": "port", "lon": 129.04, "lat": 35.10, "country": "KR"},
    {"id": "rotterdam", "label": "Port of Rotterdam", "kind": "port", "lon": 4.14, "lat": 51.95, "country": "NL"},
    {"id": "los_angeles", "label": "Port of Los Angeles", "kind": "port", "lon": -118.26, "lat": 33.73, "country": "US"},
    {"id": "new_york", "label": "Port of New York", "kind": "port", "lon": -74.02, "lat": 40.68, "country": "US"},
    {"id": "dubai", "label": "Jebel Ali Port", "kind": "port", "lon": 55.06, "lat": 25.01, "country": "AE"},
    {"id": "mumbai", "label": "Mumbai Port", "kind": "port", "lon": 72.88, "lat": 18.94, "country": "IN"},
    {"id": "colombo", "label": "Colombo Port", "kind": "port", "lon": 79.86, "lat": 6.93, "country": "LK"},
]

CANAL_NODES = [
    {"id": "suez", "label": "Suez Canal", "kind": "canal", "lon": 32.55, "lat": 30.05},
    {"id": "panama_canal", "label": "Panama Canal", "kind": "canal", "lon": -79.68, "lat": 9.08},
]

STRAIT_NODES = [
    {"id": "strait_of_malacca", "label": "Strait of Malacca", "kind": "strait", "lon": 101.0, "lat": 2.5},
    {"id": "strait_of_hormuz", "label": "Strait of Hormuz", "kind": "strait", "lon": 56.25, "lat": 26.57},
    {"id": "bab_el_mandeb", "label": "Bab el-Mandeb", "kind": "strait", "lon": 43.33, "lat": 12.58},
    {"id": "strait_of_gibraltar", "label": "Strait of Gibraltar", "kind": "strait", "lon": -5.60, "lat": 35.97},
    {"id": "taiwan_strait", "label": "Taiwan Strait", "kind": "strait", "lon": 119.0, "lat": 24.0},
]

SEA_NODES = [
    {"id": "indian_ocean", "label": "Indian Ocean", "kind": "sea", "lon": 60.0, "lat": -5.0},
    {"id": "cape_of_good_hope", "label": "Cape of Good Hope", "kind": "sea", "lon": 18.42, "lat": -34.36},
    {"id": "english_channel", "label": "English Channel", "kind": "sea", "lon": 0.50, "lat": 50.50},
]

# Full final scope (19)
FINAL_NODES = PORT_NODES + CANAL_NODES + STRAIT_NODES + SEA_NODES

# Back-compat alias: old corridor id -> new id
NODE_ID_MAP = {"european_hub": "rotterdam"}

# Kept for back-compat import; use FINAL_NODES going forward.
GLOBAL_EXTRA_NODES = [n for n in FINAL_NODES if n["id"] not in ("suez", "indian_ocean", "cape_of_good_hope", "colombo", "dubai", "mumbai")]


def all_weather_nodes():
    """All nodes to fetch weather for (final 19, port-to-port scope)."""
    return list(FINAL_NODES)


# Nodes where marine (wave height) applies
MARINE_KINDS = {"sea", "strait", "canal", "port", "transshipment"}
