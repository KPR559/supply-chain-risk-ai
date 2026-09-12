# Models

This document covers feature engineering, the learning algorithms, the
training CLI, and the numbers produced by the current reference run.

## 1. Algorithms

### Stage A — delay classifier

A gradient-boosted classifier predicts `P(delay_hours > 24)` per node.

- **Production (serverless):** scikit-learn `HistGradientBoostingClassifier`
  (trained with `--no-xgboost`). No native/compiled dependency → small bundle.
- **Local/dev:** XGBoost via `requirements-dev.txt` (equivalent quality).

Calibration: probability estimates are calibrated with **isotonic regression**
`backend/core/models/classification.py` (`_fit_isotonic`), fit on the training band and
validated on validation, so the deployed probabilities are well-calibrated.

The operating point is chosen to **maximise F1 on the validation split**
(`_optimal_threshold`).

### Stage B — delay quantiles

`HistGradientBoostingRegressor` with `loss="quantile"` per quantile
`P50 / P80 / P90`, wrapped in a `MonotoneQuantile` that enforces
**P50 ≤ P80 ≤ P90** per sample at prediction time (`backend/core/models/delay.py`).

(An earlier LightGBM / XGBoost variant is no longer used because LightGBM's
native `libgomp` dependency is unavailable on the serverless runtime.)

### Stage C — graph residual (optional)

`DelayGAT` (`backend/core/graph/gat.py`) is a small pure-PyTorch graph-attention net
(no `torch_geometric`) that learns upstream → downstream delay residual from
the route adjacency. It is optional: if torch is unavailable the engine runs
with the tabular propagation path.

### Stage D — Monte Carlo

`backend/core/simulation/monte_carlo.py` runs a vectorised simulation (default
10 000 samples): quantile-sampled node delays, log-normal edge transit times,
damped downstream delay cascade, yielding ETA **percentiles**, **deadline-miss
probability**, and **critical-node shares**.

## 2. Features

48 features across 7 families (see `docs/ARCHITECTURE.md` §3 and
`artifacts/feature_meta/groups.json`). All rolling/lag windows are
leakage-free.

## 3. Training CLI (`python -m backend.core.train`)

```
usage: backend.core.train [-h] [--generate-only] [--train-only] [--eval-only]
                  [--seed N] [--years N] [--version V] [--no-xgboost]
```

| Flag | Effect |
|---|---|
| *(none)* | run all stages: generate → train → evaluate |
| `--generate-only` | generate + validate synthetic data |
| `--train-only` | train classifier + delay quantiles, write `training_summary.json` |
| `--eval-only` | load artifacts, compute metrics → `evaluation.json` |
| `--seed N` | random seed (default: `demo_seed` = 7) |
| `--years N` | synthetic history length (default 3) |
| `--version V` | artifact version tag (default `1.0.0`) |
| `--no-xgboost` | use sklearn `HistGradientBoosting` instead of XGBoost (needed on Vercel) |

Artifacts are saved to `artifacts/` via `backend/core/models/registry.py`:

```
artifacts/
├── classifier/            model.joblib + metadata.json
├── delay_model/           model.joblib + metadata.json
├── feature_meta/          feature_names.json + groups.json
├── training_summary.json
└── evaluation.json
```

> The classifier artifact is pickled with sklearn Cython components; running it
> on Vercel needs the `_loss` pickle-alias workaround in `backend/api/index.py`
> (see `docs/DEPLOYMENT.md`).

## 4. Reference metrics (current artifacts)

Generated with `--no-xgboost` on the seeded synthetic dataset
(version `1.0.0`, trained 2026-08-30).

### Classification (delay > 24 h)

| Metric | Validation | Test |
|---|---|---|
| ROC-AUC | 0.990 | **0.968** |
| PR-AUC | 0.963 | **0.930** |
| Precision | 0.923 | 0.856 |
| Recall | 0.964 | 0.913 |
| F1 | 0.943 | **0.884** |
| ECE (test) | — | **0.0089** |

Operating threshold (max F1, from validation): **0.429**.
Class balance: 977 positive / 6563 negative (scale pos weight ~6.7).
Split sizes: 7540 train / 1620 val / 1610 test.

### Delay quantiles (hours)

| Quantile | Test MAE | Pinball (test) |
|---|---|---|
| P50 | 1.088 | 0.544 |
| P80 | 1.401 | 0.421 |
| P90 | 1.903 | 0.299 |

Median model (P50) headline: **MAE 1.088 d · RMSE 3.333 d**.

### Monte Carlo coverage (test, n_sim=10 000)

| Interval | Empirical coverage |
|---|---|
| P50 | 0.506 |
| P80 | 0.778 |
| P90 | 0.881 |

### Demo prediction (`GET /api/v1/demo`)

- Route **Suez** · 8 checkpoints · expected ~40 d · P90 ~46 d
- Suez delay probability **0.99**
- Suez responsible for **~54 %** of corridor delay
- Explanation top factor: `delay_lag_1`

> Numbers are for the seeded synthetic dataset and intended to demonstrate the
> pipeline on realistic, reproducible data — not field data.
