"""Runtime prediction service.

Loads trained artifacts once, builds current per-node feature vectors from the
gold data, computes node risk + delay quantiles, applies the GAT graph residual
and NLP alert signals, then orchestrates Monte Carlo ETA, what-if scenarios,
route comparison and check-point attribution. This service backs the API.
"""
from __future__ import annotations

import threading
from functools import lru_cache
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from core.config import get_settings
from core.data.anomalies import detect_regime
from core.data.loaders import load_alerts
from core.explain.shap_explainer import local_explanation
from core.features import node_features
from core.graph import topology
from core.graph.gat import GATIntegrator, build_gat_features
from core.logging_util import get_logger
from core.models import classification, delay, registry
from core.nlp.event_extractor import EventExtractor
from core.routing.routes import compare_routes, recommend_route, run_scenario, Scenario
from core.simulation.monte_carlo import run_monte_carlo

log = get_logger(__name__)


class PredictionEngine:
    """Lazy singleton that resolves models and data once."""

    def __init__(self):
        self._lock = threading.Lock()
        self._ready = False
        self.ml = None
        self.feature_names: List[str] = []
        self.feature_groups: Dict[str, List[str]] = {}
        self.classifier = None
        self.delay_models = None
        self.gat: Optional[GATIntegrator] = None
        self.alert_agg: pd.DataFrame | None = None

    # ------------------------------------------------------------------
    def ensure_ready(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            s = get_settings()
            if not registry.has_model("classifier") or not registry.has_model("delay_model"):
                raise RuntimeError(
                    "Trained models not found. Run: python -m core.train")
            self.classifier = registry.load_model("classifier")
            self.delay_models = registry.load_model("delay_model")

            # Feature metadata
            meta = registry.load_metadata("classifier")
            self.feature_names = (meta or {}).get("feature_names", [])
            # feature groups from training run (feature_meta JSON)
            self.feature_groups = self._load_feature_groups()
            if not self.feature_groups:
                self.feature_groups = _default_groups(self.feature_names)

            # Full feature matrix for all nodes (cached)
            from core.pipeline import prepare_ml_dataset
            self.ml = prepare_ml_dataset()
            self.ml = self.ml.dropna(subset=self.feature_names).reset_index(drop=True)
            if self.ml.empty:
                raise RuntimeError("No usable feature rows to predict on")

            # Load alerts & aggregate into per-node features
            self.alert_agg = load_alerts()

            # GAT (optional; note prepare_ml_dataset already includes regime
            # features so GAT sees the same columns the tabular models see)
            try:
                from core.graph.gat import train_gat_for_route
                if get_settings().graph_backend != "none":
                    g = train_gat_for_route(self.ml, self.feature_names,
                                            route_id="suez", epochs=getattr(s, "gat_epochs", 40))
                    self.gat = g
                    if g is not None:
                        log.info(f"GAT ready (route={g.route_id}) residual applied")
            except Exception as e:  # pragma: no cover
                log.warning(f"GAT unavailable: {e}")
                self.gat = None

            self._ready = True
            log.info("PredictionEngine ready")

    # ------------------------------------------------------------------
    def _load_feature_groups(self) -> Dict[str, List[str]]:
        s = get_settings()
        p = s.abs_artifact_dir / "feature_meta" / "groups.json"
        if p.exists():
            import json
            try:
                g = json.loads(p.read_text(encoding="utf-8"))
                return {k: v for k, v in g.items()}
            except Exception:
                return {}
        return {}

    def _current_features(self, as_of: pd.Timestamp) -> pd.DataFrame:
        """Latest feature row per node with timestamp <= as_of."""
        ml = self.ml
        ts = pd.to_datetime(ml["timestamp"])
        mask = ts <= as_of
        latest = ml[mask].sort_values("timestamp").groupby("node_id").tail(1)
        return latest

    def _predict_node(self, row: pd.Series, gat_residual: float = 0.0) -> Dict:
        feat = row[self.feature_names].to_frame().T
        p_delay = float(classification.predict_proba(self.classifier, feat)[0])
        q = delay.predict_quantiles(self.delay_models, feat)
        p50 = float(q["p50"][0]); p80 = float(q["p80"][0]); p90 = float(q["p90"][0])
        # NLP alert bump: if recent alerts exist for this node, scale quantiles
        nid = row["node_id"]
        if self.alert_agg is not None and len(self.alert_agg):
            a = self.alert_agg[self.alert_agg["node_id"] == nid]
            if len(a):
                alert_risk = float(a.iloc[0]["alert_risk_score"])
                bump = 1.0 + 0.4 * alert_risk
                p50 *= bump; p80 *= bump; p90 *= bump
                p_delay = min(0.99, p_delay + 0.05 * alert_risk)
        # GAT residual adjustment
        if gat_residual:
            residual_scale = 0.15
            p50 = max(0.0, p50 + gat_residual * residual_scale)
            p80 = max(p50, p80 + gat_residual * residual_scale)
            p90 = max(p80, p90 + gat_residual * residual_scale)
        # enforce monotone quantiles (p50 <= p80 <= p90)
        p50 = max(0.0, min(p50, p80, p90))
        p80 = max(p50, round(min(max(p80, p50), max(p50, p90)), 3))
        p90 = max(p80, p90)
        exp = (p50 + p90) / 2.0
        return {
            "node_id": nid,
            "label": topology.node_label(nid),
            "timestamp": str(row["timestamp"]),
            "delay_probability": round(p_delay, 4),
            "expected_delay_hours": round(exp, 1),
            "p50": round(float(p50), 1),
            "p80": round(float(p80), 1),
            "p90": round(float(p90), 1),
            "congestion": round(float(row["congestion_index"]), 3),
            "weather": round(float(row["weather_severity"]), 3),
            "conflict": round(float(row["conflict_risk_score"]), 3),
            "regime": int(row.get("regime_disrupted", 0)),
        }

    # ------------------------------------------------------------------
    def predict_shipment(self, origin: str, destination: str,
                         route_id: str = "suez",
                         current_checkpoint: Optional[str] = None,
                         deadline_date: Optional[str] = None,
                         origin_date: Optional[str] = None,
                         as_of: Optional[str] = None,
                         n_sim: Optional[int] = None,
                         seed: Optional[int] = None) -> Dict:
        """End-to-end prediction for a shipment on a route."""
        self.ensure_ready()
        route = topology.route_by_id(route_id)
        if route is None:
            raise ValueError(f"Unknown route {route_id}")
        if origin_date:
            base = pd.Timestamp(origin_date)
        else:
            base = pd.to_datetime(self.ml["timestamp"]).max().normalize()
        as_of_ts = pd.Timestamp(as_of) if as_of else base
        features = self._current_features(as_of_ts)

        # per-node predictions along the route
        node_rows = features[features["node_id"].isin(route.node_ids)]
        # GAT residuals for the whole route at once (batch [1, N, F])
        gat_residuals = self._gat_residuals_for_route(route_id, node_rows)
        preds = {nid: None for nid in route.node_ids}
        for _, r in node_rows.iterrows():
            preds[r["node_id"]] = self._predict_node(r, gat_residuals.get(r["node_id"], 0.0))
        # missing nodes (no data): default low risk
        for nid in route.node_ids:
            if preds.get(nid) is None:
                preds[nid] = self._default_node(nid, base)

        delay_quantiles = {nid: {"p50": p["p50"], "p80": p["p80"], "p90": p["p90"]}
                           for nid, p in preds.items()}
        delay_probs = {nid: p["delay_probability"] for nid, p in preds.items()}

        deadline_days = None
        if deadline_date:
            deadline_days = (pd.Timestamp(deadline_date) - base).days
            if deadline_days < 0:
                deadline_days = 0

        mc = run_monte_carlo(route_id, delay_quantiles,
                             n_sim=n_sim, seed=seed,
                             deadline_days=deadline_days)

        # critical nodes from simulation contribution
        critical = _rank_critical(mc.critical_nodes, route.node_ids)

        origin_label = topology.node_label(origin) if origin in topology.node_index() else origin
        dest_label = topology.node_label(destination) if destination in topology.node_index() else destination
        current_label = None
        if current_checkpoint:
            current_label = topology.node_label(current_checkpoint)

        return {
            "shipment_id": f"{origin}-{destination}",
            "origin": origin_label,
            "destination": dest_label,
            "current_checkpoint": current_label or origin_label,
            "route_id": route_id,
            "route_name": route.name,
            "prediction_date": str(base.date()),
            "node_predictions": [preds[nid] for nid in route.node_ids if preds.get(nid)],
            "delay_probabilities": delay_probs,
            "delay_quantiles": delay_quantiles,
            "monte_carlo": mc.to_dict(origin_date=str(base.date()),
                                      deadline_date=deadline_date),
            "critical_nodes": critical,
            "model_version": (registry.load_metadata("classifier") or {}).get("version", "?"),
        }

    # ------------------------------------------------------------------
    def _gat_residuals_for_route(self, route_id: str,
                                 node_rows: pd.DataFrame) -> Dict[str, float]:
        """Full-route GAT residual per node (0 if GAT inactive/missing)."""
        if self.gat is None or not getattr(self.gat, "trained", False):
            return {}
        node_order = getattr(self.gat, "node_order", None)
        if node_order is None:
            return {}
        mat = np.zeros((1, len(node_order), len(self.feature_names)), dtype=np.float32)
        missing = set(node_order)
        for _, r in node_rows.iterrows():
            nid = r["node_id"]
            if nid in node_order:
                j = node_order.index(nid)
                for k, c in enumerate(self.feature_names):
                    v = r.get(c, np.nan)
                    mat[0, j, k] = 0.0 if pd.isna(v) else float(v)
                missing.discard(nid)
        if missing:
            return {}
        resid = self.gat.predict_residual(mat)[0]
        return {nid: float(resid[i]) for i, nid in enumerate(node_order)}

    def _default_node(self, nid: str, base: pd.Timestamp) -> Dict:
        return {
            "node_id": nid, "label": topology.node_label(nid),
            "timestamp": str(base), "delay_probability": 0.2,
            "expected_delay_hours": 2.0, "p50": 1.0, "p80": 2.0, "p90": 3.0,
            "congestion": 0.1, "weather": 0.1, "conflict": 0.0, "regime": 0,
        }

    # ------------------------------------------------------------------
    def explain(self, shipment: Dict, top_k: int = 6) -> Dict:
        """Local SHAP explanation for the highest-risk node & shipment."""
        self.ensure_ready()
        route_id = shipment["route_id"]
        # most risky node
        nodes = shipment["node_predictions"]
        riskiest = max(nodes, key=lambda n: n["delay_probability"])["node_id"]
        features = self._current_features(pd.Timestamp(shipment["prediction_date"]))
        row = features[features["node_id"] == riskiest]
        if row.empty:
            return {"node_id": riskiest, "error": "no features"}
        bg = self.ml.sample(min(400, len(self.ml)), random_state=0)[self.feature_names]
        expl = local_explanation(self.classifier, bg, row[self.feature_names],
                                 self.feature_names, self.feature_groups, top_k=top_k)
        expl["node_id"] = riskiest
        expl["node_label"] = topology.node_label(riskiest)
        expl["delay_probability"] = max(n["delay_probability"] for n in nodes)
        return expl

    def whatif(self, shipment: Dict, scenario: Dict) -> Dict:
        self.ensure_ready()
        nid = scenario.get("node_id")
        adjustments = {}
        if nid:
            adjustments[nid] = {k: v for k, v in scenario.items()
                                if k in ("congestion_mult", "weather_shift",
                                         "conflict_mult", "close")}
        sc = Scenario(name=scenario.get("name", "Custom scenario"),
                      route_id=shipment["route_id"],
                      node_adjustments=adjustments,
                      deadline_days=shipment["monte_carlo"].get("deadline_date"))
        quantiles = {k: {"p50": v["p50"], "p80": v["p80"], "p90": v["p90"]}
                     for k, v in shipment["delay_quantiles"].items()}
        probs = shipment["delay_probabilities"]
        result = run_scenario(quantiles, probs, sc,
                              n_sim=get_settings().mc_simulations,
                              seed=get_settings().mc_seed)
        return result

    def compare(self, shipment: Dict, objectives: List[str]) -> Dict:
        self.ensure_ready()
        quantiles = {k: {"p50": v["p50"], "p80": v["p80"], "p90": v["p90"]}
                     for k, v in shipment["delay_quantiles"].items()}
        mc = shipment["monte_carlo"]
        deadline = mc.get("deadline_date")
        deadline_days = None
        if deadline:
            base = pd.Timestamp(shipment["prediction_date"])
            deadline_days = (pd.Timestamp(deadline) - base).days
        opts = compare_routes(quantiles, deadline_days=deadline_days,
                              n_sim=get_settings().mc_simulations,
                              seed=get_settings().mc_seed)
        # recommendations from the internal option records (simulation outputs)
        internal = [
            {
                "route_id": o.route.route_id,
                "expected_days": o.expected_days,
                "deadline_risk": o.deadline_risk,
                "delay_probability": o.delay_probability,
                "uncertainty": o.uncertainty,
            }
            for o in opts
        ]
        recs = {}
        scores_by_objective = {}
        for obj in objectives:
            rec = recommend_route(internal, obj)
            recs[obj] = rec["recommended_route_id"]
            scores_by_objective[obj] = {o["route_id"]: round(float(o["score"]), 3)
                                        for o in rec["options"]}
        options = [
            {
                "route_id": o.route.route_id, "route_name": o.route.name,
                "baseline_days": round(o.baseline_days, 1),
                "distance_km": round(o.distance_km, 0),
                "expected_eta_days": round(o.expected_days, 1),
                "p90_eta_days": round(o.p90_days, 1),
                "delay_probability": o.delay_probability,
                "deadline_risk": round(o.deadline_risk, 4),
                "uncertainty_days": round(o.uncertainty, 1),
                "scores": {obj: scores_by_objective[obj][o.route.route_id]
                           for obj in objectives},
            }
            for o in opts
        ]
        return {"options": options, "recommended": recs}


def _rank_critical(contributions: Dict[str, float], node_order: List[str]) -> List[Dict]:
    ranked = sorted(contributions.items(), key=lambda x: -x[1])
    out = []
    for nid, share in ranked:
        if nid not in node_order:
            continue
        out.append({
            "node_id": nid, "label": topology.node_label(nid),
            "delay_share": round(float(share), 4),
            "percent": round(float(share * 100), 1),
        })
    return out


def _default_groups(feature_names: List[str]) -> Dict[str, List[str]]:
    return {
        "historical delay": [c for c in feature_names if "delay_" in c or "lag" in c],
        "congestion": [c for c in feature_names if "congestion" in c],
        "weather": [c for c in feature_names if "weather" in c],
        "conflict": [c for c in feature_names if "conflict" in c],
        "regime": [c for c in feature_names if "regime" in c],
        "calendar": [c for c in feature_names if any(k in c for k in ("month", "day_of", "week", "fourier", "holiday", "season"))],
    }


_engine: Optional[PredictionEngine] = None


def get_engine() -> PredictionEngine:
    global _engine
    if _engine is None:
        _engine = PredictionEngine()
    return _engine