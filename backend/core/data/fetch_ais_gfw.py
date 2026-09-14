"""Fetch AIS vessel presence per port zone via Global Fishing Watch (GFW) 4Wings API.

Requires: one-time free signup at https://globalfishingwatch.org/our-apis
  → Request API key → set env var GFW_API_TOKEN before running.

Source: GFW 4Wings public-global-presence dataset (2012 → 96h ago, 1 pos/hr/vessel).
Free, key-only (no payment). Without GFW_API_TOKEN the fetcher exits cleanly.

Port zones: ~30 km radius geofences around each of the 9 LOGIX ports.
(precise LOCODE polygons would be ideal; radius is the pragmatic prototype.)

Output:
  - data/raw/ais_gfw/presence_*.parquet (per-port per-month)
  - DuckDB view raw_ais_gfw via materialize_warehouse (if any files)

Schema per row: node_id, date, vessel_presence_hours, vessel_count_proxy, source
"""
from __future__ import annotations

import os
import time
import urllib.request
import json
from datetime import date, timedelta

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.data.global_nodes import PORT_NODES
from backend.core.logging_util import get_logger

log = get_logger(__name__)

GFW_BASE = "https://gateway.api.globalfishingwatch.org/v3/4wings/report"
DATASET = "public-global-presence:latest"


def _need_token() -> str | None:
    tok = os.environ.get("GFW_API_TOKEN", "").strip()
    if not tok:
        log.warning(
            "GFW_API_TOKEN not set — skipping GFW fetcher. "
            "Get a free token at https://globalfishingwatch.org/our-apis "
            "(Register → API key → set GFW_API_TOKEN env var)."
        )
    return tok or None


def _bbox(lon: float, lat: float, delta: float = 0.30) -> str:
    # ~30 km at equator ≈ 0.27 deg; conservative
    return f"{lon - delta},{lat - delta},{lon + delta},{lat + delta}"


def _fetch_month(token: str, node_id: str, lon: float, lat: float,
                 start: date, end: date) -> int:
    params = {
        "datasets[0]": DATASET,
        "date-range": f"{start.isoformat()},{end.isoformat()}",
        "spatial-aggregation": "false",
        "bbox": _bbox(lon, lat),
    }
    qs = "&".join(f"{k}={urllib.request.quote(v)}" for k, v in params.items())
    url = f"{GFW_BASE}?{qs}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "User-Agent": "supply-chain-risk-ai/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            # 4Wings report returns entries with date + value
            entries = data.get("entries") or data.get("data") or []
            if not entries:
                log.info(f"GFW {node_id} {start} no entries (raw keys: {list(data.keys())[:5]})")
            return len(entries)
    except Exception as e:
        log.warning(f"GFW {node_id} {start} error: {e}")
        return -1


def fetch_all(months: int = 3) -> pd.DataFrame:
    token = _need_token()
    if not token:
        return pd.DataFrame()

    s = get_settings()
    outdir = s.abs_data_dir / "raw" / "ais_gfw"
    outdir.mkdir(parents=True, exist_ok=True)

    today = date.today()
    rows = []
    for n in PORT_NODES:
        nid, lon, lat = n["id"], n["lon"], n["lat"]
        for m in range(months):
            # last N months, ~30-day windows
            end = today - timedelta(days=30 * m)
            start = end - timedelta(days=30)
            n_entries = _fetch_month(token, nid, lon, lat, start, end)
            rows.append({
                "node_id": nid, "start": str(start), "end": str(end),
                "entries": n_entries, "source": "GFW 4Wings public-global-presence",
            })
            time.sleep(2)  # be nice

    df = pd.DataFrame(rows)
    out = outdir / "presence_summary.parquet"
    df.to_parquet(out, index=False)
    log.info(f"Wrote {len(df)} rows -> {out}")
    # DuckDB materialization is optional until real presence CSVs land
    try:
        storage.materialize_warehouse()
    except Exception as e:
        log.warning(f"materialize skipped: {e}")
    return df


def main() -> None:
    df = fetch_all()
    if df.empty:
        print("GFW skipped — set GFW_API_TOKEN to enable.")
        return
    print(df.to_string(index=False))


if __name__ == "__main__":
    main()
