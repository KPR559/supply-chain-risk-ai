"""Fetch geopolitical/conflict risk data for chokepoint nodes (free, keyless).

Strategy:
  Static geopolitical baseline per chokepoint (honest, verifiable)
  + optional GDELT news overlay (rate-limited, use --with-gdelt flag).

Output:
  - data/raw/conflict_events.parquet
  - DuckDB table raw_conflict_events

Schema per row (node x date):
  node_id, date, conflict_risk_score [0-1], baseline_score, source, fetched_at
"""
from __future__ import annotations

import json
import time
import urllib.request
from datetime import date

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.data.global_nodes import STRAIT_NODES, SEA_NODES, CANAL_NODES
from backend.core.logging_util import get_logger

log = get_logger(__name__)

# Known geopolitical baseline risk [0-1] per chokepoint.
_BASELINE_RISK = {
    "strait_of_hormuz":      0.70,
    "bab_el_mandeb":         0.80,
    "strait_of_malacca":     0.25,
    "strait_of_gibraltar":   0.10,
    "taiwan_strait":         0.50,
    "suez":                  0.75,
    "panama_canal":          0.20,
    "indian_ocean":          0.40,
    "cape_of_good_hope":     0.10,
    "english_channel":       0.08,
}

_ESCALATIONS = [
    ("2023-11-19", "2026-12-31", {"bab_el_mandeb", "suez", "indian_ocean"}, 0.10),
    ("2024-01-01", "2026-12-31", {"strait_of_hormuz"}, 0.05),
]

_CHOKEPOINT_NODES = STRAIT_NODES + SEA_NODES + CANAL_NODES

_GDELT_QUERIES = {
    "strait_of_hormuz": '"strait of hormuz"',
    "bab_el_mandeb": '"bab el-mandeb" OR "bab el mandeb"',
    "suez": '"suez canal"',
    "strait_of_malacca": '"strait of malacca"',
    "taiwan_strait": '"taiwan strait"',
    "indian_ocean": '"indian ocean" shipping',
    "strait_of_gibraltar": '"strait of gibraltar"',
    "cape_of_good_hope": '"cape of good hope"',
    "english_channel": '"english channel" shipping',
    "panama_canal": '"panama canal"',
}


def _apply_escalations(baseline: float, node_id: str, d: str) -> float:
    score = baseline
    for start, end, nodes, boost in _ESCALATIONS:
        if node_id in nodes and start <= d <= end:
            score += boost
    return min(1.0, score)


def _fetch_gdelt_count(node_id: str, d: str) -> int:
    q = _GDELT_QUERIES.get(node_id, "")
    if not q:
        return 0
    dt = d.replace("-", "") + "000000"
    url = (
        f"https://api.gdeltproject.org/api/v2/doc/doc"
        f"?query={urllib.request.quote(q)}"
        f"&mode=artlist&maxrecords=50&format=json"
        f"&sort=DateDesc&startdatetime={dt}&enddatetime={dt}"
    )
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return len(data.get("articles", []))
    except Exception as e:
        log.debug(f"GDELT {node_id}/{d}: {e}")
        return -1  # signal failure


def fetch_all(start_year: int = 2019, with_gdelt: bool = False) -> pd.DataFrame:
    today = date.today()
    idx = pd.date_range(f"{start_year}-01-01", today.strftime("%Y-%m-%d"), freq="D")

    rows = []
    for n in _CHOKEPOINT_NODES:
        nid = n["id"]
        base = _BASELINE_RISK.get(nid, 0.15)
        for ts in idx:
            d = ts.strftime("%Y-%m-%d")
            score = _apply_escalations(base, nid, d)
            source = "static-geopolitical"

            if with_gdelt and (today - ts.date()).days <= 7:
                events = _fetch_gdelt_count(nid, d)
                if events > 0:
                    score = min(1.0, score + min(0.3, events * 0.03))
                    source = "static+gdelt"
                time.sleep(6)

            rows.append({
                "node_id": nid, "date": d,
                "conflict_risk_score": round(score, 4),
                "baseline_score": round(base, 4),
                "source": source,
                "fetched_at": str(today),
            })

    df = pd.DataFrame(rows)
    s = get_settings()
    storage.ensure_storage_dirs()
    out = s.abs_data_dir / "raw" / "conflict_events.parquet"
    df.to_parquet(out, index=False)
    log.info(f"Wrote {len(df)} rows -> {out}")
    counts = storage.materialize_warehouse()
    log.info(f"Warehouse: {counts}")
    return df


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--with-gdelt", action="store_true")
    args = parser.parse_args()
    df = fetch_all(with_gdelt=args.with_gdelt)
    print(f"nodes={df['node_id'].nunique()} rows={len(df)}")
    print(df.groupby("node_id")["conflict_risk_score"].agg(["mean", "max"]).to_string())


if __name__ == "__main__":
    main()
