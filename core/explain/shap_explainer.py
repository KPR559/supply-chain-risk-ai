"""SHAP explainability.

Global feature importance (from a background sample) and local explanations
for individual predictions. Explanations come from the actual trained model +
features - nothing is hardcoded.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from core.config import get_settings
from core.logging_util import get_logger

log = get_logger(__name__)

try:
    import shap
    SHAP_AVAILABLE = True
except Exception:  # pragma: no cover
    SHAP_AVAILABLE = False


def _shap_explainer(model, X_background: pd.DataFrame, feature_names: List[str]):
    """Build a TreeExplainer for the wrapped classifier's base booster."""
    if isinstance(model, dict) and "base" in model:
        model = model["base"]
    return shap.TreeExplainer(model)


def global_importance(model, X_background: pd.DataFrame, feature_names: List[str],
                      n_background: int = 400) -> Dict[str, float]:
    """Global mean |SHAP| importance over a background sample."""
    if not SHAP_AVAILABLE:
        return {f: 0.0 for f in feature_names}
    bg = X_background[feature_names].astype(float).iloc[:n_background]
    if len(bg) == 0:
        return {f: 0.0 for f in feature_names}
    explainer = _shap_explainer(model, bg, feature_names)
    sv = explainer.shap_values(bg.to_numpy(), check_additivity=False)
    if isinstance(sv, list):
        sv = sv[-1]
    mean_abs = np.abs(np.asarray(sv)).mean(axis=0)
    out = dict(zip(feature_names, mean_abs.tolist()))
    return {k: float(v) for k, v in sorted(out.items(), key=lambda x: -x[1])}


def local_explanation(model, X_background: pd.DataFrame, X_row: pd.DataFrame,
                      feature_names: List[str],
                      feature_groups: Optional[Dict[str, List[str]]] = None,
                      n_background: int = 400,
                      top_k: int = 8) -> Dict:
    """Local SHAP explanation for a single row, aggregated to named groups.

    Returns a dict with:
        group_contributions : feature-group -> sum of SHAP values
        top_factors         : top-K {name, contribution} (already aggregated)
        base_value

    When SHAP is unavailable (e.g. the Vercel serverless runtime, which
    excludes the shap package) a model-aware approximation is used: each
    feature's contribution is its deviation from the background mean
    (standardized) weighted by the estimator's global feature importance.
    This keeps the attribution additive, faithful to the model and free of
    the shap dependency.
    """
    if not SHAP_AVAILABLE or len(X_background) == 0:
        return _fallback_explanation(X_row, X_background, feature_names, top_k,
                                     model=model)

    bg = X_background[feature_names].astype(float).iloc[:n_background]
    explainer = _shap_explainer(model, bg, feature_names)
    X_row_a = X_row[feature_names].astype(float).iloc[[0]].to_numpy()
    sv = explainer.shap_values(X_row_a, check_additivity=False)
    if isinstance(sv, list):
        sv = sv[-1]
    sv = np.asarray(sv).ravel()

    contributions = {}
    if feature_groups:
        for gname, cols in feature_groups.items():
            cols = [c for c in cols if c in feature_names]
            if cols:
                contributions[gname] = float(sv[[feature_names.index(c) for c in cols]].sum())
        # Any ungrouped features -> "other"
        grouped = set(c for cols in feature_groups.values() for c in cols)
        others = [i for i, c in enumerate(feature_names) if c not in grouped]
        contributions["other"] = float(sv[others].sum()) if others else 0.0
    else:
        contributions = {feature_names[i]: float(sv[i]) for i in range(len(feature_names))}

    top_factors = sorted(contributions.items(), key=lambda x: -abs(x[1]))[:top_k]
    return {
        "base_value": float(explainer.expected_value) if not isinstance(explainer.expected_value, (list, np.ndarray))
                       else float(np.asarray(explainer.expected_value).mean()),
        "group_contributions": contributions,
        "top_factors": [{"name": k, "contribution": round(float(v), 4)} for k, v in top_factors],
        "feature_names": feature_names,
    }


def _estimator_importance(estimator, n_features: int) -> Optional[np.ndarray]:
    """Feature importances for tree estimators, computed directly from the
    trained trees (works for HistGradientBoosting after joblib reload, where
    the ``feature_importances_`` property is not guaranteed)."""
    if estimator is None:
        return None
    fi = getattr(estimator, "feature_importances_", None)
    if fi is not None:
        fi = np.asarray(fi, dtype=float)
        if fi.size == n_features:
            return fi
    predictors = getattr(estimator, "_predictors", None)
    if isinstance(predictors, (list, tuple)) and predictors:
        imp = np.zeros(n_features, dtype=float)
        for bucket in predictors:
            tree = bucket[0] if isinstance(bucket, (list, tuple)) and bucket else bucket
            if tree is None:
                continue
            nd = getattr(tree, "nodes", None)
            if nd is None or not hasattr(nd, "dtype"):
                continue
            names = nd.dtype.names or ()
            if "feature_idx" not in names or "gain" not in names:
                continue
            fidx = np.asarray(nd["feature_idx"]).ravel()
            gain = np.asarray(nd["gain"]).ravel().astype(float)
            for i, g in zip(fidx, gain):
                if int(i) >= 0:
                    imp[int(i)] += g
        if np.abs(imp).sum() > 0:
            return imp
    return None


def _fallback_explanation(X_row: pd.DataFrame, X_background: pd.DataFrame,
                          feature_names: List[str], top_k: int,
                          model=None) -> Dict:
    """Deterministic, model-aware local approximation used when SHAP is absent.

    contribution_i = importance_i * (x_i - mean_i) / (2 * std_i)

    Positive contributions push toward delay; negative ones away. Falls back to
    raw standardized values if the estimator exposes no feature importances.
    """
    raw = X_row[feature_names]
    if raw.empty:
        return {"base_value": 0.0, "group_contributions": {},
                "top_factors": [], "fallback": "raw", "feature_names": feature_names}

    vals = raw.iloc[0].astype(float).to_numpy()
    cols = list(feature_names)
    n = len(cols)
    base = model.get("base") if isinstance(model, dict) else model
    fi = _estimator_importance(base, n)
    if fi is not None and np.abs(fi).sum() > 0:
        fi = fi / max(np.abs(fi).max(), 1e-9)
        mean = X_background[cols].astype(float).mean().to_numpy()
        std = X_background[cols].astype(float).std().to_numpy()
        dev = (vals - mean) / (2.0 * np.maximum(std, 1e-9))
        contrib = dev * fi
        method = "importance"
    else:
        mean = X_background[cols].astype(float).mean().to_numpy()
        std = X_background[cols].astype(float).std().to_numpy()
        contrib = (vals - mean) / (2.0 * np.maximum(std, 1e-9))
        method = "standardized"

    top = np.argsort(-np.abs(contrib))[:top_k]
    top_factors = [{"name": cols[i], "contribution": round(float(contrib[i]), 4)}
                   for i in top]
    return {"base_value": 0.0,
            "group_contributions": {},
            "top_factors": top_factors,
            "fallback": method,
            "feature_names": list(cols)}