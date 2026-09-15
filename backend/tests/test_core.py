"""Fast unit tests for fast, deterministic core logic (no heavy engine load)."""
from __future__ import annotations

import numpy as np
import pytest

from backend.core.config import get_settings, reset_settings
from backend.core.graph import topology
from backend.core.routing.routes import (compare_routes, recommend_route, run_scenario,
                                 Scenario)


def test_topology_routes_are_well_formed():
    assert len(topology.ROUTES) == 4
    known = set(topology.node_index())
    for r in topology.ROUTES:
        assert set(r.node_ids) <= known
        edges = topology.route_edges(r)
        assert len(edges) == len(r.node_ids) - 1
        assert topology.route_distance_km(r) > 0
        assert topology.route_baseline_days(r) > 0


def test_topology_routes_have_distinct_profiles():
    ids = [r.route_id for r in topology.ROUTES]
    assert ids == ["asia_europe_suez", "asia_europe_cape", "trans_pacific",
                   "asia_us_east_panama"]
    d = {r.route_id: topology.route_baseline_days(r) for r in topology.ROUTES}
    assert d["asia_europe_cape"] > d["asia_europe_suez"]  # bypass is longer
    assert d["trans_pacific"] == min(d.values())  # direct crossing is shortest


def test_settings_loads_env_and_defaults():
    reset_settings()
    s = get_settings()
    assert s.mc_simulations >= 100
    assert s.delay_threshold_hours > 0
    assert s.graph_backend in ("networkx", "neo4j")
    assert s.abs_artifact_dir.is_absolute()


def test_scenario_adjustment_scales_quantiles_up_with_congestion():
    base = {"suez": {"p50": 20.0, "p80": 30.0, "p90": 40.0}}
    sc = Scenario(name="high congestion", route_id="suez",
                  node_adjustments={"suez": {"congestion_mult": 2.0}})
    out = __import__("backend.core.routing.routes", fromlist=["apply_scenario_to_quantiles"]) \
        .apply_scenario_to_quantiles(base, {}, sc)
    assert out["suez"]["p50"] > base["suez"]["p50"]
    assert out["suez"]["p90"] > out["suez"]["p50"]


def test_recommend_route_fastest_picks_shortest():
    opts = [
        {"route_id": "a", "expected_days": 30.0, "deadline_risk": 0.2,
         "delay_probability": 0.5, "uncertainty": 6.0},
        {"route_id": "b", "expected_days": 42.0, "deadline_risk": 0.5,
         "delay_probability": 0.7, "uncertainty": 9.0},
    ]
    assert recommend_route(opts, "fastest")["recommended_route_id"] == "a"
    assert recommend_route(opts, "lowest_risk")["recommended_route_id"] == "a"


def test_compare_routes_uses_every_route_and_keeps_ordering():
    base = {n: {"p50": 5.0, "p80": 8.0, "p90": 11.0} for n in topology.node_index()}
    opts = compare_routes(base, n_sim=500, seed=1)
    assert len(opts) == len(topology.ROUTES)
    for o in opts:
        assert o.p90_days > o.expected_days > 0
        assert o.uncertainty > 0
    by_id = {o.route.route_id: o for o in opts}
    # trans_pacific is the shortest route so must have the lowest expected days
    assert by_id["trans_pacific"].expected_days < by_id["asia_europe_cape"].expected_days


def test_run_scenario_returns_full_payload():
    base = {n: {"p50": 6.0, "p80": 9.0, "p90": 12.0} for n in topology.node_index()}
    sc = Scenario(name="test", route_id="asia_europe_suez")
    res = run_scenario(base, {}, sc, n_sim=500, seed=2)
    assert res["scenario"] == "test"
    assert res["monte_carlo"]["expected_days"] > 0
    assert "suez" in res["per_node_risk"]


def test_storage_write_read_roundtrip(tmp_path, monkeypatch):
    import pandas as pd
    from backend.core import storage as st
    from backend.core.config import PROJECT_ROOT
    monkeypatch.setattr("backend.core.storage.get_settings",
                        lambda: _fake_settings(PROJECT_ROOT, tmp_path))
    df = pd.DataFrame({
        "node_id": ["suez", "mumbai"],
        "delay_hours": [30.0, 5.0],
        "timestamp": pd.to_datetime(["2025-06-01", "2025-06-02"]),
    })
    st.write_partitioned(df, "t", ["node_id"])
    out = st.read_partitioned("t")
    assert len(out) == 2
    assert {"suez", "mumbai"} == set(out["node_id"])


def test_warehouse_materialize_roundtrip(tmp_path, monkeypatch):
    import pandas as pd
    from backend.core import storage as st
    from backend.core.config import PROJECT_ROOT
    monkeypatch.setattr("backend.core.storage.get_settings",
                        lambda: _fake_settings(PROJECT_ROOT, tmp_path))
    raw = tmp_path / "raw"
    raw.mkdir(parents=True)
    pd.DataFrame({"node_id": ["suez", "mumbai"],
                  "delay_hours": [30.0, 5.0]}).to_parquet(raw / "events.parquet", index=False)
    assert st.warehouse_tables() == []
    counts = st.materialize_warehouse()
    assert counts["raw_events"] == 2
    assert "raw_events" in st.warehouse_tables()
    out = st.read_table("raw_events", where="delay_hours > 10")
    assert len(out) == 1
    assert out.iloc[0]["node_id"] == "suez"
    with pytest.raises(FileNotFoundError):
        st.read_table("no_such_table")


def _fake_settings(root, data_dir):
    from dataclasses import replace
    s = get_settings()
    return replace(s, project_root=root, data_dir=data_dir)


def test_quantile_trainer_converges_on_synthetic():
    import pandas as pd
    from backend.core.models.delay import train_quantile_models

    rng = np.random.default_rng(0)
    n = 600
    base = pd.date_range("2024-01-01", periods=n, freq="h")
    x = rng.uniform(0, 1, size=n)
    y = 3 * x + 2 * np.sin(np.arange(n) / 24.0) + rng.normal(0, 0.5, size=n)
    Xy = pd.DataFrame({
        "timestamp": base,
        "node_id": ["suez"] * n,
        "delay_hours": np.maximum(0.0, y),
        "f_congestion": x,
    })
    result = train_quantile_models(Xy, feature_cols=["f_congestion"],
                                   quantiles=[0.50, 0.80, 0.90])
    assert set(result["models"]) == {"p50", "p80", "p90"}
    assert result["metrics"]["mae_test"] < 1.5
    # quantiles must be ordered per-sample after prediction
    X = Xy[["f_congestion"]].astype(float).head(50).to_numpy()
    preds = {q: m.predict(X) for q, m in result["models"].items()}
    assert np.all(preds["p50"] <= preds["p80"] + 1e-6)
    assert np.all(preds["p80"] <= preds["p90"] + 1e-6)