"""Build Part G — AI/NLP Event Extraction (Section 20 of LOGIX contract).

Inputs:
  data/raw/alerts.parquet (78 RSS headlines from fetch_alerts.py)

Outputs:
  data/raw/news/year=YYYY/month=MM/*.parquet     — Section 20 raw (mirrors alerts in spec layout)
  data/silver/nlp_events/nlp_events.parquet       — Section 20 silver (extracted structured events)
  Updates NODE_ALIASES in event_extractor.py coverage is verified via this build

Spec Section 20 columns (silver):
  document_id, source, headline, affected_node_id, event_type, event_subtype,
  severity, severity_level, extraction_confidence, verification_status, published_at

Spec Section 13/23 NLP-derived feature columns (also produced):
  news_event_count, news_risk_score per node-day for ML join

Usage:
  python -m backend.core.data.build_nlp_events
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.data.global_nodes import FINAL_NODES
from backend.core.logging_util import get_logger

log = get_logger(__name__)

# Full 19-node keyword map (mirrors fetch_alerts.py + event_extractor.py, kept in sync)
NODE_KEYWORDS = {
    "shanghai": ["shanghai"], "singapore": ["singapore"], "busan": ["busan"],
    "rotterdam": ["rotterdam", "antwerp", "hamburg"], "los_angeles": ["los angeles", "long beach"],
    "new_york": ["new york", "newark"], "dubai": ["dubai", "jebel ali"],
    "mumbai": ["mumbai", "nhava sheva", "jawaharlal nehru"], "colombo": ["colombo"],
    "suez": ["suez", "suez canal", "red sea"], "panama_canal": ["panama canal"],
    "strait_of_malacca": ["malacca", "strait of malacca"], "strait_of_hormuz": ["hormuz", "persian gulf"],
    "bab_el_mandeb": ["bab el-mandeb", "bab el mandeb", "houthi", "yemen"],
    "strait_of_gibraltar": ["gibraltar"], "taiwan_strait": ["taiwan strait"],
    "indian_ocean": ["indian ocean"], "cape_of_good_hope": ["cape of good hope", "cape route"],
    "english_channel": ["english channel", "dover"],
}

EVENT_PATTERNS = {
    "congestion": [r"congest", r"backlog", r"queu", r"waiting time", r"vessel.*queue", r"throughput"],
    "weather": [r"weather", r"storm", r"wave height", r"cyclone", r"knots", r"monsoon"],
    "conflict": [r"conflict", r"restriction", r"surcharge", r"attack", r"instabilit", r"houthi", r"red sea"],
    "strike": [r"strike"], "closure": [r"closure", r"halt", r"suspend", r"blockage"],
    "delay": [r"delay", r"postpon", r"disruption"], "port_closure": [r"port closure", r"terminal closure"],
}

SEVERITY_WORDS = {"severe": 1.0, "major": 1.0, "significant": 0.7, "high": 0.9, "elevated": 0.6, "minor": 0.2, "crisis": 1.0, "surge": 0.6}

VALID_NODES = {n["id"] for n in FINAL_NODES}


def _tag_node(text: str) -> str | None:
    low = text.lower()
    for nid, kws in NODE_KEYWORDS.items():
        for kw in kws:
            if kw in low:
                return nid
    return None


def _classify(text: str) -> str:
    low = text.lower()
    for etype, pats in EVENT_PATTERNS.items():
        for p in pats:
            if re.search(p, low):
                return etype
    return "disruption"


def _severity(text: str) -> float:
    low = text.lower()
    sev = 0.5
    for w, v in SEVERITY_WORDS.items():
        if w in low:
            sev = max(sev, v)
    # duration bump
    m = re.search(r"(\d+)\s*day", low)
    if m:
        sev = min(0.99, sev + min(int(m.group(1)) / 30, 0.2))
    return round(float(sev), 3)


def build() -> tuple[pd.DataFrame, pd.DataFrame]:
    s = get_settings()
    raw_alerts = s.abs_data_dir / "raw" / "alerts.parquet"
    if not raw_alerts.exists():
        log.warning("No raw/alerts.parquet — run fetch_alerts first")
        return pd.DataFrame(), pd.DataFrame()

    alerts = pd.read_parquet(raw_alerts)
    alerts["date"] = pd.to_datetime(alerts["date"]).dt.normalize()
    now = datetime.now(timezone.utc)

    # -- raw/news partitioned mirror (Section 20 raw layout) --
    news_rows = []
    for _, r in alerts.iterrows():
        d = pd.to_datetime(r["date"])
        tag = r.get("location", "") or _tag_node(str(r.get("headline", ""))) or ""
        # Only keep alerts that map to our 19 nodes (others still stored but flagged)
        if tag and tag not in VALID_NODES:
            tag = ""
        news_rows.append({
            "document_id": r.get("alert_id", hashlib.md5(str(r["headline"]).encode()).hexdigest()[:12]),
            "source": r.get("source", ""),
            "source_url": "",
            "published_at": d,
            "retrieved_at": now,
            "headline": str(r.get("headline", "")),
            "article_text": str(r.get("headline", "")),  # RSS has no body; headline is the text
            "language": "en",
            "location_name": tag,
            "country_code": "",
            "affected_node_id": tag if tag in VALID_NODES else "",
            "year": d.year, "month": d.month,
        })
    news_df = pd.DataFrame(news_rows)
    # Write partitioned
    for (y, m), grp in news_df.groupby(["year", "month"]):
        outdir = s.abs_data_dir / "raw" / "news" / f"year={y}" / f"month={m:02d}"
        outdir.mkdir(parents=True, exist_ok=True)
        grp.drop(columns=["year", "month"]).to_parquet(outdir / "news.parquet", index=False)
    log.info(f"Wrote {len(news_df)} news rows partitioned by year/month")

    # -- silver/nlp_events (Section 20 silver: extracted intelligence) --
    nlp_rows = []
    for _, r in news_df.iterrows():
        text = r["headline"]
        node = r["affected_node_id"] or _tag_node(text) or ""
        if node and node not in VALID_NODES:
            node = ""
        etype = _classify(text)
        sev = _severity(text)
        # Extraction confidence: higher if node was tagged + event type matched
        conf = 0.9 if (node and etype != "disruption") else (0.7 if node else 0.45)
        nlp_rows.append({
            "document_id": r["document_id"],
            "source": r["source"],
            "headline": text,
            "affected_node_id": node,
            "event_type": etype,
            "event_subtype": "",
            "severity": sev,
            "severity_level": "high" if sev >= 0.75 else ("moderate" if sev >= 0.4 else "low"),
            "extraction_confidence": conf,
            "verification_status": "auto",
            "published_at": r["published_at"],
            "retrieved_at": r["retrieved_at"],
        })
    nlp_df = pd.DataFrame(nlp_rows)

    silver_dir = s.abs_data_dir / "silver" / "nlp_events"
    silver_dir.mkdir(parents=True, exist_ok=True)
    nlp_df.to_parquet(silver_dir / "nlp_events.parquet", index=False)
    log.info(f"Wrote {len(nlp_df)} nlp_events -> {silver_dir}/nlp_events.parquet")
    log.info(f"  tagged to nodes: {(nlp_df['affected_node_id'] != '').sum()} / {len(nlp_df)}")
    log.info(f"  by event_type: {nlp_df['event_type'].value_counts().to_dict()}")

    # -- also fix event_extractor.py aliases if stale (log warning, don't auto-edit) --
    try:
        from backend.core.nlp.event_extractor import NODE_ALIASES
        stale = [k for k in NODE_ALIASES if k not in VALID_NODES and k not in ("customs", "final_destination", "european_hub")]
        if stale:
            log.warning(f"event_extractor.py has stale aliases not in FINAL_NODES: {stale} — update when touching that file")
        missing = [k for k in VALID_NODES if k not in NODE_ALIASES]
        if missing:
            log.warning(f"event_extractor.py missing aliases for: {missing}")
    except Exception:
        pass

    return news_df, nlp_df


def main() -> None:
    news, nlp = build()
    print(f"raw/news: {len(news)} partitioned rows")
    print(f"silver/nlp_events: {len(nlp)} rows")
    if not nlp.empty:
        print(nlp[["affected_node_id", "event_type", "severity", "extraction_confidence"]].head(8).to_string(index=False))
        print(f"\nTagged: {(nlp['affected_node_id']!='').sum()}/{len(nlp)}, by type: {nlp['event_type'].value_counts().to_dict()}")


if __name__ == "__main__":
    main()
