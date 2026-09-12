"""Derived target/helper columns computed during generation."""
from __future__ import annotations

import pandas as pd

from backend.core.config import get_settings


def add_is_delayed(df: pd.DataFrame, threshold_hours: float | None = None) -> pd.DataFrame:
    """Add the boolean delay target from `delay_hours` against the threshold."""
    thr = threshold_hours if threshold_hours is not None else get_settings().delay_threshold_hours
    df = df.copy()
    df["is_delayed"] = (df["delay_hours"] > thr).astype(int)
    return df
