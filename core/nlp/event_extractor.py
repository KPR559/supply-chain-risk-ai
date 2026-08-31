"""NLP / LLM event intelligence.

Input: shipping news, port authority bulletins, disruption notices, logistics
alerts (free text). Output: structured events that BECOME ML features.

The default engine is deterministic (rule-based) so the system runs fully
offline. If an LLM API were configured it would replace/augment the extraction
but the fallback must always keep the pipeline functional.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from core.config import get_settings
from core.graph.topology import node_index
from core.logging_util import get_logger

log = get_logger(__name__)

NODE_ALIASES = {
    "suez": ["suez", "suez canal", "red sea"],
    "mumbai": ["mumbai", "nhava sheva", "jawaharlal nehru port"],
    "colombo": ["colombo"],
    "dubai": ["dubai", "jebel ali"],
    "european_hub": ["europe", "rotterdam", "hamburg", "antwerp", "fr william", "germany"],
    "indian_ocean": ["indian ocean"],
    "cape_of_good_hope": ["cape", "cape of good hope", "good hope"],
    "customs": ["customs", "clearance", "import"],
    "final_destination": ["delhi", "destination"],
}

EVENT_TYPE_PATTERNS = {
    "congestion": [r"congest", r"backlog", r"queu", r"waiting time", r"vessel.*queue"],
    "weather": [r"weather", r"storm", r"wave height", r"cyclone", r"knots"],
    "conflict": [r"conflict", r"restriction", r"surcharge", r"attack", r"instabilit"],
    "strike": [r"strike"],
    "closure": [r"closure", r"halt", r"suspend"],
    "delay": [r"delay", r"postpon"],
}

SEVERITY_WORDS = {"severe": 1.0, "major": 1.0, "significant": 0.7, "high": 0.9,
                  "elevated": 0.6, "minor": 0.2, "increase": 0.4}


@dataclass
class ExtractedEvent:
    location: str
    event_type: str
    severity: float
    affected_route: bool
    risk_score: float
    text: str
    matched_pattern: str = field(default="")

    def to_dict(self) -> Dict:
        return {
            "location": self.location,
            "event_type": self.event_type,
            "severity": self.severity,
            "affected_route": self.affected_route,
            "risk_score": self.risk_score,
            "text": self.text,
        }


class EventExtractor:
    """Deterministic NLP event extraction with a mock LLM fallback option."""

    def __init__(self, engine: str | None = None):
        self.engine = (engine or get_settings().nlp_engine).lower()
        self.nodes = node_index()

    # ------------------------------------------------------------------
    def _find_location(self, text: str) -> Optional[str]:
        low = text.lower()
        for nid, aliases in NODE_ALIASES.items():
            for a in aliases:
                if a in low:
                    return nid
        return None

    def _classify(self, text: str) -> str:
        low = text.lower()
        for etype, pats in EVENT_TYPE_PATTERNS.items():
            for p in pats:
                if re.search(p, low):
                    return etype
        return "disruption"

    def _severity(self, text: str) -> float:
        low = text.lower()
        sev = 0.5
        for word, val in SEVERITY_WORDS.items():
            if word in low:
                sev = max(sev, val)
        return float(np.clip(sev, 0.1, 1.0))

    def _duration_hint(self, text: str) -> float:
        m = re.search(r"(\d+)\s*(?:day|days|hr|hour)", text.lower())
        if m:
            return float(m.group(1)) * (24.0 if "day" in m.group(1) else 1.0)
        return 0.0

    # ------------------------------------------------------------------
    def extract(self, text: str) -> Optional[ExtractedEvent]:
        loc = self._find_location(text)
        if loc is None:
            return None
        etype = self._classify(text)
        sev = self._severity(text)
        dur = self._duration_hint(text)
        # risk_score grounded in severity, event type and duration
        etype_bonus = {"closure": 0.25, "conflict": 0.20, "strike": 0.15,
                       "congestion": 0.10, "weather": 0.08}.get(etype, 0.0)
        dur_factor = min(dur / 120.0, 0.2)
        risk = float(np.clip(0.45 * sev + etype_bonus + dur_factor, 0.05, 0.99))
        affected = loc in NODE_ALIASES
        return ExtractedEvent(loc, etype, round(sev, 3), affected,
                              round(risk, 3), text, f"{etype}:{loc}")

    def extract_feed(self, df: pd.DataFrame,
                     text_col: str = "headline", loc_col: str = "location") -> pd.DataFrame:
        """Extract from a feed dataframe. The generator's `location` column is
        used as ground truth id where available; extraction text drives type,
        severity and risk."""
        rows = []
        for i, r in df.iterrows():
            text = str(r.get(text_col, "")) or ""
            ev = self.extract(text)
            gt_loc = r.get(loc_col)
            if ev is None and gt_loc:
                # fall back to the known location, deriving the rest from text
                ev = ExtractedEvent(str(gt_loc), self._classify(text) or "disruption",
                                    self._severity(text), True, 0.5, text, "fallback")
            if ev is None:
                continue
            rows.append({
                **ev.to_dict(),
                "date": pd.to_datetime(r.get("date")),
                "source": r.get("source", ""),
                "alert_id": r.get("alert_id", ""),
            })
        return pd.DataFrame(rows)

    def mock_llm_events(self, n: int = 8, seed: int = 0) -> List[Dict]:
        """Deterministic mock LLM feed used when no LLM API is available."""
        rng = np.random.default_rng(seed)
        templates = [
            ("Suez Canal congestion backlog of {d} days", "suez", "congestion"),
            ("Severe weather warning Indian Ocean waves {w}m", "indian_ocean", "weather"),
            ("Mumbai port strike risk, operations may halt", "mumbai", "strike"),
            ("Colombo transshipment hub congestion elevated", "colombo", "congestion"),
            ("Customs clearance delays of {d} days reported", "customs", "delay"),
        ]
        out = []
        for _ in range(n):
            tpl, loc, etype = templates[int(rng.integers(0, len(templates)))]
            d = int(rng.integers(1, 10)) if "{d}" in tpl else None
            w = int(rng.integers(3, 9)) if "{w}" in tpl else None
            text = tpl.format(d=d, w=w)
            ev = self.extract(text)
            if ev:
                out.append({**ev.to_dict(), "text": text, "mock": True})
        return out


def alerts_to_features(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate extracted alert features into a per-node daily feature frame.

    These features are fed to the models (conflict_alert_risk, congestion_alert,
    alert_count). This is the mechanism by which NLP affects predictions.
    """
    extractor = EventExtractor()
    events = extractor.extract_feed(df)
    if events.empty:
        return pd.DataFrame(columns=["node_id", "date", "alert_count",
                                     "alert_risk_score", "alert_congestion", "alert_weather", "alert_conflict"])
    events["date"] = pd.to_datetime(events["date"]).dt.normalize()
    g = events.groupby(["location", "date"]).agg(
        alert_count=("risk_score", "size"),
        alert_risk_score=("risk_score", "mean"),
    ).reset_index()
    type_cols = pd.get_dummies(events["event_type"]).groupby(
        [events["location"], events["date"]]).max().reset_index()
    out = g.merge(type_cols, on=["location", "date"], how="left", suffixes=("", "_t"))
    out = out.rename(columns={"location": "node_id"})
    for c in ("congestion", "weather", "conflict", "strike", "closure", "delay", "disruption"):
        if c not in out.columns:
            out[c] = 0
    out["alert_congestion"] = out["congestion"]
    out["alert_weather"] = out["weather"]
    out["alert_conflict"] = out["conflict"]
    return out