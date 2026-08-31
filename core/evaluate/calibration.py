"""Calibration of probabilistic predictions.

* reliability / calibration curves for the delay classifier
* quantile coverage checks for the probabilistic ETA / delay forecasts
* calibration error (ECE-like) helpers
"""
from __future__ import annotations

from typing import Dict, Tuple

import numpy as np
import pandas as pd


def calibration_curve(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (bin_means_pred, bin_means_true, count_per_bin)."""
    y = np.asarray(y).ravel()
    p = np.asarray(p).ravel()
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    bin_means_pred = []
    bin_means_true = []
    counts = []
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        if i == n_bins - 1:
            m = p >= lo
        else:
            m = (p >= lo) & (p < hi)
        if m.sum() == 0:
            bin_means_pred.append(np.nan)
            bin_means_true.append(np.nan)
            counts.append(0)
        else:
            bin_means_pred.append(float(p[m].mean()))
            bin_means_true.append(float(y[m].mean()))
            counts.append(int(m.sum()))
    return (np.array(bin_means_pred), np.array(bin_means_true), np.array(counts))


def expected_calibration_error(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> float:
    pm, tm, cnt = calibration_curve(y, p, n_bins)
    mask = cnt > 0
    if mask.sum() == 0:
        return 0.0
    total = float(cnt[mask].sum())
    ece = float(np.sum(np.abs(pm[mask] - tm[mask]) * cnt[mask]) / total)
    return ece


def quantile_coverage(y: np.ndarray, lower: np.ndarray, upper: np.ndarray) -> Dict[str, float]:
    """Fraction of true values within the prediction interval (e.g. [P10,P90])."""
    y = np.asarray(y).ravel()
    lo = np.asarray(lower).ravel()
    hi = np.asarray(upper).ravel()
    covered = float(np.mean((y >= lo) & (y <= hi)))
    return {"coverage": covered, "interval_level": 0.80, "n": len(y)}


def single_quantile_coverage(y: np.ndarray, q_pred: np.ndarray, q_level: float) -> Dict[str, float]:
    """Coverage of a single quantile: fraction of true <= predicted quantile."""
    y = np.asarray(y).ravel()
    qp = np.asarray(q_pred).ravel()
    cov = float(np.mean(y <= qp))
    return {"quantile": q_level, "coverage": cov, "n": len(y)}


def absolute_error(y: np.ndarray, center: np.ndarray) -> Dict[str, float]:
    y = np.asarray(y).ravel()
    c = np.asarray(center).ravel()
    err = np.abs(y - c)
    return {"mae": float(err.mean()), "rmse": float(np.sqrt(np.mean(err ** 2)))}
