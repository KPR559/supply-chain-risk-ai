# Deployment

The app is deployed to **Vercel** as **two separated projects**: one serverless
API and one static frontend. The split exists because the Python Backend runs a
~350 MB function while the frontend is a tiny static build — keeping them in
separate projects avoids mixing build systems.

## Live URLs

| Project | URL |
|---|---|
| API (FastAPI / FastAPI serverless) | <https://shipment-delay-dashboard.vercel.app> |
| Dashboard (React SPA) | <https://shipment-delay-frontend.vercel.app> |

The frontend points at the API via the `VITE_API_BASE` build-time env var
(`https://shipment-delay-dashboard.vercel.app/api/v1`), inlined into the JS
bundle at build time.

## API project

- Entrypoint `backend/api/index.py` wraps the FastAPI app with **Mangum** (ASGI →
  API-Gateway adapter) and uses `lifespan="off"`.
- `vercel.json` builds only `backend/api/index.py` with
  `@vercel/python`, `runtime python3.11`, `maxLambdaSize 250mb`, and routes
  `/api/(.*)` to it.
- **Lean `requirements.txt`** keeps the function under the Vercel 500 MB cap:
  sklearn (HGB classifier + quantile regressor), no xgboost / lightgbm / torch /
  shap / statsmodels.

### Cross-project wiring

`frontend/src/api.js` reads `VITE_API_BASE` at build time (defaults to the Vite
development proxy). In the frontend project set:

```bash
vercel env add VITE_API_BASE production   # https://shipment-delay-dashboard.vercel.app/api/v1
```

### Serverless caveats baked into the code

1. **No LightGBM** — the delay quantiles use sklearn
   `HistGradientBoostingRegressor` (`backend/core/models/delay.py`), which has no
   compiled/native `libgomp` dependency. (A prior LightGBM deploy crashed on
   Vercel with `libgomp.so.1` missing.)
2. **No torch / shap** — `backend/core/graph/gat.py` and
   `backend/core/explain/shap_explainer.py` degrade gracefully; the API falls back to
   tabular propagation and an importance-based explanation.
3. **`_loss` pickle alias** — the saved classifier artifact references the
   Cython class `_loss.CyHalfBinomialLoss`. `backend/api/index.py` explicitly registers
   `sklearn._loss._loss` under the name `_loss` before unpickling, because the
   serverless Python 3.12 loader does **not** auto-register that alias. If you
   drop/retrain the artifact with a different sklearn version, re-check this.
4. **Version pinning** — `requirements.txt` pins `numpy/pandas/scipy/scikit-learn/joblib`
   to the exact versions that produced the artifacts, and includes `pyarrow`
   (Parquet reads). Mismatched sklearn versions runtime-side break artifact
   unpickling.

### Deploying the API

```bash
vercel --prod --yes        # run from repo root (vercel.json present)
```

## Frontend project

- Standard Vite SPA with the `@vercel/static-build` framework preset
  (`build` → `vite build`, `dist` → served).
- `node_modules`, `dist`, `.env` and `.env.*.local` are git-ignored.

### Deploying the frontend

```bash
vercel link --yes --project shipment-delay-frontend   # once
vercel env add VITE_API_BASE production               # once
vercel --prod --yes                                   # from frontend/
```

## Cost / size notes

- API function bundle is ~350 MB and stays under the Vercel 500 MB limit thanks
  to the lean runtime requirements.
- If you move to a scaled production you may want to separate the inference
  (models) from the API or move model loading to warm functions / async bases.

## Local development parity

The API is just FastAPI, so everything runs locally:

```bash
uvicorn backend.app.main:app --port 8000
cd frontend && npm run dev    # Vite proxies /api -> 127.0.0.1:8000
```
