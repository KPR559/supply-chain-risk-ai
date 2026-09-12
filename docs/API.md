# API Reference

All endpoints are JSON under the prefix **`/api/v1`**. CORS is wide open
(`allow_origins=["*"]`) for the demo — tighten in production.

Base URLs:

- Local: `http://127.0.0.1:8000`
- Deployed: `https://shipment-delay-dashboard.vercel.app`

Interactive OpenAPI docs are served at `/docs`.

## Request models

Defined in `backend/app/schemas/models.py`.

| Model | Fields (default) |
|---|---|
| `PredictRequest` | `origin` (`frankfurt`), `destination` (`final_destination`), `route_id` (`suez`, one of `suez\|cape\|dubai`), `current_checkpoint`, `deadline_date`, `origin_date`, `n_sim` (100–100 000) |
| `SimulateRequest` | `route_id` (`suez`), `n_sim`, `deadline_date`, `node_quantiles` |
| `ScenarioAdjustment` | `congestion_mult` (1.0), `weather_shift` (0.0), `conflict_mult` (1.0), `close` (false) |
| `WhatIfRequest` | `shipment_id` (required), `name` (`Custom scenario`), `node_id`, `adjustments` |
| `CompareRoutesRequest` | `shipment_id` (required), `objectives` (`["fastest","lowest_risk","balanced"]`, one of `fastest\|lowest_risk\|lowest_uncertainty\|balanced`) |

## Endpoints

### `GET /health`
Service, model, dataset and backend status.

```
{
  "status": "ok",
  "models": ["classifier", "delay_model"],
  "datasets": [ ... ],
  "graph_backend": "networkx",
  "nlp_backend": "local",
  "monte_carlo_simulations": 10000
}
```

### `GET /routes`
List all routes: `node` list, `distance_km`, `baseline_days`, `default_route`.

### `GET /routes/{route_id}`
Single route detail including edges (`mode`, `distance`, `reliability`).
`404` if unknown.

### `GET /demo`
Runs and stores the demo prediction (Frankfurt → Final Destination via Suez) as
both `frankfurt-final_destination` and the shortcut `FRA-IN-001`.

### `POST /predict`
Body: `PredictRequest`. Returns the full prediction payload:

```
{
  "shipment_id", "origin", "destination", "current_checkpoint",
  "route_id", "route_name", "prediction_date",
  "node_predictions": [ { node_id, label, timestamp, delay_probability,
                          expected_delay_hours, p50, p80, p90,
                          congestion, weather, conflict, regime } ],
  "delay_probabilities": { node_id: p },
  "delay_quantiles":     { node_id: { p50, p80, p90 } },
  "monte_carlo": { expected_days, expected_delay_hours, percentiles,
                   p_miss_deadline, critical_nodes, n_simulations, seed },
  "critical_nodes": [ ... ],
  "model_version"
}
```

The prediction is stored in memory under `shipment_id`.

### `GET /shipments/{shipment_id}` · `GET /prediction/{shipment_id}`
Retrieve a stored prediction payload. `404` if unknown.

### `GET /eta/{shipment_id}`
Returns only the `monte_carlo` block (`percentiles`, `p_miss_deadline`, …).

### `GET /critical-nodes/{shipment_id}`
Delay-share attribution:

```
{ "shipment_id": "...", "critical_nodes": [ { node_id, label,
                                              delay_share, percent } ] }
```

### `GET /explanation/{shipment_id}`
SHAP-style explanation for the riskiest node:

```
{
  "base_value", "node_id", "node_label", "delay_probability",
  "group_contributions": { ... },
  "top_factors": [ { "name", "contribution" } ],
  "feature_names": [ ... ]
}
```

When `shap` is unavailable (serverless runtime) it transparently returns the
zero-dependency importance fallback. `404` if the shipment is unknown.

### `POST /what-if`
Body: `WhatIfRequest`. Runs a scenario (`node_id` + adjustments) vs. the stored
baseline and returns deltas (`expected_days`, `p90`, …).

### `POST /compare-routes`
Body: `CompareRoutesRequest`. Returns per-objective recommendations:

```
{ "options": { objective: { route_id, expected_days, risk, ... } },
  "recommended": { objective: route_id } }
```

### `POST /simulate`
Body: `SimulateRequest`. Standalone Monte Carlo run (200 default n_sim).

### `GET /graph/{route_id}`
Route graph for visualisation — nodes with `lon`/`lat`/`kind`/`risk` and edges.
Runs a demo Suez prediction internally to source per-node risk.

### `GET /node/{node_id}/risk`
Per-node risk from the hardcoded Suez demo prediction. `404` if unknown.

### `GET /metrics`
Model and data health from `artifacts/training_summary.json` and
`artifacts/evaluation.json`:

```
{
  "model_metrics": { "training": {...}, "evaluation": {...} },
  "calibration": "..."
}
```

### `GET /data-quality`
Raw vs silver record counts and removal rate.

## Response-model note

Endpoints return plain dictionaries; the Pydantic response models
(`GetShipmentResponse`, `ExplanationResponse`, `HealthResponse`) defined in
`backend/app/schemas/models.py` are currently **unused** and are kept for reference.
```
