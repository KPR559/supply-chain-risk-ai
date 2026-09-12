"""API endpoints (routers)."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

from backend.app.schemas.models import (CompareRoutesRequest, PredictRequest,
                                    ScenarioAdjustment, SimulateRequest,
                                    WhatIfRequest)
from backend.core import storage
from backend.core.config import get_settings
from backend.core.graph import topology
from backend.core.logging_util import get_logger, log_with
from backend.core.models import classification, delay, registry
from backend.core.predictor import get_engine
from backend.core.routing.routes import run_scenario, Scenario

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
    return eng.predict_shipment(
        "frankfurt", "final_destination", route_id="suez",
        current_checkpoint="suez",
        deadline_date=None,
        seed=get_settings().demo_seed,
    )


@router.get("/health")
def health() -> Dict[str, Any]:
    s = get_settings()
    return {
        "status": "ok",
        "models": registry.list_models(),
        "data": {
            "datasets": storage.list_datasets(),
            "warehouse": storage.warehouse_tables(),
            "graph_backend": s.graph_backend,
            "nlp_engine": s.nlp_engine,
            "mc_simulations": s.mc_simulations,
        },
    }


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


@router.get("/routes/{route_id}")
def get_route(route_id: str) -> Dict[str, Any]:
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
    try:
        payload = eng.predict_shipment(
            req.origin, req.destination, route_id=req.route_id,
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
@router.get("/graph/{route_id}")
def get_graph(route_id: str) -> Dict[str, Any]:
    r = topology.route_by_id(route_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Unknown route {route_id}")
    try:
        eng = get_engine()
        demo = eng.predict_shipment("frankfurt", "final_destination",
                                    route_id=route_id,
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
    nodes = [
        {"node_id": n, "label": topology.node_label(n),
         "kind": topology.node_index()[n]["kind"],
         "lon": topology.node_index()[n]["lon"],
         "lat": topology.node_index()[n]["lat"],
         "risk": risk_by_node.get(n, {})}
        for n in r.node_ids
    ]
    edges = [
        {"src": e.src, "dst": e.dst, "mode": e.mode,
         "distance_km": e.distance_km, "baseline_days": e.baseline_days}
        for e in topology.route_edges(r)
    ]
    return {"route_id": route_id, "name": r.name, "nodes": nodes, "edges": edges}


@router.get("/node/{node_id}/risk")
def node_risk(node_id: str) -> Dict[str, Any]:
    if node_id not in topology.node_index():
        raise HTTPException(status_code=404, detail=f"Unknown node {node_id}")
    eng = get_engine()
    demo = eng.predict_shipment("frankfurt", "final_destination",
                                route_id="suez", seed=get_settings().demo_seed)
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
    eng = get_engine()
    scenario_payload = {"name": req.name}
    adj = req.adjustments or ScenarioAdjustment()
    if req.node_id:
        scenario_payload["node_id"] = req.node_id
        d = adj.model_dump()
        scenario_payload.update({k: v for k, v in d.items() if v is not None})
    log.info("what-if", extra={"extra_fields": {"shipment": req.shipment_id,
                                                "scenario": req.name}})
    result = eng.whatif(shipment, scenario_payload)
    baseline = shipment["monte_carlo"]
    sc = result["monte_carlo"]
    bp = baseline.get("percentiles", {})
    sp = sc.get("percentiles", {})
    result["baseline"] = {
        "expected_days": baseline.get("expected_days"),
        "expected_delay_hours": baseline.get("expected_delay_hours"),
        "percentiles": bp,
    }
    result["delta_expected_days"] = round(sc.get("expected_days", 0.0)
                                          - baseline.get("expected_days", 0.0), 2)
    result["delta_p90_days"] = round(sp.get("p90", 0.0) - bp.get("p90", 0.0), 2)
    return result


@router.post("/compare-routes")
def compare_routes_api(req: CompareRoutesRequest) -> Dict[str, Any]:
    shipment = _load(req.shipment_id)
    eng = get_engine()
    return eng.compare(shipment, req.objectives)


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