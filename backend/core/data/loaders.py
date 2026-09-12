"""Loaders for auxiliary datasets (alerts, conflict events).

These return small lightweight frames used at runtime by the prediction engine.
"""
from __future__ import annotations

import pandas as pd

from backend.core.config import get_settings
from backend.core.storage import list_datasets

_TABLE_BY_FILE = {
    "alerts.parquet": "raw_alerts",
    "conflict_events.parquet": "raw_conflict_events",
}


def _latest_raw(name: str) -> pd.DataFrame:
    table = _TABLE_BY_FILE.get(name)
    if table is not None:
        try:
            from backend.core.storage import read_table
            return read_table(table)
        except FileNotFoundError:
            pass
    s = get_settings()
    p = s.abs_data_dir / "raw" / name
    if p.exists():
        return pd.read_parquet(p)
    return pd.DataFrame()


def load_alerts() -> pd.DataFrame:
    """Load the alert feed, run NLP extraction, aggregate per-node/daily."""
    from backend.core.nlp.event_extractor import alerts_to_features
    from backend.core.storage import read_partitioned
    df = _latest_raw("alerts.parquet")
    if df.empty:
        return pd.DataFrame(columns=["node_id", "date", "alert_count",
                                     "alert_risk_score", "alert_congestion",
                                     "alert_weather", "alert_conflict"])
    agg = alerts_to_features(df)
    return agg


def load_conflict_events() -> pd.DataFrame:
    return _latest_raw("conflict_events.parquet")