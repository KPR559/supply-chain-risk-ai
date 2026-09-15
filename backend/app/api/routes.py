"""API endpoints (routers)."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request

from backend.app.schemas.models import (ChangePasswordRequest, ChangeUsernameRequest,
                                     CompareRoutesRequest, ForgotRequest, LoginRequest,
                                     PredictRequest, RegisterRequest, ResetRequest,
                                     ScenarioAdjustment, SimulateRequest, UpdateProfileRequest,
                                     WhatIfRequest, NodeAdjustment)
from backend.core import storage
from backend.core.auth import (UsernameTakenError, authenticate, change_password,
                               change_username, check_rate_limit, create_reset_token,
                               delete_user, get_profile, issue_token_pair, register_user,
                               reset_password_with_token, revoke_token, update_profile,
                               verify_refresh_token, verify_token)
from backend.core.config import get_settings
from backend.core.graph import topology
from backend.core.graph.layout import build_map_analytics
from backend.core.logging_util import get_logger, log_with
from backend.core.models import classification, delay, registry
from backend.core.predictor import get_engine
from backend.core.routing.routes import run_scenario, Scenario, run_whatif_scenario, build_whatif_presets

log = get_logger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory shipment store: prediction payloads keyed by shipment id.
# ---------------------------------------------------------------------------
_SHIPMENTS: Dict[str, Dict] = {}


def _store(shipment_id: str, payload: Dict) -> None:
    _SHIPMENTS[shipment_id] = payload


def _load(shipment_id: str) -> Dict:
    if shipment_id not in _SHIPMENTS:
        # demo id shortcut
        if shipment_id == "FRA-IN-001":
            _SHIPMENTS[shipment_id] = _run_demo_prediction()
        else:
            raise HTTPException(status_code=404, detail=f"Unknown shipment {shipment_id}")
    return _SHIPMENTS[shipment_id]


def _run_demo_prediction() -> Dict:
    eng = get_engine()
    route_id = topology.DEFAULT_ROUTE
    r = topology.route_by_id(route_id)
    origin = r.node_ids[0]
    destination = r.node_ids[-1]
    return eng.predict_shipment(
        origin, destination, route_id=route_id,
        current_checkpoint=origin,
        deadline_date=None,
        seed=get_settings().demo_seed,
    )


def _llm_meta() -> Dict[str, Any]:
    """Provider/model identity (never raises)."""
    try:
        from backend.core.llm import get_llm
        cfg = getattr(get_llm(), "_cfg", None)
        return {
            "provider": getattr(cfg, "provider", "ollama"),
            "model": getattr(cfg, "model", "unknown"),
        }
    except Exception:
        return {"provider": "ollama", "model": "unknown"}


@router.get("/health")
def health() -> Dict[str, Any]:
    s = get_settings()
    try:
        warehouse = storage.warehouse_tables()
    except Exception:
        warehouse = []
    try:
        from backend.core.llm import get_llm
        llm = get_llm()
        llm_info = {
            **_llm_meta(),
            "available": llm.is_available(),
            "base_url": getattr(getattr(llm, "_cfg", None), "base_url", "http://localhost:11434"),
        }
    except Exception:
        llm_info = {**_llm_meta(), "available": False}
    return {
        "status": "ok",
        "models": registry.list_models(),
        "data": {
            "datasets": storage.list_datasets(),
            "warehouse": warehouse,
            "graph_backend": s.graph_backend,
            "nlp_engine": s.nlp_engine,
            "mc_simulations": s.mc_simulations,
        },
        "llm": llm_info,
    }


# ---------------------------------------------------------------------------
# Auth (DuckDB-backed users + token sessions)
# ---------------------------------------------------------------------------

def _bearer_token(request: Request) -> Optional[str]:
    # Prefer Authorization header, fall back to HttpOnly refresh cookie for /refresh
    auth = request.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() == "bearer" and token:
        return token
    ck = request.cookies.get("refresh_token")
    if ck:
        return ck
    return None


def _client_ip(request: Request) -> str:
    # Vercel / proxy aware
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _issue_pair_response(username: str, status_code: int = 200):
    pair = issue_token_pair(username)
    s = get_settings()
    profile = get_profile(username) or {}
    # HttpOnly refresh cookie (7d), SameSite Lax so top-level navigation works
    from fastapi.responses import JSONResponse
    resp = JSONResponse({
        "token": pair["access_token"],
        "access_token": pair["access_token"],
        "refresh_token": pair["refresh_token"],
        "username": username,
        "avatar": profile.get("avatar"),
        "expires_at": pair.get("expires_at"),
    }, status_code=status_code)
    resp.set_cookie(
        "refresh_token", pair["refresh_token"],
        httponly=True, samesite="lax", secure=False,  # secure True needs HTTPS; keep False for local
        max_age=s.auth_refresh_ttl_days * 86400, path="/api/v1",
    )
    return resp


@router.post("/login")
def login(req: LoginRequest, request: Request) -> Dict[str, Any]:
    if not check_rate_limit(f"login:{_client_ip(request)}"):
        raise HTTPException(status_code=429, detail="Too many attempts, try again shortly")
    username = authenticate(req.username.strip(), req.password)
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return _issue_pair_response(username)


@router.post("/register", status_code=201)
def register(req: RegisterRequest, request: Request) -> Dict[str, Any]:
    if not check_rate_limit(f"register:{_client_ip(request)}"):
        raise HTTPException(status_code=429, detail="Too many attempts, try again shortly")
    try:
        username = register_user(req.username, req.password)
    except UsernameTakenError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _issue_pair_response(username, status_code=201)


@router.post("/logout")
def logout(request: Request) -> Dict[str, Any]:
    token = _bearer_token(request)
    # try to find user via either token type to revoke all their sessions
    username = verify_token(token) or verify_refresh_token(token)
    if username:
        # revoke all sessions for user (clean logout)
        from backend.core import auth as auth_mod
        con = auth_mod.storage.connect()
        try:
            con.execute("DELETE FROM sessions WHERE username = ?", [username])
        finally:
            con.close()
    else:
        revoke_token(token)
        from backend.core.auth import revoke_refresh_token
        revoke_refresh_token(token)
    # clear refresh cookie
    from fastapi.responses import JSONResponse
    resp = JSONResponse({"status": "ok"})
    resp.delete_cookie("refresh_token", path="/api/v1")
    return resp


@router.get("/me")
def me(request: Request) -> Dict[str, Any]:
    username = verify_token(_bearer_token(request))
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return get_profile(username) or {"username": username, "avatar": None, "created_at": None}


@router.post("/refresh")
def refresh(request: Request) -> Dict[str, Any]:
    token = _bearer_token(request)
    username = verify_refresh_token(token)
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    # rotate: revoke old, issue new pair
    from backend.core.auth import revoke_refresh_token
    revoke_refresh_token(token)
    return _issue_pair_response(username)


@router.post("/forgot-password")
def forgot(req: ForgotRequest, request: Request) -> Dict[str, Any]:
    if not check_rate_limit(f"forgot:{_client_ip(request)}"):
        raise HTTPException(status_code=429, detail="Too many attempts, try again shortly")
    try:
        token, exp = create_reset_token(req.username.strip())
    except ValueError:
        # don't reveal whether the user exists
        return {"status": "ok"}
    # In production this would email the token; for prototype we return it
    # so the flow is testable without an email provider.
    return {"status": "ok", "reset_token": token, "expires_at": exp.isoformat()}


@router.post("/reset-password")
def reset(req: ResetRequest) -> Dict[str, Any]:
    try:
        username = reset_password_with_token(req.token, req.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "username": username}


@router.post("/change-password")
def change_password_route(req: ChangePasswordRequest, request: Request) -> Dict[str, Any]:
    username = verify_token(_bearer_token(request))
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    try:
        change_password(username, req.old_password, req.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok"}


@router.patch("/account/profile")
def update_profile_route(req: UpdateProfileRequest, request: Request) -> Dict[str, Any]:
    username = verify_token(_bearer_token(request))
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    profile = update_profile(username, avatar=req.avatar)
    return {"status": "ok", "profile": profile}


@router.post("/account/username")
def change_username_route(req: ChangeUsernameRequest, request: Request) -> Dict[str, Any]:
    username = verify_token(_bearer_token(request))
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    try:
        new_username = change_username(username, req.new_username)
    except UsernameTakenError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # issue a fresh token pair under the new handle so the session stays valid
    return _issue_pair_response(new_username)


@router.delete("/account")
def delete_account(request: Request) -> Dict[str, Any]:
    username = verify_token(_bearer_token(request))
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    # revoke the presented token too
    revoke_token(_bearer_token(request))
    delete_user(username)
    resp = {"status": "ok", "deleted": username}
    # clear refresh cookie
    from fastapi.responses import JSONResponse
    jr = JSONResponse(resp)
    jr.delete_cookie("refresh_token", path="/api/v1")
    return jr


# ---------------------------------------------------------------------------
@router.get("/routes")
def list_routes() -> Dict[str, Any]:
    return {
        "routes": [
            {
                "route_id": r.route_id,
                "name": r.name,
                "description": r.description,
                "nodes": [{"node_id": n, "label": topology.node_label(n)} for n in r.node_ids],
                "distance_km": round(topology.route_distance_km(r), 0),
                "baseline_days": round(topology.route_baseline_days(r), 1),
            }
            for r in topology.ROUTES
        ],
        "default_route": topology.DEFAULT_ROUTE,
    }


def _resolve_route_id(route_id: str) -> str:
    return topology.resolve_route_id(route_id)


@router.get("/routes/{route_id}")
def get_route(route_id: str) -> Dict[str, Any]:
    route_id = _resolve_route_id(route_id)
    r = topology.route_by_id(route_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Unknown route {route_id}")
    edges = topology.route_edges(r)
    return {
        "route_id": r.route_id,
        "name": r.name,
        "description": r.description,
        "nodes": [{"node_id": n, "label": topology.node_label(n),
                   "kind": topology.node_index()[n]["kind"]} for n in r.node_ids],
        "edges": [
            {"src": e.src, "dst": e.dst, "mode": e.mode,
             "distance_km": e.distance_km, "baseline_days": e.baseline_days,
             "reliability": e.reliability}
            for e in edges
        ],
        "distance_km": round(topology.route_distance_km(r), 0),
        "baseline_days": round(topology.route_baseline_days(r), 1),
    }


# ---------------------------------------------------------------------------
@router.post("/predict")
def predict(req: PredictRequest) -> Dict[str, Any]:
    eng = get_engine()
    route_id = _resolve_route_id(req.route_id)
    try:
        payload = eng.predict_shipment(
            req.origin, req.destination, route_id=route_id,
            current_checkpoint=req.current_checkpoint,
            deadline_date=req.deadline_date,
            origin_date=req.origin_date,
            n_sim=req.n_sim,
            seed=get_settings().demo_seed if req.n_sim is None else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    log.info("prediction", extra={"extra_fields": {"shipment": payload["shipment_id"],
                                                    "route": req.route_id}})
    _store(payload["shipment_id"], payload)
    return payload


@router.get("/shipments/{shipment_id}")
def get_shipment(shipment_id: str) -> Dict[str, Any]:
    return _load(shipment_id)


@router.get("/prediction/{shipment_id}")
def get_prediction(shipment_id: str) -> Dict[str, Any]:
    return _load(shipment_id)


@router.get("/eta/{shipment_id}")
def get_eta(shipment_id: str) -> Dict[str, Any]:
    return _load(shipment_id)["monte_carlo"]


# ---------------------------------------------------------------------------
# Graph data for the route map. demo_n_sim keeps the map light: node risk comes
# from the classifier/quantile models and does not depend on the MC simulation,
# so a small n_sim is enough for visualisation.
# ---------------------------------------------------------------------------
def _route_graph(route_id: str, demo_n_sim: int = 100) -> Dict[str, Any]:
    route_id = _resolve_route_id(route_id)
    r = topology.route_by_id(route_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Unknown route {route_id}")
    try:
        eng = get_engine()
        demo = eng.predict_shipment(r.node_ids[0], r.node_ids[-1],
                                    route_id=route_id,
                                    n_sim=demo_n_sim,
                                    seed=get_settings().demo_seed)
    except RuntimeError:
        demo = None
    risk_by_node = {}
    if demo:
        risk_by_node = {
            n["node_id"]: {
                "delay_probability": n["delay_probability"],
                "expected_delay_hours": n["expected_delay_hours"],
                "regime": n["regime"],
                "risk": ("high" if n["delay_probability"] >= 0.6
                         else "medium" if n["delay_probability"] >= 0.35 else "low"),
            }
            for n in demo["node_predictions"] if n["node_id"] in r.node_ids
        }
    analytics = build_map_analytics()
    nodes = [
        {"node_id": n, "label": topology.node_label(n),
         "kind": topology.node_index()[n]["kind"],
         "lon": topology.node_index()[n]["lon"],
         "lat": topology.node_index()[n]["lat"],
         "pos": analytics["positions"].get(n, {}),
         "metrics": analytics["metrics"].get(n, {}),
         "risk": risk_by_node.get(n, {})}
        for n in r.node_ids
    ]
    edges = [
        {"src": e.src, "dst": e.dst, "mode": e.mode,
         "distance_km": e.distance_km, "baseline_days": e.baseline_days}
        for e in topology.route_edges(r)
    ]
    return {"route_id": route_id, "name": r.name, "nodes": nodes, "edges": edges}


@router.get("/graphs")
def get_graphs() -> Dict[str, Any]:
    """All route graphs in one call (for the route-map overlay)."""
    return {
        "routes": [_route_graph(r.route_id) for r in topology.ROUTES],
        "default_route": topology.DEFAULT_ROUTE,
        "network": build_map_analytics()["network"],
    }


@router.get("/graph/{route_id}")
def get_graph(route_id: str) -> Dict[str, Any]:
    return _route_graph(route_id)


@router.get("/node/{node_id}/risk")
def node_risk(node_id: str) -> Dict[str, Any]:
    if node_id not in topology.node_index():
        raise HTTPException(status_code=404, detail=f"Unknown node {node_id}")
    eng = get_engine()
    route_id = topology.DEFAULT_ROUTE
    r = topology.route_by_id(route_id)
    demo = eng.predict_shipment(r.node_ids[0], r.node_ids[-1],
                                route_id=route_id, seed=get_settings().demo_seed)
    for n in demo["node_predictions"]:
        if n["node_id"] == node_id:
            return n
    return {"node_id": node_id, "label": topology.node_label(node_id),
            "delay_probability": 0.0, "error": "no prediction for this node",
            "expected_delay_hours": 0.0}


# ---------------------------------------------------------------------------
@router.post("/simulate")
def simulate(req: SimulateRequest) -> Dict[str, Any]:
    from backend.core.simulation.monte_carlo import run_monte_carlo
    try:
        res = run_monte_carlo(
            req.route_id,
            req.node_quantiles or {},
            n_sim=req.n_sim,
            seed=get_settings().mc_seed,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return res.to_dict()


@router.post("/what-if")
def whatif(req: WhatIfRequest) -> Dict[str, Any]:
    shipment = _load(req.shipment_id)
    s = get_settings()

    # Build adjustments from the new request shape
    adjustments = None
    if req.adjustments:
        adjustments = req.adjustments.model_dump()
    node_adjustments_list = None
    if req.node_adjustments:
        node_adjustments_list = [na.model_dump() for na in req.node_adjustments]
    route_adjustments = None
    if req.route_adjustments:
        route_adjustments = req.route_adjustments.model_dump()

    log.info("what-if", extra={"extra_fields": {"shipment": req.shipment_id,
                                                "scenario": req.name,
                                                "type": req.scenario_type}})
    result = run_whatif_scenario(
        shipment=shipment,
        scenario_type=req.scenario_type,
        scope=req.scope,
        node_id=req.node_id,
        node_ids=req.node_ids,
        segment_start=req.segment_start,
        segment_end=req.segment_end,
        adjustments=adjustments,
        node_adjustments_list=node_adjustments_list,
        route_adjustments=route_adjustments,
        n_sim=None,
        seed=s.demo_seed,
    )
    return result


@router.get("/what-if/presets/{route_id}")
def whatif_presets(route_id: str) -> Dict[str, Any]:
    route_id = _resolve_route_id(route_id)
    r = topology.route_by_id(route_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Unknown route {route_id}")
    presets = build_whatif_presets(route_id)
    return {"route_id": route_id, "presets": presets}


@router.post("/compare-routes")
def compare_routes_api(req: CompareRoutesRequest) -> Dict[str, Any]:
    shipment = _load(req.shipment_id)
    eng = get_engine()
    return eng.compare(shipment, req.objectives)


# ---------------------------------------------------------------------------
# LLM narrative endpoints. The engine computed every number; the LLM only
# explains it. All endpoints degrade to status "unavailable" when Ollama is
# not reachable so the UI hides the AI panels instead of failing.
# ---------------------------------------------------------------------------

@router.post("/llm/explain")
def llm_explain(req: LLMExplainRequest) -> Dict[str, Any]:
    from backend.core import llm_service
    node = req.node
    if node is None and req.node_id:
        node = next((n for n in (req.prediction or {}).get("node_predictions", [])
                     if n.get("node_id") == req.node_id), None)
    try:
        res = llm_service.explain_panels(
            prediction=req.prediction,
            explanation=req.explanation,
            recommendations=req.recommendations or [],
            panels=req.panels or ["situation", "risk", "eta", "deadline", "drivers"],
            trend=req.trend,
            node=node,
            edge=req.edge,
        )
    except Exception as exc:  # pragma: no cover - depends on local Ollama
        log.warning("llm/explain error", extra={"extra_fields": {"error": str(exc)}})
        return {"status": "error", "error": str(exc), "panels": {},
                "recommendations_list": [], "node": None, "edge": None,
                "meta": _llm_meta()}
    return {
        "status": "ok" if res["meta"]["available"] else "unavailable",
        "error": None,
        "panels": res["panels"],
        "recommendations_list": res["recommendations_list"],
        "node": res["node"],
        "edge": res["edge"],
        "meta": res["meta"],
    }


@router.post("/llm/chat")
def llm_chat(req: LLMChatRequest) -> Dict[str, Any]:
    from backend.core import llm_service
    try:
        text = llm_service.chat(req.prediction or {}, req.question, req.history or [])
    except Exception as exc:  # pragma: no cover
        log.warning("llm/chat error", extra={"extra_fields": {"error": str(exc)}})
        return {"status": "error", "error": str(exc), "text": None, "meta": _llm_meta()}
    return {
        "status": "ok" if text else "unavailable",
        "error": None,
        "text": text,
        "meta": {**_llm_meta(), "available": bool(text)},
    }


@router.post("/llm/report")
def llm_report(req: LLMReportRequest) -> Dict[str, Any]:
    from backend.core import llm_service
    try:
        r = llm_service.report(req.prediction, req.explanation, req.critical)
    except Exception as exc:  # pragma: no cover
        log.warning("llm/report error", extra={"extra_fields": {"error": str(exc)}})
        return {"status": "error", "error": str(exc), "title": None, "markdown": None,
                "meta": _llm_meta()}
    if not r:
        return {"status": "unavailable", "error": None, "title": None, "markdown": None,
                "meta": _llm_meta()}
    return {"status": "ok", "error": None, **r, "meta": _llm_meta()}


# ---------------------------------------------------------------------------
@router.get("/explanation/{shipment_id}")
def explanation(shipment_id: str) -> Dict[str, Any]:
    shipment = _load(shipment_id)
    eng = get_engine()
    return eng.explain(shipment)


@router.get("/critical-nodes/{shipment_id}")
def critical_nodes(shipment_id: str) -> Dict[str, Any]:
    shipment = _load(shipment_id)
    return {"shipment_id": shipment_id,
            "critical_nodes": shipment["critical_nodes"]}


# ---------------------------------------------------------------------------
@router.get("/metrics")
def metrics() -> Dict[str, Any]:
    s = get_settings()
    eval_path = s.abs_artifact_dir / "evaluation.json"
    summary_path = s.abs_artifact_dir / "training_summary.json"
    out: Dict[str, Any] = {"model_metrics": {}}
    if summary_path.exists():
        out["model_metrics"]["training"] = json.loads(summary_path.read_text(encoding="utf-8"))
    if eval_path.exists():
        out["model_metrics"]["evaluation"] = json.loads(eval_path.read_text(encoding="utf-8"))
    out["calibration"] = {
        "method": "isotonic (classifier) + quantile regression (delay)",
        "coverage_note": "P50/P80/P90 coverage reported in evaluation.json",
    }
    return out


@router.get("/data-quality")
def data_quality() -> Dict[str, Any]:
    s = get_settings()
    raw = s.abs_data_dir / "raw" / "events.parquet"
    silver = s.abs_data_dir / "silver" / "cleaned_events.parquet"
    report = {"status": "no data"}
    if raw.exists() and silver.exists():
        import pandas as pd
        raw_df = pd.read_parquet(raw)
        clean_df = pd.read_parquet(silver)
        report = {
            "status": "ok",
            "raw_records": len(raw_df),
            "cleaned_records": len(clean_df),
            "removed": len(raw_df) - len(clean_df),
            "removal_rate": round((len(raw_df) - len(clean_df)) / max(len(raw_df), 1), 4),
            "note": "Raw events validated; real-world event anomalies are kept "
                    "and converted to regime features (never deleted).",
        }
    return report


@router.get("/demo")
def demo() -> Dict[str, Any]:
    eng = get_engine()
    payload = _run_demo_prediction()
    _store(payload["shipment_id"], payload)
    _store("FRA-IN-001", payload)
    return payload