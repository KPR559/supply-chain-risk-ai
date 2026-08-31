"""Model artifact registry.

Persists trained models, preprocessing and metadata (feature names, metrics,
version, training timestamp). The API loads these artifacts rather than
retraining on each request.
"""
from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import numpy as np

from core.config import get_settings
from core.logging_util import get_logger

log = get_logger(__name__)


@dataclass
class ArtifactMeta:
    model_type: str
    version: str
    trained_at: str
    feature_names: List[str]
    metrics: Dict[str, Any]
    extra: Dict[str, Any]


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def save_model(model: Any, name: str, feature_names: List[str],
               metrics: Dict[str, Any], extra: Optional[Dict[str, Any]] = None,
               version: str = "1.0.0", preprocessors: Optional[Dict[str, Any]] = None) -> Path:
    s = get_settings()
    base = s.abs_artifact_dir / name
    base.mkdir(parents=True, exist_ok=True)
    model_path = base / "model.joblib"
    joblib.dump(model, model_path)
    meta = ArtifactMeta(
        model_type=type(model).__name__,
        version=version,
        trained_at=_now_iso(),
        feature_names=list(feature_names),
        metrics=dict(metrics),
        extra=extra or {},
    )
    (base / "metadata.json").write_text(json.dumps(asdict(meta), indent=2), encoding="utf-8")
    if preprocessors:
        joblib.dump(preprocessors, base / "preprocessors.joblib")
    log.info(f"Saved model artifact: {base} ({name})")
    return base


def load_model(name: str) -> Any:
    s = get_settings()
    base = s.abs_artifact_dir / name
    if not (base / "model.joblib").exists():
        raise FileNotFoundError(f"Model artifact not found: {base}")
    return joblib.load(base / "model.joblib")


def load_metadata(name: str) -> Optional[Dict[str, Any]]:
    s = get_settings()
    base = s.abs_artifact_dir / name / "metadata.json"
    if not base.exists():
        return None
    return json.loads(base.read_text(encoding="utf-8"))


def load_preprocessors(name: str) -> Dict[str, Any]:
    s = get_settings()
    base = s.abs_artifact_dir / name / "preprocessors.joblib"
    if not base.exists():
        return {}
    return joblib.load(base)


def has_model(name: str) -> bool:
    return (get_settings().abs_artifact_dir / name / "model.joblib").exists()


def list_models() -> List[str]:
    s = get_settings()
    base = s.abs_artifact_dir
    if not base.exists():
        return []
    return [d.name for d in base.iterdir() if d.is_dir() and (d / "model.joblib").exists()]


def predict_quantiles(models: Dict[str, Any], X) -> Dict[str, np.ndarray]:
    """Runs a dict of quantile models ({'p50': m, ...}) producing arrays."""
    return {q: np.asarray(m.predict(X)).ravel() for q, m in models.items()}
