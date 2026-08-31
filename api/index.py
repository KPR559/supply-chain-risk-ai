"""Vercel serverless entrypoint (ASGI adapter).

Receives API gateway events and dispatches them to the FastAPI app.
The whole repo root is added to sys.path so `backend` / `core` resolve.
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _ensure_pickle_aliases() -> None:
    """Make sklearn's Cython loss classes unpicklable in the runtime.

    Model artifacts (joblib) reference classes whose ``__module__`` is the
    extension's *binary* name ``_loss`` (e.g. ``_loss.CyHalfBinomialLoss``).
    Older Python loaders auto-aliased that name into ``sys.modules`` when the
    extension was imported; newer runtimes may not, so register it explicitly.
    """
    try:
        if "_loss" not in sys.modules:
            from sklearn._loss import _loss  # type: ignore[attr-defined]

            sys.modules["_loss"] = _loss  # type: ignore[assignment]
    except Exception:  # pragma: no cover - non-sklearn environments are fine
        pass


_ensure_pickle_aliases()

from mangum import Mangum  # noqa: E402
from backend.main import app  # noqa: E402

handler = Mangum(app, lifespan="off")