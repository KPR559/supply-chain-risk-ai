"""Build all output shell schemas — Sections 25-36 (empty, spec-compliant).

Creates empty parquets with correct column definitions so the ML teammate
knows the exact contract. No data is fabricated (empty frames, correct dtypes).

Outputs:
  data/ml/predictions.parquet              (S25)
  data/ml/model_evaluation.parquet         (S37)
  data/outputs/checkpoint_risk.parquet     (S26)
  data/outputs/delay_propagation.parquet   (S27)
  data/outputs/monte_carlo_results.parquet (S28)
  data/outputs/eta_distribution.parquet    (S29)
  data/outputs/critical_checkpoints.parquet(S30)
  data/outputs/shap_explanations.parquet   (S31)
  data/outputs/scenario_results.parquet    (S33)
  data/outputs/intervention_analysis.parquet(S34)
  data/outputs/route_comparison.parquet    (S35)
  data/outputs/current_risk_state.parquet  (S36)
  data/scenarios/what_if_scenarios.parquet (S32)

Usage:
  python -m backend.core.data.build_output_schemas
"""
from __future__ import annotations

import pandas as pd
from pathlib import Path

from backend.core import storage
from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)


def _empty(cols: dict) -> pd.DataFrame:
    """Create empty DataFrame with typed columns. cols: name -> dtype string."""
    df = pd.DataFrame({c: pd.Series(dtype=d) for c, d in cols.items()})
    return df


def build() -> dict:
    s = get_settings()
    out: dict[str, Path] = {}

    # ── S25: ML Predictions ──
    df = _empty({
        "observation_id": "object", "shipment_id": "object", "route_id": "object",
        "checkpoint_id": "object", "prediction_timestamp": "datetime64[ns]",
        "model_version": "object", "delay_probability": "float64",
        "predicted_delay_flag": "int64", "expected_delay_hours": "float64",
        "delay_p50_hours": "float64", "delay_p80_hours": "float64",
        "delay_p90_hours": "float64", "delay_p95_hours": "float64",
        "risk_score": "float64", "risk_level": "object", "prediction_confidence": "float64",
    })
    p = s.abs_data_dir / "ml" / "predictions.parquet"
    p.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(p, index=False)
    out["predictions"] = p

    # ── S37: Model Evaluation ──
    df = _empty({
        "model_version": "object", "dataset_split": "object",
        "accuracy": "float64", "precision": "float64", "recall": "float64",
        "f1_score": "float64", "roc_auc": "float64", "pr_auc": "float64",
        "log_loss": "float64", "brier_score": "float64", "calibration_error": "float64",
        "mae": "float64", "rmse": "float64", "r2": "float64",
        "median_absolute_error": "float64", "quantile": "float64",
        "pinball_loss": "float64", "coverage": "float64",
        "train_start_time": "datetime64[ns]", "train_end_time": "datetime64[ns]",
        "validation_start_time": "datetime64[ns]", "validation_end_time": "datetime64[ns]",
        "test_start_time": "datetime64[ns]", "test_end_time": "datetime64[ns]",
        "feature_count": "int64", "training_row_count": "int64", "training_timestamp": "datetime64[ns]",
    })
    p = s.abs_data_dir / "ml" / "model_evaluation.parquet"
    df.to_parquet(p, index=False)
    out["model_evaluation"] = p

    # ── S26: Checkpoint Risk ──
    df = _empty({
        "shipment_id": "object", "route_id": "object", "checkpoint_id": "object",
        "checkpoint_type": "object", "risk_score": "float64", "risk_level": "object",
        "delay_probability": "float64", "expected_delay_hours": "float64",
        "delay_p50_hours": "float64", "delay_p80_hours": "float64",
        "delay_p90_hours": "float64", "delay_p95_hours": "float64",
        "uncertainty_hours": "float64", "regime_state": "object",
        "disruption_flag": "bool", "weather_risk_level": "object",
        "congestion_index": "float64", "criticality_score": "float64",
        "downstream_impact_score": "float64", "deadline_risk_contribution": "float64",
        "prediction_timestamp": "datetime64[ns]",
    })
    p = s.abs_data_dir / "outputs" / "checkpoint_risk.parquet"
    p.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(p, index=False)
    out["checkpoint_risk"] = p

    # ── S27: Delay Propagation ──
    df = _empty({
        "shipment_id": "object", "route_id": "object",
        "source_checkpoint_id": "object", "target_checkpoint_id": "object",
        "edge_id": "object", "propagated_delay_hours": "float64",
        "propagated_delay_p50": "float64", "propagated_delay_p80": "float64",
        "propagated_delay_p90": "float64", "propagated_delay_p95": "float64",
        "propagation_probability": "float64", "cumulative_delay_hours": "float64",
        "downstream_impact_score": "float64", "timestamp": "datetime64[ns]",
    })
    p = s.abs_data_dir / "outputs" / "delay_propagation.parquet"
    df.to_parquet(p, index=False)
    out["delay_propagation"] = p

    # ── S28: Monte Carlo ──
    df = _empty({
        "simulation_id": "int64", "shipment_id": "object", "route_id": "object",
        "simulation_timestamp": "datetime64[ns]", "simulated_arrival_time": "datetime64[ns]",
        "simulated_delay_hours": "float64", "simulated_transit_hours": "float64",
        "deadline_missed": "bool", "total_propagated_delay_hours": "float64",
        "critical_checkpoint_id": "object", "scenario_id": "object",
    })
    p = s.abs_data_dir / "outputs" / "monte_carlo_results.parquet"
    df.to_parquet(p, index=False)
    out["monte_carlo_results"] = p

    # ── S29: ETA Distribution ──
    df = _empty({
        "shipment_id": "object", "route_id": "object",
        "calculation_timestamp": "datetime64[ns]", "planned_arrival_time": "datetime64[ns]",
        "eta_p50": "datetime64[ns]", "eta_p80": "datetime64[ns]",
        "eta_p90": "datetime64[ns]", "eta_p95": "datetime64[ns]",
        "delay_p50_hours": "float64", "delay_p80_hours": "float64",
        "delay_p90_hours": "float64", "delay_p95_hours": "float64",
        "expected_delay_hours": "float64", "eta_mean": "datetime64[ns]",
        "eta_std_hours": "float64", "deadline": "datetime64[ns]",
        "deadline_miss_probability": "float64", "on_time_probability": "float64",
    })
    p = s.abs_data_dir / "outputs" / "eta_distribution.parquet"
    df.to_parquet(p, index=False)
    out["eta_distribution"] = p

    # ── S30: Critical Checkpoints ──
    df = _empty({
        "shipment_id": "object", "route_id": "object", "checkpoint_id": "object",
        "checkpoint_rank": "int64", "risk_score": "float64",
        "expected_delay_contribution_hours": "float64",
        "uncertainty_contribution_hours": "float64",
        "deadline_risk_contribution": "float64",
        "downstream_impact_score": "float64", "criticality_score": "float64",
        "criticality_reason": "object", "calculation_timestamp": "datetime64[ns]",
    })
    p = s.abs_data_dir / "outputs" / "critical_checkpoints.parquet"
    df.to_parquet(p, index=False)
    out["critical_checkpoints"] = p

    # ── S31: SHAP ──
    df = _empty({
        "observation_id": "object", "shipment_id": "object", "checkpoint_id": "object",
        "prediction_timestamp": "datetime64[ns]", "feature_name": "object",
        "feature_value": "object", "shap_value": "float64",
        "contribution_direction": "object", "feature_rank": "int64",
        "model_output": "float64", "model_version": "object",
    })
    p = s.abs_data_dir / "outputs" / "shap_explanations.parquet"
    df.to_parquet(p, index=False)
    out["shap_explanations"] = p

    # ── S32: What-If Scenario Input ──
    df = _empty({
        "scenario_id": "object", "shipment_id": "object", "base_route_id": "object",
        "created_at": "datetime64[ns]", "scenario_name": "object",
        "scenario_type": "object", "target_node_id": "object",
        "target_edge_id": "object", "target_feature": "object",
        "baseline_value": "float64", "intervention_value": "float64",
        "change_pct": "float64", "duration_hours": "float64",
        "start_time": "datetime64[ns]", "end_time": "datetime64[ns]",
        "description": "object",
    })
    p = s.abs_data_dir / "scenarios" / "what_if_scenarios.parquet"
    p.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(p, index=False)
    out["what_if_scenarios"] = p

    # ── S33: Scenario Results ──
    df = _empty({
        "scenario_id": "object", "shipment_id": "object",
        "base_route_id": "object", "scenario_route_id": "object",
        "baseline_eta_p50": "datetime64[ns]", "scenario_eta_p50": "datetime64[ns]",
        "baseline_eta_p90": "datetime64[ns]", "scenario_eta_p90": "datetime64[ns]",
        "baseline_deadline_miss_probability": "float64",
        "scenario_deadline_miss_probability": "float64",
        "baseline_expected_delay_hours": "float64",
        "scenario_expected_delay_hours": "float64",
        "eta_change_hours": "float64", "risk_change_pct": "float64",
        "uncertainty_change_hours": "float64", "recommendation": "object",
    })
    p = s.abs_data_dir / "outputs" / "scenario_results.parquet"
    df.to_parquet(p, index=False)
    out["scenario_results"] = p

    # ── S34: Intervention ──
    df = _empty({
        "intervention_id": "object", "shipment_id": "object", "base_route_id": "object",
        "intervention_type": "object", "target_node_id": "object",
        "target_edge_id": "object", "baseline_risk": "float64",
        "intervention_risk": "float64", "risk_delta": "float64",
        "baseline_expected_delay_hours": "float64",
        "intervention_expected_delay_hours": "float64",
        "delay_reduction_hours": "float64",
        "baseline_eta_p90": "datetime64[ns]", "intervention_eta_p90": "datetime64[ns]",
        "eta_improvement_hours": "float64",
        "baseline_deadline_miss_probability": "float64",
        "intervention_deadline_miss_probability": "float64",
        "deadline_risk_reduction": "float64",
        "uncertainty_reduction_hours": "float64",
        "intervention_score": "float64", "recommendation": "object",
    })
    p = s.abs_data_dir / "outputs" / "intervention_analysis.parquet"
    df.to_parquet(p, index=False)
    out["intervention_analysis"] = p

    # ── S35: Route Comparison ──
    df = _empty({
        "comparison_id": "object", "shipment_id": "object", "route_id": "object",
        "route_rank": "int64", "route_name": "object",
        "distance_km": "float64", "planned_transit_hours": "float64",
        "expected_transit_hours": "float64", "expected_delay_hours": "float64",
        "delay_probability": "float64",
        "eta_p50": "datetime64[ns]", "eta_p80": "datetime64[ns]",
        "eta_p90": "datetime64[ns]", "eta_p95": "datetime64[ns]",
        "deadline_miss_probability": "float64",
        "disruption_exposure": "float64", "geopolitical_risk": "float64",
        "weather_risk": "float64", "congestion_risk": "float64",
        "uncertainty_hours": "float64", "critical_checkpoint_count": "int64",
        "route_risk_score": "float64", "risk_adjusted_score": "float64",
        "recommended_flag": "bool", "recommendation_reason": "object",
    })
    p = s.abs_data_dir / "outputs" / "route_comparison.parquet"
    df.to_parquet(p, index=False)
    out["route_comparison"] = p

    # ── S36: Dynamic Risk State ──
    df = _empty({
        "shipment_id": "object", "route_id": "object", "checkpoint_id": "object",
        "last_updated_at": "datetime64[ns]",
        "current_latitude": "float64", "current_longitude": "float64",
        "current_route_segment_id": "object", "current_speed_kmh": "float64",
        "current_regime_state": "object", "current_congestion_index": "float64",
        "current_weather_risk": "float64", "current_disruption_risk": "float64",
        "current_delay_probability": "float64",
        "current_expected_delay_hours": "float64",
        "current_eta_p50": "datetime64[ns]", "current_eta_p90": "datetime64[ns]",
        "current_deadline_miss_probability": "float64",
        "risk_change_from_previous": "float64", "risk_trend": "object",
        "recalculation_reason": "object", "model_version": "object",
    })
    p = s.abs_data_dir / "outputs" / "current_risk_state.parquet"
    df.to_parquet(p, index=False)
    out["current_risk_state"] = p

    for k, p in out.items():
        log.info(f"Shell {k}: {p} (0 rows, spec columns)")

    return out


def main() -> None:
    paths = build()
    print(f"Built {len(paths)} shell schemas (0 rows each):")
    for k, p in paths.items():
        print(f"  {k:30s} -> {p}")


if __name__ == "__main__":
    main()
