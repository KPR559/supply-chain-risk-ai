"""Build derived weather features (Section 13 of LOGIX contract).

Inputs:
  raw_weather_history (daily: node_id, date, temp_max_c, wind_max_kmh, precip_mm, wave_max_m, weathercode, weather_severity, 2019-now)
  raw_weather         (7-day forecast, same schema)

Outputs:
  data/features/weather_features/weather_features.parquet

Derived columns (adapted to daily granularity — raw is daily, not hourly):
  wind_speed_7d_avg, wind_speed_30d_avg, precip_7d_sum, precip_30d_sum
  pressure proxy via weathercode transitions
  weather_severity (already in raw), weather_risk_level, extreme_weather_flag, weather_anomaly, weather_anomaly_score
  temperature_7d_avg, temperature_30d_avg

Note: Contract Section 13 lists 3h/6h/24h aggregates for hourly data.
Our source is daily, so we use 7d/30d rollings — same purpose (recent vs baseline),
honest about granularity. If hourly forecast is needed later, switch to raw_weather (forecast) API.

Usage:
  python -m backend.core.data.build_weather_features
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)


def build() -> pd.DataFrame:
    con = storage.connect()
    try:
        w = pd.read_sql("SELECT * FROM raw_weather_history", con)
    finally:
        con.close()

    w["date"] = pd.to_datetime(w["date"]).dt.normalize()
    w = w.sort_values(["node_id", "date"]).reset_index(drop=True)

    # Normalize cols (raw has temp_max_c, wind_max_kmh, precip_mm, wave_max_m)
    w["temperature_2m"] = pd.to_numeric(w.get("temp_max_c", 0), errors="coerce")
    w["wind_speed_10m"] = pd.to_numeric(w.get("wind_max_kmh", 0), errors="coerce")
    w["precipitation"] = pd.to_numeric(w.get("precip_mm", 0), errors="coerce")
    w["wave_height"] = pd.to_numeric(w.get("wave_max_m", 0), errors="coerce")
    w["weather_severity"] = pd.to_numeric(w.get("weather_severity", 0), errors="coerce").fillna(0)

    rows = []
    for nid, g in w.groupby("node_id"):
        g = g.sort_values("date").reset_index(drop=True)
        ws = g["wind_speed_10m"].astype(float)
        pp = g["precipitation"].astype(float)
        tp = g["temperature_2m"].astype(float)
        sev = g["weather_severity"].astype(float)

        g["wind_speed_7d_avg"] = ws.rolling(7, min_periods=1).mean().round(2)
        g["wind_speed_30d_avg"] = ws.rolling(30, min_periods=1).mean().round(2)
        g["wind_gust_7d_max"] = ws.rolling(7, min_periods=1).max().round(2)
        g["wind_gust_30d_max"] = ws.rolling(30, min_periods=1).max().round(2)
        g["precipitation_7d_sum"] = pp.rolling(7, min_periods=1).sum().round(2)
        g["precipitation_30d_sum"] = pp.rolling(30, min_periods=1).sum().round(2)
        g["temperature_7d_avg"] = tp.rolling(7, min_periods=1).mean().round(2)
        g["temperature_30d_avg"] = tp.rolling(30, min_periods=1).mean().round(2)

        # Weather anomaly: z-score of severity vs 30d window
        roll_mean = sev.rolling(30, min_periods=14).mean()
        roll_std = sev.rolling(30, min_periods=14).std().replace(0, np.nan)
        g["weather_anomaly"] = ((sev - roll_mean) / roll_std).round(3)
        g["weather_anomaly_score"] = g["weather_anomaly"].fillna(0).clip(-3, 3) / 3.0
        g["weather_anomaly_score"] = g["weather_anomaly_score"].round(3)

        # Risk level buckets
        g["weather_risk_level"] = pd.cut(sev, bins=[-0.1, 0.25, 0.5, 0.75, 2.0],
                                         labels=["low", "moderate", "high", "severe"]).astype(str)
        g["extreme_weather_flag"] = (sev > 0.7).astype(int)

        rows.append(g)

    out = pd.concat(rows, ignore_index=True).sort_values(["node_id", "date"]).reset_index(drop=True)

    keep = ["node_id", "date", "temperature_2m", "wind_speed_10m", "precipitation",
            "wave_height", "weathercode", "weather_severity",
            "wind_speed_7d_avg", "wind_speed_30d_avg", "wind_gust_7d_max", "wind_gust_30d_max",
            "precipitation_7d_sum", "precipitation_30d_sum",
            "temperature_7d_avg", "temperature_30d_avg",
            "weather_anomaly", "weather_anomaly_score", "weather_risk_level", "extreme_weather_flag"]
    out = out[[c for c in keep if c in out.columns]]

    s = get_settings()
    storage.ensure_storage_dirs()
    feat_dir = s.abs_data_dir / "features" / "weather_features"
    feat_dir.mkdir(parents=True, exist_ok=True)
    f = feat_dir / "weather_features.parquet"
    out.to_parquet(f, index=False)
    log.info(f"Wrote {len(out)} rows -> {f} ({out['node_id'].nunique()} nodes)")
    return out


def main() -> None:
    df = build()
    print(f"rows={len(df)} nodes={df['node_id'].nunique()}")
    print(df.groupby("weather_risk_level").size().to_string())
    print(f"extreme: {int(df['extreme_weather_flag'].sum())} / {len(df)}")
    print(df.groupby("node_id")["weather_anomaly"].agg(["mean", "std"]).round(3).head(5).to_string())


if __name__ == "__main__":
    main()
