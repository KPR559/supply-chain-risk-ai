"""Event anomaly detection: real-world disruptions vs data-quality issues.

Data-quality anomalies (validation) are cleaned/removed. *Real-world event
anomalies* (Suez blockage, strikes, storms, exceptional congestion) must NOT be
deleted - they are converted into regime / disruption features that feed the ML
models.

Implementation is deliberately practical:

* rolling statistics (z-score on a trailing window)
* CUSUM for drift / level shifts
* Binary-Segmentation style change-point detection on large residuals
* Isolation Forest on engineered risk features as a complementary signal
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from core.logging_util import get_logger

log = get_logger(__name__)


def rolling_zscore(series: pd.Series, window: int = 30, min_periods: int = 15) -> pd.Series:
    """Trailing z-score relative to a rolling window (no future leakage)."""
    roll_mean = series.rolling(window=window, min_periods=min_periods).mean()
    roll_std = series.rolling(window=window, min_periods=min_periods).std().replace(0, np.nan)
    return (series - roll_mean) / roll_std


def cusum_detector(series: pd.Series, threshold: float = 4.0,
                   drift: float = 0.5, start: int = 50) -> pd.Series:
    """CUSUM change-point detector returning a boolean series of level shifts."""
    vals = series.to_numpy(dtype=float)
    out = np.zeros(len(vals), dtype=bool)
    mu = vals[0]
    s_hi, s_lo = 0.0, 0.0
    for i in range(max(start, 1), len(vals)):
        mu = 0.95 * mu + 0.05 * vals[i]
        s_hi = max(0.0, s_hi + (vals[i] - mu - drift))
        s_lo = max(0.0, s_lo - (vals[i] - mu + drift))
        if s_hi > threshold or s_lo > threshold:
            out[i] = True
            s_hi, s_lo = 0.0, 0.0
            mu = vals[i]
    return pd.Series(out, index=series.index)


def binary_segmentation_changepoints(series: pd.Series, min_seg: int = 15,
                                     pval_thresh: float = 0.3, max_depth: int = 4):
    """Recursive binary segmentation change-point detection (approximate).

    Returns a list of index positions identified as change points.
    """
    vals = series.to_numpy(dtype=float)
    n = len(vals)
    cps = []

    def _seg(lo, hi, depth):
        if depth > max_depth or hi - lo < 2 * min_seg:
            return
        ys = vals[lo:hi]
        best = -1
        best_gain = -1.0
        # residual sum of squares based split
        for i in range(min_seg, len(ys) - min_seg):
            left = ys[:i]
            right = ys[i:]
            var0 = ys.var()
            if var0 <= 1e-12:
                break
            gain = var0 - (len(left) / len(ys)) * left.var() - (len(right) / len(ys)) * right.var()
            if gain > best_gain:
                best_gain = gain
                best = i
        if best >= 0 and best_gain > pval_thresh:
            cps.append(lo + best)
            _seg(lo, lo + best, depth + 1)
            _seg(lo + best, hi, depth + 1)

    _seg(0, n, 0)
    return cps


def isolation_forest_flags(features: pd.DataFrame, contamination: float = 0.03,
                           seed: int = 0) -> pd.Series:
    """Outlier flag from Isolation Forest on the given feature columns."""
    X = features.astype(float).fillna(0.0).to_numpy()
    if X.shape[0] < 10 or X.shape[1] < 1:
        return pd.Series([False] * X.shape[0], index=features.index)
    model = IsolationForest(contamination=contamination, random_state=seed, n_jobs=1)
    pred = model.fit_predict(X)
    return pd.Series(pred == -1, index=features.index)


def detect_regime(df: pd.DataFrame,
                  delay_col: str = "delay_hours",
                  node_col: str = "node_id",
                  ts_col: str = "timestamp") -> pd.DataFrame:
    """Add disruption/regime flags to node observations grouped by node.

    Adds columns::

        regime_roll_z      -> rolling z-score of delay
        regime_cusum       -> CUSUM shift flag
        regime_iso         -> Isolation Forest outlier flag
        regime_disrupted   -> aggregated boolean (1 if any detector fired)

    `regime_disrupted` is the feature fed to models.
    """
    df = df.copy()
    df["regime_roll_z"] = 0.0
    df["regime_cusum"] = 0
    df["regime_iso"] = 0
    df["regime_disrupted"] = 0
    for node, g in df.groupby(node_col):
        g = g.sort_values(ts_col)
        delays = g[delay_col].to_numpy(dtype=float)
        z = rolling_zscore(pd.Series(delays), window=30).to_numpy(dtype=float)
        cusum = cusum_detector(pd.Series(delays)).to_numpy(dtype=bool)
        feat = g[[delay_col, "congestion_index", "weather_severity", "conflict_risk_score"]]
        iso = isolation_forest_flags(feat.reset_index(drop=True)).to_numpy(dtype=bool)
        disrupted = ((np.nan_to_num(z) > 3.0) | cusum | iso).astype(int)
        df.loc[g.index, "regime_roll_z"] = np.nan_to_num(z)
        df.loc[g.index, "regime_cusum"] = cusum.astype(int)
        df.loc[g.index, "regime_iso"] = iso.astype(int)
        df.loc[g.index, "regime_disrupted"] = disrupted
    return df


def event_classify(df: pd.DataFrame, delay_col: str = "delay_hours",
                   node_col: str = "node_id") -> pd.Series:
    """Classify detected disruptions into event categories (heuristic but
    anchored in the data). Returns a Series of labels aligned to df.index."""
    labels = []
    for _, r in df.iterrows():
        if not r.get("regime_disrupted", 0):
            labels.append("normal")
            continue
        delay = r.get(delay_col, 0.0)
        cong = r.get("congestion_index", 0.0)
        conflict = r.get("conflict_risk_score", 0.0)
        weather = r.get("weather_severity", 0.0)
        node = r.get(node_col, "")
        if node == "suez" and conflict > 0.6:
            labels.append("geopolitical")
        elif cong > 0.75:
            labels.append("congestion")
        elif weather > 0.75:
            labels.append("weather")
        elif delay > 60:
            labels.append("major_disruption")
        else:
            labels.append("disruption")
    return pd.Series(labels, index=df.index)
