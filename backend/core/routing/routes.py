"""Decision support: what-if scenarios, alternative-route comparison,
critical-checkpoint analysis and route recommendation."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

import numpy as np
import pandas as pd

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
        congestion_mult, weather_shift, conflict_shift, close (bool)
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
    """Adjust node delay quantiles according to a scenario's multipliers.

    The adjustment is grounded in the node's own baseline: a congestion
    increase of X% scales the expected delay contribution proportional to the
    node's congestion sensitivity (encoded in the baseline quantiles).
    """
    out: Dict[str, Dict[str, float]] = {}
    for nid, q in base_quantiles.items():
        adj = scenario.node_adjustments.get(nid, {})
        cong_mult = adj.get("congestion_mult", 1.0)
        weather_shift = adj.get("weather_shift", 0.0)
        conflict_mult = adj.get("conflict_mult", 1.0)
        close = adj.get("close", False)
        if close:
            # node effectively blocked -> huge delay
            nq = {"p50": 72.0, "p80": 96.0, "p90": 120.0}
            if "p95" in q:
                nq["p95"] = 144.0
            out[nid] = nq
            continue
        # Preserve any extra quantiles present (e.g. p95) so scenario runs
        # sample the same CDF knot structure as the baseline - otherwise the
        # tail interpolation differs and the comparison is not counterfactual.
        keys = ("p50", "p80", "p90") + (("p95",) if "p95" in q else ())
        base = {k: float(q.get(k, 0.0)) for k in keys}
        # Delay scales partly with congestion & conflict sensitivity.
        # Symmetric treatment: mult > 1 worsens, mult < 1 relieves
        # (counterfactual interventions such as congestion relief).
        base_expected = (base["p50"] + base["p90"]) / 2.0
        cong_delta = base_expected * (cong_mult - 1.0) * 0.6
        conflict_delta = base_expected * (conflict_mult - 1.0) * 0.4
        wx = base_expected * weather_shift * 0.3
        add = cong_delta + conflict_delta + wx
        nq = {k: max(0.0, v + add) for k, v in base.items()}
        # preserve spread
        out[nid] = nq
    return out


def _resilience_score(delay_prob: float, uncertainty_days: float,
                      baseline_days: float) -> float:
    """0-100 composite of on-time reliability under delay risk.

    Same formulation as the route-comparison API: penalised by the mean
    node delay probability and by how wide the arrival tail is relative to
    the planned transit time. Higher is better.
    """
    unc = min(1.0, uncertainty_days / max(baseline_days, 0.5))
    return round(100.0 * (1.0 - delay_prob) * (1.0 - 0.5 * unc), 1)


def run_scenario(base_quantiles: Dict[str, Dict[str, float]],
                 base_risk: Dict[str, float],
                 scenario: Scenario,
                 n_sim: Optional[int] = None,
                 seed: Optional[int] = None) -> Dict:
    """Run the Monte Carlo engine under a scenario and return full results."""
    quantiles = apply_scenario_to_quantiles(base_quantiles, base_risk, scenario)
    route = topology.route_by_id(scenario.route_id)
    # Counterfactual baseline: same route, same seed, unadjusted quantiles,
    # so the scenario delta is measured against the identical simulation draw.
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
    # compute per-node risk under scenario (rough, from adjusted expected delay)
    per_node = {}
    for nid, q in quantiles.items():
        exp = (q["p50"] + q["p90"]) / 2.0
        prob = 1.0 / (1.0 + np.exp(-(exp - get_settings().delay_threshold_hours) / 15.0))
        per_node[nid] = {
            "node_id": nid,
            "risk": risk_level_from_probability(prob),
            "delay_probability": round(float(prob), 4),
            "expected_delay_hours": round(float(exp), 1),
        }
    return {
        "scenario": scenario.name,
        "monte_carlo": mc_dict,
        "per_node_risk": per_node,
    }


# ---------------------------------------------------------------------------
# Alternative route comparison
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
                   seed: Optional[int] = None) -> List[Dict]:
    """Run the MC engine for every configured route and return a comparison."""
    options = []
    for route in topology.ROUTES:
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


def _mean_delay_probability(route: topology.Route, quantiles) -> float:
    vals = []
    for nid in route.node_ids:
        q = quantiles.get(nid, {})
        exp = (q.get("p50", 0.0) + q.get("p90", 0.0)) / 2.0
        thr = get_settings().delay_threshold_hours
        p = 1.0 / (1.0 + np.exp(-(exp - thr) / 15.0))
        vals.append(p)
    return round(float(np.mean(vals)), 4)


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
        # min-max normalise across options
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
