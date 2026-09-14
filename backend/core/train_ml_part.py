"""T1.3 ML part - items 11-14 (PREDICT).

Trains on the packaged, chronologically split datasets
``data/ml/{train,val,test}.parquet`` (built by
``backend.core.data.build_features``) and produces the graph handoff:

  11. checkpoint-level risk prediction   -> delay_probability (calibrated)
  12. checkpoint delay classification    -> predicted_delay_flag (p > 0.5)
  13. delay magnitude prediction         -> expected_delay_hours (point model)
  14. probabilistic delay forecasting    -> delay_p50/p80/p90/p95_hours

Outputs (per docs/ML_GRAPH_CONTRACT.md):
  data/ml/predictions.parquet        - test-slice predictions, contract schema
  data/ml/model_evaluation.parquet   - per (version x split) [+ per-quantile] metrics
  artifacts/{classifier,delay_model,point_model,feature_pipeline}/ - registry models

Usage:
    python -m backend.core.train_ml_part [--version 1.1.0] [--no-xgboost]
"""
from __future__ import annotations

import argparse
import time
from typing import Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import (HistGradientBoostingClassifier,
                              HistGradientBoostingRegressor)
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import (accuracy_score, average_precision_score,
                             brier_score_loss, f1_score, log_loss,
                             mean_absolute_error, mean_squared_error,
                             median_absolute_error, precision_score, r2_score,
                             recall_score, roc_auc_score)
from sklearn.preprocessing import OneHotEncoder

from backend.core.config import get_settings
from backend.core.evaluate import calibration
from backend.core.logging_util import get_logger
from backend.core.models import registry
from backend.core.models.delay import MonotoneQuantile

log = get_logger(__name__)

# Feature exclusion per docs/ML_GRAPH_CONTRACT.md (identifiers/targets/split/labels).
FEATURE_EXCLUDE = {
    "node_id", "timestamp", "delay_hours", "delay_flag", "split",
    "label_source", "annual_delay_mean", "cppi_score",
    "checkpoint_id", "date", "country",
}
QUANTILES = [0.50, 0.80, 0.90, 0.95]
_CONTRACT_FLAG_THRESHOLD = 0.5


def _utcnow() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_splits() -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    s = get_settings()
    ml = s.abs_data_dir / "ml"
    tr = pd.read_parquet(ml / "train.parquet")
    va = pd.read_parquet(ml / "val.parquet")
    te = pd.read_parquet(ml / "test.parquet")
    log.info(f"loaded splits: train={tr.shape} val={va.shape} test={te.shape}")
    return tr, va, te


def build_feature_plan(tr: pd.DataFrame) -> Dict:
    """Numeric features (contract rule) + one-hot for multi-level categoricals.

    Categorical detection keys on *non-numeric dtype* (works for object and
    Arrow-backed string columns alike); single-level columns are dropped.
    """
    num_cols, cat_cols, dropped = [], [], []
    for c in tr.columns:
        if c in FEATURE_EXCLUDE:
            continue
        if pd.api.types.is_numeric_dtype(tr[c].dtype):
            num_cols.append(c)
        elif tr[c].astype(str).nunique(dropna=True) > 1:
            cat_cols.append(c)
        else:
            dropped.append(c)
    log.info(f"numeric={len(num_cols)} onehot={cat_cols} dropped_const={dropped}")
    return {"numeric": num_cols, "categorical": cat_cols, "dropped": dropped}


def fit_preprocess(tr: pd.DataFrame, plan: Dict) -> Dict:
    num, cat = plan["numeric"], plan["categorical"]
    imp = SimpleImputer(strategy="median")
    num_imp = pd.DataFrame(
        imp.fit_transform(tr[num].astype(float)), columns=num, index=tr.index)
    enc = None
    if cat:
        cat_filled = tr[cat].fillna("missing").astype(str)
        enc = OneHotEncoder(handle_unknown="ignore", sparse_output=False, drop="first")
        enc.fit(cat_filled)
        ohe_names = list(enc.get_feature_names_out(cat))
        ohe = pd.DataFrame(enc.transform(cat_filled), columns=ohe_names, index=tr.index)
        X = pd.concat([num_imp, ohe], axis=1)
    else:
        ohe_names = []
        X = num_imp
    feature_names = num + ohe_names
    return {"imputer": imp, "encoder": enc, "ohe_names": ohe_names,
            "feature_names": feature_names, "plan": plan, "X_train": X}


def apply_preprocess(df: pd.DataFrame, prep: Dict) -> pd.DataFrame:
    num, cat = prep["plan"]["numeric"], prep["plan"]["categorical"]
    num_imp = pd.DataFrame(
        prep["imputer"].transform(df[num].astype(float)), columns=num, index=df.index)
    if cat and prep["encoder"] is not None:
        cat_filled = df[cat].fillna("missing").astype(str)
        ohe = pd.DataFrame(
            prep["encoder"].transform(cat_filled), columns=prep["ohe_names"], index=df.index)
        return pd.concat([num_imp, ohe], axis=1)
    return num_imp


# ------------------------------------------------------------------ models

def fit_classifier(Xtr: np.ndarray, ytr: np.ndarray,
                   Xva: np.ndarray, yva: np.ndarray,
                   use_xgboost: bool) -> Tuple[object, str]:
    pos, neg = int(ytr.sum()), int((ytr == 0).sum())
    spw = max(neg / max(pos, 1), 1.0)
    log.info(f"class imbalance: pos={pos} neg={neg} scale_pos_weight={spw:.2f}")
    if use_xgboost:
        try:
            import xgboost as xgb
            model = xgb.XGBClassifier(
                n_estimators=300, max_depth=6, learning_rate=0.05,
                subsample=0.8, colsample_bytree=0.8,
                scale_pos_weight=spw, eval_metric="aucpr",
                n_jobs=-1, random_state=get_settings().mc_seed,
            )
            model.fit(Xtr, ytr)
            return model, "xgboost"
        except Exception as exc:  # fall through to sklearn
            log.info(f"xgboost unavailable ({exc}); using HistGradientBoosting")
    model = HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.06, max_depth=6,
        min_samples_leaf=20, class_weight="balanced",
        early_stopping=True, validation_fraction=0.12, n_iter_no_change=25,
        random_state=get_settings().mc_seed,
    )
    model.fit(Xtr, ytr)
    return model, "hist_gradient_boosting"


def fit_isotonic(raw_tr: np.ndarray, ytr: np.ndarray) -> IsotonicRegression:
    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(np.asarray(raw_tr).ravel(), np.asarray(ytr).ravel())
    return iso


def optimal_threshold(y: np.ndarray, p: np.ndarray) -> float:
    from sklearn.metrics import precision_recall_curve
    prec, rec, th = precision_recall_curve(y, p)
    f1 = 2 * prec * rec / np.maximum(prec + rec, 1e-12)
    return float(th[np.argmax(f1[:-1])]) if len(th) else 0.5


def calibrated_proba(wrapper: Dict, X: np.ndarray) -> np.ndarray:
    raw = wrapper["base"].predict_proba(np.asarray(X, dtype=np.float32))[:, 1]
    return np.asarray(wrapper["isotonic"].predict(raw)).ravel()


def fit_point_regressor(Xtr: np.ndarray, ytr: np.ndarray) -> HistGradientBoostingRegressor:
    model = HistGradientBoostingRegressor(
        loss="squared_error", max_iter=400, learning_rate=0.06,
        max_leaf_nodes=63, min_samples_leaf=20,
        early_stopping=True, validation_fraction=0.12, n_iter_no_change=25,
        random_state=get_settings().mc_seed,
    )
    model.fit(Xtr, ytr)
    return model


def fit_quantiles(Xtr: np.ndarray, ytr: np.ndarray) -> Dict[str, MonotoneQuantile]:
    models: Dict[str, MonotoneQuantile] = {}
    lower = None
    for q in sorted(QUANTILES):
        raw = HistGradientBoostingRegressor(
            loss="quantile", quantile=q, max_iter=300, learning_rate=0.05,
            max_leaf_nodes=31, early_stopping=True, validation_fraction=0.1,
            n_iter_no_change=30, random_state=get_settings().mc_seed + int(q * 100),
        )
        raw.fit(Xtr, ytr)
        models[f"p{int(q * 100)}"] = MonotoneQuantile(raw, lower=lower)
        lower = models[f"p{int(q * 100)}"]
        log.info(f"quantile Q={q:.2f} trained")
    return models


# ------------------------------------------------------------------ metrics

def _pinball(y: np.ndarray, p: np.ndarray, q: float) -> float:
    err = y - p
    return float(np.mean(np.where(err >= 0, q * err, (q - 1) * err)))


def cls_metrics(y: np.ndarray, p: np.ndarray, thr: float = _CONTRACT_FLAG_THRESHOLD) -> Dict:
    pred = (p >= thr).astype(int)
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1_score": float(f1_score(y, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y, p)),
        "pr_auc": float(average_precision_score(y, p)),
        "log_loss": float(log_loss(y, np.clip(p, 1e-9, 1 - 1e-9))),
        "brier_score": float(brier_score_loss(y, p)),
        "calibration_error": float(calibration.expected_calibration_error(y, p)),
    }


def reg_metrics(y: np.ndarray, p: np.ndarray) -> Dict:
    return {
        "mae": float(mean_absolute_error(y, p)),
        "rmse": float(np.sqrt(mean_squared_error(y, p))),
        "r2": float(r2_score(y, p)),
        "median_absolute_error": float(median_absolute_error(y, p)),
    }


def risk_level(p: float) -> str:
    if p < 0.20:
        return "low"
    if p < 0.50:
        return "moderate"
    if p < 0.80:
        return "high"
    return "severe"


# ------------------------------------------------------------------ main

def run(version: str = "1.1.0", use_xgboost: bool = True) -> Dict:
    s = get_settings()
    t_start = _utcnow()
    tr, va, te = load_splits()

    plan = build_feature_plan(tr)
    prep = fit_preprocess(tr, plan)
    feature_names = prep["feature_names"]
    log.info(f"feature matrix: {len(feature_names)} cols")

    Xtr = prep["X_train"].to_numpy(dtype=np.float32)
    Xva = apply_preprocess(va, prep).to_numpy(dtype=np.float32)
    Xte = apply_preprocess(te, prep).to_numpy(dtype=np.float32)
    ytr = tr["delay_flag"].astype(int).to_numpy()
    yva = va["delay_flag"].astype(int).to_numpy()
    yte = te["delay_flag"].astype(int).to_numpy()
    dtr = tr["delay_hours"].astype(float).to_numpy()
    dva = va["delay_hours"].astype(float).to_numpy()
    dte = te["delay_hours"].astype(float).to_numpy()

    # ---- 11/12. classifier: fit, isotonic-calibrate (train), threshold (val)
    base, family = fit_classifier(Xtr, ytr, Xva, yva, use_xgboost)
    raw_tr = base.predict_proba(Xtr)[:, 1]
    wrapper = {"base": base, "isotonic": fit_isotonic(raw_tr, ytr)}
    p_va = calibrated_proba(wrapper, Xva)
    thr_opt = optimal_threshold(yva, p_va)
    log.info(f"classifier={family} f1_opt_threshold(val)={thr_opt:.4f}")

    # ---- 13. point regressor
    point = fit_point_regressor(Xtr, dtr)

    # ---- 14. quantiles
    qmodels = fit_quantiles(Xtr, dtr)

    # ---- evaluation on all three splits
    splits = {"train": (ytr, dtr, Xtr), "val": (yva, dva, Xva), "test": (yte, dte, Xte)}
    cls_eval, reg_eval, q_eval = {}, {}, {}
    for name, (yy, dd, XX) in splits.items():
        pp = calibrated_proba(wrapper, XX)
        cls_eval[name] = cls_metrics(yy, pp)
        pt = np.clip(point.predict(XX), 0.0, None)
        reg_eval[name] = reg_metrics(dd, pt)
        preds = {k: np.asarray(m.predict(XX)).ravel() for k, m in qmodels.items()}
        order = sorted(preds)
        prev = None
        for k in order:  # monotone enforcement, same as predictor.py
            if prev is not None:
                preds[k] = np.maximum(preds[k], preds[prev])
            prev = k
        q_eval[name] = {}
        for k in order:
            q = {"p50": 0.50, "p80": 0.80, "p90": 0.90, "p95": 0.95}[k]
            pq = np.clip(preds[k], 0.0, None)
            q_eval[name][k] = {
                "quantile": q,
                "pinball_loss": _pinball(dd, pq, q),
                "coverage": float(np.mean(dd <= pq)),
                "calibration_error": float(abs(np.mean(dd <= pq) - q)),
            }
        log.info(
            f"[{name}] cls f1={cls_eval[name]['f1_score']:.3f} "
            f"auc={cls_eval[name]['roc_auc']:.3f} ece={cls_eval[name]['calibration_error']:.4f} | "
            f"point mae={reg_eval[name]['mae']:.3f}h r2={reg_eval[name]['r2']:.3f}"
        )

    # ---- predictions.parquet (test slice, contract schema)
    p_te = calibrated_proba(wrapper, Xte)
    pt_te = np.clip(point.predict(Xte), 0.0, None)
    q_te = {k: np.clip(np.asarray(m.predict(Xte)).ravel(), 0.0, None)
            for k, m in qmodels.items()}
    for k in ("p80", "p90", "p95"):
        prev = {"p80": "p50", "p90": "p80", "p95": "p90"}[k]
        q_te[k] = np.maximum(q_te[k], q_te[prev])
    pred_ts = _utcnow()
    te_reset = te.reset_index(drop=True)
    preds = pd.DataFrame({
        "observation_id": te_reset["node_id"].astype(str) + ":"
                          + pd.to_datetime(te_reset["timestamp"]).dt.strftime("%Y-%m-%d"),
        "shipment_id": None,
        "route_id": None,
        "checkpoint_id": te_reset["node_id"],
        "prediction_timestamp": pd.Timestamp(pred_ts),
        "model_version": version,
        "delay_probability": p_te.astype(float),
        "predicted_delay_flag": (p_te >= _CONTRACT_FLAG_THRESHOLD).astype(int),
        "expected_delay_hours": pt_te.astype(float),
        "delay_p50_hours": q_te["p50"].astype(float),
        "delay_p80_hours": q_te["p80"].astype(float),
        "delay_p90_hours": q_te["p90"].astype(float),
        "delay_p95_hours": q_te["p95"].astype(float),
        "risk_score": p_te.astype(float),
        "risk_level": [risk_level(float(x)) for x in p_te],
        "prediction_confidence": np.clip(1.0 - 2.0 * np.abs(p_te - 0.5), 0.0, 1.0),
    })
    ml_dir = s.abs_data_dir / "ml"
    preds.to_parquet(ml_dir / "predictions.parquet", index=False)
    log.info(f"wrote predictions.parquet: {preds.shape}")

    # ---- model_evaluation.parquet (contract schema)
    def win(df: pd.DataFrame) -> Tuple[str, str]:
        ts = pd.to_datetime(df["timestamp"])
        return ts.min().strftime("%Y-%m-%d"), ts.max().strftime("%Y-%m-%d")

    tr_s, tr_e = win(tr)
    va_s, va_e = win(va)
    te_s, te_e = win(te)
    rows: List[Dict] = []
    for name in ("train", "val", "test"):
        base_row = {
            "model_version": version, "dataset_split": name,
            **cls_eval[name], **reg_eval[name],
            "quantile": np.nan, "pinball_loss": np.nan, "coverage": np.nan,
            "train_start_time": tr_s, "train_end_time": tr_e,
            "validation_start_time": va_s, "validation_end_time": va_e,
            "test_start_time": te_s, "test_end_time": te_e,
            "feature_count": len(feature_names),
            "training_row_count": len(tr),
            "training_timestamp": t_start,
        }
        rows.append(base_row)
        for k, qm in q_eval[name].items():
            qrow = dict(base_row)
            for drop in ("accuracy", "precision", "recall", "f1_score", "roc_auc",
                         "pr_auc", "log_loss", "brier_score", "mae", "rmse", "r2",
                         "median_absolute_error"):
                qrow[drop] = np.nan
            qrow.update(quantile=qm["quantile"], pinball_loss=qm["pinball_loss"],
                        coverage=qm["coverage"], calibration_error=qm["calibration_error"])
            rows.append(qrow)
    shell_cols = list(pd.read_parquet(ml_dir / "model_evaluation.parquet").columns)
    ev = pd.DataFrame(rows).reindex(columns=shell_cols)
    ev.to_parquet(ml_dir / "model_evaluation.parquet", index=False)
    log.info(f"wrote model_evaluation.parquet: {ev.shape}")

    # ---- registry artifacts (API/predictor reuse)
    def _jsonable(d: Dict) -> Dict:
        return {k: (float(v) if isinstance(v, (int, float, np.floating, np.integer)) else v)
                for k, v in d.items()}

    registry.save_model(wrapper, "classifier", feature_names,
                        {**_jsonable(cls_eval["test"]), "threshold_opt": thr_opt},
                        extra={"model_family": family,
                               "use_xgboost": family == "xgboost",
                               "threshold_contract": _CONTRACT_FLAG_THRESHOLD,
                               "onehot": plan["categorical"]},
                        version=version)
    registry.save_model(qmodels, "delay_model", feature_names,
                        _jsonable({f"{k}_{m}": v for k, qm in q_eval["test"].items()
                                   for m, v in qm.items() if m != "quantile"}),
                        extra={"quantiles": QUANTILES}, version=version)
    registry.save_model(point, "point_model", feature_names,
                        _jsonable(reg_eval["test"]), extra={}, version=version)
    joblib.dump({"imputer": prep["imputer"], "encoder": prep["encoder"],
                 "ohe_names": prep["ohe_names"], "plan": plan,
                 "numeric": plan["numeric"],
                 "categorical": plan["categorical"],
                 "feature_names": feature_names, "version": version},
                s.abs_artifact_dir / "feature_pipeline.joblib")
    log.info("saved registry artifacts: classifier, delay_model, point_model, feature_pipeline")

    return {"version": version, "family": family, "threshold_opt": thr_opt,
            "classification": cls_eval, "regression": reg_eval, "quantiles": q_eval}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Train ML part (items 11-14) -> graph handoff files")
    p.add_argument("--version", default="1.1.0")
    p.add_argument("--no-xgboost", action="store_true",
                   help="use sklearn HistGradientBoosting for the classifier")
    args = p.parse_args(argv)
    out = run(version=args.version, use_xgboost=not args.no_xgboost)
    print(f"\nT1.3-ML done: version={out['version']} family={out['family']} "
          f"thr_opt={out['threshold_opt']:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
