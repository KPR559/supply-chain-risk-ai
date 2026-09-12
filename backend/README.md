# Backend — Shipment Delay API (FastAPI)

FastAPI backend for the Frankfurt → India corridor: per-node delay risk,
P50/P80/P90 delay quantiles, Monte Carlo ETA, critical nodes, explanations,
what-if scenarios and route comparison. All JSON under `/api/v1`.

Live: <https://shipment-delay-dashboard.vercel.app> (base `/api/v1`)

## Tech

- FastAPI + uvicorn, Pydantic v2, Mangum (serverless ASGI adapter)
- ML: scikit-learn `HistGradientBoosting` (classifier + quantile regressors),
  NetworkX topology, optional pure-PyTorch GAT and SHAP (dev-only, with
  zero-dependency fallbacks so the serverless bundle stays lean)

## Layout

The backend spans four repo-root folders (kept at root so Python import paths
`backend.*` / `core.*` and the Vercel `api/index.py` entrypoint stay stable):

| Path | Purpose |
|---|---|
| `backend/` | FastAPI app: `main.py` (app + CORS + `/api/v1` router mount), `api/routes.py` (17 endpoints), `schemas/models.py` (request models) |
| `core/` | ML engine: `config.py`, `pipeline.py`, `storage.py`, `predictor.py` (PredictionEngine singleton), `train.py` (CLI), `data/` (synthetic/validation/anomalies/loaders), `features/`, `graph/` (topology/network/optional GAT), `models/` (registry/classification/delay), `simulation/` (Monte Carlo), `routing/`, `explain/`, `evaluate/`, `nlp/` |
| `api/` | Vercel serverless entrypoint: `api/index.py` (Mangum adapter + sklearn `_loss` pickle-alias workaround) |
| `tests/` | `test_api.py` (HTTP), `test_core.py` (units), `test_engine.py` (slow E2E) |
| `requirements.txt` | lean production runtime (sklearn-only, pinned) |
| `requirements-dev.txt` | full dev stack (xgboost, torch, shap, statsmodels, …) |
| `pytest.ini` | `slow` marker for artifact-dependent engine tests |
| `.env.example` | all settings with defaults (see `core/config.py`) |

Generated, git-ignored: `artifacts/` (trained models + metrics), `data/`
(synthetic datasets).

## Run

```bash
pip install -r requirements.txt

python -m core.train --generate-only   # synthetic data + validation
python -m core.train --train-only      # classifier + quantile models
python -m core.train --eval-only       # metrics -> artifacts/evaluation.json

uvicorn backend.main:app --port 8000   # API + interactive docs at /docs
```

Dev/experiments stack: `pip install -r requirements-dev.txt`, then train
without `--no-xgboost` for the XGBoost variant.

## Test

```bash
python -m pytest -m "not slow"   # fast units + HTTP (no artifacts needed)
python -m pytest                 # full suite incl. slow engine tests
```

## Deploy

Serverless API project (`shipment-delay-dashboard`), see
`docs/DEPLOYMENT.md` and root `vercel.json`:

```bash
vercel --prod --yes   # from repo root
```

Notes: `requirements.txt` is deliberately lean to stay under Vercel's 500 MB
function cap (no xgboost/lightgbm/torch/shap); `api/index.py` registers the
`_loss` pickle alias so the saved sklearn classifier unpickles on Python 3.12.
