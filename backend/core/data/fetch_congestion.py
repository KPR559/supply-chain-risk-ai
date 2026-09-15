"""Fetch free port-congestion data (IMF PortWatch, no API key) into DuckDB.

Sources (ArcGIS REST, free):
  - Daily_Chokepoints_Data: daily transits n_total + capacity per chokepoint
  - Daily_Ports_Data: daily portcalls + import/export per port
  - PortWatch_ports_database / PortWatch_chokepoints_database: metadata
Docs: https://portwatch.imf.org/pages/data-and-methodology

Output:
  - data/raw/congestion.parquet
  - DuckDB table raw_congestion (via storage.materialize_warehouse)

Schema per row (one row per node x date):
  node_id, portwatch_id, data_type, date, volume (n_total/portcalls),
  capacity, baseline_90d, congestion_index [0-1], fetched_at, source

congestion_index matches gold_node_observations.congestion_index semantics.
Each row's baseline_90d is the trailing 90-day median ending 7 days before
that date (no leakage), so full history is training-ready.

Usage:
  python -m backend.core.data.fetch_congestion             # last 30 days (live)
  python -m backend.core.data.fetch_congestion --full      # full history 2019-now (~50k rows)
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from datetime import date

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)

ARCGIS = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services"

# node_id -> (service, portwatch_id, data_type, count_field)
PORTWATCH_MAP = {
    # chokepoints (world-economy straits/canals)
    "suez": ("Daily_Chokepoints_Data", "chokepoint1", "chokepoint", "n_total"),
    "panama_canal": ("Daily_Chokepoints_Data", "chokepoint2", "chokepoint", "n_total"),
    "bab_el_mandeb": ("Daily_Chokepoints_Data", "chokepoint4", "chokepoint", "n_total"),
    "strait_of_malacca": ("Daily_Chokepoints_Data", "chokepoint5", "chokepoint", "n_total"),
    "strait_of_hormuz": ("Daily_Chokepoints_Data", "chokepoint6", "chokepoint", "n_total"),
    "cape_of_good_hope": ("Daily_Chokepoints_Data", "chokepoint7", "chokepoint", "n_total"),
    "strait_of_gibraltar": ("Daily_Chokepoints_Data", "chokepoint8", "chokepoint", "n_total"),
    "english_channel": ("Daily_Chokepoints_Data", "chokepoint9", "chokepoint", "n_total"),
    "taiwan_strait": ("Daily_Chokepoints_Data", "chokepoint11", "chokepoint", "n_total"),
    # ports (top container / energy ports)
    "singapore": ("Daily_Ports_Data", "port1201", "port", "portcalls"),
    "mumbai": ("Daily_Ports_Data", "port776", "port", "portcalls"),
    "colombo": ("Daily_Ports_Data", "port254", "port", "portcalls"),
    "shanghai": ("Daily_Ports_Data", "port1188", "port", "portcalls"),
    "busan": ("Daily_Ports_Data", "port1065", "port", "portcalls"),
    "los_angeles": ("Daily_Ports_Data", "port664", "port", "portcalls"),
    "new_york": ("Daily_Ports_Data", "port815", "port", "portcalls"),
    "dubai": ("Daily_Ports_Data", "port744", "port", "portcalls"),
    "rotterdam": ("Daily_Ports_Data", "port1114", "port", "portcalls"),
}
# NOTE (port-to-port scope): indian_ocean is open sea with no berth queue —
# it keeps the model default until the AIS-density step.


def _query(service: str, portwatch_id: str, n: int = 120) -> pd.DataFrame:
    base = f"{ARCGIS}/{service}/FeatureServer/0/query"
    params = {"where": f"portid='{portwatch_id}'", "outFields": "*",
              "f": "json", "resultRecordCount": n, "returnGeometry": "false",
              "orderByFields": "date DESC"}
    req = urllib.request.Request(base + "?" + urllib.parse.urlencode(params),
                                 headers={"User-Agent": "supply-chain-risk-ai/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    rows = [f["attributes"] for f in payload.get("features", [])]
    df = pd.DataFrame(rows)
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
        df = df.sort_values("date").reset_index(drop=True)
    return df


def _query_all(service: str, portwatch_id: str, page: int = 1000) -> pd.DataFrame:
    """All history for one port/chokepoint (2019-now, ~2800 rows), paginated."""
    base = f"{ARCGIS}/{service}/FeatureServer/0/query"
    frames, offset = [], 0
    while True:
        params = {"where": f"portid='{portwatch_id}'", "outFields": "*",
                  "f": "json", "resultRecordCount": page, "resultOffset": offset,
                  "returnGeometry": "false", "orderByFields": "date ASC"}
        req = urllib.request.Request(base + "?" + urllib.parse.urlencode(params),
                                     headers={"User-Agent": "supply-chain-risk-ai/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        feats = payload.get("features", [])
        if not feats:
            break
        frames.append(pd.DataFrame([f["attributes"] for f in feats]))
        offset += len(feats)
        if len(feats) < page or payload.get("exceededTransferLimit") is False and len(feats) < page:
            break
        if offset > 10000:
            break
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["date"])
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    return df.sort_values("date").reset_index(drop=True)


def _congestion_index(current: float, baseline: float) -> float:
    if not baseline or baseline <= 0:
        return 0.0
    drop = max(0.0, 1.0 - current / baseline)
    surge = max(0.0, min(current / baseline - 1.0, 1.0))
    return round(float(max(0.0, min(0.65 * drop + 0.35 * surge, 1.0))), 4)


def _history_rows(node_id: str, pw_id: str, dtype: str, count_field: str,
                   df: pd.DataFrame) -> list:
    """One row per date with trailing (no-leakage) baseline."""
    series = pd.to_numeric(df[count_field], errors="coerce").fillna(0.0)
    rows = []
    for i, (_, r) in enumerate(df.iterrows()):
        lo, hi = max(0, i - 97), max(0, i - 7)
        window = series.iloc[lo:hi] if hi > lo else series.iloc[:1]
        baseline = float(window.median()) if len(window) else float(series.iloc[0] or 0.0)
        vol = float(r.get(count_field, 0.0) or 0.0)
        cap = r.get("capacity")
        try:
            cap = float(cap) if cap is not None else 0.0
        except (TypeError, ValueError):
            cap = 0.0
        rows.append({
            "node_id": node_id, "portwatch_id": pw_id, "data_type": dtype,
            "date": r.get("date"), "volume": vol, "capacity": round(cap, 1),
            "baseline_90d": round(baseline, 1),
            "congestion_index": _congestion_index(vol, baseline),
            "fetched_at": str(date.today()), "source": "IMF PortWatch",
        })
    return rows


def fetch_all(days: int = 30, lookback: int = 120, full: bool = False) -> pd.DataFrame:
    out_rows = []
    for node_id, (service, pw_id, dtype, count_field) in PORTWATCH_MAP.items():
        try:
            df = _query_all(service, pw_id) if full else _query(service, pw_id, n=lookback)
        except Exception as e:
            log.warning(f"congestion fetch failed for {node_id}: {e}")
            continue
        if df.empty or count_field not in df.columns:
            log.warning(f"no data for {node_id} ({pw_id})")
            continue
        rows = _history_rows(node_id, pw_id, dtype, count_field, df)
        if not full:
            rows = rows[-days:]
            # attach live snapshot cols for the 30d mode
            series = pd.to_numeric(df[count_field], errors="coerce").fillna(0.0)
            baseline = float(series.iloc[:-7].tail(90).median()) if len(series) > 7 else float(series.median())
            current7 = float(series.tail(7).mean())
            for r in rows:
                r["current_7d"] = round(current7, 1)
        out_rows.extend(rows)
        log.info(f"congestion ok: {node_id} rows={len(rows)}")
    if not out_rows:
        raise RuntimeError("No congestion data fetched (network blocked?)")
    out = pd.DataFrame(out_rows)
    s = get_settings()
    storage.ensure_storage_dirs()
    dest = s.abs_data_dir / "raw" / "congestion.parquet"
    out.to_parquet(dest, index=False)
    log.info(f"Wrote {len(out)} rows -> {dest}")
    counts = storage.materialize_warehouse()
    log.info(f"Warehouse: {counts}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--lookback", type=int, default=120)
    ap.add_argument("--full", action="store_true",
                    help="full history 2019-now instead of last 30 days")
    args = ap.parse_args()
    df = fetch_all(days=args.days, lookback=args.lookback, full=args.full)
    print(f"nodes={df['node_id'].nunique()} rows={len(df)}")
    print(df.groupby("node_id")["congestion_index"].max().sort_values(ascending=False).to_string())


if __name__ == "__main__":
    main()
