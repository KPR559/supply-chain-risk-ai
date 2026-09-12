"""Training CLI.

Usages::

    python -m backend.core.train                 # full: data -> features -> train both models
    python -m backend.core.train --generate-only
    python -m backend.core.train --train-only
    python -m backend.core.train --eval-only
"""
from __future__ import annotations

import argparse
import json
import sys

from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)


def cmd_generate(seed: int | None = None, years: int = 3) -> None:
    from backend.core.data.synthetic import generate_all
    seed = seed if seed is not None else get_settings().demo_seed
    result = generate_all(seed=seed, years=years)
    from backend.core.pipeline import clean_raw_events
    clean_raw_events()
    log.info(f"Generated {len(result['observations'])} observations")


def cmd_train(version: str = "1.0.0", groups=None, use_xgboost: bool = True) -> dict:
    from backend.core import pipeline
    from backend.core.models import classification, delay

    ml = pipeline.prepare_ml_dataset(groups=groups)
    feats = pipeline.feature_columns(ml)
    ml = ml.dropna(subset=feats).reset_index(drop=True)

    _store_feature_groups(ml)

    cls_metrics = classification.train_and_save(
        ml, feats, version=version, use_xgboost=use_xgboost)
    delay_metrics = delay.train_and_save(ml, feats, version=version)

    metrics = {"classification": cls_metrics, "delay": delay_metrics,
               "n_features": len(feats), "feature_groups": pipeline.build_feature_groups(ml)}
    out_path = get_settings().abs_artifact_dir / "training_summary.json"
    out_path.write_text(json.dumps(metrics, indent=2, default=float), encoding="utf-8")
    log.info(f"Training complete. Summary -> {out_path}")
    return metrics


def _store_feature_groups(ml) -> None:
    from backend.core import pipeline
    from backend.core.config import get_settings
    from pathlib import Path
    base = get_settings().abs_artifact_dir / "feature_meta"
    base.mkdir(parents=True, exist_ok=True)
    (base / "feature_names.json").write_text(
        json.dumps(pipeline.feature_columns(ml)), encoding="utf-8")
    (base / "groups.json").write_text(
        json.dumps(pipeline.build_feature_groups(ml)), encoding="utf-8")


def cmd_eval() -> dict:
    from backend.core import pipeline
    from backend.core.models import classification, delay, registry
    import numpy as np

    ml = pipeline.prepare_ml_dataset()
    feats = pipeline.feature_columns(ml)
    ml = ml.dropna(subset=feats).reset_index(drop=True)
    from backend.core.models.classification import split_time
    tr, va, te = split_time(ml)

    clf = registry.load_model("classifier")
    delay_models = registry.load_model("delay_model")

    # Classification eval
    p_test = classification.predict_proba(clf, te[feats].astype(float))
    y_test = te["is_delayed"].astype(int).values
    from backend.core.evaluate import calibration
    from sklearn.metrics import average_precision_score, roc_auc_score
    cls_eval = {
        "aucpr_test": average_precision_score(y_test, p_test),
        "roc_auc_test": roc_auc_score(y_test, p_test),
        "ece": calibration.expected_calibration_error(y_test, p_test),
    }
    # Delay quantile eval + coverage
    preds = delay.predict_quantiles(delay_models, te[feats].astype(float))
    y_delay = te["delay_hours"].values
    d_eval = {"mae": float(np.mean(np.abs(preds["p50"] - y_delay)))}
    # quantile coverage: fraction of rows where true delay <= predicted q
    for qk in ("p50", "p80", "p90"):
        d_eval[f"coverage_{qk}"] = float(np.mean(y_delay <= preds[qk]))

    report = {"classification_eval": cls_eval, "delay_eval": d_eval,
              "n_test": len(te)}
    out = get_settings().abs_artifact_dir / "evaluation.json"
    out.write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    log.info(f"Evaluation written -> {out}")
    return report


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Train / evaluate the delay system")
    p.add_argument("--generate-only", action="store_true")
    p.add_argument("--train-only", action="store_true")
    p.add_argument("--eval-only", action="store_true")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--years", type=int, default=3)
    p.add_argument("--version", default="1.0.0")
    p.add_argument("--no-xgboost", action="store_true",
                   help="Train the classifier with sklearn RandomForest instead of "
                        "xgboost (used for Vercel deploy, which excludes xgboost)")
    args = p.parse_args(argv)

    if not (args.generate_only or args.train_only or args.eval_only):
        args.generate_only = True
        args.train_only = True
        args.eval_only = True

    if args.generate_only:
        cmd_generate(args.seed, args.years)
    if args.train_only or (not args.generate_only and not args.eval_only):
        cmd_train(version=args.version, use_xgboost=not args.no_xgboost)
    if args.eval_only:
        cmd_eval()
    return 0


if __name__ == "__main__":
    sys.exit(main())
