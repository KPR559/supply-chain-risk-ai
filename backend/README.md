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

Everything Python lives under `backend/` as importable packages
(`backend.app.*`, `backend.core.*`):

| Path | Purpose |
|---|---|
| `backend/app/` | FastAPI app: `main.py` (app + CORS + `/api/v1` router mount), `api/routes.py` (17 endpoints), `schemas/models.py` (request models) |
| `backend/core/` | ML engine: `config.py`, `pipeline.py`, `storage.py`, `predictor.py` (PredictionEngine singleton), `train.py` (CLI), `auth.py` (DuckDB users + token sessions), `data/` (synthetic/validation/anomalies/loaders), `features/`, `graph/` (topology/network/optional GAT), `models/` (registry/classification/delay), `simulation/` (Monte Carlo), `routing/`, `explain/`, `evaluate/`, `nlp/` |
| `backend/api/` | Vercel serverless entrypoint: `index.py` (Mangum adapter + sklearn `_loss` pickle-alias workaround) |
| `backend/tests/` | `test_api.py` (HTTP), `test_core.py` (units), `test_engine.py` (slow E2E) |
| `backend/requirements.txt` | lean production runtime (sklearn-only, pinned) |
| `backend/requirements-dev.txt` | full dev stack (xgboost, torch, shap, statsmodels, …) |

Repo-root companions (kept at root for tooling): `requirements.txt` /
`requirements-dev.txt` are one-line shims (`-r backend/...`), `pytest.ini`
points at `backend/tests`, `vercel.json` builds `backend/api/index.py`.
Generated, git-ignored: `artifacts/` (trained models + metrics), `data/`
(synthetic datasets), resolved from the repo root via
`backend/core/config.py`.

## Database (DuckDB)

`data/warehouse.duckdb` (path overridable with `DUCKDB_PATH`) is the
project database. Tables:

| Table | Source |
|---|---|
| `raw_events` | `data/raw/events.parquet` |
| `silver_cleaned_events` | `data/silver/cleaned_events.parquet` |
| `gold_node_observations` | `data/gold/node_observations/` parts |
| `raw_alerts` | `data/raw/alerts.parquet` |
| `raw_conflict_events` | `data/raw/conflict_events.parquet` |

Rebuild it any time (runs automatically after data generation):

```bash
python -c "from backend.core.storage import materialize_warehouse; print(materialize_warehouse())"
```

Query it with `read_table(name, where=..., columns=...)` — e.g.
`read_table("gold_node_observations", where="node_id='suez'")`.
`GET /api/v1/health` lists the live tables under `data.warehouse`.

## Auth

`POST /api/v1/login` verifies credentials against the `users` table
(PBKDF2-HMAC-SHA256, 600k iterations, stdlib-only) and issues a 12 h opaque
bearer token stored hashed in `sessions`. `GET /api/v1/me` validates,
`POST /api/v1/logout` revokes. `POST /api/v1/register` creates accounts
(username 3–32 chars, password min 8, `409` on duplicates) and signs the new
user straight in. Default `admin` / `admin123` comes from
`AUTH_USER` / `AUTH_PASS` and is seeded on first login.

## Run

```bash
pip install -r requirements.txt

python -m backend.core.train --generate-only   # synthetic data + validation
python -m backend.core.train --train-only      # classifier + quantile models
python -m backend.core.train --eval-only       # metrics -> artifacts/evaluation.json

uvicorn backend.app.main:app --port 8000   # API + interactive docs at /docs
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

Notes: `backend/requirements.txt` is deliberately lean to stay under Vercel's
500 MB function cap (no xgboost/lightgbm/torch/shap); `backend/api/index.py`
registers the `_loss` pickle alias so the saved sklearn classifier unpickles
on Python 3.12.
