"""Fetch free weather data (Open-Meteo, no API key) and store in DuckDB.

Sources:
  - Forecast: https://api.open-meteo.com/v1/forecast (temp, wind, precip, weathercode)
  - Marine:   https://marine-api.open-meteo.com/v1/marine (wave height, for sea nodes)

Output:
  - data/raw/weather.parquet (raw layer)
  - DuckDB table raw_weather (via storage.materialize_warehouse)

Schema per row (one row per node x date):
  node_id, date, temp_max_c, wind_max_kmh, precip_mm, wave_max_m,
  weathercode, weather_severity [0-1]

weather_severity matches gold_node_observations.weather_severity semantics.

Usage:
  python -m backend.core.data.fetch_weather
  python -m backend.core.data.fetch_weather --days 7
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
from backend.core.data.global_nodes import MARINE_KINDS, all_weather_nodes
from backend.core.logging_util import get_logger

log = get_logger(__name__)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"


def _get_json(url: str, params: dict, timeout: int = 30) -> dict:
    qs = urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(f"{url}?{qs}", headers={"User-Agent": "supply-chain-risk-ai/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _severity(wind_kmh: float, precip_mm: float, wave_m: float, code: int) -> float:
    wind = min((wind_kmh or 0) / 60.0, 1.0)
    wave = min((wave_m or 0) / 4.0, 1.0)
    rain = min((precip_mm or 0) / 20.0, 1.0)
    code_factor = 1.0 if code in (95, 96, 99) else 0.7 if code in (71, 73, 75, 77, 85, 86) else 0.4 if code >= 51 else 0.0
    sev = 0.4 * wind + 0.3 * wave + 0.2 * rain + 0.1 * code_factor
    return round(float(max(0.0, min(1.0, sev))), 4)


def fetch_node(node: dict, days: int = 7) -> pd.DataFrame:
    lat, lon = node["lat"], node["lon"]
    fc = _get_json(FORECAST_URL, {
        "latitude": lat, "longitude": lon,
        "daily": "temperature_2m_max,wind_speed_10m_max,precipitation_sum,weathercode",
        "timezone": "UTC", "forecast_days": days,
    })
    daily = fc.get("daily", {})
    dates = daily.get("time", [])
    temps = daily.get("temperature_2m_max", [])
    winds = daily.get("wind_speed_10m_max", [])
    precs = daily.get("precipitation_sum", [])
    codes = daily.get("weathercode", [])

    waves = [0.0] * len(dates)
    if node.get("kind") in MARINE_KINDS:
        try:
            mar = _get_json(MARINE_URL, {
                "latitude": lat, "longitude": lon,
                "daily": "wave_height_max", "timezone": "UTC", "forecast_days": days,
            })
            w = mar.get("daily", {}).get("wave_height_max", [])
            if w:
                waves = [0.0 if v is None else float(v) for v in w]
        except Exception as e:  # marine missing for inland grid point -> keep 0
            log.warning(f"marine fetch failed for {node['id']}: {e}")

    rows = []
    for i, d in enumerate(dates):
        t = float(temps[i]) if i < len(temps) and temps[i] is not None else 0.0
        wnd = float(winds[i]) if i < len(winds) and winds[i] is not None else 0.0
        pr = float(precs[i]) if i < len(precs) and precs[i] is not None else 0.0
        cd = int(codes[i]) if i < len(codes) and codes[i] is not None else 0
        rows.append({
            "node_id": node["id"],
            "date": d,
            "temp_max_c": round(t, 1),
            "wind_max_kmh": round(wnd, 1),
            "precip_mm": round(pr, 1),
            "wave_max_m": round(float(waves[i]) if i < len(waves) else 0.0, 2),
            "weathercode": cd,
            "weather_severity": _severity(wnd, pr, float(waves[i]) if i < len(waves) else 0.0, cd),
            "fetched_at": str(date.today()),
            "source": "open-meteo",
        })
    return pd.DataFrame(rows)


def fetch_all(days: int = 7) -> pd.DataFrame:
    nodes = all_weather_nodes()
    frames = []
    for n in nodes:
        try:
            frames.append(fetch_node(n, days=days))
            log.info(f"weather ok: {n['id']}")
        except Exception as e:
            log.warning(f"weather failed for {n['id']}: {e}")
    if not frames:
        raise RuntimeError("No weather data fetched (network blocked?)")
    df = pd.concat(frames, ignore_index=True)
    s = get_settings()
    storage.ensure_storage_dirs()
    out = s.abs_data_dir / "raw" / "weather.parquet"
    df.to_parquet(out, index=False)
    log.info(f"Wrote {len(df)} rows -> {out}")
    counts = storage.materialize_warehouse()
    log.info(f"Warehouse: {counts}")
    return df


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    args = ap.parse_args()
    df = fetch_all(days=args.days)
    print(f"nodes={df['node_id'].nunique()} rows={len(df)}")
    print(df.groupby("node_id")["weather_severity"].max().sort_values(ascending=False).head(10).to_string())


if __name__ == "__main__":
    main()
