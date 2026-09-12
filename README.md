# AI-Powered Predictive Risk & Decision Intelligence for Global Supply Chains

> **Shipment Delay Prediction · Frankfurt → India**

Probabilistic ETA and delay-risk prediction for a **Frankfurt → India** freight
corridor. For every checkpoint on a route it produces:

- a **delay-risk probability** (is this node going to be delayed > 24 h?)
- **delay quantiles** (P50 / P80 / P90 hours)
- a graph-propagated **Monte Carlo ETA** (percentiles, deadline-miss probability)
- **critical-node attribution**, **SHAP-style explanations**, **what-if scenarios**
  and **alternative-route comparison**

Delivered through a **FastAPI** backend and a **React + Vite** dashboard, with a
**serverless (Vercel)** deployment path.

---

## Feature highlights

| Area | What you get |
|---|---|
| Risk | Per-node delay probability from a calibrated gradient-boosted classifier |
| ETA | P50 / P80 / P90 delay quantiles + Monte Carlo simulation over 10 000 routes |
| Graph | Propagation-aware topology; optional pure-PyTorch GAT residual adjustment |
| Decide | What-if scenarios ("Suez +30 % congestion", "Suez closed"), route comparison |
| Explain | SHAP-style per-node attribution (with a zero-dependency fallback) |
| Ship | FastAPI `/api/v1` API, React dashboard, Vercel serverless deployment |

## Quick start

Requirements: **Python ≥ 3.10** (tested on 3.13) and **Node ≥ 18** (tested on 24).

```bash
pip install -r requirements.txt

python -m backend.core.train   # generate data, train models, evaluate
                               # (or step by step: --generate-only / --train-only / --eval-only)

uvicorn backend.app.main:app --port 8000   # API: http://127.0.0.1:8000 (docs at /docs)

cd frontend
npm install
npm run dev                    # dashboard: http://127.0.0.1:5173 (proxies /api -> :8000)
```

> **Dev/experiments only:** install `requirements-dev.txt` for the heavier stack
> (XGBoost, PyTorch GAT, SHAP, statsmodels, matplotlib). The lean
> `requirements.txt` (sklearn-only) is what runs in production.

---

## Repository layout

Two top-level stacks plus shared repo files:

```
supply-chain-risk-ai/
├── frontend/     # React 18 + Vite dashboard  -> frontend/README.md
└── backend/      # FastAPI backend + ML engine -> backend/README.md
    ├── app/      # FastAPI app (backend.app.*)
    ├── core/     # ML engine (backend.core.*)
    ├── api/      # Vercel serverless entrypoint
    └── tests/    # backend tests
```

### Frontend — React (`frontend/`)

React 18 + Vite SPA: route map, risk views, ETA percentiles, simulator,
explanations, reports. See [frontend/README.md](frontend/README.md).

### Backend — FastAPI (`backend/`)

FastAPI app (`backend/app/`), ML engine (`backend/core/`), serverless adapter
(`backend/api/`), tests (`backend/tests/`). See
[backend/README.md](backend/README.md).

| Path | Stack | Purpose |
|---|---|---|
| `frontend/` | Frontend | React 18 + Vite dashboard |
| `backend/app/` | Backend | FastAPI app: `main.py`, `api/routes.py`, `schemas/models.py` |
| `backend/core/` | Backend | Data, features, graph, models, simulation, explanation, routing engine |
| `backend/api/` | Backend | Vercel serverless entrypoint (`index.py`, Mangum ASGI adapter) |
| `backend/tests/` | Backend | `test_api.py` (HTTP), `test_core.py` (units), `test_engine.py` (slow E2E) |
| `backend/requirements.txt` / `backend/requirements-dev.txt` | Backend | lean prod runtime / full dev stack (`requirements*.txt` at root are shims) |
| `artifacts/` | Backend | Trained model artifacts + `evaluation.json` (generated, git-ignored) |
| `data/` | Backend | Synthetic data (generated, git-ignored) |
| `docs/` | Shared | Architecture, API, deployment and model documentation |

Detailed docs:

- [Architecture](docs/ARCHITECTURE.md) — end-to-end pipeline and module map
- [API reference](docs/API.md) — every endpoint, request/response models
- [Models](docs/MODELS.md) — features, algorithms, training CLI, metrics
- [Deployment](docs/DEPLOYMENT.md) — Vercel serverless + configuration notes
- [Task board](docs/TASKS.md) — parallel work lanes for splitting the build with friends

## Configuration

All settings live in `backend/core/config.py` and can be overridden via environment
variables (a `.env` file is supported). See [`.env.example`](.env.example) for
the full list with defaults.

---

## Tests

```bash
python -m pytest -m "not slow"   # fast unit + HTTP tests (no artifacts needed)
python -m pytest                 # includes slow end-to-end engine tests (artifacts required)
```

## API summary

All JSON, prefix `/api/v1`. See [docs/API.md](docs/API.md) for details and
examples.

| Endpoint | Purpose |
|---|---|
| `GET /health` | service + model + dataset status |
| `GET /routes`, `GET /routes/{id}` | corridor topology |
| `GET /demo` | run + store the demo shipment (Suez) |
| `POST /predict` | full prediction for a route |
| `GET /shipments/{id}` (alias `/prediction/{id}`) | stored prediction payload |
| `GET /eta/{id}` | Monte Carlo ETA distribution |
| `GET /critical-nodes/{id}` | delay-share attribution |
| `GET /explanation/{id}` | per-node factor explanation |
| `POST /what-if` | scenario vs. baseline deltas |
| `POST /compare-routes` | per-objective route recommendation |
| `POST /simulate` | standalone Monte Carlo run |
| `GET /graph/{route}`, `GET /node/{id}/risk` | visualisation data |
| `GET /metrics`, `GET /data-quality` | model + data health |

## Live demo (deployed)

Stack served from two separated Vercel projects:

- Dashboard: <https://shipment-delay-frontend.vercel.app>
- API: <https://shipment-delay-dashboard.vercel.app> (base `/api/v1`)

## License

[MIT](LICENSE)
