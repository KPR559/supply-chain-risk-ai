# Architecture

This document describes the end-to-end pipeline of the shipment-delay
decision-support system: how raw events become per-node risk and delay
quantiles, and how those become a probabilistic ETA.

## 1. Pipeline overview

```
raw events ─► validation ─► silver ─► feature engineering ─► gold (node obs)
                                                                  │
                                  ┌────────────────────────────────┤
                                  ▼                                ▼
                    classifier (delay > 24 h)          quantile regressors (P50/P80/P90)
                                  │                                │
                                  └───────────► node delay quantiles ─┘
                                                       │
                                GAT residuals (graph, optional) ──► per-node risk
                                                       │
                         ┌─────────────────────────────┴────────────────┐
                         ▼                                              ▼
                 Monte Carlo (10k routes)                    critical-node attribution
                         │
         ETA percentiles · deadline risk · what-if · route comparison
                         │
         SHAP-style explanation · FastAPI /api/v1 · React/Vite dashboard
```

Four stages, each with a clear output:

| Stage | Produces |
|---|---|
| **A. Classification** | Probability that a node will be delayed > 24 h |
| **B. Regression** | Delay quantiles P50 / P80 / P90 (hours) per node |
| **C. Graph** | Propagation-aware residuals + route topology (optional) |
| **D. Simulation** | Monte Carlo ETA percentiles, deadline-miss probability, critical-node shares |

## 2. Data layer

Synthetic generation is seeded and deterministic:

```
backend/core/data/synthetic.py    generate observations, raw events, conflicts, alerts
backend/core/data/validation.py   schema cleaning (missing fields, bad GPS/durations, dupes)
backend/core/data/anomalies.py    regime detection (rolling z, CUSUM, binary segmentation, Isolation Forest)
backend/core/data/loaders.py      runtime loaders for alerts (NLP) and conflict events
backend/core/pipeline.py          orchestrates raw -> validate -> silver -> features -> ML dataset
```

- Raw events that fail the schema are dropped; genuine "anomalies" are **kept**
  and converted into the `regime_disrupted` feature rather than discarded.
- `backend/core/storage.py` is the storage layer: partitioned Parquet writes
  (`year=`/`month=`), `_metadata.parquet` sidecars, predicate-pushed reads,
  plus a DuckDB query helper.

## 3. Feature engineering

`backend/core/features/node_features.py` builds **leakage-free** rolling/lag windows
across seven families:

| Family | Example features |
|---|---|
| Time | `month`, `day_of_week`, `day_of_year`, Fourier terms, `season_quarter` |
| Historical delay | rolling mean/std (7/30/90/365 d), `delay_ewma`, lags 1/3/7/14, frequency (30/90 d) |
| Congestion | `congestion_index`, `congestion_percentile`, trend, anomaly |
| Weather | `weather_severity`, `weather_extreme`, trend, 7 d mean |
| Customs | `customs_workload`, weekday effect, 7 d workload, `customs_risk` |
| Conflict | `conflict_risk_score`, trend, recency |
| Regime | `regime_disrupted`, `regime_cusum`, `regime_iso`, `regime_roll_z`, `regime_days_adj` |

`backend/core/features/derived.py` adds the binary target `is_delayed`
(`delay_hours > DELAY_THRESHOLD_HOURS`, default 24).

## 4. Modules (map)

| Module | Responsibility |
|---|---|
| `backend/core/config.py` | Central settings (`Settings` dataclass + `get_settings()` singleton, `.env` support) |
| `backend/core/logging_util.py` | JSON-lines structured logging |
| `backend/core/storage.py` | Partitioned Parquet + DuckDB storage layer |
| `backend/core/pipeline.py` | Raw → silver → ML dataset orchestration |
| `backend/core/train.py` | CLI for generate / train / evaluate |
| `backend/core/predictor.py` | `PredictionEngine` singleton powering the API |
| `backend/core/data/` | synthetic / validation / anomalies / loaders |
| `backend/core/features/` | node_features / derived |
| `backend/core/graph/` | topology (data-driven), network (cascade), gat (optional) |
| `backend/core/models/` | registry, classification (Stage A), delay (Stage B) |
| `backend/core/simulation/` | monte_carlo (Stage D) |
| `backend/core/routing/` | scenarios, comparison, recommendation |
| `backend/core/explain/` | shap_explainer (+ fallback) |
| `backend/core/evaluate/` | calibration curves, ECE, quantile coverage |
| `backend/core/nlp/` | rule-based alert event extractor |
| `backend/app/` | FastAPI app (`main.py`, `api/routes.py`, `schemas/models.py`) |
| `frontend/` | React 18 + Vite dashboard |
| `backend/api/` | Vercel serverless entrypoint (Mangum ASGI adapter) |

## 5. Runtime engine

`backend/core/predictor.py` (`PredictionEngine`, a lazy singleton) is the brain behind
the API. For a route it:

1. Loads the trained classifier, quantile regressors and feature metadata.
2. Builds per-node feature rows for the current checkpoint state.
3. Computes per-node delay probability (`Stage A`) and quantiles (`Stage B`).
4. Applies GAT residuals (`Stage C`, optional — gracefully skipped without torch).
5. Adds an NLP alert bump from recent alert text.
6. Runs the Monte Carlo simulation (`Stage D`) and computes critical-node shares.

The engine is deliberately **optional-fallback friendly**: torch / SHAP /
xgboost are all optional, so the lean production runtime stays small and the
heavy dev stack has no effect on the serverless bundle.

## 6. Frontend

The React dashboard is a single-page app with a **view switcher**:

`Overview, Route Map, Risk Radar, Simulator, Shipments, Alerts, Analytics,
Reports, Data Sources, Settings`

- `frontend/src/App.jsx` — shell: global state (prediction / explanation /
  critical / health), route & shipment selection.
- `frontend/src/api.js` — fetch wrapper over `/api/v1`
  (base from `VITE_API_BASE`, falls back to the Vite proxy).
- `frontend/src/pages/` — 10 views; `frontend/src/components/` — 17 reusable
  components (route map, percentile chart, what-if panel, explanation bars…).
- Dark "LOGIX" theme in `frontend/src/styles.css`.

## 7. Repository-layout notes

- Routes are always data-driven through `backend/core/graph/topology.py` — never
  hardcoded in logic.
- All thresholds live in `backend/core/config.py`.
- Quantile models are enforced **monotone** (P50 ≤ P80 ≤ P90) at prediction time.
