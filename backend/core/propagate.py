"""Items 15-21 — PROPAGATE & QUANTIFY batch job.

Reads the ML handoff (``data/ml/predictions.parquet``) and the route topology
and produces the graph-layer outputs:

  15. probabilistic checkpoint graph  -> LogisticsGraph + NodePrediction overlay
  16. graph-based delay modelling     -> edge-reliability cascade (+ GAT residual
                                        when torch + training data are available)
  17. spatio-temporal delay propagation -> per-edge quantile cascade
  18. dynamic network risk recalculation -> recalculate() on updated node states
  19. Monte Carlo ETA simulation      -> per-simulation rows (10k per route)
  20. probabilistic final ETA         -> per-route ETA percentiles
  21. deadline-miss probability       -> per-route p_miss + per-node contributions

Writes (schemas per backend/core/data/build_output_schemas.py):
  data/outputs/checkpoint_risk.parquet, delay_propagation.parquet,
  monte_carlo_results.parquet, eta_distribution.parquet,
  critical_checkpoints.parquet, current_risk_state.parquet

Conventions (documented, deterministic):
  * one row per (route, checkpoint); shipment_id is null (no shipment feed yet)
  * origin date = latest prediction batch timestamp
  * deadline_days = route baseline_days * deadline_factor (default 1.25)
  * uncertainty_hours = delay_p95 - delay_p50
  * criticality_score = MC expected-delay share; downstream_impact_score =
    propagated-delay share; deadline_risk_contribution = share * p_miss

Usage:
    python -m backend.core.propagate [--routes asia_europe_suez ...]
        [--n-sim 10000] [--attenuation 1.0] [--deadline-factor 1.25]
"""
from __future__ import annotations

import argparse
import os
import time
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from backend.core.config import get_settings
from backend.core.graph import topology
from backend.core.graph.network import (
    LogisticsGraph,
    NodePrediction,
    propagate_delay_cascade,
    risk_level_from_probability,
)
from backend.core.logging_util import get_logger
from backend.core.simulation.monte_carlo import run_monte_carlo

log = get_logger(__name__)

QUANTILES = (50, 80, 90, 95)


def _utcnow() -> pd.Timestamp:
    return pd.Timestamp(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


# ------------------------------------------------------------------ inputs

def load_latest_predictions(model_version: Optional[str] = None) -> Tuple[pd.DataFrame, str]:
    """Latest model_version rows; latest row per checkpoint."""
    s = get_settings()
    pred = pd.read_parquet(s.abs_data_dir / "ml" / "predictions.parquet")
    if pred.empty:
        raise ValueError("data/ml/predictions.parquet is empty - train the ML part first")
    if model_version is None:
        model_version = str(pred["model_version"].astype(str).max())
    pred = pred[pred["model_version"] == model_version].copy()
    pred["prediction_timestamp"] = pd.to_datetime(pred["prediction_timestamp"])
    pred = pred.sort_values("prediction_timestamp").groupby("checkpoint_id").tail(1)
    log.info(f"predictions v{model_version}: {len(pred)} checkpoints")
    return pred.reset_index(drop=True), model_version


def load_node_context() -> pd.DataFrame:
    """Latest regime/congestion context per node from checkpoint_features."""
    s = get_settings()
    feat = pd.read_parquet(s.abs_data_dir / "features" / "checkpoint_features.parquet")
    feat["timestamp"] = pd.to_datetime(feat["timestamp"])
    latest = feat.sort_values("timestamp").groupby("node_id").tail(1).set_index("node_id")
    return latest


def weather_risk_level(sev: float) -> str:
    if sev >= 0.75:
        return "high"
    if sev >= 0.33:
        return "moderate"
    return "low"


# ------------------------------------------------------------------ 15/16

def build_checkpoint_graph(pred: pd.DataFrame) -> Tuple[LogisticsGraph, Dict[str, NodePrediction]]:
    """Item 15: probabilistic checkpoint graph (topology + ML overlay)."""
    graph = LogisticsGraph.from_topology()
    nodes: Dict[str, NodePrediction] = {}
    node_index = topology.node_index()
    for _, r in pred.iterrows():
        nid = str(r["checkpoint_id"])
        if nid not in graph.graph:
            continue
        meta = node_index.get(nid, {})
        nodes[nid] = NodePrediction(
            node_id=nid,
            label=meta.get("label", nid),
            delay_probability=float(r["delay_probability"]),
            risk_level=risk_level_from_probability(float(r["delay_probability"])),
            expected_delay_hours=float(r["expected_delay_hours"]),
            p50=float(r["delay_p50_hours"]),
            p80=float(r["delay_p80_hours"]),
            p90=float(r["delay_p90_hours"]),
            congestion=float(r.get("congestion_index", 0.0) or 0.0),
            weather=0.0,
            conflict=0.0,
            regime=0,
        )
        graph.graph.nodes[nid].update(
            delay_probability=nodes[nid].delay_probability,
            expected_delay_hours=nodes[nid].expected_delay_hours,
        )
    log.info(f"checkpoint graph: {len(nodes)} nodes with predictions overlaid")
    return graph, nodes


def gat_adjustment(route_id: str) -> Tuple[Dict[str, float], str]:
    """Item 16 hook: learned GAT residual per route node.

    Returns ({node_id: residual_hours}, method). Falls back to the tabular
    path with an explicit reason when torch or training data is unavailable
    (the committed environment has neither: no torch, gold layer git-ignored).
    """
    try:
        from backend.core.graph.gat import TORCH_AVAILABLE
    except Exception:
        return {}, "gat_import_unavailable"
    if not TORCH_AVAILABLE:
        log.info("GAT disabled (no torch) - item 16 uses tabular graph modelling")
        return {}, "torch_unavailable"
    s = get_settings()
    gold_path = s.abs_data_dir / "gold" / "node_observations" / "observations.parquet"
    if not gold_path.exists():
        log.info("GAT disabled (no gold training data) - item 16 uses tabular graph modelling")
        return {}, "no_training_data"
    return {}, "torch_available_untrained"


# ------------------------------------------------------------------ 17/18

def propagate_route_quantiles(
    route_id: str,
    quants: Dict[str, Dict[str, float]],
    attenuation: float = 1.0,
) -> Dict[str, Dict[str, float]]:
    """Item 17: per-quantile downstream cascade along a route.

    eff_q[node] = own_q[node] + attenuation * cum_q(upstream).
    Monotonicity across quantiles is preserved (sums of monotone inputs).
    """
    route = topology.route_by_id(route_id).node_ids
    eff: Dict[str, Dict[str, float]] = {}
    cum = {q: 0.0 for q in QUANTILES}
    for nid in route:
        own = quants.get(nid, {})
        eff[nid] = {}
        for q in QUANTILES:
            own_q = float(own.get(f"p{q}", own.get("expected", 0.0) or 0.0) or 0.0)
            eff[nid][q] = own_q + attenuation * cum[q]
            cum[q] = cum[q] + own_q * attenuation
    return eff


def recalculate(
    route_id: str,
    quants: Dict[str, Dict[str, float]],
    node_overrides: Optional[Dict[str, Dict[str, float]]] = None,
    attenuation: float = 1.0,
    reason: str = "manual",
) -> Dict[str, Dict[str, float]]:
    """Item 18: dynamic network risk recalculation.

    Merges updated node states (e.g. fresh observations or what-if edits)
    over the batch quantiles and re-runs the cascade. Pure function of its
    inputs so any new observation propagates checkpoint -> downstream.
    """
    merged = {nid: dict(vals) for nid, vals in quants.items()}
    for nid, vals in (node_overrides or {}).items():
        merged.setdefault(nid, {}).update(vals)
    log.info(f"recalculate route={route_id} reason={reason} "
             f"overrides={sorted((node_overrides or {}))}")
    return propagate_route_quantiles(route_id, merged, attenuation)


# ------------------------------------------------------------------run

def _quants_from_predictions(pred: pd.DataFrame) -> Dict[str, Dict[str, float]]:
    out = {}
    for _, r in pred.iterrows():
        nid = str(r["checkpoint_id"])
        out[nid] = {
            "p50": float(r["delay_p50_hours"]), "p80": float(r["delay_p80_hours"]),
            "p90": float(r["delay_p90_hours"]), "p95": float(r["delay_p95_hours"]),
            "expected": float(r["expected_delay_hours"]),
            "proba": float(r["delay_probability"]),
            "risk": float(r["risk_score"]), "risk_level": str(r["risk_level"]),
        }
    return out


def run_route(
    route_id: str,
    quants: Dict[str, Dict[str, float]],
    ctx: pd.DataFrame,
    origin: pd.Timestamp,
    now: pd.Timestamp,
    model_version: str,
    n_sim: Optional[int] = None,
    attenuation: float = 1.0,
    deadline_factor: float = 1.25,
) -> Dict[str, pd.DataFrame]:
    route = topology.route_by_id(route_id)
    node_ids = route.node_ids
    edges = topology.route_edges(route)
    em = topology.edge_map()
    baseline_days = float(sum(e.baseline_days for e in edges))
    deadline_days = baseline_days * deadline_factor

    # --- 16/17: cascade (GAT hook -> tabular fallback)
    gat_resid, method = gat_adjustment(route_id)
    eff = recalculate(route_id, quants, None, attenuation, reason="scheduled_batch")
    if gat_resid:
        for nid, res in gat_resid.items():
            if nid in eff:
                for q in QUANTILES:
                    eff[nid][q] = max(0.0, eff[nid][q] + res)
    own_expected = {nid: quants.get(nid, {}).get("expected", 0.0) for nid in node_ids}
    prop_expected = propagate_delay_cascade(own_expected, route_id, attenuation)
    route_total_eff = sum(prop_expected.values()) or 1.0

    # --- 19/20/21: Monte Carlo with p95-aware sampling
    mc_quants = {
        nid: {"p50": quants.get(nid, {}).get("p50", 0.0),
              "p80": quants.get(nid, {}).get("p80", 0.0),
              "p90": quants.get(nid, {}).get("p90", 0.0),
              "p95": quants.get(nid, {}).get("p95", 0.0)}
        for nid in node_ids
    }
    sim = run_monte_carlo(route_id, mc_quants, n_sim=n_sim,
                          attenuation=attenuation, deadline_days=deadline_days)
    p_miss = sim.p_miss_deadline

    # --- checkpoint_risk rows
    risk_rows = []
    for nid in node_ids:
        q = quants.get(nid, {})
        crow = ctx.loc[nid] if nid in ctx.index else None
        share = sim.critical_nodes.get(nid, 0.0)
        risk_rows.append({
            "shipment_id": None, "route_id": route_id, "checkpoint_id": nid,
            "checkpoint_type": topology.node_index().get(nid, {}).get("kind", "unknown"),
            "risk_score": q.get("risk", 0.0), "risk_level": q.get("risk_level", "low"),
            "delay_probability": q.get("proba", 0.0),
            "expected_delay_hours": q.get("expected", 0.0),
            "delay_p50_hours": q.get("p50", 0.0), "delay_p80_hours": q.get("p80", 0.0),
            "delay_p90_hours": q.get("p90", 0.0), "delay_p95_hours": q.get("p95", 0.0),
            "uncertainty_hours": q.get("p95", 0.0) - q.get("p50", 0.0),
            "regime_state": str(crow["regime_state"]) if crow is not None else "unknown",
            "disruption_flag": bool(crow["regime_disrupted"]) if crow is not None else False,
            "weather_risk_level": weather_risk_level(float(crow["weather_severity"]))
            if crow is not None else "low",
            "congestion_index": float(crow["congestion_index"]) if crow is not None else 0.0,
            "criticality_score": share,
            "downstream_impact_score": prop_expected.get(nid, 0.0) / route_total_eff,
            "deadline_risk_contribution": share * p_miss,
            "prediction_timestamp": now,
        })
    checkpoint_risk = pd.DataFrame(risk_rows)

    # --- delay_propagation rows (per edge)
    prop_rows = []
    cum_eff = 0.0
    for a, b in zip(node_ids, node_ids[1:]):
        e = em.get(a, {}).get(b)
        cum_eff += eff.get(b, {}).get(50, 0.0)
        prop_rows.append({
            "shipment_id": None, "route_id": route_id,
            "source_checkpoint_id": a, "target_checkpoint_id": b,
            "edge_id": f"{a}->{b}",
            "propagated_delay_hours": eff.get(b, {}).get(50, 0.0),
            "propagated_delay_p50": eff.get(b, {}).get(50, 0.0),
            "propagated_delay_p80": eff.get(b, {}).get(80, 0.0),
            "propagated_delay_p90": eff.get(b, {}).get(90, 0.0),
            "propagated_delay_p95": eff.get(b, {}).get(95, 0.0),
            "propagation_probability": float(e.reliability) if e else 0.9,
            "cumulative_delay_hours": cum_eff,
            "downstream_impact_score": eff.get(b, {}).get(50, 0.0) / route_total_eff,
            "timestamp": now,
        })
    delay_propagation = pd.DataFrame(prop_rows)

    # --- monte_carlo_results rows (per sim)
    node_delay_matrix = np.stack([sim.node_samples[nid] for nid in node_ids])
    crit_idx = np.argmax(node_delay_matrix, axis=0)
    mc_rows = pd.DataFrame({
        "simulation_id": np.arange(sim.n_sim, dtype=np.int64),
        "shipment_id": None, "route_id": route_id,
        "simulation_timestamp": now,
        "simulated_arrival_time": origin + pd.to_timedelta(sim.arrival_days, unit="D"),
        "simulated_delay_hours": sim.total_delay_hours,
        "simulated_transit_hours": sim.total_transit_hours,
        "deadline_missed": sim.arrival_days > deadline_days,
        "total_propagated_delay_hours": sim.total_delay_hours,
        "critical_checkpoint_id": [node_ids[i] for i in crit_idx],
        "scenario_id": None,
    })

    # --- eta_distribution row
    delay_q = {f"p{p}": float(np.percentile(sim.total_delay_hours, p)) for p in (50, 80, 90, 95)}
    eta_distribution = pd.DataFrame([{
        "shipment_id": None, "route_id": route_id,
        "calculation_timestamp": now,
        "planned_arrival_time": origin + pd.Timedelta(days=baseline_days),
        "eta_p50": origin + pd.Timedelta(days=sim.percentiles["p50"]),
        "eta_p80": origin + pd.Timedelta(days=sim.percentiles["p80"]),
        "eta_p90": origin + pd.Timedelta(days=sim.percentiles["p90"]),
        "eta_p95": origin + pd.Timedelta(days=sim.percentiles["p95"]),
        "delay_p50_hours": delay_q["p50"], "delay_p80_hours": delay_q["p80"],
        "delay_p90_hours": delay_q["p90"], "delay_p95_hours": delay_q["p95"],
        "expected_delay_hours": sim.expected_delay_hours,
        "eta_mean": origin + pd.Timedelta(days=sim.expected_days),
        "eta_std_hours": float(np.std(sim.arrival_days) * 24.0),
        "deadline": origin + pd.Timedelta(days=deadline_days),
        "deadline_miss_probability": p_miss,
        "on_time_probability": 1.0 - p_miss,
    }])

    # --- critical_checkpoints rows
    unc = {nid: quants.get(nid, {}).get("p95", 0.0) - quants.get(nid, {}).get("p50", 0.0)
           for nid in node_ids}
    ranked = sorted(node_ids, key=lambda n: sim.critical_nodes.get(n, 0.0), reverse=True)
    med_unc = float(np.median(list(unc.values()))) if unc else 0.0
    crit_rows = []
    for rank, nid in enumerate(ranked, start=1):
        q = quants.get(nid, {})
        if q.get("proba", 0.0) >= 0.5:
            reason = "high delay probability"
        elif unc[nid] > med_unc:
            reason = "wide delay uncertainty"
        elif prop_expected.get(nid, 0.0) / route_total_eff > 1.0 / max(len(node_ids), 1):
            reason = "large downstream impact"
        else:
            reason = "baseline watch"
        crit_rows.append({
            "shipment_id": None, "route_id": route_id, "checkpoint_id": nid,
            "checkpoint_rank": rank, "risk_score": q.get("risk", 0.0),
            "expected_delay_contribution_hours": sim.per_node_expected_delay.get(nid, 0.0),
            "uncertainty_contribution_hours": unc[nid],
            "deadline_risk_contribution": sim.critical_nodes.get(nid, 0.0) * p_miss,
            "downstream_impact_score": prop_expected.get(nid, 0.0) / route_total_eff,
            "criticality_score": sim.critical_nodes.get(nid, 0.0),
            "criticality_reason": reason, "calculation_timestamp": now,
        })
    critical_checkpoints = pd.DataFrame(crit_rows)

    # --- current_risk_state rows
    state_rows = []
    for i, nid in enumerate(node_ids):
        meta = topology.node_index().get(nid, {})
        seg = f"{node_ids[i-1]}->{nid}" if i > 0 else (f"{nid}->{node_ids[1]}" if len(node_ids) > 1 else None)
        crow = ctx.loc[nid] if nid in ctx.index else None
        rr = next((r for r in risk_rows if r["checkpoint_id"] == nid), {})
        state_rows.append({
            "shipment_id": None, "route_id": route_id, "checkpoint_id": nid,
            "last_updated_at": now,
            "current_latitude": meta.get("lat", 0.0), "current_longitude": meta.get("lon", 0.0),
            "current_route_segment_id": seg, "current_speed_kmh": np.nan,
            "current_regime_state": str(crow["regime_state"]) if crow is not None else "unknown",
            "current_congestion_index": float(crow["congestion_index"]) if crow is not None else 0.0,
            "current_weather_risk": float(crow["weather_severity"]) if crow is not None else 0.0,
            "current_disruption_risk": rr.get("risk_score", 0.0),
            "current_delay_probability": rr.get("delay_probability", 0.0),
            "current_expected_delay_hours": rr.get("expected_delay_hours", 0.0),
            "current_eta_p50": origin + pd.Timedelta(days=sim.percentiles["p50"]),
            "current_eta_p90": origin + pd.Timedelta(days=sim.percentiles["p90"]),
            "current_deadline_miss_probability": p_miss,
            "risk_change_from_previous": 0.0, "risk_trend": "stable",
            "recalculation_reason": "scheduled_batch", "model_version": model_version,
        })
    current_risk_state = pd.DataFrame(state_rows)

    log.info(f"route={route_id} expected={sim.expected_days:.1f}d "
             f"P90={sim.percentiles['p90']:.1f}d miss={p_miss:.3f} method={method}")
    return {
        "checkpoint_risk": checkpoint_risk,
        "delay_propagation": delay_propagation,
        "monte_carlo_results": mc_rows,
        "eta_distribution": eta_distribution,
        "critical_checkpoints": critical_checkpoints,
        "current_risk_state": current_risk_state,
        "summary": {"route_id": route_id, "method": method,
                    "expected_days": sim.expected_days, "p_miss": p_miss,
                    "deadline_days": deadline_days, "baseline_days": baseline_days},
    }


def run(
    route_ids: Optional[List[str]] = None,
    n_sim: Optional[int] = None,
    attenuation: float = 1.0,
    deadline_factor: float = 1.25,
    out_dir: Optional[str] = None,
) -> Dict:
    """Run items 15-21 for the given routes and write the output parquets."""
    s = get_settings()
    out = s.abs_data_dir / "outputs" if out_dir is None else out_dir
    os.makedirs(out, exist_ok=True)

    pred, model_version = load_latest_predictions()
    quants = _quants_from_predictions(pred)
    build_checkpoint_graph(pred)  # item 15 graph object (overlays logged)
    ctx = load_node_context()
    origin = pd.to_datetime(pred["prediction_timestamp"]).max().normalize()
    now = _utcnow()

    route_ids = route_ids or topology.all_route_ids()
    frames: Dict[str, List[pd.DataFrame]] = {
        "checkpoint_risk": [], "delay_propagation": [], "monte_carlo_results": [],
        "eta_distribution": [], "critical_checkpoints": [], "current_risk_state": [],
    }
    summaries = []
    for rid in route_ids:
        res = run_route(rid, quants, ctx, origin, now, model_version,
                        n_sim=n_sim, attenuation=attenuation,
                        deadline_factor=deadline_factor)
        for k in frames:
            frames[k].append(res[k])
        summaries.append(res["summary"])

    for name, parts in frames.items():
        df = pd.concat(parts, ignore_index=True)
        df.to_parquet(f"{out}/{name}.parquet", index=False)
        log.info(f"wrote {name}.parquet: {df.shape}")
    return {"model_version": model_version, "routes": summaries, "out_dir": str(out)}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Items 15-21: propagate & quantify -> output parquets")
    p.add_argument("--routes", nargs="*", default=None)
    p.add_argument("--n-sim", type=int, default=None)
    p.add_argument("--attenuation", type=float, default=1.0)
    p.add_argument("--deadline-factor", type=float, default=1.25)
    args = p.parse_args(argv)
    out = run(route_ids=args.routes, n_sim=args.n_sim,
              attenuation=args.attenuation, deadline_factor=args.deadline_factor)
    for r in out["routes"]:
        print(f"  {r['route_id']}: expected={r['expected_days']:.1f}d "
              f"miss={r['p_miss']:.3f} method={r['method']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
