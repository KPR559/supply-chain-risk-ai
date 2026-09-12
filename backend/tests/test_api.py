"""API contract tests using FastAPI TestClient (fast endpoints only).

The heavy prediction endpoints trigger cold engine startup (GAT training), so
this module focuses on cheap, static endpoints and payload shapes.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app

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


# ---------------------------------------------------------------------------
# Auth (isolated tmp warehouse so the real one is never touched)
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_auth(tmp_path, monkeypatch):
    from dataclasses import replace
    from backend.core.config import get_settings as real_settings
    fake = replace(real_settings(), project_root=tmp_path, data_dir=tmp_path)
    monkeypatch.setattr("backend.app.api.routes.get_settings", lambda: fake)
    monkeypatch.setattr("backend.core.storage.get_settings", lambda: fake)
    return fake


def test_login_default_admin(isolated_auth):
    r = client.post("/api/v1/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "admin"
    assert body["token"]
    assert body["expires_at"]


def test_login_wrong_password(isolated_auth):
    client.post("/api/v1/login", json={"username": "admin", "password": "admin123"})
    r = client.post("/api/v1/login", json={"username": "admin", "password": "nope"})
    assert r.status_code == 401


def test_login_unknown_user(isolated_auth):
    r = client.post("/api/v1/login", json={"username": "ghost", "password": "whatever"})
    assert r.status_code == 401


def test_me_and_logout_flow(isolated_auth):
    token = client.post(
        "/api/v1/login", json={"username": "admin", "password": "admin123"}).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = client.get("/api/v1/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["username"] == "admin"
    assert client.post("/api/v1/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/me", headers=headers).status_code == 401


def test_me_no_token(isolated_auth):
    assert client.get("/api/v1/me").status_code == 401
    assert client.get("/api/v1/me", headers={"Authorization": "Bearer bogus"}).status_code == 401


def test_delete_account_removes_user_and_sessions(isolated_auth):
    token = client.post(
        "/api/v1/register",
        json={"username": "tempuser", "password": "s3cure-pass"}).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = client.delete("/api/v1/account", headers=headers)
    assert r.status_code == 200
    assert r.json()["deleted"] == "tempuser"
    assert client.get("/api/v1/me", headers=headers).status_code == 401
    assert client.post(
        "/api/v1/login",
        json={"username": "tempuser", "password": "s3cure-pass"}).status_code == 401


def test_delete_account_no_token(isolated_auth):
    assert client.delete("/api/v1/account").status_code == 401


def test_verify_token_missing_db_returns_none(isolated_auth):
    from backend.core import auth as auth_mod
    # isolated warehouse file does not exist yet: must resolve to None,
    # never raise (this is what kept kicking users to login on refresh)
    assert auth_mod.verify_token("bogus") is None
    auth_mod.revoke_token("bogus")  # must not raise either


def test_expired_token_rejected(isolated_auth):
    from backend.core import auth as auth_mod
    auth_mod.ensure_tables()
    token, _ = auth_mod.create_session("admin", ttl_hours=-1)
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_register_new_user_auto_login(isolated_auth):
    r = client.post("/api/v1/register",
                    json={"username": "operator1", "password": "s3cure-pass"})
    assert r.status_code == 201
    body = r.json()
    assert body["username"] == "operator1"
    assert body["token"]
    me = client.get("/api/v1/me",
                    headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200
    assert me.json()["username"] == "operator1"
    # and the new user can sign in with a password check
    again = client.post("/api/v1/login",
                        json={"username": "operator1", "password": "s3cure-pass"})
    assert again.status_code == 200


def test_register_duplicate_username(isolated_auth):
    client.post("/api/v1/register",
                json={"username": "operator1", "password": "s3cure-pass"})
    r = client.post("/api/v1/register",
                    json={"username": "operator1", "password": "other-pass"})
    assert r.status_code == 409


def test_register_weak_password_rejected(isolated_auth):
    r = client.post("/api/v1/register",
                    json={"username": "operator1", "password": "short"})
    assert r.status_code == 422


def test_register_bad_username_rejected(isolated_auth):
    r = client.post("/api/v1/register",
                    json={"username": "no spaces!", "password": "s3cure-pass"})
    assert r.status_code == 422