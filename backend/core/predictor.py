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

from backend.core.config import get_settings
from backend.core.data.anomalies import detect_regime
from backend.core.data.loaders import load_alerts
from backend.core.explain.shap_explainer import local_explanation
from backend.core.features import node_features
from backend.core.graph import topology
from backend.core.graph.gat import GATIntegrator, build_gat_features
from backend.core.logging_util import get_logger
from backend.core.models import classification, delay, registry
from backend.core.nlp.event_extractor import EventExtractor
from backend.core.routing.routes import compare_routes, recommend_route, run_scenario, Scenario
from backend.core.simulation.monte_carlo import run_monte_carlo

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
                    "Trained models not found. Run: python -m backend.core.train_ml_part --version 1.1.0  (or: python -m backend.core.train)")
            raw_clf = registry.load_model("classifier")
            # XGBoost 1.7 pickle contains `use_label_encoder` removed in 2.x;
            # patch so get_params() doesn't raise AttributeError at predict.
            try:
                base = raw_clf.get("base") if isinstance(raw_clf, dict) else raw_clf
                if base is not None and base.__class__.__name__ == "XGBClassifier" and not hasattr(base, "use_label_encoder"):
                    base.__dict__["use_label_encoder"] = False  # type: ignore[attr-defined]
            except Exception:
                pass
            self.classifier = raw_clf
            self.delay_models = registry.load_model("delay_model")

            # Feature metadata
            meta = registry.load_metadata("classifier")
            self.feature_names = (meta or {}).get("feature_names", [])
            # feature groups from training run (feature_meta JSON)
            self.feature_groups = self._load_feature_groups()
            if not self.feature_groups:
                self.feature_groups = _default_groups(self.feature_names)

            # Detect new data/ml pipeline: feature_pipeline.joblib means 84-feature
            # regime_state/season OHE flow that needs preprocessing at inference.
            self._feature_pipeline = None
            self._ml_feature_names: List[str] = list(self.feature_names)
            try:
                import joblib
                fp = s.abs_artifact_dir / "feature_pipeline.joblib"
                if fp.exists():
                    self._feature_pipeline = joblib.load(str(fp))
                    # Keep the post-preprocessing names from the new training run
                    self._ml_feature_names = list(
                        self._feature_pipeline.get("feature_names", self.feature_names))
            except Exception:
                pass

            # Full feature matrix for all nodes (cached) — source must match
            # the pipeline that produced the artifacts, otherwise feature_names
            # won't align with the data.
            if self._feature_pipeline is not None:
                # New path: data/ml/ml_training_data.parquet already has 84-col
                # past-only features (built by build_features.py). Reuse it so
                # feature_names align exactly; no second feature build.
                try:
                    ml_path = s.abs_data_dir / "ml" / "ml_training_data.parquet"
                    if ml_path.exists():
                        raw = pd.read_parquet(ml_path)
                        self.ml = raw.copy()
                        if "delay_flag" in raw.columns and "is_delayed" not in self.ml.columns:
                            self.ml["is_delayed"] = raw["delay_flag"]
                        # Apply stored preprocessing once so self.ml already holds
                        # the transformed matrix the classifier expects.
                        self.ml = self._apply_feature_pipeline(self.ml)
                        # Drop rows where any of the post-transform features is NaN
                        self.ml = self.ml.dropna(subset=[
                            c for c in self._ml_feature_names if c in self.ml.columns
                        ]).reset_index(drop=True)
                    else:
                        raise FileNotFoundError(str(ml_path))
                except Exception as e:
                    log.warning(f"data/ml fallback to pipeline: {e}")
                    from backend.core.pipeline import prepare_ml_dataset
                    self.ml = prepare_ml_dataset()
                    self.ml = self.ml.dropna(subset=self.feature_names).reset_index(drop=True)
            else:
                from backend.core.pipeline import prepare_ml_dataset
                self.ml = prepare_ml_dataset()
                self.ml = self.ml.dropna(subset=self.feature_names).reset_index(drop=True)
            if self.ml.empty:
                raise RuntimeError("No usable feature rows to predict on")

            # Load alerts & aggregate into per-node features
            self.alert_agg = load_alerts()

            # GAT (optional; note prepare_ml_dataset already includes regime
            # features so GAT sees the same columns the tabular models see)
            try:
                from backend.core.graph.gat import train_gat_for_route
                if get_settings().graph_backend != "none":
                    gat_feats = self._ml_feature_names if self._feature_pipeline is not None and self._ml_feature_names else self.feature_names
                    gat_route = "asia_europe_suez" if topology.route_by_id("asia_europe_suez") else "suez"
                    if not topology.route_by_id(gat_route):
                        gat_route = topology.all_route_ids()[0] if topology.all_route_ids() else gat_route
                    g = train_gat_for_route(self.ml, gat_feats,
                                            route_id=gat_route, epochs=getattr(s, "gat_epochs", 40))
                    self.gat = g
                    if g is not None:
                        log.info(f"GAT ready (route={g.route_id}) residual applied")
            except Exception as e:  # pragma: no cover
                log.warning(f"GAT unavailable: {e}")
                self.gat = None

            self._ready = True
            log.info("PredictionEngine ready")

    # ------------------------------------------------------------------
    def _apply_feature_pipeline(self, df: pd.DataFrame) -> pd.DataFrame:
        """When the new data/ml training ran, apply its stored imputer+OHE."""
        if self._feature_pipeline is None:
            return df
        import pandas as pd
        plan = self._feature_pipeline.get("plan", {})
        imputer = self._feature_pipeline.get("imputer")
        encoder = self._feature_pipeline.get("encoder")
        ohe_names: List[str] = list(self._feature_pipeline.get("ohe_names", []))
        numeric: List[str] = list(plan.get("numeric", []))
        categorical: List[str] = list(plan.get("categorical", []))
        out = df.copy()
        if numeric and imputer is not None:
            avail = [c for c in numeric if c in out.columns]
            if avail:
                imp = pd.DataFrame(
                    imputer.transform(out[avail].astype(float)),
                    columns=avail, index=out.index)
                for c in avail:
                    out[c] = imp[c]
        if categorical and encoder is not None and ohe_names:
            avail_cat = [c for c in categorical if c in out.columns]
            if avail_cat:
                filled = out[avail_cat].fillna("missing").astype(str)
                ohe = pd.DataFrame(
                    encoder.transform(filled), columns=ohe_names, index=out.index)
                for c in ohe_names:
                    out[c] = ohe[c].to_numpy()
        return out

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
        # Build feature frame through the pipeline that was active at training.
        if self._feature_pipeline is not None:
            raw_cols: List[str] = list(self._feature_pipeline.get("plan", {}).get("numeric", [])) \
                + list(self._feature_pipeline.get("plan", {}).get("categorical", []))
            raw = row[raw_cols].to_frame().T if raw_cols else row[self.feature_names].to_frame().T
            # Apply stored imputer + OHE so classifier sees 84 cols
            tmp = raw.copy()
            tmp = self._apply_feature_pipeline(tmp)
            feat = tmp[self._ml_feature_names] if self._ml_feature_names else tmp[self.feature_names]
        else:
            feat = row[self.feature_names].to_frame().T
        # XGBoost 1.7 pickles break on 2.x get_params — try wrapper then booster fallback
        try:
            p_delay = float(classification.predict_proba(self.classifier, feat)[0])
        except AttributeError:
            try:
                import xgboost as xgb
                base = self.classifier.get("base") if isinstance(self.classifier, dict) else self.classifier
                booster = base.get_booster() if hasattr(base, "get_booster") else None
                if booster is not None:
                    dm = xgb.DMatrix(feat.to_numpy(dtype=np.float32))
                    raw = booster.predict(dm)
                    # binary:logistic already gives proba; else clip
                    p = float(raw[0]) if raw.ndim == 1 else float(raw[0, 1] if raw.shape[1] > 1 else raw[0])
                    iso = self.classifier.get("isotonic") if isinstance(self.classifier, dict) else None
                    p_delay = float(iso.predict([p])[0]) if iso is not None else float(p)
                else:
                    raise
            except Exception:
                # last resort: neutral probability
                p_delay = 0.5
        q = delay.predict_quantiles(self.delay_models, feat)
        # New models ship p95; old have only p50/p80/p90 — handle both
        p50 = float(q.get("p50", q.get("p50", [0.0]))[0] if "p50" in q else 0.0)
        p80 = float(q.get("p80", [p50])[0]); p90 = float(q.get("p90", [p80])[0])
        p95 = float(q.get("p95", [p90])[0]) if "p95" in q else None
        # NLP alert bump: if recent alerts exist for this node, scale quantiles
        nid = row["node_id"]
        if self.alert_agg is not None and len(self.alert_agg):
            a = self.alert_agg[self.alert_agg["node_id"] == nid]
            if len(a):
                alert_risk = float(a.iloc[0]["alert_risk_score"])
                bump = 1.0 + 0.4 * alert_risk
                p50 *= bump; p80 *= bump; p90 *= bump
                if p95 is not None:
                    p95 *= bump
                p_delay = min(0.99, p_delay + 0.05 * alert_risk)
        # GAT residual adjustment
        if gat_residual:
            residual_scale = 0.15
            p50 = max(0.0, p50 + gat_residual * residual_scale)
            p80 = max(p50, p80 + gat_residual * residual_scale)
            p90 = max(p80, p90 + gat_residual * residual_scale)
            if p95 is not None:
                p95 = max(p90, p95 + gat_residual * residual_scale)
        # enforce monotone quantiles (p50 <= p80 <= p90 <= p95)
        if p95 is not None:
            p50 = max(0.0, min(p50, p80, p90, p95))
            p80 = max(p50, round(min(max(p80, p50), max(p50, p90, p95)), 3))
            p90 = max(p80, round(min(max(p90, p80), p95), 3))
            p95 = max(p90, p95)
        else:
            p50 = max(0.0, min(p50, p80, p90))
            p80 = max(p50, round(min(max(p80, p50), max(p50, p90)), 3))
            p90 = max(p80, p90)
        exp = (p50 + (p95 if p95 is not None else p90)) / 2.0
        out: Dict = {
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
        if p95 is not None:
            out["p95"] = round(float(p95), 1)
        return out

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
        route_id = topology.resolve_route_id(route_id)
        route = topology.route_by_id(route_id)
        if route is None:
            raise ValueError(f"Unknown route {route_id}")
        # Resolve endpoints: fall back to the route's real origin/destination
        # when the caller only labels the corridor (e.g. old frankfurt aliases).
        idx = topology.node_index()
        if origin not in idx and route.node_ids:
            origin = route.node_ids[0]
        if destination not in idx and route.node_ids:
            destination = route.node_ids[-1]
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

        delay_quantiles = {}
        for nid, p in preds.items():
            q = {"p50": p["p50"], "p80": p["p80"], "p90": p["p90"]}
            if "p95" in p:
                q["p95"] = p["p95"]
            delay_quantiles[nid] = q
        delay_probs = {nid: p["delay_probability"] for nid, p in preds.items()}

        deadline_days = None
        if deadline_date:
            deadline_days = (pd.Timestamp(deadline_date) - base).days
            if deadline_days < 0:
                deadline_days = 0

        mc = run_monte_carlo(route_id, delay_quantiles,
                             n_sim=n_sim, seed=seed,
                             deadline_days=deadline_days)

        # Distributional confidence: how tight the arrival spread is around
        # the expected value. 100 when the P95-P50 gap is zero; penalised as
        # the downside tail grows relative to the expected transit time.
        spread = mc.percentiles["p95"] - mc.percentiles["p50"]
        confidence = 100.0 * (1.0 - spread / max(mc.expected_days, 0.5))
        confidence = round(min(100.0, max(0.0, confidence)), 1)

        # Route-level resilience (same formulation as route comparison so the
        # baseline and what-if scenarios are directly comparable).
        route_delay_prob = float(np.mean(
            [delay_probs[nid] for nid in route.node_ids if nid in delay_probs]
        )) if route.node_ids else 0.0
        route_baseline_days = topology.route_baseline_days(route)
        unc_days = mc.percentiles["p90"] - mc.percentiles["p10"]
        unc_ratio = min(1.0, unc_days / max(route_baseline_days, 0.5))
        resilience = round(100.0 * (1.0 - route_delay_prob) * (1.0 - 0.5 * unc_ratio), 1)

        # critical nodes from simulation contribution
        critical = _rank_critical(mc.critical_nodes, route.node_ids)

        origin_label = topology.node_label(origin) if origin in topology.node_index() else origin
        dest_label = topology.node_label(destination) if destination in topology.node_index() else destination
        current_label = None
        if current_checkpoint:
            current_label = topology.node_label(current_checkpoint)

        mc_dict = mc.to_dict(origin_date=str(base.date()),
                     deadline_date=deadline_date)
        mc_dict["resilience_score"] = resilience
        mc_dict["confidence"] = confidence

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
            "monte_carlo": mc_dict,
            "critical_nodes": critical,
            "prediction_confidence": confidence,
            "resilience_score": resilience,
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
        feat = self._ml_feature_names if self._feature_pipeline is not None and self._ml_feature_names else self.feature_names
        # Apply pipeline transform if needed for GAT input
        rows_df = node_rows.copy()
        if self._feature_pipeline is not None:
            rows_df = self._apply_feature_pipeline(rows_df)
        mat = np.zeros((1, len(node_order), len(feat)), dtype=np.float32)
        missing = set(node_order)
        for _, r in rows_df.iterrows():
            nid = r["node_id"]
            if nid in node_order:
                j = node_order.index(nid)
                for k, c in enumerate(feat):
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
        expl_feats = self._ml_feature_names if self._feature_pipeline is not None and self._ml_feature_names else self.feature_names
        # Apply pipeline transform for the new 84-feature models
        if self._feature_pipeline is not None:
            bg_raw = self.ml.sample(min(400, len(self.ml)), random_state=0)
            bg = self._apply_feature_pipeline(bg_raw)[expl_feats]
            row_feat = self._apply_feature_pipeline(row)[expl_feats]
        else:
            bg = self.ml.sample(min(400, len(self.ml)), random_state=0)[self.feature_names]
            row_feat = row[self.feature_names]
            expl_feats = self.feature_names
        expl = local_explanation(self.classifier, bg, row_feat,
                                 expl_feats, self.feature_groups, top_k=top_k)
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
        deadline_days = None
        deadline = shipment["monte_carlo"].get("deadline_date")
        if deadline:
            base = pd.Timestamp(shipment["prediction_date"])
            deadline_days = (pd.Timestamp(deadline) - base).days
        sc = Scenario(name=scenario.get("name", "Custom scenario"),
                      route_id=shipment["route_id"],
                      node_adjustments=adjustments,
                      deadline_days=deadline_days)
        quantiles = {k: {"p50": v["p50"], "p80": v["p80"], "p90": v["p90"]}
                     for k, v in shipment["delay_quantiles"].items()}
        probs = shipment["delay_probabilities"]
        result = run_scenario(quantiles, probs, sc,
                              n_sim=get_settings().mc_simulations,
                              seed=get_settings().mc_seed)
        return result

    def compare(self, shipment: Dict, objectives: List[str]) -> Dict:
        self.ensure_ready()

        # Determine origin / destination nodes from the shipment's own route
        # so we only surface corridors that actually serve this corridor.
        current_route = topology.route_by_id(shipment["route_id"])
        origin_node = current_route.node_ids[0]
        dest_node = current_route.node_ids[-1]

        # Only simulate routes that start at the same origin and either end
        # at the destination or pass through it (multi-stop routes).
        relevant_ids = [
            r.route_id for r in topology.ROUTES
            if r.node_ids[0] == origin_node
            and (r.node_ids[-1] == dest_node or dest_node in r.node_ids)
        ]

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
                              seed=get_settings().mc_seed,
                              route_ids=relevant_ids)

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

        # Build a per-route reason explaining why it is (or isn't) recommended
        origin_label = topology.node_label(origin_node)
        dest_label = topology.node_label(dest_node)
        balanced_rec = recs.get("balanced", recs.get("fastest", ""))
        fastest_rec = recs.get("fastest", "")
        safest_rec = recs.get("lowest_risk", "")

        options = []
        for o in opts:
            rid = o.route.route_id
            nodes = o.route.node_ids
            is_current = (rid == shipment["route_id"])
            is_balanced = (rid == balanced_rec)
            is_fastest = (rid == fastest_rec)
            is_safest = (rid == safest_rec)
            passes_through = dest_node in nodes and nodes[-1] != dest_node
            final_dest = topology.node_label(nodes[-1])

            reasons = []
            if is_current:
                reasons.append(f"Your current corridor ({origin_label} → {dest_label}).")
            if passes_through:
                reasons.append(f"Passes through {dest_label} on the way to {final_dest}.")
            if is_fastest:
                reasons.append("Fastest option for this corridor.")
            if is_safest:
                reasons.append("Lowest delay risk among available routes.")
            if is_balanced:
                reasons.append("Best overall balance of speed, risk, and resilience.")
            if not reasons:
                reasons.append(f"Alternative corridor ({origin_label} → {final_dest}).")

            options.append({
                "route_id": rid, "route_name": o.route.name,
                "baseline_days": round(o.baseline_days, 1),
                "distance_km": round(o.distance_km, 0),
                "expected_eta_days": round(o.expected_days, 1),
                "p90_eta_days": round(o.p90_days, 1),
                "delay_probability": o.delay_probability,
                "deadline_risk": round(o.deadline_risk, 4),
                "uncertainty_days": round(o.uncertainty, 1),
                "resilience": round(100.0 * (1.0 - o.delay_probability)
                                    * (1.0 - 0.5 * min(1.0, o.uncertainty / max(o.baseline_days, 0.5))), 1),
                "scores": {obj: scores_by_objective[obj][rid]
                           for obj in objectives},
                "is_current": is_current,
                "reasons": reasons,
            })
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