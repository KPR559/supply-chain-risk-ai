"""Build regime / change-point data (Section 22 — Feature 10).

Inputs:
  gold/node_observations (daily delay + predictors)
  Uses backend.core.data.anomalies.detect_regime (rolling z, CUSUM, Isolation Forest)

Outputs:
  data/features/regimes.parquet  — Section 22

Schema: location_id, checkpoint_id, timestamp, regime_state, change_point_flag,
  change_point_source, change_point_score, regime_duration_days, activity_anomaly,
  delay_anomaly, congestion_anomaly, weather_anomaly, regime_confidence,
  event_category

States: NORMAL, DETERIORATING, DISRUPTION, SEVERE_DISRUPTION, RECOVERY

Change points combine two detectors (previously only state transitions):
  * state transitions between regime_state values
  * binary-segmentation change points on the delay series
    (backend.core.data.anomalies.binary_segmentation_changepoints)
`change_point_source` records which detector(s) fired:
  none / transition / binseg / both.

`event_category` labels each disrupted row via
backend.core.data.anomalies.event_classify:
  normal / disruption / congestion / weather / geopolitical / major_disruption.

Usage:
  python -m backend.core.data.build_regimes
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from pathlib import Path

from backend.core import storage
from backend.core.config import get_settings
from backend.core.data.anomalies import (
    binary_segmentation_changepoints,
    detect_regime,
    event_classify,
)
from backend.core.logging_util import get_logger

log = get_logger(__name__)


def build(gold: pd.DataFrame | None = None,
          out_path=None) -> pd.DataFrame:
    """Build the regimes table.

    `gold` is injectable for testing/rebuilding: when None (default) it is
    read from the warehouse table ``gold_node_observations``. A dataframe with
    columns node_id, timestamp, delay_hours, congestion_index, weather_severity,
    conflict_risk_score reproduces the committed regimes.parquet.
    `out_path` overrides the output location (tests must pass a tmp path so
    the committed file is never clobbered).
    """
    if gold is None:
        con = storage.connect()
        try:
            gold = pd.read_sql('SELECT * FROM "gold_node_observations"', con)
        finally:
            con.close()

    gold["timestamp"] = pd.to_datetime(gold["timestamp"])
    gold = gold.sort_values(["node_id", "timestamp"]).reset_index(drop=True)

    # Run anomaly/regime detection (adds regime_roll_z, regime_cusum, regime_iso, regime_disrupted)
    enriched = detect_regime(gold)

    # Map to Section 22 states per node, with duration tracking
    rows = []
    for nid, g in enriched.groupby("node_id"):
        g = g.sort_values("timestamp").reset_index(drop=True)
        disrupted = g["regime_disrupted"].astype(int).tolist()
        g["regime_state"] = "NORMAL"
        # State assignment: disrupted + severity tier
        for i, row in g.iterrows():
            if row["regime_disrupted"]:
                if row["delay_hours"] > 36:
                    g.loc[i, "regime_state"] = "SEVERE_DISRUPTION"
                elif row["delay_hours"] > 24:
                    g.loc[i, "regime_state"] = "DISRUPTION"
                else:
                    g.loc[i, "regime_state"] = "DETERIORATING"
            elif i > 0 and g.loc[i - 1, "regime_state"] in ("SEVERE_DISRUPTION", "DISRUPTION", "DETERIORATING"):
                g.loc[i, "regime_state"] = "RECOVERY"

        # Change-point flags: state transitions UNION binary-segmentation
        # change points on the delay series.
        states = g["regime_state"].tolist()
        trans_flags = np.array(
            [False] + [states[i] != states[i - 1] for i in range(1, len(states))],
            dtype=bool,
        )
        delay_series = g["delay_hours"].astype(float)
        cps = binary_segmentation_changepoints(
            delay_series.fillna(delay_series.median())
        )
        binseg_flags = np.zeros(len(g), dtype=bool)
        for pos in cps:
            if 0 <= pos < len(g):
                binseg_flags[pos] = True
        g["change_point_flag"] = trans_flags | binseg_flags
        src = np.full(len(g), "none", dtype=object)
        src[trans_flags & ~binseg_flags] = "transition"
        src[~trans_flags & binseg_flags] = "binseg"
        src[trans_flags & binseg_flags] = "both"
        g["change_point_source"] = src
        g["change_point_score"] = g["regime_roll_z"].abs().round(3)

        # Event-category labels for disrupted rows.
        g["event_category"] = event_classify(g).astype(str).tolist()

        # Regime duration (days in current state)
        durations = []
        cur = 1
        for i in range(len(g)):
            if i > 0 and g.loc[i, "regime_state"] == g.loc[i - 1, "regime_state"]:
                cur += 1
            else:
                cur = 1
            durations.append(cur)
        g["regime_duration_days"] = durations
        g["regime_duration_hours"] = [d * 24 for d in durations]

        # Anomalies per signal (Section 22)
        g["delay_anomaly"] = g["regime_roll_z"].round(3)
        g["activity_anomaly"] = 0.0
        # Congestion/weather anomalies: z-score vs 30d window already in enriched
        for col in ("congestion_index", "weather_severity"):
            grp = g[col]
            roll_mean = grp.rolling(30, min_periods=10).mean()
            roll_std = grp.rolling(30, min_periods=10).std().replace(0, np.nan)
            anom = ((grp - roll_mean) / roll_std).round(3)
            key = "congestion_anomaly" if "congestion" in col else "weather_anomaly"
            g[key] = anom.fillna(0)
        g["disruption_anomaly"] = g["delay_anomaly"]
        g["regime_confidence"] = (0.5 + 0.3 * (g["regime_disrupted"]) + 0.2 * (g["regime_cusum"])).round(3).clip(0, 1)

        for _, r in g.iterrows():
            rows.append({
                "location_id": nid, "checkpoint_id": nid, "node_id": nid,
                "timestamp": r["timestamp"], "regime_state": r["regime_state"],
                "change_point_flag": bool(r["change_point_flag"]),
                "change_point_source": str(r["change_point_source"]),
                "change_point_score": float(r["change_point_score"]),
                "event_category": str(r["event_category"]),
                "regime_duration_days": int(r["regime_duration_days"]),
                "regime_duration_hours": float(r["regime_duration_hours"]),
                "activity_anomaly": float(r.get("activity_anomaly", 0)),
                "delay_anomaly": float(r["delay_anomaly"]),
                "congestion_anomaly": float(r["congestion_anomaly"]),
                "weather_anomaly": float(r["weather_anomaly"]),
                "disruption_anomaly": float(r["disruption_anomaly"]),
                "regime_confidence": float(r["regime_confidence"]),
                "regime_disrupted": int(r["regime_disrupted"]),
                "regime_roll_z": float(r["regime_roll_z"]),
                "regime_cusum": int(r["regime_cusum"]),
                "regime_iso": int(r["regime_iso"]),
            })

    df = pd.DataFrame(rows).sort_values(["node_id", "timestamp"]).reset_index(drop=True)

    s = get_settings()
    storage.ensure_storage_dirs()
    out = Path(out_path) if out_path is not None else s.abs_data_dir / "features" / "regimes.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    log.info(f"Wrote {len(df)} rows -> {out}")
    log.info(f"  states: {df['regime_state'].value_counts().to_dict()}")
    log.info(f"  change_points: {int(df['change_point_flag'].sum())} / {len(df)}")
    return df


def main() -> None:
    df = build()
    print(f"rows={len(df)} nodes={df['node_id'].nunique()}")
    print(df["regime_state"].value_counts().to_string())
    print(f"change_points: {int(df['change_point_flag'].sum())}")
    print(df.groupby("node_id")["change_point_flag"].sum().to_string())


if __name__ == "__main__":
    main()
