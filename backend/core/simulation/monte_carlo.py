"""Monte Carlo ETA engine (Stage D).

Uses the **model's predicted delay magnitude distributions** per node (not
arbitrary random numbers) to sample thousands of scenarios, propagate delays
downstream through the route (delay cascade) and produce a full ETA
distribution with percentiles, expected delay and deadline-miss probability.

The simulation is vectorised where practical and fully reproducible with a
seed.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from backend.core.config import get_settings
from backend.core.graph.network import propagate_delay_cascade
from backend.core.graph import topology
from backend.core.logging_util import get_logger

log = get_logger(__name__)


class QuantileSampler:
    """Sample from a distribution described by a set of quantiles.

    CDF is reconstructed by piecewise-linear interpolation between known
    quantiles and extrapolated in the upper tail; the lower bound is clipped at
    zero. Vectorised over a number of draws.
    """

    def __init__(self, quantiles: np.ndarray, values: np.ndarray, upper_tail: float = 1.6):
        quantiles = np.asarray(quantiles, dtype=float)
        values = np.asarray(values, dtype=float)
        order = np.argsort(quantiles)
        self.q = quantiles[order]
        self.v = np.clip(values[order], 0.0, None)
        self.upper_tail = upper_tail

    def sample(self, n: int, rng: np.random.Generator) -> np.ndarray:
        u = rng.random(n)
        # extend CDF beyond highest quantile with linear extrapolation
        q_hi = self.q[-1]
        v_hi = self.v[-1]
        tail_q = q_hi + (1.0 - q_hi) * self.upper_tail
        tail_v = v_hi * self.upper_tail  # linear growth in the tail
        q_all = np.append(self.q, tail_q)
        v_all = np.append(self.v, tail_v)
        out = np.interp(u, q_all, v_all)
        return np.clip(out, 0.0, None)


def _identity_quantiles(df: pd.DataFrame) -> Dict[str, Dict[str, float]]:
    """Build per-node delta-quantiles from a single predicted latency row.

    `df` must carry columns node_id, delay_p50, delay_p80, delay_p90.
    """
    out = {}
    for _, r in df.iterrows():
        out[r["node_id"]] = {
            "p50": float(r.get("delay_p50", 0.0)),
            "p80": float(r.get("delay_p80", 0.0)),
            "p90": float(r.get("delay_p90", 0.0)),
        }
    return out


@dataclass
class SimulationResult:
    route_id: str
    n_sim: int
    seed: int
    arrival_days: np.ndarray          # total transit+delay days per sim
    expected_days: float
    percentiles: Dict[str, float]
    expected_delay_hours: float
    p_miss_deadline: float
    deadline_days: Optional[float]
    critical_nodes: Dict[str, float]  # share of expected delay by node
    per_node_expected_delay: Dict[str, float] = field(default_factory=dict)
    # Per-simulation detail (populated by run_monte_carlo; cheap to keep).
    total_delay_hours: np.ndarray = field(default_factory=lambda: np.zeros(0))
    total_transit_hours: np.ndarray = field(default_factory=lambda: np.zeros(0))
    node_samples: Dict[str, np.ndarray] = field(default_factory=dict)

    def to_dict(self, origin_date: str = None, deadline_date: str = None) -> Dict:
        d = {
            "route_id": self.route_id,
            "n_simulations": self.n_sim,
            "seed": self.seed,
            "expected_days": round(self.expected_days, 2),
            "expected_delay_hours": round(self.expected_delay_hours, 1),
            "percentiles": {k: round(float(v), 2) for k, v in self.percentiles.items()},
            "p_miss_deadline": round(float(self.p_miss_deadline), 4),
            "critical_nodes": {k: round(v, 4) for k, v in self.critical_nodes.items()},
        }
        if origin_date and deadline_date:
            base = pd.Timestamp(origin_date)
            dl = pd.Timestamp(deadline_date)
            d["eta_date"] = {k: (base + pd.Timedelta(days=float(v))).strftime("%Y-%m-%d")
                             for k, v in self.percentiles.items()}
            d["expected_eta_date"] = (base + pd.Timedelta(days=self.expected_days)).strftime("%Y-%m-%d")
            d["deadline_date"] = dl.strftime("%Y-%m-%d")
        return d


def run_monte_carlo(
    route_id: str,
    node_delay_quantiles: Dict[str, Dict[str, float]],
    edge_transit_days: Dict[str, float] | None = None,
    n_sim: Optional[int] = None,
    seed: Optional[int] = None,
    attenuation: float = 1.0,
    deadline_days: Optional[float] = None,
) -> SimulationResult:
    """Run the Monte Carlo ETA simulation.

    Parameters
    ----------
    node_delay_quantiles : per-node {p50, p80, p90} delay-hour predictions.
        An optional ``p95`` entry per node is honoured when present
        (older callers passing only p50/p80/p90 are unaffected).
    edge_transit_days : optional per-edge baseline transit days (src->dst key);
        defaults to topology baselines.
    """
    n_sim = n_sim or get_settings().mc_simulations
    seed = seed if seed is not None else get_settings().mc_seed
    rng = np.random.default_rng(seed)
    route_id = topology.resolve_route_id(route_id)

    if edge_transit_days is None:
        edge_transit_days = {f"{e.src}->{e.dst}": e.baseline_days
                             for e in topology.route_edges(topology.route_by_id(route_id))}

    route = topology.route_by_id(route_id)
    node_ids = route.node_ids

    # Pre-build per-node samplers (p95-aware, backward compatible).
    samplers = {}
    for nid in node_ids:
        q = node_delay_quantiles.get(nid, {})
        p50 = q.get("p50", 0.0)
        p80 = q.get("p80", p50)
        p90 = q.get("p90", p80)
        if "p95" in q:
            samplers[nid] = QuantileSampler(
                np.array([0.0, 0.50, 0.80, 0.90, 0.95]),
                np.array([0.0, p50, p80, p90, q.get("p95", p90)]),
            )
        else:
            samplers[nid] = QuantileSampler(
                np.array([0.0, 0.50, 0.80, 0.90]),
                np.array([0.0, p50, p80, p90]),
            )

    # Sample per-node delays (shape n_sim per node for route-ordered nodes)
    node_samples = {}
    for nid in node_ids:
        node_samples[nid] = samplers[nid].sample(n_sim, rng)

    # Sample edge transit times (log-normal around baseline with mild noise)
    # + base delay noise already in node delays; transit is separate per edge.
    edge_samples = {}
    for e in topology.route_edges(route):
        key = f"{e.src}->{e.dst}"
        base = float(edge_transit_days[key])
        mu = np.log(base) - 0.5 * 0.20 ** 2
        edge_samples[key] = rng.lognormal(mu, 0.20, size=n_sim)

    # Assemble arrival time per simulation (sum of edge transits).
    total_transit = np.zeros(n_sim)
    for nid, nxt in zip(node_ids, node_ids[1:]):
        key = f"{nid}->{nxt}"
        total_transit += edge_samples[key]

    # Downstream cascade of delay.
    # propagated delay per node = own delay + attenuation * upstream cum raw delay
    total_delay = np.zeros(n_sim)
    cum = np.zeros(n_sim)
    per_node_expected = {}
    for nid in node_ids:
        own = node_samples[nid]
        eff = own + attenuation * cum
        total_delay += eff
        per_node_expected[nid] = float(np.mean(own))
        cum = cum + own * attenuation  # raw accumulates (damped)

    arrival_days = total_transit + total_delay / 24.0

    percentiles = {
        f"p{int(p)}": float(np.percentile(arrival_days, p))
        for p in (10, 25, 50, 80, 90, 95)
    }
    expected_days = float(np.mean(arrival_days))
    expected_delay_hours = float(np.mean(total_delay))

    total_expected = sum(per_node_expected.values()) or 1.0
    critical_nodes = {k: v / total_expected for k, v in per_node_expected.items()}

    p_miss = 0.0
    if deadline_days is not None:
        p_miss = float(np.mean(arrival_days > deadline_days))

    res = SimulationResult(
        route_id=route_id,
        n_sim=n_sim,
        seed=seed,
        arrival_days=arrival_days,
        expected_days=expected_days,
        percentiles=percentiles,
        expected_delay_hours=expected_delay_hours,
        p_miss_deadline=p_miss,
        deadline_days=deadline_days,
        critical_nodes=critical_nodes,
        per_node_expected_delay=per_node_expected,
        total_delay_hours=total_delay,
        total_transit_hours=total_transit,
        node_samples=node_samples,
    )
    log.info(f"MC sim route={route_id} n={n_sim} expected_days={expected_days:.2f} "
             f"P90={percentiles['p90']:.2f} miss={p_miss:.3f}")
    return res
