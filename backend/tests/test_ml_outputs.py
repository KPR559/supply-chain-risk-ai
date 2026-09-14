"""Contract tests for the T1.3 ML part outputs (items 11-14).

Covers docs/ML_GRAPH_CONTRACT.md:
  * data/ml/predictions.parquet  - required schema, ranges, monotone quantiles
  * data/ml/model_evaluation.parquet - required schema, splits x quantiles
  * feature exclusion rule (no targets/ids/split/labels as features)
  * registry artifact round-trip (load + predict, when artifacts exist)

Tests that need filled output files skip when the repo still carries the
empty shells, so the suite stays green on a fresh checkout.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.core.config import get_settings

PRED_REQUIRED = [
    "observation_id", "checkpoint_id", "prediction_timestamp", "model_version",
    "delay_probability", "predicted_delay_flag", "expected_delay_hours",
    "delay_p50_hours", "delay_p80_hours", "delay_p90_hours", "delay_p95_hours",
    "risk_score",
]
EVAL_REQUIRED = [
    "model_version", "dataset_split",
    "accuracy", "precision", "recall", "f1_score", "roc_auc", "pr_auc",
    "mae", "rmse", "r2", "median_absolute_error",
    "quantile", "pinball_loss", "coverage", "calibration_error",
    "feature_count", "training_row_count",
]


def _ml_path(name: str):
    return get_settings().abs_data_dir / "ml" / name


def _load_or_skip(name: str) -> pd.DataFrame:
    p = _ml_path(name)
    if not p.exists():
        pytest.skip(f"{name} missing")
    df = pd.read_parquet(p)
    if df.empty:
        pytest.skip(f"{name} is an empty shell")
    return df


def test_predictions_contract_schema():
    df = _load_or_skip("predictions.parquet")
    missing = [c for c in PRED_REQUIRED if c not in df.columns]
    assert not missing, f"missing contract columns: {missing}"
    assert df["observation_id"].is_unique, "observation_id must be unique"
    assert df["observation_id"].notna().all()


def test_predictions_value_ranges():
    df = _load_or_skip("predictions.parquet")
    assert ((df["delay_probability"] >= 0) & (df["delay_probability"] <= 1)).all()
    assert ((df["risk_score"] >= 0) & (df["risk_score"] <= 1)).all()
    assert set(df["predicted_delay_flag"].unique()) <= {0, 1}
    for c in ("expected_delay_hours", "delay_p50_hours", "delay_p80_hours",
              "delay_p90_hours", "delay_p95_hours"):
        assert (df[c] >= 0).all(), f"{c} must be non-negative"
        assert df[c].notna().all(), f"{c} must not contain NaN"
    mono = (
        (df["delay_p50_hours"] <= df["delay_p80_hours"])
        & (df["delay_p80_hours"] <= df["delay_p90_hours"])
        & (df["delay_p90_hours"] <= df["delay_p95_hours"])
    )
    assert bool(mono.all()), "quantiles must satisfy P50<=P80<=P90<=P95"
    assert (df["predicted_delay_flag"] == (df["delay_probability"] >= 0.5).astype(int)).all()


def test_evaluation_contract_schema():
    df = _load_or_skip("model_evaluation.parquet")
    missing = [c for c in EVAL_REQUIRED if c not in df.columns]
    assert not missing, f"missing contract columns: {missing}"
    main = df[df["quantile"].isna()]
    assert set(main["dataset_split"].unique()) >= {"train", "val", "test"}
    qrows = df[df["quantile"].notna()]
    got = set(zip(qrows["dataset_split"], qrows["quantile"].round(2)))
    for split in ("train", "val", "test"):
        for q in (0.50, 0.80, 0.90, 0.95):
            assert (split, q) in got, f"missing quantile row {split} Q={q}"
    # coverage must sit inside [0,1]; pinball non-negative
    assert ((qrows["coverage"] >= 0) & (qrows["coverage"] <= 1)).all()
    assert (qrows["pinball_loss"] >= 0).all()


def test_feature_exclusion_rule():
    """Targets/ids/split/labels must never be model features."""
    from backend.core.train_ml_part import FEATURE_EXCLUDE, build_feature_plan
    tr = pd.read_parquet(_ml_path("train.parquet"))
    assert {"delay_hours", "delay_flag", "split", "node_id", "timestamp"} <= FEATURE_EXCLUDE
    plan = build_feature_plan(tr)
    feats = set(plan["numeric"]) | set(plan["categorical"])
    assert not (feats & FEATURE_EXCLUDE), f"leak columns in features: {feats & FEATURE_EXCLUDE}"
    assert len(feats) > 0


def test_registry_artifact_roundtrip():
    from backend.core.models import registry
    for name in ("classifier", "delay_model", "point_model"):
        if not registry.has_model(name):
            pytest.skip(f"artifact {name} not trained")
    clf = registry.load_model("classifier")
    qmodels = registry.load_model("delay_model")
    point = registry.load_model("point_model")
    assert set(qmodels) >= {"p50", "p80", "p90", "p95"}

    te = pd.read_parquet(_ml_path("test.parquet")).head(50)
    meta = registry.load_metadata("classifier")
    feats = meta["feature_names"]
    prep = __import__("joblib").load(
        get_settings().abs_artifact_dir / "feature_pipeline.joblib")
    from backend.core.train_ml_part import apply_preprocess
    X = apply_preprocess(te, prep).to_numpy(dtype=np.float32)

    from backend.core.models.classification import predict_proba as clf_proba
    from backend.core.models.delay import predict_quantiles
    p = clf_proba(clf, pd.DataFrame(X, columns=feats))
    assert p.shape == (50,) and ((p >= 0) & (p <= 1)).all()
    q = predict_quantiles(qmodels, pd.DataFrame(X, columns=feats))
    assert set(q) >= {"p50", "p80", "p90", "p95"}
    pt = np.asarray(point.predict(X)).ravel()
    assert pt.shape == (50,)

    # cross-check against predictions.parquet (same test slice, same order)
    preds = pd.read_parquet(_ml_path("predictions.parquet")).head(50)
    assert np.allclose(preds["delay_probability"].to_numpy(), p, atol=1e-6)
    assert np.allclose(preds["expected_delay_hours"].to_numpy(),
                       np.clip(pt, 0, None), atol=1e-3)
