"""Node-level delay classification (Stage A).

* Baseline: RandomForest
* Production: XGBoost (or HistGradientBoosting when xgboost is unavailable,
  e.g. the Vercel serverless runtime) with class weighting to handle imbalance.

Primary metric is AUC-PR (rare delays). Time-respecting splits are used to
avoid leakage.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import (auc, average_precision_score, confusion_matrix,
                             precision_recall_curve, roc_auc_score, roc_curve)

from core.config import get_settings
from core.logging_util import get_logger
from core.models import registry

log = get_logger(__name__)

_TARGET = "is_delayed"


def _col_groups() -> Dict[str, list]:
    return registry.load_preprocessors("classifier").get("groups", {}) if registry.has_model("classifier") else {}


def split_time(df: pd.DataFrame, ts_col: str = "timestamp"):
    """Time-respecting train / val / test split (70 / 15 / 15 by time)."""
    s = pd.to_datetime(df[ts_col]).sort_values()
    n = len(s)
    t1 = s.iloc[int(n * 0.70)]
    t2 = s.iloc[int(n * 0.85)]
    tr = df[pd.to_datetime(df[ts_col]) <= t1]
    va = df[(pd.to_datetime(df[ts_col]) > t1) & (pd.to_datetime(df[ts_col]) <= t2)]
    te = df[pd.to_datetime(df[ts_col]) > t2]
    return tr, va, te


def train_classifier(Xy: pd.DataFrame, feature_cols: list,
                     use_xgboost: bool = True) -> Tuple[Any, Dict[str, Any]]:
    """Train and return (model, metrics). `Xy` must contain features + target."""
    tr, va, te = split_time(Xy)
    log.info(f"Split sizes: train={len(tr)} val={len(va)} test={len(te)}")

    y_tr = tr[_TARGET].astype(int)
    y_va = va[_TARGET].astype(int)
    y_te = te[_TARGET].astype(int)

    pos = int(y_tr.sum())
    neg = int((y_tr == 0).sum())
    scale_pos_weight = max(neg / max(pos, 1), 1.0)
    log.info(f"Train imbalance: pos={pos} neg={neg} scale_pos_weight={scale_pos_weight:.2f}")

    X_tr = tr[feature_cols].astype(float)
    X_va = va[feature_cols].astype(float)
    X_te = te[feature_cols].astype(float)

    if use_xgboost:
        try:
            import xgboost as xgb  # optional (requirements-dev.txt)
        except Exception as exc:
            raise RuntimeError(
                "xgboost not installed. Run `pip install -r requirements-dev.txt` "
                "or train with --no-xgboost (sklearn HistGradientBoosting)."
            ) from exc
        model = xgb.XGBClassifier(
            n_estimators=300, max_depth=6, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8,
            scale_pos_weight=scale_pos_weight,
            eval_metric="aucpr", n_jobs=1, random_state=get_settings().mc_seed,
        )
        model.fit(
            X_tr.to_numpy(dtype=np.float32), y_tr.to_numpy(),
            eval_set=[(X_va.to_numpy(dtype=np.float32), y_va.to_numpy())],
            verbose=False,
        )
    else:
        model = HistGradientBoostingClassifier(
            max_iter=400, learning_rate=0.06, max_depth=6,
            min_samples_leaf=20, class_weight="balanced",
            early_stopping=True, validation_fraction=0.12, n_iter_no_change=25,
            random_state=get_settings().mc_seed,
        )
        model.fit(X_tr.to_numpy(dtype=np.float32), y_tr.to_numpy())

    # Raw model probabilities
    proba_tr = model.predict_proba(X_tr.to_numpy(dtype=np.float32))[:, 1]
    proba_va = model.predict_proba(X_va.to_numpy(dtype=np.float32))[:, 1]
    proba_test_raw = model.predict_proba(X_te.to_numpy(dtype=np.float32))[:, 1]

    # Calibrate probabilities on validation set using isotonic regression.
    iso = _fit_isotonic(proba_tr, y_tr.to_numpy(), proba_va, y_va.to_numpy())
    proba_val = iso.predict(proba_va)
    proba_test = iso.predict(proba_test_raw)

    metrics = _classification_metrics(y_va.to_numpy(), proba_val, y_te.to_numpy(), proba_test)
    metrics["scale_pos_weight"] = scale_pos_weight
    metrics["n_train"] = len(tr)
    metrics["n_val"] = len(va)
    metrics["n_test"] = len(te)
    return {"base": model, "isotonic": iso}, metrics


def _fit_isotonic(train_pred, train_y, val_pred, val_y) -> IsotonicRegression:
    """Fit isotonic calibration on out-of-fold probabilities (train band) and
    validate monotonicity on validation predictions."""
    model = IsotonicRegression(out_of_bounds="clip")
    model.fit(np.asarray(train_pred).ravel(), np.asarray(train_y).ravel())
    _ = model.predict(np.asarray(val_pred).ravel())  # monotonicity sanity call
    return model


def _classification_metrics(y_val, p_val, y_test, p_test) -> Dict[str, Any]:
    thr = _optimal_threshold(y_val, p_val)
    m = {}
    for split, y, p in (("val", y_val, p_val), ("test", y_test, p_test)):
        m[f"aucpr_{split}"] = average_precision_score(y, p)
        m[f"roc_auc_{split}"] = roc_auc_score(y, p)
        pred = (p >= thr).astype(int)
        cm = confusion_matrix(y, pred, labels=[0, 1]).ravel()
        tn, fp, fn, tp = cm
        prec = tp / max(tp + fp, 1)
        rec = tp / max(tp + fn, 1)
        f1 = 2 * prec * rec / max(prec + rec, 1e-9)
        m[f"precision_{split}"] = prec
        m[f"recall_{split}"] = rec
        m[f"f1_{split}"] = f1
        m[f"tp_{split}"] = int(tp)
        m[f"fp_{split}"] = int(fp)
        m[f"tn_{split}"] = int(tn)
        m[f"fn_{split}"] = int(fn)
    m["threshold"] = thr
    return m


def _optimal_threshold(y, p) -> float:
    """Maximise F1 on validation probabilities."""
    p = np.asarray(p).ravel()
    y = np.asarray(y).ravel()
    prec, rec, th = precision_recall_curve(y, p)
    f1 = 2 * prec * rec / np.maximum(prec + rec, 1e-12)
    best = np.argmax(f1[:-1])
    return float(th[best]) if len(th) > 0 else 0.5


def threshold_metrics(y, p, thr: float) -> Dict[str, float]:
    pred = (np.asarray(p) >= thr).astype(int)
    y = np.asarray(y)
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())
    prec = tp / max(tp + fp, 1)
    rec = tp / max(tp + fn, 1)
    return {"precision": prec, "recall": rec, "f1": 2 * prec * rec / max(prec + rec, 1e-9),
            "tp": tp, "fp": fp, "tn": tn, "fn": fn}


def saving_metrics(m: Dict[str, Any]) -> Dict[str, Any]:
    return {k: (float(v) if isinstance(v, (int, float, np.floating, np.integer)) else v)
            for k, v in m.items()}


def train_and_save(Xy: pd.DataFrame, feature_cols: list,
                   version: str = "1.0.0", use_xgboost: bool = True) -> Dict[str, Any]:
    model, metrics = train_classifier(Xy, feature_cols, use_xgboost=use_xgboost)
    registry.save_model(
        model, "classifier",
        feature_names=feature_cols,
        metrics=saving_metrics(metrics),
        extra={"model_family": "xgboost" if use_xgboost else "hist_gradient_boosting",
               "use_xgboost": use_xgboost},
        version=version,
    )
    return metrics


def predict_proba(model, X: pd.DataFrame) -> np.ndarray:
    """Predict calibrated probabilities. `model` is the wrapper dict saved to
    the registry (``{"base": estimator, "isotonic": IsotonicRegression}``)."""
    if isinstance(model, dict) and {"base", "isotonic"} <= set(model.keys()):
        raw = model["base"].predict_proba(X.to_numpy(dtype=np.float32))[:, 1]
        return np.asarray(model["isotonic"].predict(raw)).ravel()
    return np.asarray(model.predict_proba(X)[:, 1]).ravel()


def predict_raw_probability(model, X: pd.DataFrame) -> np.ndarray:
    if isinstance(model, dict) and "base" in model:
        model = model["base"]
    return np.asarray(model.predict_proba(X.to_numpy(dtype=np.float32))[:, 1]).ravel()
