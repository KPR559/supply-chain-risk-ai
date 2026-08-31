"""API contract tests using FastAPI TestClient (fast endpoints only).

The heavy prediction endpoints trigger cold engine startup (GAT training), so
this module focuses on cheap, static endpoints and payload shapes.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert isinstance(body["models"], list)
    assert "data" in body


def test_routes_listing_shape():
    r = client.get("/api/v1/routes")
    assert r.status_code == 200
    routes = r.json()["routes"]
    ids = {x["route_id"] for x in routes}
    assert {"suez", "cape", "dubai"} <= ids
    for x in routes:
        assert x["baseline_days"] > 0
        assert len(x["nodes"]) >= 6


def test_route_detail():
    r = client.get("/api/v1/routes/cape")
    assert r.status_code == 200
    body = r.json()
    assert body["route_id"] == "cape"
    assert len(body["nodes"]) == len(body["edges"]) + 1
    assert body["distance_km"] > body["baseline_days"]


def test_route_404():
    assert client.get("/api/v1/routes/bogus").status_code == 404


def test_simulate_endpoint_shape():
    r = client.post("/api/v1/simulate", json={"route_id": "suez", "n_sim": 200})
    assert r.status_code == 200
    mc = r.json()
    assert mc["route_id"] == "suez"
    assert mc["n_simulations"] == 200
    assert mc["expected_days"] > 0
    assert mc["percentiles"]["p90"] >= mc["percentiles"]["p50"]


def test_data_quality_shape():
    r = client.get("/api/v1/data-quality")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("ok", "no data")
    if body["status"] == "ok":
        assert body["removal_rate"] >= 0


def test_metrics_shape():
    r = client.get("/api/v1/metrics")
    assert r.status_code == 200
    body = r.json()
    assert "model_metrics" in body
    assert "calibration" in body


def test_unknown_shipment_404():
    r = client.get("/api/v1/shipments/does-not-exist")
    assert r.status_code == 404


def test_explanation_unknown_shipment_404():
    assert client.get("/api/v1/explanation/does-not-exist").status_code == 404


def test_unknown_node_404():
    assert client.get("/api/v1/node/nope/risk").status_code == 404