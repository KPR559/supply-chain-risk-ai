"""Backfill past weather (Open-Meteo archive, no API key) for model training.

Live forecast (data/raw/weather.parquet, 7d rolling) sails the ship.
This history table teaches the model what forecast values mean:
past (weather, delay) pairs per node x date, 2019-now, aligned to
raw_congestion dates.

Sources (free, same severity ruler as the forecast fetcher):
  - https://archive-api.open-meteo.com/v1/archive (temp/wind/precip/weathercode, ERA5)
  - https://marine-api.open-meteo.com/v1/marine with past dates (wave height, sea nodes)

Output:
  - data/raw/weather_history.parquet
  - DuckDB table raw_weather_history

Severity weights stay HAND-SET (domain priors, shared ruler 0-1 across nodes).
History learns the severity -> delay mapping in the gradient-boosting models,
not the ruler itself.

Usage:
  python -m backend.core.data.fetch_weather_history
  python -m backend.core.data.fetch_weather_history --start 2019-01-01 --end 2026-09-01
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
from backend.core.data.fetch_weather import _severity
from backend.core.data.global_nodes import FINAL_NODES, MARINE_KINDS
from backend.core.logging_util import get_logger

log = get_logger(__name__)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"


def _get_json(url: str, params: dict, timeout: int = 60) -> dict:
    qs = urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(f"{url}?{qs}", headers={"User-Agent": "supply-chain-risk-ai/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_node_history(node: dict, start: str, end: str) -> pd.DataFrame:
    lat, lon = node["lat"], node["lon"]
    arch = _get_json(ARCHIVE_URL, {
        "latitude": lat, "longitude": lon, "start_date": start, "end_date": end,
        "daily": "temperature_2m_max,wind_speed_10m_max,precipitation_sum,weathercode",
        "timezone": "UTC",
    })
    daily = arch.get("daily", {})
    dates = daily.get("time", [])
    temps = daily.get("temperature_2m_max", [])
    winds = daily.get("wind_speed_10m_max", [])
    precs = daily.get("precipitation_sum", [])
    codes = daily.get("weathercode", [])

    waves = [0.0] * len(dates)
    if node.get("kind") in MARINE_KINDS:
        try:
            mar = _get_json(MARINE_URL, {
                "latitude": lat, "longitude": lon, "start_date": start, "end_date": end,
                "daily": "wave_height_max", "timezone": "UTC",
            })
            w = mar.get("daily", {}).get("wave_height_max", [])
            if w:
                waves = [0.0 if v is None else float(v) for v in w]
        except Exception as e:
            log.warning(f"marine history failed for {node['id']}: {e} (waves=0)")

    rows = []
    for i, d in enumerate(dates):
        t = float(temps[i]) if i < len(temps) and temps[i] is not None else 0.0
        wnd = float(winds[i]) if i < len(winds) and winds[i] is not None else 0.0
        pr = float(precs[i]) if i < len(precs) and precs[i] is not None else 0.0
        cd = int(codes[i]) if i < len(codes) and codes[i] is not None else 0
        wv = float(waves[i]) if i < len(waves) else 0.0
        rows.append({
            "node_id": node["id"],
            "date": d,
            "temp_max_c": round(t, 1),
            "wind_max_kmh": round(wnd, 1),
            "precip_mm": round(pr, 1),
            "wave_max_m": round(wv, 2),
            "weathercode": cd,
            "weather_severity": _severity(wnd, pr, wv, cd),
            "fetched_at": str(date.today()),
            "source": "open-meteo-archive",
        })
    return pd.DataFrame(rows)


def fetch_all_history(start: str = "2019-01-01", end: str | None = None) -> pd.DataFrame:
    end = end or str(date.today())
    frames = []
    for n in FINAL_NODES:
        try:
            frames.append(fetch_node_history(n, start, end))
            log.info(f"weather history ok: {n['id']}")
        except Exception as e:
            log.warning(f"weather history failed for {n['id']}: {e}")
    if not frames:
        raise RuntimeError("No weather history fetched (network blocked?)")
    df = pd.concat(frames, ignore_index=True)
    s = get_settings()
    storage.ensure_storage_dirs()
    out = s.abs_data_dir / "raw" / "weather_history.parquet"
    df.to_parquet(out, index=False)
    log.info(f"Wrote {len(df)} rows -> {out}")
    counts = storage.materialize_warehouse()
    log.info(f"Warehouse: {counts}")
    return df


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2019-01-01")
    ap.add_argument("--end", default=None)
    args = ap.parse_args()
    df = fetch_all_history(start=args.start, end=args.end)
    print(f"nodes={df['node_id'].nunique()} rows={len(df)} {df['date'].min()}..{df['date'].max()}")


if __name__ == "__main__":
    main()
