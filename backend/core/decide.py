"""Items 22-26 — EXPLAIN & DECIDE batch job.

  22. critical checkpoint & uncertainty attribution (critical_checkpoints.parquet
      already filled by propagate.py; extended here with SHAP factor attribution)
  23. explainable network-level risk   -> data/outputs/shap_explanations.parquet
  24. counterfactual what-if simulation -> data/scenarios/what_if_scenarios.parquet
      + data/outputs/scenario_results.parquet
  25. causal / intervention-aware reasoning -> data/outputs/intervention_analysis.parquet
      (counterfactual do-operations through cascade + Monte Carlo, ranked)
  26. risk-aware route decision        -> data/outputs/route_comparison.parquet

Causal note (item 25): intervention effects are counterfactual estimates under
the model's structural assumptions (node condition -> quantile shift ->
downstream cascade -> Monte Carlo ETA). No causal-discovery claims are made;
ranking is by the documented intervention_score.

Conventions: shipment_id null (no shipment feed); deadline_days =
baseline_days * deadline_factor (default 1.25, same as propagate.py);
uncertainty_hours = p95 - p50; one recommended route (balanced objective).

Usage:
    python -m backend.core.decide [--n-sim 10000] [--top-k-shap 8]
"""
from __future__ import annotations

import argparse
import os
import time
from typing import Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd

from backend.core.config import get_settings
from backend.core.graph import topology
from backend.core.logging_util import get_logger
from backend.core.models import registry
from backend.core.routing.routes import (
    Scenario,
    apply_scenario_to_quantiles,
    compare_routes,
    recommend_route,
    run_scenario,
)
from backend.core.simulation.monte_carlo import run_monte_carlo

log = get_logger(__name__)

try:
    import shap as _shap

    SHAP_AVAILABLE = True
except Exception:  # pragma: no cover
    SHAP_AVAILABLE = False


def _utcnow() -> pd.Timestamp:
    return pd.Timestamp(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


# ------------------------------------------------------------------ inputs

def load_inputs() -> Dict:
    s = get_settings()
    pred = pd.read_parquet(s.abs_data_dir / "ml" / "predictions.parquet")
    if pred.empty:
        raise ValueError("predictions.parquet is empty - run train_ml_part first")
    version = str(pred["model_version"].astype(str).max())
    pred = pred[pred["model_version"].astype(str) == version].copy()
    pred["prediction_timestamp"] = pd.to_datetime(pred["prediction_timestamp"])
    eta = pd.read_parquet(s.abs_data_dir / "outputs" / "eta_distribution.parquet")
    crit = pd.read_parquet(s.abs_data_dir / "outputs" / "critical_checkpoints.parquet")
    feat = pd.read_parquet(s.abs_data_dir / "features" / "checkpoint_features.parquet")
    feat["timestamp"] = pd.to_datetime(feat["timestamp"])
    test = pd.read_parquet(s.abs_data_dir / "ml" / "test.parquet")
    return {"pred": pred, "version": version, "eta": eta, "crit": crit,
            "feat": feat, "test": test}


def base_quantiles_all_nodes(pred: pd.DataFrame) -> Dict[str, Dict[str, float]]:
    """Latest predicted quantiles per node (all 19 nodes, for MC input)."""
    latest = pred.sort_values("prediction_timestamp").groupby("checkpoint_id").tail(1)
    return {str(r["checkpoint_id"]): {
        "p50": float(r["delay_p50_hours"]), "p80": float(r["delay_p80_hours"]),
        "p90": float(r["delay_p90_hours"]), "p95": float(r["delay_p95_hours"])}
        for _, r in latest.iterrows()}


# ------------------------------------------------------------------ 23 SHAP

def explain_checkpoints(top_k: int = 8) -> pd.DataFrame:
    """Item 23: per-checkpoint top-K SHAP factors for delay_probability."""
    if not SHAP_AVAILABLE:
        raise RuntimeError("shap package required for batch explanations")
    s = get_settings()
    clf = registry.load_model("classifier")
    base = clf.get("base") if isinstance(clf, dict) else clf
    prep = joblib.load(s.abs_artifact_dir / "feature_pipeline.joblib")
    from backend.core.train_ml_part import apply_preprocess
    test = pd.read_parquet(s.abs_data_dir / "ml" / "test.parquet")
    X = apply_preprocess(test, prep)
    feature_names = prep["feature_names"]

    explainer = _shap.TreeExplainer(base)
    sv = explainer.shap_values(X.to_numpy(dtype=np.float32), check_additivity=False)
    if isinstance(sv, list):
        sv = sv[-1]
    sv = np.asarray(sv)
    log.info(f"SHAP values: {sv.shape}")

    pred = pd.read_parquet(s.abs_data_dir / "ml" / "predictions.parquet")
    obs_keys = (test["node_id"].astype(str) + ":"
                + pd.to_datetime(test["timestamp"]).dt.strftime("%Y-%m-%d"))
    pred_lookup = pred.set_index("observation_id")
    rows = []
    ts_now = _utcnow()
    version = str(pred["model_version"].astype(str).max())
    for i in range(len(X)):
        obs_id = obs_keys.iloc[i]
        prow = pred_lookup.loc[obs_id] if obs_id in pred_lookup.index else None
        top = np.argsort(-np.abs(sv[i]))[:top_k]
        for rank, j in enumerate(top, start=1):
            v = float(sv[i, j])
            rows.append({
                "observation_id": obs_id, "shipment_id": None,
                "checkpoint_id": str(test["node_id"].iloc[i]),
                "prediction_timestamp": ts_now,
                "feature_name": feature_names[j],
                "feature_value": str(X.iloc[i, j]),
                "shap_value": v,
                "contribution_direction": "positive" if v >= 0 else "negative",
                "feature_rank": rank,
                "model_output": float(prow["delay_probability"]) if prow is not None else np.nan,
                "model_version": version,
            })
    df = pd.DataFrame(rows)
    log.info(f"shap_explanations: {df.shape}")
    return df


# ------------------------------------------------------------------ 24/25

def scenario_catalog(crit: pd.DataFrame) -> List[Dict]:
    """Item 24 inputs: adverse scenarios on each route's top-2 critical nodes."""
    catalog = []
    for rid in topology.all_route_ids():
        top = (crit[crit["route_id"] == rid]
               .sort_values("checkpoint_rank").head(2)["checkpoint_id"].tolist())
        for nid in top:
            catalog.append({
                "scenario_id": f"{rid}__congestion_plus30__{nid}",
                "route_id": rid, "kind": "congestion_plus30", "node": nid,
                "adjustments": {nid: {"congestion_mult": 1.3}},
                "name": f"{nid}: congestion +30%",
                "description": f"Counterfactual: port/route congestion at {nid} rises 30% on {rid}.",
            })
            catalog.append({
                "scenario_id": f"{rid}__closure__{nid}",
                "route_id": rid, "kind": "closure", "node": nid,
                "adjustments": {nid: {"close": True}},
                "name": f"{nid}: node closure",
                "description": f"Counterfactual: {nid} fully blocked (closure) on {rid}.",
            })
    return catalog


def intervention_catalog(crit: pd.DataFrame) -> List[Dict]:
    """Item 25 inputs: relief interventions on each route's top-2 critical nodes."""
    catalog = []
    for rid in topology.all_route_ids():
        top = (crit[crit["route_id"] == rid]
               .sort_values("checkpoint_rank").head(2)["checkpoint_id"].tolist())
        for nid in top:
            catalog.append({
                "intervention_id": f"{rid}__relief_congestion__{nid}",
                "route_id": rid, "kind": "congestion_relief", "node": nid,
                "adjustments": {nid: {"congestion_mult": 0.7}},
                "name": f"{nid}: congestion relief (-30%)",
            })
            catalog.append({
                "intervention_id": f"{rid}__resolve_disruption__{nid}",
                "route_id": rid, "kind": "disruption_resolution", "node": nid,
                "adjustments": {nid: {"congestion_mult": 0.5, "conflict_mult": 0.5}},
                "name": f"{nid}: disruption resolution",
            })
    return catalog


def _route_baseline_deadline(route_id: str, deadline_factor: float) -> Tuple[float, float]:
    route = topology.route_by_id(route_id)
    baseline = float(topology.route_baseline_days(route))
    return baseline, baseline * deadline_factor


def run_scenarios(base_q: Dict, eta: pd.DataFrame, crit: pd.DataFrame,
                  origin: pd.Timestamp, n_sim: Optional[int],
                  deadline_factor: float) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Item 24: run catalog scenarios; return (definitions, results)."""
    from backend.core.propagate import propagate_route_quantiles
    now = _utcnow()
    eta_idx = eta.set_index("route_id")
    defs, results = [], []
    for sc in scenario_catalog(crit):
        rid = sc["route_id"]
        baseline_days, deadline_days = _route_baseline_deadline(rid, deadline_factor)
        brow = eta_idx.loc[rid]
        scenario = Scenario(name=sc["name"], route_id=rid,
                            node_adjustments=sc["adjustments"],
                            deadline_days=deadline_days)
        res = run_scenario(base_q, {}, scenario, n_sim=n_sim,
                           seed=get_settings().mc_seed)
        mc = res["monte_carlo"]
        sc_eta_p50 = origin + pd.Timedelta(days=mc["percentiles"]["p50"])
        sc_eta_p90 = origin + pd.Timedelta(days=mc["percentiles"]["p90"])
        base_p50 = pd.Timestamp(brow["eta_p50"])
        base_p90 = pd.Timestamp(brow["eta_p90"])
        # analytic route-delay uncertainty via quantile cascade
        adj_q = apply_scenario_to_quantiles(base_q, {}, scenario)
        eff = propagate_route_quantiles(rid, {n: {
            "p50": v.get("p50", 0.0), "p80": v.get("p80", v.get("p50", 0.0)),
            "p90": v.get("p90", v.get("p50", 0.0)),
            "p95": v.get("p90", v.get("p50", 0.0))} for n, v in adj_q.items()})
        route_nodes = topology.route_by_id(rid).node_ids
        sc_unc = sum(eff[n][90] - eff[n][50] for n in route_nodes)
        base_unc = float(brow["delay_p90_hours"] - brow["delay_p50_hours"])
        exp_base, exp_sc = float(brow["expected_delay_hours"]), mc["expected_delay_hours"]
        defs.append({
            "scenario_id": sc["scenario_id"], "shipment_id": None, "base_route_id": rid,
            "created_at": now, "scenario_name": sc["name"], "scenario_type": sc["kind"],
            "target_node_id": sc["node"], "target_edge_id": None,
            "target_feature": "congestion" if "congestion" in sc["kind"] else "node_open",
            "baseline_value": 1.0,
            "intervention_value": 1.3 if sc["kind"] == "congestion_plus30" else 0.0,
            "change_pct": 30.0 if sc["kind"] == "congestion_plus30" else -100.0,
            "duration_hours": np.nan, "start_time": pd.NaT, "end_time": pd.NaT,
            "description": sc["description"],
        })
        d_eta = (sc_eta_p50 - base_p50).total_seconds() / 3600.0
        results.append({
            "scenario_id": sc["scenario_id"], "shipment_id": None,
            "base_route_id": rid, "scenario_route_id": rid,
            "baseline_eta_p50": base_p50, "scenario_eta_p50": sc_eta_p50,
            "baseline_eta_p90": base_p90, "scenario_eta_p90": sc_eta_p90,
            "baseline_deadline_miss_probability": float(brow["deadline_miss_probability"]),
            "scenario_deadline_miss_probability": mc["p_miss_deadline"],
            "baseline_expected_delay_hours": exp_base,
            "scenario_expected_delay_hours": exp_sc,
            "eta_change_hours": d_eta,
            "risk_change_pct": (exp_sc - exp_base) / max(exp_base, 1e-9) * 100.0,
            "uncertainty_change_hours": sc_unc - base_unc,
            "recommendation": (
                f"{sc['name']} pushes P50 ETA by {d_eta:+.1f}h and deadline-miss "
                f"{float(brow['deadline_miss_probability']):.2f}->{mc['p_miss_deadline']:.2f}. "
                f"Consider rerouting via an alternate corridor or expediting at {sc['node']}."
            ),
        })
    return pd.DataFrame(defs), pd.DataFrame(results)


def run_interventions(base_q: Dict, eta: pd.DataFrame, crit: pd.DataFrame,
                      origin: pd.Timestamp, n_sim: Optional[int],
                      deadline_factor: float) -> pd.DataFrame:
    """Item 25: counterfactual relief interventions, ranked by intervention_score."""
    now = _utcnow()
    eta_idx = eta.set_index("route_id")
    rows = []
    for iv in intervention_catalog(crit):
        rid = iv["route_id"]
        baseline_days, deadline_days = _route_baseline_deadline(rid, deadline_factor)
        brow = eta_idx.loc[rid]
        scenario = Scenario(name=iv["name"], route_id=rid,
                            node_adjustments=iv["adjustments"],
                            deadline_days=deadline_days)
        res = run_scenario(base_q, {}, scenario, n_sim=n_sim,
                           seed=get_settings().mc_seed)
        mc = res["monte_carlo"]
        sc_eta_p90 = origin + pd.Timedelta(days=mc["percentiles"]["p90"])
        base_p90 = pd.Timestamp(brow["eta_p90"])
        exp_base, exp_sc = float(brow["expected_delay_hours"]), mc["expected_delay_hours"]
        miss_base, miss_sc = float(brow["deadline_miss_probability"]), mc["p_miss_deadline"]
        base_unc = float(brow["delay_p90_hours"] - brow["delay_p50_hours"])
        adj_q = apply_scenario_to_quantiles(base_q, {}, scenario)
        route_nodes = topology.route_by_id(rid).node_ids
        sc_unc = sum(max(0.0, adj_q.get(n, {}).get("p90", 0.0) - adj_q.get(n, {}).get("p50", 0.0))
                     for n in route_nodes)
        delay_red = exp_base - exp_sc
        miss_red = miss_base - miss_sc
        unc_red = base_unc - sc_unc
        score = float(np.clip(
            0.5 * delay_red / max(exp_base, 1e-9)
            + 0.3 * miss_red + 0.2 * unc_red / max(base_unc, 1e-9), 0.0, 1.0))
        rows.append({
            "intervention_id": iv["intervention_id"], "shipment_id": None,
            "base_route_id": rid, "intervention_type": iv["kind"],
            "target_node_id": iv["node"], "target_edge_id": None,
            "baseline_risk": float(brow["deadline_miss_probability"]),
            "intervention_risk": miss_sc, "risk_delta": miss_sc - miss_base,
            "baseline_expected_delay_hours": exp_base,
            "intervention_expected_delay_hours": exp_sc,
            "delay_reduction_hours": delay_red,
            "baseline_eta_p90": base_p90, "intervention_eta_p90": sc_eta_p90,
            "eta_improvement_hours": (base_p90 - sc_eta_p90).total_seconds() / 3600.0,
            "baseline_deadline_miss_probability": miss_base,
            "intervention_deadline_miss_probability": miss_sc,
            "deadline_risk_reduction": miss_red,
            "uncertainty_reduction_hours": unc_red,
            "intervention_score": score,
            "recommendation": (
                f"{iv['name']} on {rid}: cuts expected delay {exp_base:.1f}->{exp_sc:.1f}h "
                f"(score {score:.2f}). {'Recommended.' if score >= 0.10 else 'Marginal benefit.'}"
            ),
        })
    df = pd.DataFrame(rows).sort_values("intervention_score", ascending=False)
    return df.reset_index(drop=True)


# ------------------------------------------------------------------ 26

def compare_all_routes(base_q: Dict, pred: pd.DataFrame, feat: pd.DataFrame,
                       n_sim: Optional[int], deadline_factor: float,
                       comparison_id: str = "cmp_all_routes_v1") -> pd.DataFrame:
    """Item 26: risk-aware route comparison + balanced recommendation."""
    now = _utcnow()
    latest_feat = (feat.sort_values("timestamp").groupby("node_id").tail(1)
                   .set_index("node_id"))
    latest_pred = (pred.sort_values("prediction_timestamp")
                   .groupby("checkpoint_id").tail(1).set_index("checkpoint_id"))
    rows, opt_dicts, mc_cache = [], [], {}
    for route in topology.ROUTES:
        nodes = route.node_ids
        baseline_days = float(topology.route_baseline_days(route))
        deadline_days = baseline_days * deadline_factor
        res = run_monte_carlo(route.route_id,
                              {n: base_q.get(n, {"p50": 0.0, "p80": 0.0, "p90": 0.0})
                               for n in nodes},
                              n_sim=n_sim, seed=get_settings().mc_seed,
                              deadline_days=deadline_days)
        mc_cache[route.route_id] = res
        probs = [float(latest_pred.loc[n, "delay_probability"]) if n in latest_pred.index else 0.0
                 for n in nodes]
        risks = [float(latest_pred.loc[n, "risk_score"]) if n in latest_pred.index else 0.0
                 for n in nodes]
        geo = float(np.mean([float(latest_feat.loc[n, "conflict_risk_score"])
                             if n in latest_feat.index else 0.0 for n in nodes]))
        wx = float(np.mean([float(latest_feat.loc[n, "weather_severity"])
                            if n in latest_feat.index else 0.0 for n in nodes]))
        cg = float(np.mean([float(latest_feat.loc[n, "congestion_index"])
                            if n in latest_feat.index else 0.0 for n in nodes]))
        unc = float((res.percentiles["p90"] - res.percentiles["p10"]) * 24.0)
        opt_dicts.append({
            "route_id": route.route_id, "expected_days": res.expected_days,
            "deadline_risk": res.p_miss_deadline,
            "delay_probability": float(np.mean(probs)), "uncertainty": unc,
        })
        rows.append({
            "comparison_id": comparison_id, "shipment_id": None, "route_id": route.route_id,
            "route_rank": 0, "route_name": route.name,
            "distance_km": float(topology.route_distance_km(route)),
            "planned_transit_hours": baseline_days * 24.0,
            "expected_transit_hours": res.expected_days * 24.0,
            "expected_delay_hours": res.expected_delay_hours,
            "delay_probability": float(np.mean(probs)),
            "eta_p50": None, "eta_p80": None, "eta_p90": None, "eta_p95": None,
            "deadline_miss_probability": res.p_miss_deadline,
            "disruption_exposure": float(np.mean([1.0 if p >= 0.5 else 0.0 for p in probs])),
            "geopolitical_risk": geo, "weather_risk": wx, "congestion_risk": cg,
            "uncertainty_hours": unc,
            "critical_checkpoint_count": int(sum(1.0 if p >= 0.5 else 0.0 for p in probs)),
            "route_risk_score": float(np.mean(risks)),
            "risk_adjusted_score": 0.0, "recommended_flag": False,
            "recommendation_reason": "",
        })
    # ETA datetimes need the shared origin (reuse the cached MC runs)
    origin = pd.to_datetime(pred["prediction_timestamp"]).max().normalize()
    for row, route in zip(rows, topology.ROUTES):
        res_days = mc_cache[route.route_id]
        for k in (50, 80, 90, 95):
            row[f"eta_p{k}"] = origin + pd.Timedelta(days=res_days.percentiles[f"p{k}"])
    winners = {}
    for obj in ("fastest", "lowest_risk", "lowest_uncertainty", "balanced"):
        winners[obj] = recommend_route(opt_dicts, obj)["recommended_route_id"]
    bal = recommend_route(opt_dicts, "balanced")
    scores = {o["route_id"]: o["score"] for o in bal["options"]}
    ranked = sorted(rows, key=lambda r: scores[r["route_id"]], reverse=True)
    for i, r in enumerate(ranked, start=1):
        r["route_rank"] = i
        r["risk_adjusted_score"] = scores[r["route_id"]]
        r["recommended_flag"] = (r["route_id"] == winners["balanced"])
        r["recommendation_reason"] = (
            f"balanced winner {winners['balanced']}; fastest {winners['fastest']}; "
            f"lowest_risk {winners['lowest_risk']}; lowest_uncertainty {winners['lowest_uncertainty']}"
        )
    return pd.DataFrame(ranked)


# ------------------------------------------------------------------ run

def run(n_sim: Optional[int] = None, deadline_factor: float = 1.25,
        top_k_shap: int = 8, out_dir: Optional[str] = None,
        scenarios_dir: Optional[str] = None) -> Dict:
    s = get_settings()
    out = s.abs_data_dir / "outputs" if out_dir is None else out_dir
    scn = s.abs_data_dir / "scenarios" if scenarios_dir is None else scenarios_dir
    os.makedirs(out, exist_ok=True)
    os.makedirs(scn, exist_ok=True)

    data = load_inputs()
    pred, version, eta = data["pred"], data["version"], data["eta"]
    base_q = base_quantiles_all_nodes(pred)
    origin = pd.to_datetime(pred["prediction_timestamp"]).max().normalize()

    shap_df = explain_checkpoints(top_k=top_k_shap)
    shap_df.to_parquet(f"{out}/shap_explanations.parquet", index=False)
    log.info(f"wrote shap_explanations.parquet: {shap_df.shape}")

    scen_defs, scen_results = run_scenarios(base_q, eta, data["crit"], origin, n_sim, deadline_factor)
    scen_defs.to_parquet(f"{scn}/what_if_scenarios.parquet", index=False)
    scen_results.to_parquet(f"{out}/scenario_results.parquet", index=False)
    log.info(f"wrote scenarios: {scen_defs.shape} / results: {scen_results.shape}")

    interventions = run_interventions(base_q, eta, data["crit"], origin, n_sim, deadline_factor)
    interventions.to_parquet(f"{out}/intervention_analysis.parquet", index=False)
    log.info(f"wrote intervention_analysis.parquet: {interventions.shape}")

    comparison = compare_all_routes(base_q, pred, data["feat"], n_sim, deadline_factor)
    comparison.to_parquet(f"{out}/route_comparison.parquet", index=False)
    log.info(f"wrote route_comparison.parquet: {comparison.shape}")

    return {"model_version": version, "out_dir": str(out),
            "n_scenarios": len(scen_defs), "n_interventions": len(interventions)}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Items 22-26: explain & decide -> output parquets")
    p.add_argument("--n-sim", type=int, default=None)
    p.add_argument("--deadline-factor", type=float, default=1.25)
    p.add_argument("--top-k-shap", type=int, default=8)
    args = p.parse_args(argv)
    out = run(n_sim=args.n_sim, deadline_factor=args.deadline_factor,
              top_k_shap=args.top_k_shap)
    print(f"decide done: {out['n_scenarios']} scenarios, "
          f"{out['n_interventions']} interventions -> {out['out_dir']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
