"""End-to-end pipeline orchestration shared by CLI, evaluation and runtime.

Builds: raw -> clean -> regime/anomaly -> features -> ML dataset.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from core import storage
from core.config import get_settings
from core.data.anomalies import detect_regime
from core.data.validation import validate_events
from core.features import node_features
from core.features.derived import add_is_delayed
from core.logging_util import get_logger

log = get_logger(__name__)

FEATURE_GROUPS: List[str] = list(node_features.FEATURE_GROUPS.keys())


def load_observations() -> pd.DataFrame:
    return storage.read_partitioned("node_observations", layer="gold")


def prepare_ml_dataset(groups: Optional[List[str]] = None) -> pd.DataFrame:
    """Load gold observations, run anomaly/regime detection, build features and
    return a single ML dataset with feature columns + targets + ids."""
    s = get_settings()
    obs = load_observations()
    obs = add_is_delayed(obs, s.delay_threshold_hours)
    obs = detect_regime(obs)  # adds regime_* columns

    # Sort + preserve identifiers
    obs = obs.sort_values(["node_id", "timestamp"]).reset_index(drop=True)
    feats = node_features.build_features(obs, groups=groups or FEATURE_GROUPS)

    ml = pd.concat([
        obs[["node_id", "timestamp", "delay_hours", "is_delayed"]].reset_index(drop=True),
        feats.reset_index(drop=True),
    ], axis=1)
    ml = ml.dropna(subset=["is_delayed"]).reset_index(drop=True)
    log.info(f"ML dataset prepared: {ml.shape} rows, {ml.shape[1]} cols")
    return ml


def feature_columns(ml: pd.DataFrame) -> List[str]:
    """Columns that are features (excludes identifiers and targets)."""
    exclude = {"node_id", "timestamp", "delay_hours", "is_delayed"}
    return [c for c in ml.columns if c not in exclude]


def build_feature_groups(ml: pd.DataFrame) -> Dict[str, List[str]]:
    """Feature subsets for ablation / explanation grouping."""
    def names(*substrs) -> List[str]:
        return [c for c in feature_columns(ml) if any(s in c for s in substrs)]
    return {
        "base": names("delay_roll", "delay_ewma", "delay_lag", "delay_frequency",
                      "month", "day_of_week", "day_of_year", "week_of_year",
                      "fourier", "season_quarter", "is_holiday", "congestion_index",
                      "congestion_baseline", "weather_severity", "customs_workload",
                      "customs_weekday", "conflict_risk_score"),
        "weather": names("weather_"),
        "congestion": names("congestion_"),
        "conflict": names("conflict_"),
        "regime": names("regime_"),
        "customs": names("customs_"),
    }


def clean_raw_events() -> pd.DataFrame:
    """Validate & clean the raw events file -> parquet to silver."""
    s = get_settings()
    raw = s.abs_data_dir / "raw" / "events.parquet"
    if not raw.exists():
        raise FileNotFoundError("Generate data first (python -m core.pipeline generate)")
    df = pd.read_parquet(raw)
    cleaned = validate_events(df)
    (s.abs_data_dir / "silver").mkdir(parents=True, exist_ok=True)
    cleaned.to_parquet(s.abs_data_dir / "silver" / "cleaned_events.parquet", index=False)
    return cleaned


def overall_split(ml: pd.DataFrame):
    from core.models.classification import split_time
    return split_time(ml)
