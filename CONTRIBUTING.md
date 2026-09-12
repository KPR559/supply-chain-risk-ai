# Contributing

Thanks for helping out! This is a small, focused project — guidelines are short.

## Setup

```bash
pip install -r requirements-dev.txt   # full dev stack (xgboost, torch, shap, ...)
python -m backend.core.train --generate-only
python -m backend.core.train --train-only --no-xgboost
python -m backend.core.train --eval-only
cd frontend && npm install
```

## Running checks

```bash
python -m pytest -m "not slow"       # fast units + HTTP (no artifacts)
python -m pytest                     # full suite, incl. slow engine tests
cd frontend && npm run build         # frontend type/build check
```

## Conventions

- Follow the existing layout in `backend/` (`app/`, `core/`, `api/`, `tests/`)
  and `frontend/`.
- Routes go through `backend/core/graph/topology.py` (data-driven) — never hardcode
  them in logic.
- Thresholds and configuration belong in `backend/core/config.py` / `.env.example`.
- Keep the **lean `backend/requirements.txt`** deployable: algorithms that the
  production runtime needs must not require xgboost / lightgbm / torch / shap.
  Use `--no-xgboost` and the fallback paths already in place.
- Quantile predictions must stay monotone (P50 ≤ P80 ≤ P90).
- Add or update tests in `backend/tests/`; mark integration tests that need trained
  artifacts with `slow` (see `pytest.ini`).

## Submitting changes

1. Create a feature branch.
2. Make focused commits with clear messages.
3. Ensure the fast test set passes.
4. Open a pull request describing the change and how to verify it.

## Notes

- Generated data and artifacts are git-ignored; never commit them.
- Documentation lives in `docs/` — update it if behaviour changes.
