"""Tests for items 22-26: explain & decide (backend/core/decide.py).

File-level checks read the committed batch outputs (fast); engine
behaviour is tested on small synthetic inputs.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from backend.core.config import get_settings
from backend.core.graph import topology

OUT = get_settings().abs_data_dir / "outputs"
SCN = get_settings().abs_data_dir / "scenarios"


def test_scenario_catalog_covers_routes():
    from backend.core.decide import scenario_catalog, intervention_catalog
    crit = pd.read_parquet(OUT / "critical_checkpoints.parquet")
    scn, inv = scenario_catalog(crit), intervention_catalog(crit)
    routes = {s["route_id"] for s in scn}
    assert routes == set(topology.all_route_ids())
    assert len(scn) == 16 and len(inv) == 16
    kinds = {s["kind"] for s in scn}
    assert kinds == {"congestion_plus30", "closure"}


def test_relief_extension_reduces_quantiles():
    from backend.core.routing.routes import apply_scenario_to_quantiles, Scenario
    base = {"suez": {"p50": 20.0, "p80": 30.0, "p90": 40.0}}
    relief = Scenario(name="relief", route_id="asia_europe_suez",
                      node_adjustments={"suez": {"congestion_mult": 0.7}})
    out = apply_scenario_to_quantiles(base, {}, relief)
    assert out["suez"]["p50"] < base["suez"]["p50"]
    assert out["suez"]["p50"] <= out["suez"]["p80"] <= out["suez"]["p90"]
    # adverse direction still holds
    worse = Scenario(name="worse", route_id="asia_europe_suez",
                     node_adjustments={"suez": {"congestion_mult": 1.3}})
    out2 = apply_scenario_to_quantiles(base, {}, worse)
    assert out2["suez"]["p50"] > base["suez"]["p50"]


def test_scenario_results_direction():
    sr = pd.read_parquet(OUT / "scenario_results.parquet")
    assert (sr["eta_change_hours"] > 0).all()
    assert (sr["scenario_deadline_miss_probability"]
            >= sr["baseline_deadline_miss_probability"]).all()
    assert (sr["scenario_expected_delay_hours"]
            >= sr["baseline_expected_delay_hours"]).all()


def test_intervention_results_direction():
    iv = pd.read_parquet(OUT / "intervention_analysis.parquet")
    assert (iv["delay_reduction_hours"] >= -1e-9).all()
    assert (iv["deadline_risk_reduction"] >= -1e-9).all()
    assert iv["intervention_score"].between(0, 1).all()
    # ranking is by score descending
    assert iv["intervention_score"].is_monotonic_decreasing


def test_route_comparison_single_winner():
    rc = pd.read_parquet(OUT / "route_comparison.parquet")
    assert len(rc) == len(topology.ROUTES)
    assert int(rc["recommended_flag"].sum()) == 1
    assert sorted(rc["route_rank"].tolist()) == [1, 2, 3, 4]
    assert rc["deadline_miss_probability"].between(0, 1).all()
    assert (rc["eta_p50"] <= rc["eta_p90"]).all()


def test_shap_explanations_shape():
    sh = pd.read_parquet(OUT / "shap_explanations.parquet")
    pred = pd.read_parquet(get_settings().abs_data_dir / "ml" / "predictions.parquet")
    assert set(sh["observation_id"].unique()) == set(pred["observation_id"].unique())
    assert (sh.groupby("observation_id").size() == 8).all()
    assert set(sh["contribution_direction"].unique()) <= {"positive", "negative"}
    pos = sh[sh["contribution_direction"] == "positive"]["shap_value"]
    neg = sh[sh["contribution_direction"] == "negative"]["shap_value"]
    assert (pos >= 0).all() and (neg < 0).all()
    assert (sh["feature_rank"].between(1, 8)).all()
