# ML → Graph Data Contract

This document is the handoff between the **ML teammate** and the **graph/output** layer.
It defines what `data/ml/predictions.parquet` must contain for the downstream
pipeline (GAT propagation → Monte Carlo → ETA → attribution → what-if → dashboard)
to run without changes.

## Input to ML: `data/ml/{train,val,test}.parquet`

Already built — 37,303 / 7,993 / 7,995 rows, 85 cols each, chronological 70/15/15.
Each row = one `node_id × timestamp` (a checkpoint on a date).

Key feature columns (leakage-free, past_only=True):
`month, day_of_week, delay_roll_mean_7d/30d/90d/365d, delay_lag_1/3/7/14, delay_ewma,
 congestion_index, congestion_percentile, weather_severity, customs_workload,
 conflict_risk_score, regime_disrupted, ...` (full list in `features/checkpoint_features.parquet`)

Targets (already in the file):
`delay_hours` (regression), `delay_flag = delay_hours > 24` (classification)

## Output from ML: `data/ml/predictions.parquet` — REQUIRED SCHEMA

One row per `observation_id` (or per `checkpoint_id × prediction_timestamp` if you
batch by node). Must include:

| Column | Type | Required | Description |
|---|---|---|---|
| `observation_id` | string | yes | `node_id:timestamp` or index |
| `shipment_id` | string | no | if batched by shipment |
| `route_id` | string | no | route context if applicable |
| `checkpoint_id` | string | yes | node_id |
| `prediction_timestamp` | timestamp | yes | when prediction was made |
| `model_version` | string | yes | e.g. `v1.0.0` |
| `delay_probability` | float [0,1] | yes | `P(delay_flag=1)` from classifier |
| `predicted_delay_flag` | int {0,1} | yes | `delay_probability > 0.5` |
| `expected_delay_hours` | float | yes | point estimate (regression or P50) |
| `delay_p50_hours` | float | yes | quantile 0.50 |
| `delay_p80_hours` | float | yes | quantile 0.80 |
| `delay_p90_hours` | float | yes | quantile 0.90 |
| `delay_p95_hours` | float | yes | quantile 0.95 (PPT promise) |
| `risk_score` | float [0,1] | yes | combined risk (e.g. `delay_probability` calibrated) |
| `risk_level` | string | no | low/moderate/high/severe |
| `prediction_confidence` | float [0,1] | no | model confidence |

Existing `data/ml/predictions.parquet` is an empty shell with these columns (0 rows).

## What consumes `predictions.parquet`

```
predictions.parquet
      ↓
checkpoint_risk  (per checkpoint, for dashboard)
      ↓
delay_propagation  (GAT/ST-GNN learns edge-wise propagation)
      ↓
monte_carlo_results (10K sims per shipment)
      ↓
eta_distribution + critical_checkpoints + shap_explanations + route_comparison (Sections 29-35)
```

## DuckDB views (already created)

```sql
CREATE VIEW predictions AS SELECT * FROM read_parquet('data/ml/predictions.parquet');
CREATE VIEW checkpoint_features AS SELECT * FROM read_parquet('data/features/checkpoint_features.parquet');
-- plus 30 more: run `python -m backend.core.storage_views --verify`
```

Graph layer reads `checkpoints`, `route_edges` (already in warehouse as `silver_checkpoints`, `silver_route_edges`)
plus `predictions` when available.

## Minimal training script the ML teammate can use

```python
import pandas as pd
from backend.core.config import get_settings
s = get_settings()
train = pd.read_parquet(s.abs_data_dir / "ml" / "train.parquet")
val = pd.read_parquet(s.abs_data_dir / "ml" / "val.parquet")
# Features = all cols except identifiers/targets/split/label_source
exclude = {"node_id","timestamp","delay_hours","delay_flag","split","label_source","annual_delay_mean","cppi_score","checkpoint_id","date","country"}
feat_cols = [c for c in train.columns if c not in exclude and train[c].dtype != object]
# Train classifier + quantile regressors on feat_cols → write to data/ml/predictions.parquet
```

## Model evaluation: `data/ml/model_evaluation.parquet`

After training, also write one row per `model_version × dataset_split`:

| Column | Description |
|---|---|
| `model_version`, `dataset_split` | train/val/test |
| `accuracy, precision, recall, f1, roc_auc, pr_auc` | classification |
| `mae, rmse, r2, median_absolute_error` | regression |
| `quantile, pinball_loss, coverage, calibration_error` | per quantile |
| `train_start_time, test_end_time, feature_count, training_row_count` | metadata |
