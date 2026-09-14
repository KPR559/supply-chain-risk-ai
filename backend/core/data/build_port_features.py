"""Build derived port & operational activity features (Section 10 of LOGIX contract).

Inputs:
  raw_congestion (PortWatch: node_id, date, congestion_index, baseline_90d, 2019-now)
  raw_ais_daily  (Kaggle archive: date, vessel_count, anchored_count, 2023-2025, los_angeles only)
  silver_ais_visits (per-visit: for traffic aggregates)

Outputs:
  data/features/port_activity/port_features.parquet
  DuckDB view is via direct read_parquet (not warehouse materialized — features layer)

Derived columns (Section 10):
  activity_1d, activity_7d_avg, 14d, 30d, 90d
  activity_change_7d_pct, 30d_pct
  activity_zscore, activity_anomaly, activity_anomaly_flag
  congestion_index, congestion_level, port_pressure_index, operational_risk_score

Usage:
  python -m backend.core.data.build_port_features
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
        cong = pd.read_sql("SELECT * FROM raw_congestion", con)
        try:
            ais_daily = pd.read_sql("SELECT * FROM raw_ais_daily", con)
        except Exception:
            ais_daily = pd.DataFrame()
    finally:
        con.close()

    cong["date"] = pd.to_datetime(cong["date"]).dt.normalize()
    cong = cong.sort_values(["node_id", "date"]).reset_index(drop=True)

    # Use congestion_index as the activity proxy (all nodes have it)
    # For los_angeles, also merge AIS vessel_count as activity_1d
    if not ais_daily.empty:
        ais_daily["date"] = pd.to_datetime(ais_daily["date"]).dt.normalize()
        # Merge AIS vessel_count into cong for los_angeles
        cong = cong.merge(
            ais_daily[["date", "vessel_count", "anchored_count"]].rename(
                columns={"vessel_count": "ais_vessel_count", "anchored_count": "ais_anchored"}
            ),
            on="date", how="left"
        )
        # activity_1d = AIS vessel_count where available, else congestion-derived proxy
        cong["activity_1d"] = cong["ais_vessel_count"].fillna(
            (cong["congestion_index"] * 50 + 30).round(1)  # proxy: ~30-80 vessels
        )
    else:
        cong["activity_1d"] = (cong["congestion_index"] * 50 + 30).round(1)

    rows = []
    for nid, g in cong.groupby("node_id"):
        g = g.sort_values("date").reset_index(drop=True)
        s = g["activity_1d"].astype(float)
        g["activity_7d_avg"] = s.rolling(7, min_periods=1).mean().round(2)
        g["activity_14d_avg"] = s.rolling(14, min_periods=1).mean().round(2)
        g["activity_30d_avg"] = s.rolling(30, min_periods=1).mean().round(2)
        g["activity_90d_avg"] = s.rolling(90, min_periods=1).mean().round(2)
        g["activity_change_7d_pct"] = ((s - g["activity_7d_avg"].shift(7)) / g["activity_7d_avg"].shift(7).replace(0, np.nan) * 100).round(1)
        g["activity_change_30d_pct"] = ((s - g["activity_30d_avg"].shift(30)) / g["activity_30d_avg"].shift(30).replace(0, np.nan) * 100).round(1)
        roll_mean = s.rolling(90, min_periods=30).mean()
        roll_std = s.rolling(90, min_periods=30).std().replace(0, np.nan)
        g["activity_zscore"] = ((s - roll_mean) / roll_std).round(3)
        g["activity_anomaly"] = g["activity_zscore"]
        g["activity_anomaly_flag"] = (g["activity_zscore"].abs() > 2).astype(int)

        # Congestion level buckets
        ci = g["congestion_index"].astype(float)
        g["congestion_level"] = pd.cut(ci, bins=[-0.1, 0.2, 0.5, 0.8, 2.0], labels=["low", "moderate", "high", "severe"]).astype(str)

        # Port pressure: congestion * activity deviation
        g["port_pressure_index"] = (ci * (1 + g["activity_zscore"].fillna(0).clip(-2, 2) * 0.15)).round(4).clip(0, 2)
        # Operational risk: weighted
        g["operational_risk_score"] = (0.5 * ci + 0.3 * g["port_pressure_index"].fillna(0) + 0.2 * g["activity_anomaly_flag"] * 0.5).round(4).clip(0, 1)

        rows.append(g)

    out = pd.concat(rows, ignore_index=True).sort_values(["node_id", "date"]).reset_index(drop=True)

    # Select output columns
    keep = ["node_id", "date", "activity_1d", "activity_7d_avg", "activity_14d_avg",
            "activity_30d_avg", "activity_90d_avg", "activity_change_7d_pct",
            "activity_change_30d_pct", "activity_zscore", "activity_anomaly",
            "activity_anomaly_flag", "congestion_index", "congestion_level",
            "port_pressure_index", "operational_risk_score"]
    out = out[keep]

    s = get_settings()
    storage.ensure_storage_dirs()
    feat_dir = s.abs_data_dir / "features" / "port_activity"
    feat_dir.mkdir(parents=True, exist_ok=True)
    f = feat_dir / "port_features.parquet"
    out.to_parquet(f, index=False)
    log.info(f"Wrote {len(out)} rows -> {f} ({out['node_id'].nunique()} nodes)")
    return out


def main() -> None:
    df = build()
    print(f"rows={len(df)} nodes={df['node_id'].nunique()}")
    print(df.groupby("node_id")[["activity_zscore", "operational_risk_score"]].agg(["mean", "max"]).round(3).to_string())
    print(f"\nAnomalies: {int(df['activity_anomaly_flag'].sum())} / {len(df)}")


if __name__ == "__main__":
    main()
