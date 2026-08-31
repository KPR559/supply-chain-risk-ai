"""Node-level feature engineering.

Produces all the feature families required by the models while strictly
preventing data leakage: historical/rolling features are computed only from
data *strictly before* the target timestamp (``past_only=True``), and
time-respecting splits are used downstream.
"""
from __future__ import annotations

from typing import List

import numpy as np
import pandas as pd

from core.config import get_settings


def fourier_features(doy: pd.Series, n_terms: int = 3) -> pd.DataFrame:
    """Fourier terms for yearly seasonality."""
    phase = 2 * np.pi * doy.to_numpy(dtype=float) / 365.25
    cols = {}
    for k in range(1, n_terms + 1):
        cols[f"fourier_sin_{k}"] = np.sin(k * phase)
        cols[f"fourier_cos_{k}"] = np.cos(k * phase)
    return pd.DataFrame(cols, index=doy.index)


def _ts(df: pd.DataFrame) -> pd.Series:
    return pd.to_datetime(df["timestamp"])


def _ref_timestamp(df: pd.DataFrame) -> pd.Timestamp:
    """Deterministic 'forecast time' = max timestamp in frame (for feature ctx)."""
    return pd.to_datetime(df["timestamp"]).max()


def time_features(df: pd.DataFrame) -> pd.DataFrame:
    """Calendar-derived features (month, dow, doy, week, holiday, Fourier)."""
    ts = _ts(df)
    out = pd.DataFrame(index=df.index)
    out["month"] = ts.dt.month
    out["day_of_week"] = ts.dt.dayofweek
    out["day_of_year"] = ts.dt.dayofyear
    out["week_of_year"] = ts.dt.isocalendar().week.astype(int)
    out["is_holiday"] = df.get("is_holiday", 0).astype(int)
    fourier = fourier_features(ts.dt.dayofyear, n_terms=3)
    out = pd.concat([out, fourier], axis=1)
    # seasonal categorical (quarter)
    out["season_quarter"] = ((out["month"] - 1) // 3).astype(int)
    return out


def historical_delay_features(df: pd.DataFrame, past_only: bool = True) -> pd.DataFrame:
    """Rolling / EWMA / lag / frequency statistics of delay, grouped per node.

    `past_only=True` guarantees no leakage: rolling windows use
    ``min_periods`` and shift so the target row never sees its own delay or any
    future value in its window.
    """
    ts = _ts(df)
    # Sort within each node for correct rolling.
    df = df.copy()
    df["_ts"] = ts
    df = df.sort_values(["node_id", "_ts"]).reset_index(drop=True)

    delay = df["delay_hours"]
    windows = [7, 30, 90, 365]
    out = pd.DataFrame(index=df.index)
    # Use groupby transform with rolling; shift(1) pushes the window so the
    # current row's delay is not included -> no leakage.
    grp = df.groupby("node_id")
    for w in windows:
        out[f"delay_roll_mean_{w}d"] = grp["delay_hours"].transform(
            lambda s: s.shift(1).rolling(w, min_periods=min(5, w)).mean())
        out[f"delay_roll_std_{w}d"] = grp["delay_hours"].transform(
            lambda s: s.shift(1).rolling(w, min_periods=min(5, w)).std())
    out["delay_ewma"] = grp["delay_hours"].transform(
        lambda s: s.shift(1).ewm(span=14, adjust=False).mean())
    for lag in [1, 3, 7, 14]:
        out[f"delay_lag_{lag}"] = grp["delay_hours"].transform(lambda s: s.shift(lag))

    # Delay frequency: fraction of recent observations classified as delayed.
    thr = get_settings().delay_threshold_hours
    delayed_flag = (df["delay_hours"] > thr).astype(float)
    grp2 = df.assign(_d=delayed_flag).groupby("node_id")
    out["delay_frequency_90d"] = grp2["_d"].transform(
        lambda s: s.shift(1).rolling(90, min_periods=10).mean())
    out["delay_frequency_30d"] = grp2["_d"].transform(
        lambda s: s.shift(1).rolling(30, min_periods=5).mean())

    out = out.sort_index()
    # align with original df if caller passed an unsorted copy
    out.index = df.index
    return out


def congestion_features(df: pd.DataFrame) -> pd.DataFrame:
    """Congestion indices, percentile, trend, anomaly."""
    out = pd.DataFrame(index=df.index)
    grp = df.groupby("node_id")
    out["congestion_index"] = df["congestion_index"]
    # percentile of today's congestion vs historical rolling baseline
    # computed per-node AFTER shift(1) so today's value is not in its own window
    out["congestion_percentile"] = (
        df.groupby("node_id")["congestion_index"]
        .transform(lambda s: s.shift(1).rolling(120, min_periods=20).rank(pct=True))
    )
    out["congestion_trend"] = grp["congestion_index"].transform(
        lambda s: s.shift(1).rolling(14, min_periods=5).mean().diff(7))
    baseline = grp["congestion_index"].transform(
        lambda s: s.shift(1).rolling(90, min_periods=20).mean())
    out["congestion_anomaly"] = df["congestion_index"] - baseline
    out["congestion_baseline"] = baseline
    return out


def weather_features(df: pd.DataFrame) -> pd.DataFrame:
    """Weather severity (already a derived severity score) + flags."""
    out = pd.DataFrame(index=df.index)
    sev = df["weather_severity"]
    out["weather_severity"] = sev
    grp = df.groupby("node_id")
    out["weather_extreme"] = (sev > 0.8).astype(int)
    out["weather_trend"] = grp["weather_severity"].transform(
        lambda s: s.shift(1).rolling(7, min_periods=3).mean().diff())
    out["weather_mean_7d"] = grp["weather_severity"].transform(
        lambda s: s.shift(1).rolling(7, min_periods=3).mean())
    return out


def customs_features(df: pd.DataFrame) -> pd.DataFrame:
    """Customs workload, holiday and weekday effects."""
    out = pd.DataFrame(index=df.index)
    out["customs_workload"] = df.get("customs_workload", 0.0)
    out["is_holiday"] = df.get("is_holiday", 0).astype(int)
    out["customs_weekday_effect"] = df["timestamp"].dt.dayofweek.map(
        lambda d: 1.0 if d in (5, 6) else 0.4 if d == 0 else 0.0)
    grp = df.groupby("node_id")
    out["customs_workload_7d"] = grp["customs_workload"].transform(
        lambda s: s.shift(1).rolling(7, min_periods=3).mean())
    out["customs_risk"] = (
        out["customs_workload"] + 0.5 * out["customs_workload_7d"] + 0.3 * out["is_holiday"]
    )
    return out


def conflict_features(df: pd.DataFrame) -> pd.DataFrame:
    """Conflict proximity / risk score and its trend."""
    out = pd.DataFrame(index=df.index)
    out["conflict_risk_score"] = df.get("conflict_risk_score", 0.0)
    out["conflict_trend"] = df.groupby("node_id")["conflict_risk_score"].transform(
        lambda s: s.shift(1).rolling(14, min_periods=5).mean().diff())
    out["conflict_recency"] = out["conflict_risk_score"]
    return out


def regime_features(df: pd.DataFrame) -> pd.DataFrame:
    """Regime/disruption features (from anomaly detection)."""
    out = pd.DataFrame(index=df.index)
    for c in ("regime_disrupted", "regime_cusum", "regime_iso", "regime_roll_z"):
        out[c] = df.get(c, 0)
    out["regime_days_adj"] = df.groupby("node_id")["regime_disrupted"].transform(
        lambda s: s.rolling(7, min_periods=1).sum())
    return out


FEATURE_GROUPS = {
    "time": time_features,
    "historical": historical_delay_features,
    "congestion": congestion_features,
    "weather": weather_features,
    "customs": customs_features,
    "conflict": conflict_features,
    "regime": regime_features,
}


def build_features(df: pd.DataFrame, groups: List[str] | None = None) -> pd.DataFrame:
    """Combine selected feature groups (default: all).

    Internally sorts by (node_id, timestamp) so rolling/lag computations are
    time-correct, then realigns features to the caller's row order.
    """
    groups = groups or list(FEATURE_GROUPS.keys())
    ts = pd.to_datetime(df["timestamp"])
    sort_key = pd.concat([df["node_id"].astype(str), ts.rename("_ts")], axis=1).sort_values(
        ["node_id", "_ts"]).index
    sorted_df = df.loc[sort_key]
    frames = []
    for g in groups:
        frame = FEATURE_GROUPS[g](sorted_df)
        frames.append(frame)
    feats = pd.concat(frames, axis=1)
    feats = feats.reindex(df.index)
    feats = feats.astype(float, errors="ignore")
    feats = feats.loc[:, ~feats.columns.duplicated()].copy()
    return feats
