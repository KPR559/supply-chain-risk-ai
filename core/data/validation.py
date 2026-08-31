"""Data-quality validation and cleaning for raw event streams.

Focuses on *data-quality* anomalies that should be corrected or removed:
impossible GPS speeds, negative durations, impossible timestamps, missing
mandatory fields, duplicates. Real-world event anomalies are handled separately
in :mod:`core.data.anomalies`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

import pandas as pd

from core.logging_util import get_logger

log = get_logger(__name__)

# Physical/definitional limits (configurable via env in production).
GPS_SPEED_MAX_KPH = 300.0
DURATION_MIN_HOURS = 0.0
DURATION_MAX_HOURS = 60 * 24  # 60 days
MAX_FUTURE_DAYS = 1
MANDATORY_FIELDS = ["timestamp", "src_node", "dst_node"]


@dataclass
class QualityReport:
    total: int = 0
    records_removed: int = 0
    records_corrected: int = 0
    issue_counts: Dict[str, int] = field(default_factory=dict)

    @property
    def kept(self) -> int:
        return self.total - self.records_removed

    def to_dict(self) -> Dict:
        return {
            "total": self.total,
            "kept": self.kept,
            "records_removed": self.records_removed,
            "records_corrected": self.records_corrected,
            "issue_counts": self.issue_counts,
            "removal_rate": round(self.records_removed / self.total, 4) if self.total else 0.0,
        }


def _bump(report: QualityReport, key: str, n: int = 1) -> None:
    report.issue_counts[key] = report.issue_counts.get(key, 0) + int(n)


def _today() -> pd.Timestamp:
    return pd.Timestamp.today().normalize()


def validate_events(df: pd.DataFrame, gps_max=GPS_SPEED_MAX_KPH,
                    future_days=MAX_FUTURE_DAYS) -> pd.DataFrame:
    """Clean a raw events frame, returning the cleaned frame with a `_quality`
    status column and detailing issues via a side-effect log.

    Returns cleaned data (data-quality anomalies removed / corrected).
    """
    report = QualityReport(total=len(df))
    out = df.copy()
    now = _today()
    kept_mask = pd.Series(True, index=out.index)

    # 1) Missing mandatory fields -> remove
    for f in MANDATORY_FIELDS:
        if f in out.columns:
            missing = out[f].isna() | (out[f].astype(str).str.strip() == "")
            n = int(missing.sum())
            if n:
                _bump(report, f"missing_{f}", n)
                kept_mask &= ~missing

    # 2) Impossible GPS speeds -> remove (uncorrectable physical impossibility)
    if "gps_speed_kmh" in out.columns:
        bad = out["gps_speed_kmh"] < 0
        bad = bad | (out["gps_speed_kmh"] > gps_max)
        n = int(bad.sum())
        if n:
            _bump(report, "impossible_gps_speed", n)
            kept_mask &= ~bad

    # 3) Negative durations -> remove
    if "duration_hours" in out.columns:
        neg = out["duration_hours"] < 0
        n = int(neg.sum())
        if n:
            _bump(report, "negative_duration", n)
            kept_mask &= ~neg

    # 4) Impossible duration (too long) -> remove
    if "duration_hours" in out.columns:
        too_long = out["duration_hours"] > DURATION_MAX_HOURS
        n = int(too_long.sum())
        if n:
            _bump(report, "impossible_duration", n)
            kept_mask &= ~too_long

    # 5) Impossible timestamps (future or invalid) -> remove
    if "timestamp" in out.columns:
        ts = pd.to_datetime(out["timestamp"], errors="coerce")
        invalid = ts.isna()
        future = ts > now + pd.Timedelta(days=future_days)
        n = int((invalid | future).sum())
        if n:
            _bump(report, "impossible_timestamp", n)
            kept_mask &= ~(invalid | future)

    # 6) Duplicate records -> remove (keep first)
    dup_cols = [c for c in ["event_id", "timestamp", "src_node", "dst_node"] if c in out.columns]
    if dup_cols:
        dups = out.duplicated(subset=dup_cols, keep="first")
        n = int(dups.sum())
        if n:
            _bump(report, "duplicate", n)
            kept_mask &= ~dups

    out["_keep"] = kept_mask
    report.records_removed = int((~kept_mask).sum())

    # Correct remaining minor issues (e.g. NaN speed -> 0) rather than drop
    correct_count = 0
    if "gps_speed_kmh" in out.columns:
        na_speed = out.loc[kept_mask, "gps_speed_kmh"].isna()
        if na_speed.any():
            out.loc[kept_mask, "gps_speed_kmh"] = out.loc[kept_mask, "gps_speed_kmh"].fillna(0.0)
            correct_count += int(na_speed.sum())
    report.records_corrected = correct_count

    cleaned = out.loc[kept_mask].drop(columns=["_keep"]).reset_index(drop=True)
    report.total = len(df)
    log.info(f"Data quality: {report.to_dict()}")
    return cleaned


def summarize_quality(df: pd.DataFrame) -> Dict:
    """Short summary of the quality of a dataset (missing, duplicates, ranges)."""
    out = {"rows": len(df), "columns": list(df.columns), "missing": {}, "duplicates": 0}
    for c in df.columns:
        n = int(df[c].isna().sum())
        if n:
            out["missing"][c] = n
    out["duplicates"] = int(df.duplicated().sum())
    return out
