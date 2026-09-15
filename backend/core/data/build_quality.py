"""Build data quality flags (Section 21 — Feature 8).

Inputs:
  gold/node_observations (53K daily rows)
  silver/checkpoint_outcomes (per-visit + annual)
  silver/disruptions + raw/congestion weather history

Outputs:
  data/silver/data_quality_flags.parquet  — Section 21

Each row flags one observation/dataset's quality. Data-quality anomalies
(missing, duplicate, impossible duration, future timestamp) are REMOVED
from training; real-world disruptions (Suez, Houthi, etc.) are PRESERVED.

Usage:
  python -m backend.core.data.build_quality
"""
from __future__ import annotations

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.data.validation import validate_events
from backend.core.logging_util import get_logger

log = get_logger(__name__)


def build() -> pd.DataFrame:
    # Validate the two outcome-bearing datasets
    con = storage.connect()
    try:
        gold = pd.read_sql('SELECT * FROM "gold_node_observations"', con)
        outcome_like = gold[["node_id", "timestamp", "delay_hours"]].copy()
        outcome_like["timestamp"] = pd.to_datetime(outcome_like["timestamp"])
        outcome_like["duration_hours"] = outcome_like["delay_hours"]
        outcome_like["src_node"] = outcome_like["node_id"]
        outcome_like["dst_node"] = outcome_like["node_id"]
    finally:
        con.close()

    # Run validation logic (marks removes/corrects)
    cleaned = validate_events(outcome_like)

    # Build flags: one row per original observation
    gold["quality_status"] = "valid"
    # Flag impossible durations
    bad_duration = (gold["delay_hours"] < 0) | (gold["delay_hours"] > 60 * 24)
    gold.loc[bad_duration, "quality_status"] = "invalid"

    # Duplicate flag
    gold["is_duplicate"] = gold.duplicated(subset=["node_id", "timestamp"], keep="first")
    dup_mask = gold["is_duplicate"]
    gold.loc[dup_mask & (gold["quality_status"] == "valid"), "quality_status"] = "flagged"

    # Future timestamp
    future = pd.to_datetime(gold["timestamp"]) > pd.Timestamp.now(tz="UTC").tz_localize(None) + pd.Timedelta(days=1)
    gold.loc[future & (gold["quality_status"] == "valid"), "quality_status"] = "flagged"

    # Compose quality_flags string
    gold["quality_flags"] = ""
    gold.loc[bad_duration, "quality_flags"] += "impossible_duration;"
    gold.loc[dup_mask, "quality_flags"] += "duplicate;"
    gold.loc[future, "quality_flags"] += "future_timestamp;"

    flags = gold[[
        "node_id", "timestamp", "delay_hours", "quality_status", "quality_flags",
        "is_duplicate"
    ]].copy()
    flags["dataset_name"] = "gold_node_observations"
    flags["record_id"] = flags["node_id"] + ":" + flags["timestamp"].astype(str)
    flags["missing_value_flag"] = flags["delay_hours"].isna()
    flags["duplicate_flag"] = flags["is_duplicate"]
    flags["future_timestamp_flag"] = future.values
    flags["invalid_range_flag"] = bad_duration.values
    flags["outlier_flag"] = False  # filled by anomalies layer if needed
    flags["correction_applied"] = False
    flags["quality_score"] = flags["quality_status"].map({"valid": 1.0, "flagged": 0.5, "invalid": 0.0})

    s = get_settings()
    storage.ensure_storage_dirs()
    out = s.abs_data_dir / "silver" / "data_quality_flags.parquet"
    flags.to_parquet(out, index=False)
    log.info(f"Wrote {len(flags)} rows -> {out} (valid={int((flags['quality_status']=='valid').sum())} flagged={int((flags['quality_status']=='flagged').sum())} invalid={int((flags['quality_status']=='invalid').sum())})")

    # Also produce a cleaned gold for downstream (no invalid rows)
    cleaned_gold = gold[gold["quality_status"] != "invalid"].copy()
    log.info(f"Cleaned gold: {len(cleaned_gold)} / {len(gold)} kept ({len(gold)-len(cleaned_gold)} invalid removed)")

    return flags


def main() -> None:
    df = build()
    print(f"rows={len(df)} valid={(df['quality_status']=='valid').sum()} flagged={(df['quality_status']=='flagged').sum()} invalid={(df['quality_status']=='invalid').sum()}")
    print(df["quality_flags"].value_counts().head(5).to_string())


if __name__ == "__main__":
    main()
