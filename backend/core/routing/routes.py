"""Decision support: what-if scenarios, alternative-route comparison,
critical-checkpoint analysis and route recommendation."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

from backend.core.config import get_settings
from backend.core.graph import topology
from backend.core.graph.network import LogisticsGraph, risk_level_from_probability
from backend.core.logging_util import get_logger
from backend.core.simulation.monte_carlo import run_monte_carlo

log = get_logger(__name__)


@dataclass
class Scenario:
    """A what-if scenario modifying node conditions.

    `node_adjustments` maps node_id -> dict with any of:
        congestion_mult, weather_shift, conflict_mult, close (bool)
    """
    name: str
    route_id: str
    node_adjustments: Dict[str, Dict] = field(default_factory=dict)
    deadline_days: Optional[float] = None

    def describe(self) -> str:
        return self.name


def apply_scenario_to_quantiles(base_quantiles: Dict[str, Dict[str, float]],
                                base_risk: Dict[str, float],
                                scenario: Scenario) -> Dict[str, Dict[str, float]]:
    """Adjust node delay quantiles according to a scenario's multipliers."""
    out: Dict[str, Dict[str, float]] = {}
    for nid, q in base_quantiles.items():
        adj = scenario.node_adjustments.get(nid, {})
        cong_mult = adj.get("congestion_mult", 1.0)
        weather_shift = adj.get("weather_shift", 0.0)
        conflict_mult = adj.get("conflict_mult", 1.0)
        close = adj.get("close", False)
        if close:
            nq = {"p50": 72.0, "p80": 96.0, "p90": 120.0}
            if "p95" in q:
                nq["p95"] = 144.0
            out[nid] = nq
            continue
        keys = ("p50", "p80", "p90") + (("p95",) if "p95" in q else ())
        base = {k: float(q.get(k, 0.0)) for k in keys}
        base_expected = (base["p50"] + base["p90"]) / 2.0
        cong_delta = base_expected * (cong_mult - 1.0) * 0.6
        conflict_delta = base_expected * (conflict_mult - 1.0) * 0.4
        wx = float(weather_shift) if weather_shift else 0.0
        add = cong_delta + conflict_delta + wx
        nq = {k: max(0.0, v + add) for k, v in base.items()}
        out[nid] = nq
    return out


def _resilience_score(delay_prob: float, uncertainty_days: float,
                      baseline_days: float) -> float:
    unc = min(1.0, uncertainty_days / max(baseline_days, 0.5))
    return round(100.0 * (1.0 - delay_prob) * (1.0 - 0.5 * unc), 1)


def _node_delay_prob(exp_delay_hours: float) -> float:
    thr = get_settings().delay_threshold_hours
    return 1.0 / (1.0 + np.exp(-(exp_delay_hours - thr) / 15.0))


def _mean_delay_probability(route: topology.Route, quantiles) -> float:
    vals = []
    for nid in route.node_ids:
        q = quantiles.get(nid, {})
        exp = (q.get("p50", 0.0) + q.get("p90", 0.0)) / 2.0
        p = _node_delay_prob(exp)
        vals.append(p)
    return round(float(np.mean(vals)), 4)


def run_scenario(base_quantiles: Dict[str, Dict[str, float]],
                 base_risk: Dict[str, float],
                 scenario: Scenario,
                 n_sim: Optional[int] = None,
                 seed: Optional[int] = None) -> Dict:
    """Run the Monte Carlo engine under a scenario and return full results."""
    quantiles = apply_scenario_to_quantiles(base_quantiles, base_risk, scenario)
    route = topology.route_by_id(scenario.route_id)
    base_mc = run_monte_carlo(
        scenario.route_id, base_quantiles,
        n_sim=n_sim, seed=seed,
        attenuation=1.0,
        deadline_days=scenario.deadline_days,
    )
    res = run_monte_carlo(
        scenario.route_id, quantiles,
        n_sim=n_sim, seed=seed,
        attenuation=1.0,
        deadline_days=scenario.deadline_days,
    )
    base_days = topology.route_baseline_days(route)
    base_res = _resilience_score(
        _mean_delay_probability(route, base_quantiles),
        base_mc.percentiles["p90"] - base_mc.percentiles["p10"],
        base_days,
    )
    scen_res = _resilience_score(
        _mean_delay_probability(route, quantiles),
        res.percentiles["p90"] - res.percentiles["p10"],
        base_days,
    )
    mc_dict = res.to_dict()
    mc_dict["resilience_score"] = scen_res
    mc_dict["delta_resilience"] = round(scen_res - base_res, 1)

    per_node = {}
    for nid in route.node_ids:
        q = quantiles.get(nid, {})
        bq = base_quantiles.get(nid, {})
        exp = (q.get("p50", 0.0) + q.get("p90", 0.0)) / 2.0
        bexp = (bq.get("p50", 0.0) + bq.get("p90", 0.0)) / 2.0
        prob = _node_delay_prob(exp)
        bprob = _node_delay_prob(bexp)
        per_node[nid] = {
            "node_id": nid,
            "label": topology.node_label(nid),
            "risk": risk_level_from_probability(prob),
            "delay_probability": round(float(prob), 4),
            "expected_delay_hours": round(float(exp), 1),
            "baseline_delay_probability": round(float(bprob), 4),
            "baseline_expected_delay_hours": round(float(bexp), 1),
            "risk_change_pct": round(float((prob - bprob) * 100), 1),
            "delay_change_hours": round(float(exp - bexp), 1),
        }
    return {
        "scenario": scenario.name,
        "monte_carlo": mc_dict,
        "per_node_risk": per_node,
    }


# ---------------------------------------------------------------------------
# Route comparison & recommendation
# ---------------------------------------------------------------------------

@dataclass
class RouteOption:
    route: topology.Route
    baseline_days: float
    distance_km: float
    p90_days: float
    expected_days: float
    delay_probability: float
    deadline_risk: float
    uncertainty: float  # p90 - p10
    score: float = 0.0


def compare_routes(base_quantiles: Dict[str, Dict[str, float]],
                   deadline_days: Optional[float] = None,
                   n_sim: Optional[int] = None,
                   seed: Optional[int] = None,
                   route_ids: Optional[List[str]] = None) -> List[Dict]:
    """Run the MC engine for every configured route and return a comparison.

    When *route_ids* is provided only those routes are evaluated — useful for
    showing corridor-relevant alternatives instead of every possible path.
    """
    routes = topology.ROUTES
    if route_ids:
        routes = [r for r in topology.ROUTES if r.route_id in set(route_ids)]
    options = []
    for route in routes:
        res = run_monte_carlo(route.route_id, base_quantiles,
                              n_sim=n_sim, seed=seed, deadline_days=deadline_days)
        delay_prob = _mean_delay_probability(route, base_quantiles)
        unc = float(res.percentiles["p90"] - res.percentiles["p10"])
        options.append(RouteOption(
            route=route,
            baseline_days=topology.route_baseline_days(route),
            distance_km=topology.route_distance_km(route),
            p90_days=float(res.percentiles["p90"]),
            expected_days=res.expected_days,
            delay_probability=delay_prob,
            deadline_risk=res.p_miss_deadline,
            uncertainty=unc,
        ))
    return options


def recommend_route(options: List[Dict], objective: str = "balanced") -> Dict:
    """Choose a route based on a configurable objective.

    Objectives: fastest | lowest_risk | lowest_uncertainty | balanced.

    Scoring is computed from actual simulation outputs (not string sorting).
    """
    normalized = []
    for o in options:
        exp = o["expected_days"]
        risk = o["deadline_risk"] if o["deadline_risk"] > 0 else o["delay_probability"]
        unc = o["uncertainty"]
        normalized.append({"d": exp, "r": risk, "u": unc, "raw": o})
    dmax = max(n["d"] for n in normalized) or 1
    rmax = max(n["r"] for n in normalized) or 1
    umax = max(n["u"] for n in normalized) or 1

    def norm(a, m):
        return (m - a) / m if m else 0.0

    for n in normalized:
        if objective == "fastest":
            n["score"] = norm(n["d"], dmax)
        elif objective == "lowest_risk":
            n["score"] = norm(n["r"], rmax)
        elif objective == "lowest_uncertainty":
            n["score"] = norm(n["u"], umax)
        else:  # balanced
            n["score"] = 0.5 * norm(n["d"], dmax) + 0.3 * norm(n["r"], rmax) + 0.2 * norm(n["u"], umax)

    best = max(normalized, key=lambda x: x["score"])
    return {
        "objective": objective,
        "recommended_route_id": best["raw"]["route_id"],
        "score": round(float(best["score"]), 3),
        "options": [dict(n["raw"], score=round(float(n["score"]), 3)) for n in normalized],
    }


# ---------------------------------------------------------------------------
# Comprehensive what-if scenario runner
# ---------------------------------------------------------------------------

def run_whatif_scenario(
    shipment: Dict,
    scenario_type: str,
    scope: str,
    node_id: Optional[str],
    node_ids: Optional[List[str]],
    segment_start: Optional[str],
    segment_end: Optional[str],
    adjustments: Optional[Dict],
    node_adjustments_list: Optional[List[Dict]],
    route_adjustments: Optional[Dict],
    n_sim: Optional[int] = None,
    seed: Optional[int] = None,
) -> Dict:
    """Comprehensive what-if scenario runner.

    Returns a full payload with baseline, scenario, deltas, per-node impact,
    critical checkpoint, impact explanation, recommendations, and alt routes.
    """
    route_id = shipment["route_id"]
    route = topology.route_by_id(route_id)
    route_nodes = route.node_ids
    deadline_days = None
    deadline_date = shipment.get("monte_carlo", {}).get("deadline_date")
    prediction_date = shipment.get("prediction_date")
    if deadline_date and prediction_date:
        deadline_days = (np.datetime64(deadline_date) - np.datetime64(prediction_date)) / np.timedelta64(1, "D")
        deadline_days = max(0.0, float(deadline_days))

    base_quantiles = {k: {kk: float(vv) for kk, vv in v.items()
                          if kk in ("p50", "p80", "p90", "p95")}
                      for k, v in shipment.get("delay_quantiles", {}).items()}

    # Build the node_adjustments dict from inputs
    node_adj = _build_node_adjustments(
        scenario_type, scope, node_id, node_ids,
        segment_start, segment_end, route_nodes,
        adjustments, node_adjustments_list, route_adjustments,
    )

    # Determine scenario name
    scenario_name = _scenario_name(scenario_type, scope, node_id, node_ids, node_adj)

    scenario = Scenario(
        name=scenario_name,
        route_id=route_id,
        node_adjustments=node_adj,
        deadline_days=deadline_days,
    )

    s = get_settings()
    actual_seed = seed if seed is not None else s.mc_seed
    actual_nsim = n_sim or s.mc_simulations

    # Run baseline and scenario with the SAME seed for counterfactual comparison
    base_quantiles_route = {nid: base_quantiles.get(nid, {"p50": 0, "p80": 0, "p90": 0})
                            for nid in route_nodes}
    adj_quantiles = apply_scenario_to_quantiles(base_quantiles_route, {}, scenario)

    base_mc = run_monte_carlo(
        route_id, base_quantiles_route,
        n_sim=actual_nsim, seed=actual_seed,
        attenuation=1.0, deadline_days=deadline_days,
    )
    scen_mc = run_monte_carlo(
        route_id, adj_quantiles,
        n_sim=actual_nsim, seed=actual_seed,
        attenuation=1.0, deadline_days=deadline_days,
    )

    # Resilience
    base_days = topology.route_baseline_days(route)
    base_dp = _mean_delay_probability(route, base_quantiles_route)
    scen_dp = _mean_delay_probability(route, adj_quantiles)
    base_unc = float(base_mc.percentiles["p90"] - base_mc.percentiles["p10"])
    scen_unc = float(scen_mc.percentiles["p90"] - scen_mc.percentiles["p10"])
    base_res = _resilience_score(base_dp, base_unc, base_days)
    scen_res = _resilience_score(scen_dp, scen_unc, base_days)

    # Baseline summary
    origin_date = prediction_date or "2026-09-15"
    base_summary = {
        "expected_days": round(base_mc.expected_days, 2),
        "expected_delay_hours": round(base_mc.expected_delay_hours, 1),
        "p50_eta_days": round(base_mc.percentiles["p50"], 2),
        "p90_eta_days": round(base_mc.percentiles["p90"], 2),
        "p_miss_deadline": round(base_mc.p_miss_deadline, 4),
        "resilience_score": base_res,
    }

    # Scenario summary
    scen_summary = {
        "expected_days": round(scen_mc.expected_days, 2),
        "expected_delay_hours": round(scen_mc.expected_delay_hours, 1),
        "p50_eta_days": round(scen_mc.percentiles["p50"], 2),
        "p90_eta_days": round(scen_mc.percentiles["p90"], 2),
        "p_miss_deadline": round(scen_mc.p_miss_deadline, 4),
        "resilience_score": scen_res,
    }

    # Deltas
    delta = {
        "expected_days": round(scen_mc.expected_days - base_mc.expected_days, 2),
        "p90_eta_days": round(scen_mc.percentiles["p90"] - base_mc.percentiles["p90"], 2),
        "deadline_risk_change_pct": round((scen_mc.p_miss_deadline - base_mc.p_miss_deadline) * 100, 1),
        "resilience_change": round(scen_res - base_res, 1),
        "delay_hours_change": round(scen_mc.expected_delay_hours - base_mc.expected_delay_hours, 1),
    }

    # Per-node checkpoint impact (sorted by delay_change descending)
    checkpoint_impact = []
    affected_set = set(node_adj.keys())
    for nid in route_nodes:
        bq = base_quantiles_route.get(nid, {"p50": 0, "p80": 0, "p90": 0})
        sq = adj_quantiles.get(nid, {"p50": 0, "p80": 0, "p90": 0})
        bexp = (bq.get("p50", 0) + bq.get("p90", 0)) / 2.0
        sexp = (sq.get("p50", 0) + sq.get("p90", 0)) / 2.0
        bprob = _node_delay_prob(bexp)
        sprob = _node_delay_prob(sexp)
        status = "Normal"
        status_class = "low"
        if sprob >= 0.8:
            status = "Critical"
            status_class = "critical"
        elif sprob >= 0.6:
            status = "Disrupted"
            status_class = "high"
        elif sprob >= 0.35:
            status = "Elevated"
            status_class = "medium"
        checkpoint_impact.append({
            "node_id": nid,
            "label": topology.node_label(nid),
            "sequence": route_nodes.index(nid) + 1,
            "is_affected": nid in affected_set,
            "baseline_risk": round(bprob, 4),
            "scenario_risk": round(sprob, 4),
            "risk_change_pct": round((sprob - bprob) * 100, 1),
            "baseline_delay_hours": round(bexp, 1),
            "scenario_delay_hours": round(sexp, 1),
            "delay_change_hours": round(sexp - bexp, 1),
            "status": status,
            "status_class": status_class,
        })
    checkpoint_impact.sort(key=lambda x: abs(x["delay_change_hours"]), reverse=True)

    # Critical checkpoint (most affected)
    if checkpoint_impact:
        cc = max(checkpoint_impact, key=lambda x: abs(x["delay_change_hours"]))
        downstream_count = len(route_nodes) - route_nodes.index(cc["node_id"]) - 1 if cc["node_id"] in route_nodes else 0
        critical_checkpoint = {
            "node_id": cc["node_id"],
            "label": cc["label"],
            "risk": cc["scenario_risk"],
            "risk_increase_pct": cc["risk_change_pct"],
            "delay_contribution_hours": cc["delay_change_hours"],
            "downstream_affected": max(0, downstream_count),
            "explanation": (
                f"Disruption at {cc['label']} increases expected waiting time "
                f"by {abs(cc['delay_change_hours']):.1f}h and propagates delay "
                f"to {max(0, downstream_count)} downstream checkpoints."
            ),
        }
    else:
        critical_checkpoint = None

    # Impact explanation (structured)
    impact_explanation = _build_impact_explanation(
        scenario_type, node_adj, checkpoint_impact, delta, route_nodes,
    )

    # Closed chokepoints under this scenario (routes sharing them are blocked)
    closed_nodes = {nid for nid, adj in node_adj.items() if adj.get("close")}

    # Alternative routes under scenario (closure-aware)
    alt_routes = _compare_alternative_routes(
        route_id, base_quantiles_route, adj_quantiles,
        closed_nodes, deadline_days, actual_nsim, actual_seed,
    )
    viable_alt = [r for r in alt_routes if not r["blocked"]]
    blocked_labels = [topology.node_label(n) for n in sorted(closed_nodes)]

    # Recommendations (closure-aware)
    recommendations = _build_recommendations(
        scenario_type, delta, scen_mc, base_mc, checkpoint_impact, route_nodes,
        has_viable_alternative=bool(viable_alt), blocked_labels=blocked_labels,
    )

    # Per-node predictions for both baseline and scenario
    per_node_baseline = []
    per_node_scenario = []
    for nid in route_nodes:
        bq = base_quantiles_route.get(nid, {"p50": 0, "p80": 0, "p90": 0})
        sq = adj_quantiles.get(nid, {"p50": 0, "p80": 0, "p90": 0})
        bprob = _node_delay_prob((bq.get("p50", 0) + bq.get("p90", 0)) / 2.0)
        sprob = _node_delay_prob((sq.get("p50", 0) + sq.get("p90", 0)) / 2.0)
        per_node_baseline.append({
            "node_id": nid,
            "label": topology.node_label(nid),
            "delay_probability": round(bprob, 4),
            "expected_delay_hours": round((bq.get("p50", 0) + bq.get("p90", 0)) / 2.0, 1),
            "p50": round(bq.get("p50", 0), 1),
            "p80": round(bq.get("p80", 0), 1),
            "p90": round(bq.get("p90", 0), 1),
        })
        per_node_scenario.append({
            "node_id": nid,
            "label": topology.node_label(nid),
            "delay_probability": round(sprob, 4),
            "expected_delay_hours": round((sq.get("p50", 0) + sq.get("p90", 0)) / 2.0, 1),
            "p50": round(sq.get("p50", 0), 1),
            "p80": round(sq.get("p80", 0), 1),
            "p90": round(sq.get("p90", 0), 1),
        })

    # Monte Carlo dicts with dates
    base_mc_dict = base_mc.to_dict(origin_date=str(origin_date), deadline_date=deadline_date)
    scen_mc_dict = scen_mc.to_dict(origin_date=str(origin_date), deadline_date=deadline_date)
    base_mc_dict["resilience_score"] = base_res
    scen_mc_dict["resilience_score"] = scen_res

    return {
        "scenario_name": scenario_name,
        "scenario_type": scenario_type,
        "scope": scope,
        "affected_nodes": list(node_adj.keys()),
        "baseline": base_summary,
        "scenario": scen_summary,
        "delta": delta,
        "checkpoint_impact": checkpoint_impact,
        "critical_checkpoint": critical_checkpoint,
        "impact_explanation": impact_explanation,
        "recommendations": recommendations,
        "alternative_routes": alt_routes,
        "closed_chokepoints": blocked_labels,
        "no_viable_alternative": not viable_alt,
        "per_node_baseline": per_node_baseline,
        "per_node_scenario": per_node_scenario,
        "monte_carlo": scen_mc_dict,
        "baseline_monte_carlo": base_mc_dict,
    }


def _build_node_adjustments(
    scenario_type, scope, node_id, node_ids,
    segment_start, segment_end, route_nodes,
    adjustments, node_adjustments_list, route_adjustments,
) -> Dict[str, Dict]:
    """Convert the what-if request into a node_id -> adjustment dict."""
    adj = adjustments or {}
    base_adj = {
        "congestion_mult": adj.get("congestion_mult", 1.0),
        "weather_shift": adj.get("weather_shift", 0.0),
        "conflict_mult": adj.get("conflict_mult", 1.0),
        "close": adj["close"] if "close" in adj else (scenario_type == "closure"),
    }
    result = {}

    if scenario_type == "baseline":
        return {}

    if scope == "route" and route_adjustments:
        ra = route_adjustments
        for nid in route_nodes:
            result[nid] = {
                "congestion_mult": ra.get("congestion_mult", 1.0),
                "weather_shift": ra.get("weather_shift", 0.0),
                "conflict_mult": ra.get("conflict_mult", 1.0),
                "close": ra["close"] if "close" in ra else (scenario_type == "closure"),
            }
        return result

    if scope == "multi" and node_adjustments_list:
        for na in node_adjustments_list:
            nid = na.get("node_id")
            if nid and nid in route_nodes:
                result[nid] = {
                    "congestion_mult": na.get("congestion_mult", 1.0),
                    "weather_shift": na.get("weather_shift", 0.0),
                    "conflict_mult": na.get("conflict_mult", 1.0),
                    "close": na["close"] if "close" in na else (scenario_type == "closure"),
                }
        return result

    if scope == "segment" and segment_start and segment_end:
        if segment_start in route_nodes and segment_end in route_nodes:
            si = route_nodes.index(segment_start)
            ei = route_nodes.index(segment_end)
            for nid in route_nodes[si:ei + 1]:
                result[nid] = dict(base_adj)
        return result

    # Single node (default)
    if node_id and node_id in route_nodes:
        result[node_id] = dict(base_adj)
    return result


def _scenario_name(scenario_type, scope, node_id, node_ids, node_adj):
    """Generate a human-readable scenario name."""
    if scenario_type == "baseline":
        return "Baseline / Normal Conditions"
    affected = list(node_adj.keys())
    if not affected:
        return "No Impact Scenario"
    node_labels = [topology.node_label(n) for n in affected[:3]]
    nodes_str = ", ".join(node_labels)
    if len(affected) > 3:
        nodes_str += f" +{len(affected) - 3} more"

    if scenario_type == "closure":
        return f"{nodes_str} Closed"
    if scenario_type == "congestion":
        return f"{nodes_str} Congestion"
    if scenario_type == "weather":
        return f"Severe Weather at {nodes_str}"
    if scope == "route":
        return f"Route-Wide Disruption ({nodes_str})"
    if scope == "segment":
        return f"Segment Disruption ({nodes_str})"
    if scope == "multi":
        return f"Multi-Checkpoint Disruption ({nodes_str})"
    return f"Custom: {nodes_str}"


def _build_impact_explanation(scenario_type, node_adj, checkpoint_impact, delta, route_nodes):
    reasons = []
    affected_labels = [topology.node_label(n) for n in node_adj.keys() if n in route_nodes]
    main_label = affected_labels[0] if affected_labels else "the affected checkpoint"

    if not node_adj:
        reasons.append("No adjustments were applied — this is the baseline scenario.")
        return {"summary": "Baseline conditions — no changes from current predictions.", "reasons": reasons}

    if delta["expected_days"] < 0.01 and abs(delta["deadline_risk_change_pct"]) < 1:
        reasons.append(f"Adjustments at {main_label} have minimal effect on overall transit time.")
        reasons.append("The checkpoint is either not a significant delay contributor or the adjustment is too small to propagate.")
        return {"summary": "The scenario has limited impact on the ETA.", "reasons": reasons}

    if scenario_type == "closure":
        reasons.append(f"Closing {main_label} adds approximately {abs(delta['expected_days']):.1f} days of additional delay.")
        reasons.append("The route remains feasible but with significantly elevated transit time.")
    elif scenario_type == "congestion":
        reasons.append(f"Congestion at {main_label} increases expected waiting time at the checkpoint.")
    elif scenario_type == "weather":
        reasons.append(f"Severe weather at {main_label} adds {abs(delta.get('delay_hours_change', 0)) / 24:.1f} days of weather-related delay.")
    else:
        reasons.append(f"Disruptions at {main_label} increase checkpoint delay and propagate downstream.")

    if delta["p90_eta_days"] > 0.5:
        reasons.append(f"P90 uncertainty increased by {delta['p90_eta_days']:.1f} days due to higher delay variance.")
    if delta["deadline_risk_change_pct"] > 1:
        reasons.append(f"Deadline miss probability increased by {delta['deadline_risk_change_pct']:.0f}%.")

    affected_downstream = [cp for cp in checkpoint_impact
                           if cp["delay_change_hours"] > 0.5 and not cp["is_affected"]]
    if affected_downstream:
        ds_labels = [cp["label"] for cp in affected_downstream[:3]]
        reasons.append(f"Downstream checkpoints affected: {', '.join(ds_labels)}.")

    summary_parts = []
    if abs(delta["expected_days"]) > 0.1:
        summary_parts.append(f"Expected transit time {'increases' if delta['expected_days'] > 0 else 'decreases'} by {abs(delta['expected_days']):.1f} days")
    if abs(delta["deadline_risk_change_pct"]) > 1:
        summary_parts.append(f"deadline risk changes by {delta['deadline_risk_change_pct']:+.0f}%")
    summary = ". ".join(summary_parts) + "." if summary_parts else "Limited measurable impact."

    return {"summary": summary, "reasons": reasons}


def _build_recommendations(scenario_type, delta, scen_mc, base_mc,
                           checkpoint_impact, route_nodes,
                           has_viable_alternative=True, blocked_labels=None):
    recs = []
    miss = scen_mc.p_miss_deadline
    delay_change = delta["expected_days"]
    risk_change = delta["deadline_risk_change_pct"]
    blocked_labels = blocked_labels or []

    if scenario_type == "baseline" or (abs(delay_change) < 0.1 and abs(risk_change) < 1):
        recs.append({
            "priority": "low",
            "action": "No immediate action required",
            "reason": "The scenario has negligible impact on transit time and delivery risk.",
            "expected_benefit": "None needed — conditions are within normal parameters.",
            "confidence": 0.95,
        })
        return recs

    # Closure with no viable alternative → no reroute option
    if blocked_labels and not has_viable_alternative:
        blocked_str = ", ".join(blocked_labels)
        if miss >= 0.8:
            recs.append({
                "priority": "critical",
                "action": "No maritime alternative exists",
                "reason": (
                    f"Blockage at {blocked_str} affects every viable Asia–Europe corridor. "
                    f"Deadline miss probability is {miss:.0%}. "
                    f"Consider expedited air freight for critical cargo or negotiate a delivery window extension."
                ),
                "expected_benefit": "Non-maritime options bypass the closure entirely.",
                "confidence": 0.90,
            })
        else:
            recs.append({
                "priority": "high",
                "action": "No alternative route available",
                "reason": (
                    f"Blockage at {blocked_str} affects all Asia–Europe corridors. "
                    f"Monitor the chokepoint status; reroute once conditions clear."
                ),
                "expected_benefit": "Viable alternatives will reappear once the chokepoint reopens.",
                "confidence": 0.80,
            })
    elif miss >= 0.8:
        recs.append({
            "priority": "critical",
            "action": "Reroute immediately",
            "reason": f"Deadline miss probability is {miss:.0%}. The current route is infeasible under this scenario.",
            "expected_benefit": "Alternative corridors reduce deadline risk.",
            "confidence": 0.90,
        })
    elif miss >= 0.5 or risk_change > 20:
        recs.append({
            "priority": "high",
            "action": "Consider rerouting",
            "reason": f"Deadline miss risk elevated to {miss:.0%}. Alternative routes may offer better reliability.",
            "expected_benefit": f"Risk reduction of {max(0, risk_change):.0f} percentage points possible.",
            "confidence": 0.80,
        })
    elif delay_change > 2:
        recs.append({
            "priority": "medium",
            "action": "Monitor checkpoint closely",
            "reason": f"Significant delay increase ({delay_change:.1f} days) but deadline risk remains manageable.",
            "expected_benefit": "Early monitoring enables faster response if conditions worsen.",
            "confidence": 0.75,
        })
    else:
        recs.append({
            "priority": "low",
            "action": "Monitor situation",
            "reason": "Moderate impact detected. Continue tracking conditions.",
            "expected_benefit": "No immediate operational change required.",
            "confidence": 0.70,
        })

    affected_critical = [cp for cp in checkpoint_impact if cp["is_affected"] and cp["scenario_risk"] >= 0.6]
    if affected_critical:
        cc = affected_critical[0]
        recs.append({
            "priority": "medium",
            "action": f"Prioritize {cc['label']} operations",
            "reason": f"Checkpoint risk at {cc['label']} is {cc['scenario_risk']:.0%}.",
            "expected_benefit": "Faster processing at this checkpoint reduces downstream cascading.",
            "confidence": 0.70,
        })

    return recs


def _compare_alternative_routes(
    current_route_id: str,
    base_quantiles_route: Dict[str, Dict[str, float]],
    scenario_quantiles: Dict[str, Dict[str, float]],
    closed_nodes: set,
    deadline_days: Optional[float],
    n_sim: int,
    seed: int,
) -> List[Dict]:
    """Compare alternative routes under the scenario quantiles.

    Only routes sharing the same origin and destination are considered true
    alternatives for the shipment, so non-comparable corridors are excluded.

    If the scenario closes a chokepoint that is also on the alternative route,
    the route is flagged ``blocked: True`` — it is not a viable substitute
    and will be displayed accordingly by the UI.
    """
    current = topology.route_by_id(current_route_id)
    if current is None:
        return []
    current_nodes = current.node_ids
    origin, destination = current_nodes[0], current_nodes[-1]
    options = []
    for route in topology.ROUTES:
        if route.route_id == current_route_id:
            continue
        rnodes = route.node_ids
        if not rnodes or rnodes[0] != origin or rnodes[-1] != destination:
            continue

        # Determine if this alternative shares any closed chokepoint
        blocked_by = [nid for nid in route.node_ids if nid in closed_nodes]
        blocked = bool(blocked_by)
        blocked_labels = [topology.node_label(n) for n in blocked_by]

        # Build quantiles for the simulation: closed nodes use baseline
        # (reference only), other shared nodes inherit scenario, rest default
        route_q: Dict[str, Dict[str, float]] = {}
        for nid in route.node_ids:
            if nid in closed_nodes:
                # For blocked routes: use baseline quantiles so reference
                # numbers aren't absurd, but the route is clearly flagged
                route_q[nid] = base_quantiles_route.get(nid, {"p50": 1, "p80": 2, "p90": 3})
            elif nid in scenario_quantiles:
                route_q[nid] = scenario_quantiles[nid]
            else:
                route_q[nid] = {"p50": 1.0, "p80": 2.0, "p90": 3.0}

        res = run_monte_carlo(route.route_id, route_q,
                              n_sim=n_sim, seed=seed,
                              attenuation=1.0, deadline_days=deadline_days)
        dp = _mean_delay_probability(route, route_q)
        unc = float(res.percentiles["p90"] - res.percentiles["p10"])
        base_days = topology.route_baseline_days(route)
        resil = _resilience_score(dp, unc, base_days)

        if blocked:
            recommendation = (
                f"BLOCKED — also passes through {', '.join(blocked_labels)}. "
                f"Not a viable alternative for this scenario."
            )
        elif options and not options[-1].get("blocked"):
            recommendation = "Viable alternative."
        else:
            recommendation = "Recommended alternative."

        options.append({
            "route_id": route.route_id,
            "route_name": route.name,
            "expected_days": round(res.expected_days, 2),
            "p50_eta_days": round(res.percentiles["p50"], 2),
            "p90_eta_days": round(res.percentiles["p90"], 2),
            "delay_probability": dp,
            "deadline_risk": round(res.p_miss_deadline, 4),
            "uncertainty_days": round(unc, 2),
            "resilience_score": resil,
            "blocked": blocked,
            "blocked_by": blocked_labels,
            "recommendation": recommendation,
        })

    # Sort: viable first (by resilience desc), then blocked at the bottom
    options.sort(key=lambda x: (x["blocked"], -x["resilience_score"]))
    for i, opt in enumerate(options):
        if not opt["blocked"] and i == 0:
            opt["recommendation"] = "Recommended alternative."
    return options


# ---------------------------------------------------------------------------
# Route-aware preset catalog
# ---------------------------------------------------------------------------

def build_whatif_presets(route_id: str) -> List[Dict]:
    """Generate route-aware what-if scenario presets for a given route."""
    route = topology.route_by_id(route_id)
    if not route:
        return []
    presets = []

    # Normal Conditions — always available
    presets.append({
        "id": "baseline",
        "name": "Normal Conditions",
        "description": "No disruptions — current corridor conditions.",
        "scenario_type": "baseline",
        "scope": "single",
        "node_id": None,
        "adjustments": {},
        "available": True,
    })

    # Congestion presets — per-node quick options, deterministic default nodes
    node_ids = route.node_ids
    mid = len(node_ids) // 2
    default_node_ids = [node_ids[min(mid + i, len(node_ids) - 1)] for i in range(3)]
    congestion_presets = [
        ("moderate_congestion", "Moderate Congestion", "30% congestion increase", {"congestion_mult": 1.3}),
        ("severe_congestion", "Severe Congestion", "60% congestion increase", {"congestion_mult": 1.6}),
        ("major_congestion", "Major Port Congestion", "100% congestion increase", {"congestion_mult": 2.0}),
    ]
    for i, (pid, name, desc, adj) in enumerate(congestion_presets):
        presets.append({
            "id": pid,
            "name": name,
            "description": desc,
            "scenario_type": "congestion",
            "scope": "single",
            "node_id": default_node_ids[i],
            "adjustments": adj,
            "available": True,
        })

    # Weather presets
    presets.append({
        "id": "severe_weather",
        "name": "Severe Weather",
        "description": "Severe weather adding 48 hours of delay.",
        "scenario_type": "weather",
        "scope": "single",
        "node_id": node_ids[mid],
        "adjustments": {"weather_shift": 48},
        "available": True,
    })

    # Closure — only for chokepoints on route
    chokepoints = {"suez", "panama_canal", "strait_of_malacca", "bab_el_mandeb",
                   "strait_of_hormuz", "strait_of_gibraltar", "taiwan_strait"}
    for nid in route.node_ids:
        if nid in chokepoints:
            presets.append({
                "id": f"closure_{nid}",
                "name": f"{topology.node_label(nid)} Closed",
                "description": f"Complete closure of {topology.node_label(nid)}.",
                "scenario_type": "closure",
                "scope": "single",
                "node_id": nid,
                "adjustments": {"close": True},
                "available": True,
            })

    # Multi-checkpoint disruption (last two nodes)
    if len(route.node_ids) >= 3:
        multi_nodes = route.node_ids[-3:]
        presets.append({
            "id": "multi_disruption",
            "name": "Multi-Checkpoint Disruption",
            "description": "Combined disruptions across multiple route checkpoints.",
            "scenario_type": "multi_checkpoint",
            "scope": "multi",
            "node_ids": multi_nodes,
            "node_adjustments": [
                {"node_id": n, "congestion_mult": 1.4, "weather_shift": 12}
                for n in multi_nodes
            ],
            "available": True,
        })

    # Custom scenario
    presets.append({
        "id": "custom",
        "name": "Custom Scenario",
        "description": "Define your own checkpoint, congestion, weather, and closure adjustments.",
        "scenario_type": "custom",
        "scope": "single",
        "node_id": route.node_ids[0],
        "adjustments": {"congestion_mult": 1.0, "weather_shift": 0},
        "available": True,
    })

    return presets
