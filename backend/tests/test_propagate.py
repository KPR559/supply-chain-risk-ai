"""Tests for items 15-21: propagate & quantify (backend/core/propagate.py)
plus the p95-aware Monte Carlo extension."""
from __future__ import annotations

import numpy as np
import pandas as pd

from backend.core.graph import topology
from backend.core import propagate as pg
from backend.core.simulation.monte_carlo import run_monte_carlo

RID = "asia_europe_suez"


def _toy_quants(value: float = 6.0) -> dict:
    route = topology.route_by_id(RID).node_ids
    return {nid: {"p50": value, "p80": value + 1, "p90": value + 2,
                  "p95": value + 3, "expected": value,
                  "proba": 0.1, "risk": 0.1, "risk_level": "low"}
            for nid in route}


def test_quantile_cascade_monotone_and_growing():
    eff = pg.propagate_route_quantiles(RID, _toy_quants(), attenuation=1.0)
    nodes = topology.route_by_id(RID).node_ids
    for nid in nodes:
        assert eff[nid][50] <= eff[nid][80] <= eff[nid][90] <= eff[nid][95]
    # downstream accumulates upstream delay
    assert eff[nodes[-1]][50] > eff[nodes[0]][50]


def test_recalculate_overrides_propagate_downstream():
    base = pg.recalculate(RID, _toy_quants(6.0), None, 1.0, reason="t")
    nodes = topology.route_by_id(RID).node_ids
    mid = nodes[len(nodes) // 2]
    bumped = pg.recalculate(
        RID, _toy_quants(6.0), {mid: {"p50": 60.0, "expected": 60.0}},
        1.0, reason="t")
    assert bumped[nodes[-1]][50] > base[nodes[-1]][50]
    # upstream of the bump is untouched
    assert bumped[nodes[0]][50] == base[nodes[0]][50]


def test_monte_carlo_p95_and_fields():
    route = topology.route_by_id(RID).node_ids
    q = {nid: {"p50": 6.0, "p80": 8.0, "p90": 10.0, "p95": 14.0} for nid in route}
    res = run_monte_carlo(RID, q, n_sim=500, seed=7, deadline_days=60.0)
    p = res.percentiles
    assert p["p50"] <= p["p80"] <= p["p90"] <= p["p95"]
    assert 0.0 <= res.p_miss_deadline <= 1.0
    assert abs(sum(res.critical_nodes.values()) - 1.0) < 1e-9
    assert res.total_delay_hours.shape == (500,)
    assert res.total_transit_hours.shape == (500,)
    assert set(res.node_samples) == set(route)
    # legacy callers without p95 still work
    q_legacy = {nid: {"p50": 6.0, "p80": 8.0, "p90": 10.0} for nid in route}
    res2 = run_monte_carlo(RID, q_legacy, n_sim=200, seed=7)
    assert res2.percentiles["p50"] <= res2.percentiles["p95"]


def test_full_run_writes_contract_files(tmp_path):
    out = pg.run(route_ids=[RID], n_sim=300, out_dir=str(tmp_path))
    assert out["model_version"]
    frames = {
        "checkpoint_risk": 10, "delay_propagation": 9,
        "eta_distribution": 1, "critical_checkpoints": 10,
        "current_risk_state": 10,
    }
    for name, nrows in frames.items():
        df = pd.read_parquet(tmp_path / f"{name}.parquet")
        assert len(df) == nrows, f"{name}: {len(df)} != {nrows}"
    mc = pd.read_parquet(tmp_path / "monte_carlo_results.parquet")
    assert len(mc) == 300
    assert set(mc["critical_checkpoint_id"].unique()) <= set(
        topology.route_by_id(RID).node_ids)
    eta = pd.read_parquet(tmp_path / "eta_distribution.parquet")
    assert eta["deadline_miss_probability"].between(0, 1).all()
    assert (eta["on_time_probability"] == 1 - eta["deadline_miss_probability"]).all()
    # schema parity with the committed contract files (shell column order)
    from backend.core.config import get_settings
    base = get_settings().abs_data_dir / "outputs"
    for name in list(frames) + ["monte_carlo_results"]:
        contract_cols = list(pd.read_parquet(base / f"{name}.parquet").columns)
        got_cols = list(pd.read_parquet(tmp_path / f"{name}.parquet").columns)
        assert got_cols == contract_cols, f"{name} schema drift"
