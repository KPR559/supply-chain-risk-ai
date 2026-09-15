"""Delay magnitude / distribution prediction (Stage B).

Trains quantile regression models (P50 / P80 / P90) on `delay_hours` using
scikit-learn HistGradientBoosting (quantile loss) with lag and rolling
features, seasonality, weather, congestion, conflict and regime. A SARIMAX
baseline is provided for comparison but is not the production model.

HistGradientBoosting is used instead of LightGBM so the deployed serverless
runtime (Vercel) has no native/libgomp dependency for this stage.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

from backend.core.config import get_settings
from backend.core.logging_util import get_logger
from backend.core.models import registry

log = get_logger(__name__)

_TARGET = "delay_hours"
QUANTILES = [0.50, 0.80, 0.90]


def _pinball(y, p, q) -> float:
    err = y - p
    return float(np.mean(np.where(err >= 0, q * err, (q - 1) * err)))


class MonotoneQuantile:
    """Wraps a fitted quantile regressor and enforces cross-quantile
    ordering (`p_lower <= p` per sample) using the next-lower model's
    predictions during predict. Picklable so the artifact round-trips.
    """

    def __init__(self, base: Any, lower: Optional["MonotoneQuantile"] = None):
        self.base = base
        self.lower = lower

    def predict(self, X):
        y = np.asarray(self.base.predict(X)).ravel()
        if self.lower is not None:
            y = np.maximum(y, self.lower.predict(X))
        return y


def train_quantile_models(Xy: pd.DataFrame, feature_cols: list,
                          quantiles: Optional[list] = None) -> Dict[str, Any]:
    """Train a HistGradientBoosting quantile model per requested quantile.

    Time-respecting split; returns {q: MonotoneQuantile} whose predictions
    are order-enforced against the next-lower quantile.
    """
    from backend.core.models.classification import split_time
    quantiles = quantiles or QUANTILES
    tr, va, te = split_time(Xy)
    y_tr = tr[_TARGET].astype(float).values
    X_tr = tr[feature_cols].astype(float)
    Xn_tr = X_tr.to_numpy(dtype=np.float32)
    Xn_va = va[feature_cols].astype(float).to_numpy(dtype=np.float32)
    Xn_te = te[feature_cols].astype(float).to_numpy(dtype=np.float32)
    y_va = va[_TARGET].astype(float).values
    y_te = te[_TARGET].astype(float).values

    models: Dict[str, Any] = {}
    lower = None
    metrics = {"n_train": len(tr), "n_val": len(va), "n_test": len(te)}
    for q in sorted(quantiles):
        raw = HistGradientBoostingRegressor(
            loss="quantile", quantile=q,
            max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
            early_stopping=True, validation_fraction=0.1, n_iter_no_change=30,
            random_state=get_settings().mc_seed + int(q * 100),
        )
        raw.fit(Xn_tr, y_tr)
        m = MonotoneQuantile(raw, lower=lower)
        name = f"p{int(q * 100)}"
        models[name] = m
        p_va = np.asarray(m.predict(Xn_va)).ravel()
        p_te = np.asarray(m.predict(Xn_te)).ravel()
        metrics[f"mae_p{int(q*100)}_val"] = mean_absolute_error(y_va, p_va)
        metrics[f"mae_p{int(q*100)}_test"] = mean_absolute_error(y_te, p_te)
        metrics[f"rmse_p{int(q*100)}_val"] = float(np.sqrt(mean_squared_error(y_va, p_va)))
        metrics[f"pinball_p{int(q*100)}_test"] = _pinball(y_te, p_te, q)
        lower = models[name]

    # Median model MAE/RMSE as headline
    med = np.asarray(models["p50"].predict(Xn_te)).ravel()
    metrics["mae_test"] = mean_absolute_error(y_te, med)
    metrics["rmse_test"] = float(np.sqrt(mean_squared_error(y_te, med)))
    metrics["quantiles"] = quantiles
    return {"models": models, "metrics": metrics}


def sarimax_baseline_error(Xy: pd.DataFrame) -> Dict[str, Any]:
    """Classical SARIMAX baseline on aggregate delay series (per overall)."""
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    # Aggregate daily mean delay across nodes for a univariate baseline.
    s = Xy.copy()
    s["date"] = pd.to_datetime(s["timestamp"]).dt.normalize()
    daily = s.groupby("date")["delay_hours"].mean().reset_index()
    daily = daily.set_index("date")
    daily.index = pd.DatetimeIndex(daily.index, freq="D")
    n = len(daily)
    if n < 30:
        return {"error": "insufficient data"}
    cut = int(n * 0.85)
    train = daily.iloc[:cut]["delay_hours"]
    test = daily.iloc[cut:]["delay_hours"]
    try:
        model = ExponentialSmoothing(train, seasonal_periods=7, trend="add", seasonal="add")
        fit = model.fit()
        fc = fit.forecast(len(test))
        mae = mean_absolute_error(test.values, fc.values)
        rmse = float(np.sqrt(mean_squared_error(test.values, fc.values)))
        return {"mae": mae, "rmse": rmse, "n_test": len(test)}
    except Exception as e:  # pragma: no cover
        return {"error": str(e)}


def train_and_save(Xy: pd.DataFrame, feature_cols: list, version: str = "1.0.0") -> Dict[str, Any]:
    result = train_quantile_models(Xy, feature_cols)
    registry.save_model(
        result["models"], "delay_model",
        feature_names=feature_cols,
        metrics=result["metrics"],
        extra={"quantiles": QUANTILES},
        version=version,
    )
    # copy metadata for graph model info later
    return result["metrics"]


def predict_quantiles(models: Dict[str, Any], X: pd.DataFrame) -> Dict[str, np.ndarray]:
    Xa = X.to_numpy(dtype=np.float32)
    preds = {q: np.asarray(m.predict(Xa)).ravel() for q, m in models.items()}
    order = sorted(preds)
    prev = None
    for q in order:
        vals = preds[q].copy()
        if prev is not None:
            vals = np.maximum(vals, preds[prev])
        preds[q] = vals
        prev = q
    return preds
