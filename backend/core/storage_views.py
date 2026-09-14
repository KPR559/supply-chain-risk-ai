"""DuckDB views — Section 40 (Parquet is storage, DuckDB is the query engine).

Creates SQL views that let analytics/ML/dashboard query curated Parquet files
without duplicating them in DuckDB. Mirrors the Section 40 recommended views.

Usage:
  python -m backend.core.storage_views           # create views
  python -m backend.core.storage_views --verify # create + smoke-test
"""
from __future__ import annotations

import argparse

import duckdb

from backend.core import storage
from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)

VIEWS: dict[str, str] = {
    # Silver / curated
    "checkpoints": "SELECT * FROM read_parquet('data/silver/checkpoints.parquet')",
    "route_edges": "SELECT * FROM read_parquet('data/silver/route_edges.parquet')",
    "checkpoint_outcomes": "SELECT * FROM read_parquet('data/silver/checkpoint_outcomes.parquet')",
    "ais_visits": "SELECT * FROM read_parquet('data/silver/ais_visits.parquet')",
    "holidays": "SELECT * FROM read_parquet('data/silver/holidays.parquet')",
    "data_quality_flags": "SELECT * FROM read_parquet('data/silver/data_quality_flags.parquet')",
    "disruptions": "SELECT * FROM read_parquet('data/silver/disruptions/disruptions.parquet')",
    "nlp_events": "SELECT * FROM read_parquet('data/silver/nlp_events/nlp_events.parquet')",
    # Features
    "port_features": "SELECT * FROM read_parquet('data/features/port_activity/port_features.parquet')",
    "weather_features": "SELECT * FROM read_parquet('data/features/weather_features/weather_features.parquet')",
    "disruption_features": "SELECT * FROM read_parquet('data/features/disruption_features/disruption_features.parquet')",
    "temporal_features": "SELECT * FROM read_parquet('data/features/temporal/temporal_features.parquet')",
    "regimes": "SELECT * FROM read_parquet('data/features/regimes.parquet')",
    "checkpoint_features": "SELECT * FROM read_parquet('data/features/checkpoint_features.parquet')",
    # ML
    "ml_training_data": "SELECT * FROM read_parquet('data/ml/ml_training_data.parquet')",
    "ml_train": "SELECT * FROM read_parquet('data/ml/train.parquet')",
    "ml_val": "SELECT * FROM read_parquet('data/ml/val.parquet')",
    "ml_test": "SELECT * FROM read_parquet('data/ml/test.parquet')",
    "predictions": "SELECT * FROM read_parquet('data/ml/predictions.parquet')",
    "model_evaluation": "SELECT * FROM read_parquet('data/ml/model_evaluation.parquet')",
    # Outputs
    "checkpoint_risk": "SELECT * FROM read_parquet('data/outputs/checkpoint_risk.parquet')",
    "delay_propagation": "SELECT * FROM read_parquet('data/outputs/delay_propagation.parquet')",
    "monte_carlo_results": "SELECT * FROM read_parquet('data/outputs/monte_carlo_results.parquet')",
    "eta_distribution": "SELECT * FROM read_parquet('data/outputs/eta_distribution.parquet')",
    "critical_checkpoints": "SELECT * FROM read_parquet('data/outputs/critical_checkpoints.parquet')",
    "shap_explanations": "SELECT * FROM read_parquet('data/outputs/shap_explanations.parquet')",
    "scenario_results": "SELECT * FROM read_parquet('data/outputs/scenario_results.parquet')",
    "intervention_analysis": "SELECT * FROM read_parquet('data/outputs/intervention_analysis.parquet')",
    "route_comparison": "SELECT * FROM read_parquet('data/outputs/route_comparison.parquet')",
    "current_risk_state": "SELECT * FROM read_parquet('data/outputs/current_risk_state.parquet')",
    "what_if_scenarios": "SELECT * FROM read_parquet('data/scenarios/what_if_scenarios.parquet')",
    # Raw (via warehouse tables already materialized — views are aliases)
    "raw_news": "SELECT * FROM read_parquet('data/raw/news/year=*/month=*/*.parquet')",
}


def create_views(verify: bool = False) -> dict[str, int]:
    s = get_settings()
    con = duckdb.connect(str(s.abs_data_dir.parent / "data" / "warehouse.duckdb") if (s.abs_data_dir / "warehouse.duckdb").exists() else str(s.abs_data_dir / "warehouse.duckdb"))
    # Use the actual warehouse path
    con.close()
    con = storage.connect()
    counts: dict[str, int] = {}
    try:
        for name, sql in VIEWS.items():
            con.execute(f"CREATE OR REPLACE VIEW {name} AS {sql}")
            if verify:
                try:
                    n = con.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
                    counts[name] = int(n)
                except Exception as e:
                    log.warning(f"View {name} verify failed: {e}")
                    counts[name] = -1
            else:
                counts[name] = -1  # not verified
        if verify:
            log.info(f"Views verified: {counts}")
        else:
            log.info(f"Views created: {list(VIEWS.keys())}")
    finally:
        con.close()
    return counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true", help="count rows after creating views")
    args = parser.parse_args()
    counts = create_views(verify=args.verify)
    if args.verify:
        for k, v in counts.items():
            print(f"  {k:30s} {v:>8,}")
    else:
        print(f"Created {len(VIEWS)} views (run with --verify to count)")


if __name__ == "__main__":
    main()
