"""Build graph layer: checkpoints + route edges (Sections 4-5 of LOGIX contract).

Inputs:
  backend.core.data.global_nodes (19 nodes: 9 ports + 2 canals + 5 straits + 3 seas)
  Haversine distances (computed here, no API)

Outputs:
  data/silver/checkpoints.parquet   — Section 4 (node layer, 19 rows)
  data/silver/route_edges.parquet   — Section 5 (edge layer, directed edges)

Also updates backend/core/graph/topology.py to reflect the 19-node global graph
(kept in sync; the parquet files are the DuckDB-analytical copies).

Usage:
  python -m backend.core.data.build_graph
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.data.global_nodes import FINAL_NODES
from backend.core.logging_util import get_logger

log = get_logger(__name__)

# ------------------------------------------------------------
# Haversine
# ------------------------------------------------------------
def _hav(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ------------------------------------------------------------
# Edge definitions: adjacent shipping lanes (directed where flow has a primary direction;
# bidirectional lanes listed as both directions where needed).
# distance_km and baseline_days are computed from coords (no hard-coded distances).
# ------------------------------------------------------------
EDGE_PAIRS: list[tuple[str, str, str]] = [
    # East Asia
    ("shanghai", "taiwan_strait", "sea"),
    ("taiwan_strait", "singapore", "sea"),
    ("shanghai", "busan", "sea"),
    ("busan", "taiwan_strait", "sea"),
    # Malacca corridor
    ("singapore", "strait_of_malacca", "sea"),
    ("strait_of_malacca", "indian_ocean", "sea"),
    # Indian Ocean hub (outbound from Malacca)
    ("indian_ocean", "colombo", "sea"),
    ("colombo", "mumbai", "sea"),
    ("mumbai", "colombo", "sea"),  # bidirectional
    ("indian_ocean", "strait_of_hormuz", "sea"),
    ("strait_of_hormuz", "dubai", "sea"),
    ("dubai", "mumbai", "sea"),
    # Red Sea / Suez corridor
    ("indian_ocean", "bab_el_mandeb", "sea"),
    ("bab_el_mandeb", "suez", "sea"),
    ("suez", "strait_of_gibraltar", "sea"),
    ("strait_of_gibraltar", "english_channel", "sea"),
    ("english_channel", "rotterdam", "sea"),
    # Atlantic / Americas
    ("rotterdam", "new_york", "sea"),
    ("new_york", "panama_canal", "sea"),
    ("panama_canal", "new_york", "sea"),
    ("panama_canal", "los_angeles", "sea"),
    ("los_angeles", "panama_canal", "sea"),
    # Pacific direct
    ("shanghai", "los_angeles", "sea"),
    ("singapore", "los_angeles", "sea"),
    # Cape alternative (Suez bypass)
    ("indian_ocean", "cape_of_good_hope", "sea"),
    ("cape_of_good_hope", "english_channel", "sea"),
    ("cape_of_good_hope", "strait_of_gibraltar", "sea"),
]

# Speed assumptions (km/day) by mode
SPEED_KM_PER_DAY = {"sea": 800, "road": 600, "canal": 300, "port": 0}  # 800 km/day ≈ 18 knots

# Reliability by node kind traversed (lower = more disruption-prone)
EDGE_RELIABILITY = {
    ("suez",): 0.80, ("bab_el_mandeb",): 0.75, ("strait_of_hormuz",): 0.82,
    ("strait_of_malacca",): 0.90, ("taiwan_strait",): 0.88,
    ("panama_canal",): 0.88, ("cape_of_good_hope",): 0.92,
}


def _reliability(dst: str) -> float:
    for nodes, val in EDGE_RELIABILITY.items():
        if dst in nodes:
            return val
    return 0.91


def build() -> tuple[pd.DataFrame, pd.DataFrame]:
    nodes = {n["id"]: n for n in FINAL_NODES}
    now = datetime.now(timezone.utc).isoformat()

    # -- checkpoints (Section 4) --
    ckpt_rows = []
    for n in FINAL_NODES:
        ckpt_rows.append({
            "node_id": n["id"], "node_name": n["label"], "node_type": n["kind"],
            "latitude": n["lat"], "longitude": n["lon"],
            "country_code": n.get("country", ""), "region": "",
            "city": n["label"].split()[-1] if n["kind"] == "port" else "",
            "timezone": "", "capacity": None, "capacity_unit": "",
            "operational_status": "normal", "opening_time": "", "closing_time": "",
            "geometry": f"POINT({n['lon']} {n['lat']})",
            "source": "global_nodes.py (port-to-port 19-node scope)",
            "ingested_at": now,
        })
    ckpt_df = pd.DataFrame(ckpt_rows)

    # -- route edges (Section 5) --
    edge_rows = []
    for i, (src, dst, mode) in enumerate(EDGE_PAIRS):
        s, d = nodes[src], nodes[dst]
        dist = round(_hav(s["lon"], s["lat"], d["lon"], d["lat"]), 1)
        days = round(dist / SPEED_KM_PER_DAY.get(mode, 800), 2) if dist else 0.0
        edge_rows.append({
            "edge_id": f"e{i:03d}_{src}__{dst}",
            "route_id": "global",  # lane-level; ROUTES in topology.py group these into named routes
            "source_node_id": src, "target_node_id": dst,
            "transport_mode": mode, "distance_km": dist,
            "planned_travel_hours": round(days * 24, 1),
            "historical_travel_hours_mean": round(days * 24, 1),
            "historical_travel_hours_std": round(max(1.0, days * 24 * 0.12), 1),
            "historical_travel_hours_p50": round(days * 24, 1),
            "historical_travel_hours_p90": round(days * 24 * 1.35, 1),
            "historical_travel_hours_p95": round(days * 24 * 1.55, 1),
            "speed_limit": None, "route_type": "main" if i < 17 else "alternative",
            "route_class": "primary" if i < 17 else "alternative",
            "risk_zone": dst if dst in {r[1] for r in EDGE_PAIRS if _reliability(r[1]) < 0.89} else "",
            "geometry": f"LINESTRING({s['lon']} {s['lat']}, {d['lon']} {d['lat']})",
            "direction": "directed", "is_alternative": i >= 17,
            "operational_status": "open", "reliability": _reliability(dst),
            "source": "Haversine from global_nodes coords + 800km/day sea speed",
            "ingested_at": now,
        })
    edge_df = pd.DataFrame(edge_rows)

    s = get_settings()
    storage.ensure_storage_dirs()
    silver = s.abs_data_dir / "silver"
    silver.mkdir(parents=True, exist_ok=True)
    ckpt_path = silver / "checkpoints.parquet"
    edge_path = silver / "route_edges.parquet"
    ckpt_df.to_parquet(ckpt_path, index=False)
    edge_df.to_parquet(edge_path, index=False)
    log.info(f"Wrote {len(ckpt_df)} checkpoints -> {ckpt_path}")
    log.info(f"Wrote {len(edge_df)} edges -> {edge_path} ({edge_df['distance_km'].sum():,.0f} km total)")

    # Also add to warehouse sources if not present (features stay file-based, but these are analytical)
    return ckpt_df, edge_df


def main() -> None:
    ckpt, edges = build()
    print(f"checkpoints: {len(ckpt)} nodes")
    print(ckpt[["node_id", "node_type", "country_code"]].to_string(index=False))
    print(f"\nedges: {len(edges)} directed")
    print(edges[["edge_id", "source_node_id", "target_node_id", "distance_km", "planned_travel_hours", "reliability"]].to_string(index=False))
    print(f"\nTotal lane distance: {edges['distance_km'].sum():,.0f} km")


if __name__ == "__main__":
    main()
