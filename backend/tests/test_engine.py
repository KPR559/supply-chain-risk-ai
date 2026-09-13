"""End-to-end engine integration tests (require trained artifacts).

Run the full suite with `pytest -m "not slow"` to skip these; or run
everything with plain `pytest`.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.core.predictor import get_engine

pytestmark = pytest.mark.slow


def test_graphs_endpoint_all_routes():
    r = TestClient(app).get("/api/v1/graphs")
    assert r.status_code == 200
    body = r.json()
    routes = body["routes"]
    assert {g["route_id"] for g in routes} == {"suez", "cape", "dubai"}
    assert body["network"]["nodes"] == 10
    assert body["network"]["edges"] >= 12
    for g in routes:
        assert len(g["nodes"]) == len(g["edges"]) + 1
        for n in g["nodes"]:
            assert isinstance(n["lon"], float) and isinstance(n["lat"], float)
            assert "delay_probability" in n["risk"]
            assert {"x", "y"} <= set(n["pos"])
            assert "betweenness" in n["metrics"]
            assert n["metrics"]["hops_from_origin"] == 0 or n["metrics"]["hops_from_origin"] > 0
        for e in g["edges"]:
            assert e["mode"] in {"road", "sea", "port"}
            assert e["distance_km"] >= 0


@pytest.fixture(scope="module")
def engine():
    eng = get_engine()
    eng.ensure_ready()
    return eng


@pytest.fixture(scope="module")
def shipment(engine):
    return engine.predict_shipment(
        "frankfurt", "final_destination", route_id="suez", seed=7)


def test_predict_payload_shape(shipment):
    assert shipment["route_id"] == "suez"
    assert shipment["monte_carlo"]["expected_days"] > 15
    mc = shipment["monte_carlo"]
    assert mc["percentiles"]["p10"] <= mc["percentiles"]["p50"] <= mc["percentiles"]["p90"]
    assert len(shipment["node_predictions"]) == 8
    assert 0.0 <= shipment["delay_probabilities"]["suez"] <= 1.0
    assert len(shipment["critical_nodes"]) == 8
    assert shipment["critical_nodes"][0]["node_id"] == "suez"


def test_predict_explanation(shipment, engine):
    expl = engine.explain(shipment)
    assert expl["node_id"] == "suez"
    assert len(expl["top_factors"]) >= 3
    assert expl["delay_probability"] > 0.5


def test_whatif_increases_p90(engine, shipment):
    base_p90 = shipment["monte_carlo"]["percentiles"]["p90"]
    res = engine.whatif(shipment, {
        "name": "Suez blocked", "node_id": "suez", "close": True,
    })
    assert res["monte_carlo"]["percentiles"]["p90"] > base_p90


def test_compare_recommendations_are_valid(engine, shipment):
    cmp = engine.compare(shipment, ["fastest", "lowest_risk", "balanced"])
    assert set(cmp["recommended"]) == {"fastest", "lowest_risk", "balanced"}
    for v in cmp["recommended"].values():
        assert v in {"suez", "cape", "dubai"}
    assert len(cmp["options"]) == 3
    # fastest should not be the longest route
    fast = cmp["recommended"]["fastest"]
    op = {o["route_id"]: o for o in cmp["options"]}
    assert op[fast]["expected_eta_days"] == min(o["expected_eta_days"] for o in cmp["options"])


def test_three_routes_produce_etas(engine):
    for rid in ("suez", "cape", "dubai"):
        s = engine.predict_shipment("frankfurt", "final_destination",
                                    route_id=rid, seed=7)
        assert s["monte_carlo"]["expected_days"] > 10