"""LLM-powered narrative features for LOGIX.

Every feature here **explains** facts computed by the statistical engine — the
LLM never calculates metrics. Each prompt is built from a compact facts
payload extracted from a prediction, with explicit instructions that only
provided values may be cited and that routes/checkpoints/events must not be
invented.

Panels:
    situation       current-situation brief
    risk            why the risk score is high/low
    recommendations per-card explanations for rule-based recommendations
    eta             ETA distribution interpretation
    deadline        deadline-miss risk explanation
    drivers         SHAP factor attribution explanation
    trend           "what changed" over the trend window
    node            selected checkpoint explanation (map)
    edge            selected segment explanation (map)

All functions return ``None`` when the LLM is not reachable so the UI can
quietly hide the AI panels instead of showing errors.
"""
from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)

from backend.core.llm import get_llm, LLMProvider
from backend.core.graph import topology

PANEL_NAMES = {"situation", "risk", "recommendations", "eta", "deadline",
               "drivers", "trend", "node", "edge"}

_SYSTEM = (
    "You are LOGIX, an AI analyst for a global supply-chain risk platform. "
    "You explain predictions produced by a statistical engine. Use ONLY the "
    "facts provided in the prompt. NEVER present any number, date, percentage, "
    "checkpoint, route, or event that does not appear verbatim in the Facts "
    "block. If a metric is absent, say it is not available — never estimate or "
    "invent it. Write in plain business language. Keep each answer short (under "
    "five sentences) unless asked for more detail. Do not begin with filler "
    "such as 'Here is a summary:' — start directly with the answer."
)


# ---------------------------------------------------------------------------
# Fact extraction (from the prediction payload)
# ---------------------------------------------------------------------------

def _pct(x: Any) -> str:
    try:
        return f"{round(float(x) * 100)}%"
    except (TypeError, ValueError):
        return "n/a"


def _fmt_days(x: Any) -> str:
    try:
        return f"{float(x):.1f} days"
    except (TypeError, ValueError):
        return "n/a"


def _alternative_routes(route_id: str) -> List[Dict[str, str]]:
    return [
        {"route_id": r.route_id, "name": r.name, "description": r.description}
        for r in topology.ROUTES if r.route_id != route_id
    ]


def extract_facts(payload: Optional[Dict]) -> Dict[str, Any]:
    """Facts relevant to any LLM narrative, taken only from the payload."""
    if not payload:
        return {}
    mc = payload.get("monte_carlo") or {}
    nodes: List[Dict] = payload.get("node_predictions") or []
    probs = payload.get("delay_probabilities") or {}

    risky = sorted(
        (n for n in nodes if n.get("node_id") in probs or "delay_probability" in n),
        key=lambda n: n.get("delay_probability", 0.0),
        reverse=True,
    )
    top_risky = [
        {
            "node": n.get("label") or n.get("node_id"),
            "delay_probability": round(n.get("delay_probability", 0.0), 3),
            "expected_delay_hours": round(n.get("expected_delay_hours", 0.0), 1),
            "regime": "disrupted" if n.get("regime") == 1 else "normal",
        }
        for n in risky[:5]
    ]
    disruptions = [
        n.get("label") or n.get("node_id")
        for n in nodes if n.get("regime") == 1
    ]
    critical_raw = payload.get("critical_nodes") or mc.get("critical_nodes") or {}
    if isinstance(critical_raw, dict):
        critical = [
            {"node": k, "delay_share": round(float(v), 3)}
            for k, v in critical_raw.items()
        ]
    else:
        critical = [
            {"node": c.get("label") or c.get("node_id"),
             "delay_share": c.get("delay_share")}
            for c in critical_raw[:5]
        ]

    route_id = payload.get("route_id", "")
    pcts = mc.get("percentiles") or {}
    risk_score = None
    if top_risky:
        risk_score = round(max(c["delay_probability"] for c in top_risky) * 100)
    facts = {
        "shipment_id": payload.get("shipment_id"),
        "origin": payload.get("origin"),
        "destination": payload.get("destination"),
        "current_checkpoint": payload.get("current_checkpoint"),
        "route_id": route_id,
        "route_name": payload.get("route_name"),
        "prediction_date": payload.get("prediction_date"),
        "expected_eta_date": mc.get("expected_eta_date"),
        "expected_days": mc.get("expected_days"),
        "expected_delay_hours": mc.get("expected_delay_hours"),
        "p_miss_deadline": mc.get("p_miss_deadline"),
        "deadline_date": mc.get("deadline_date"),
        "n_simulations": mc.get("n_simulations"),
        "percentiles": {
            k: (round(float(v), 1) if v is not None else None)
            for k, v in pcts.items() if k in ("p10", "p25", "p50", "p80", "p90", "p95")
        },
        "eta_date": {
            k: v for k, v in (mc.get("eta_date") or {}).items() if k in ("p25", "p50", "p90", "p95")
        },
        "risk_score": risk_score,
        "prediction_confidence": payload.get("prediction_confidence"),
        "resilience_score": payload.get("resilience_score"),
        "top_risky_checkpoints": top_risky,
        "critical_checkpoints": critical,
        "active_disruptions": disruptions,
        "alternative_routes": _alternative_routes(route_id),
    }
    return facts


def _facts_json(facts: Dict[str, Any]) -> str:
    return json.dumps(facts, indent=1, ensure_ascii=False, default=str)


# ---------------------------------------------------------------------------
# Panel prompt builders
# ---------------------------------------------------------------------------

def _base_sections(facts: Dict[str, Any]) -> str:
    route_names = ", ".join(
        f"{r['name']} ({r['route_id']})" for r in facts.get("alternative_routes", [])
    )
    sections = [
        "Current position",
        f"{facts.get('current_checkpoint') or 'origin'} (en route {facts.get('route_name')} from "
        f"{facts.get('origin')} to {facts.get('destination')})",
        "Deadline",
        str(facts.get("deadline_date") or "not set"),
        "Expected arrival",
        f"{facts.get('expected_eta_date') or 'n/a'} (~{_fmt_days(facts.get('expected_days'))})",
        "Checkpoints available to cite",
        "; ".join(
            f"{c['node']} ({_pct(c['delay_probability'])} delay, {round(c['expected_delay_hours'], 1)} h expected)"
            for c in (facts.get("top_risky_checkpoints") or [])
        ) or "none",
        "Active disruptions",
        ", ".join(facts.get("active_disruptions") or []) or "none",
        "Alternative routes (do not invent others)",
        route_names or "none available",
    ]
    return "\n".join(f"{k}: {v}" for k, v in zip(sections[0::2], sections[1::2]))


def build_situation(facts: Dict[str, Any]) -> Optional[str]:
    return (
        "Describe the current situation in 3-4 sentences: overall status, the main cause "
        "of risk (cite the top risky checkpoint and any active disruption only if the "
        "Facts contain them), and one forward-looking observation. Reference the "
        "alternative route only as an option. If a fact is absent, say it is not "
        "available.\n\n"
        f"Facts:\n{_facts_json(facts)}"
    )


def build_risk(facts: Dict[str, Any]) -> Optional[str]:
    return (
        "The risk score below is a GIVEN fact computed by the risk engine — do NOT "
        "recalculate it. Explain in 3-4 sentences why the risk is high/low: cite the "
        "worst checkpoint's delay probability and expected delay hours if the Facts "
        "contain them, any disrupted regime, and the business impact on meeting the "
        "required delivery date. If a checkpoint metric or deadline is absent from the "
        "Facts, say it is not available. Close with a suggested next action that uses "
        "only routes from the Facts.\n\n"
        f"Facts:\n{_facts_json(facts)}"
    )


def build_recommendations(facts: Dict[str, Any], recommendations: Sequence[Dict]) -> Optional[str]:
    if not recommendations:
        return None
    items = []
    for i, r in enumerate(recommendations, 1):
        items.append(f"{i}. title={r.get('title')} | why={r.get('why')} | impact={r.get('impact')}")
    return (
        "For each numbered recommendation below write ONE short human explanation "
        "(1-2 sentences) in the same order. Each explanation may cite shipment facts "
        "from the Facts block, must only reference routes listed there, and must not "
        "introduce new recommendations. Output exactly one numbered line per "
        "recommendation (e.g. '1. ...').\n\n"
        f"Recommendations:\n{chr(10).join(items)}\n\n"
        f"Facts:\n{_facts_json(facts)}"
    )


def build_eta(facts: Dict[str, Any]) -> Optional[str]:
    return (
        "Interpret the simulated ETA distribution in plain terms: the most likely "
        "arrival (expected ETA / P50), the conservative P90, the number of simulations, "
        "and what the spread between typical and conservative estimates implies about "
        "uncertainty. Semantic rule: P50 means half of the simulations arrive on or "
        "before that date; P90 means 90% arrive on or before that date. Explain ONLY "
        "the provided values; never modify them.\n\n"
        f"Facts:\n{_facts_json(facts)}"
    )


def build_deadline(facts: Dict[str, Any]) -> Optional[str]:
    return (
        "Explain the simulated deadline-miss probability in plain words for a business "
        "reader: the miss probability, the number of simulations behind it, the expected "
        "arrival versus the required delivery date, and whether the shipment is on "
        "track to meet the deadline. Use ONLY the provided values.\n\n"
        f"Facts:\n{_facts_json(facts)}"
    )


def build_drivers(facts: Dict[str, Any], explanation: Optional[Dict]) -> Optional[str]:
    top = (explanation or {}).get("top_factors") or []
    if not top:
        return None
    rows = "\n".join(
        f"- {f.get('name')}: contribution {f.get('contribution', f.get('value', 0))}"
        for f in top[:6]
    )
    node = explanation.get("node_label") or facts.get("current_checkpoint") or "the riskiest checkpoint"
    return (
        "Interpret the SHAP-style factor contributions for the predicted delay risk at "
        f"{node}. A POSITIVE contribution means the factor INCREASES predicted delay "
        "risk; a NEGATIVE contribution means it DECREASES risk relative to the "
        "baseline; a near-zero contribution means limited influence. Describe each "
        "direction correctly and never claim a factor 'increased risk' when its "
        "contribution is negative. 2-4 sentences.\n\n"
        f"Factors:\n{rows}\n\n"
        f"Facts:\n{_facts_json(facts)}"
    )


def build_trend(facts: Dict[str, Any], trend: Optional[Dict]) -> Optional[str]:
    t = trend or {}
    if not t.get("trend"):
        return None
    return (
        "Explain the risk trend change in business language: how much the risk "
        "score moved between the previous and current analysis, which named drivers "
        "increased, which decreased, and what the trend implies for the next planning "
        "decision. Drivers are GIVEN — do not infer others. 2-3 sentences.\n\n"
        f"Trend:\n{json.dumps(t, ensure_ascii=False, default=str)}\n\n"
        f"Facts:\n{_facts_json(facts)}"
    )


def build_node(facts: Dict[str, Any], node: Optional[Dict]) -> Optional[str]:
    if not node:
        return None
    return (
        "Explain the selected checkpoint in business terms: its current delay "
        "probability and expected delay hours, whether it is under a disrupted regime, "
        "and what effect it has on the remaining route and the final arrival at the "
        "destination. Use ONLY the provided values. 2-3 sentences.\n\n"
        f"Checkpoint:\n{json.dumps(node, ensure_ascii=False, default=str)}\n\n"
        f"Facts:\n{_facts_json(facts)}"
    )


def build_edge(facts: Dict[str, Any], edge: Optional[Dict]) -> Optional[str]:
    if not edge:
        return None
    return (
        "Explain the selected route segment in business terms: its mode, distance, "
        "baseline transit time, and the risk inherited from its source checkpoint "
        "(from the facts). Note how the segment contributes to overall transit time. "
        "2-3 sentences. Use ONLY provided values.\n\n"
        f"Segment:\n{json.dumps(edge, ensure_ascii=False, default=str)}\n\n"
        f"Facts:\n{_facts_json(facts)}"
    )


# ---------------------------------------------------------------------------
# Prompt runner
# ---------------------------------------------------------------------------

def _clean(text: str) -> str:
    text = text.replace("\ufffd", "-")
    text = "\n".join(line.strip() for line in text.splitlines()).strip()
    return text.strip()


def _chat(provider: LLMProvider, prompt: str) -> Optional[str]:
    if not prompt:
        return None
    try:
        return _clean(provider.chat(prompt, system=_SYSTEM))
    except Exception as exc:  # pragma: no cover - depends on local Ollama
        logger.warning("LLM panel failed: %s", exc)
        return None


def explain_panels(
    *,
    prediction: Optional[Dict],
    explanation: Optional[Dict] = None,
    recommendations: Optional[Sequence[Dict]] = None,
    panels: Iterable[str] = ("situation", "risk", "eta", "deadline", "drivers"),
    trend: Optional[Dict] = None,
    node: Optional[Dict] = None,
    edge: Optional[Dict] = None,
) -> Dict[str, Any]:
    """Run the requested panels; every value is an LLM narrative over engine facts.

    Returns ``{"panels": {...}, "node": ..., "meta": {...}}``. When the LLM is
    not reachable, panels are empty and ``meta.available`` is False.
    """
    try:
        provider = get_llm()
        available = provider.is_available()
    except Exception:
        provider = None
        available = False

    meta = {
        "provider": getattr(provider, "_cfg", None).provider if provider and hasattr(provider, "_cfg") else "ollama",
        "model": getattr(getattr(provider, "_cfg", None), "model", "unknown") if provider else "unknown",
        "available": bool(available),
    }
    if not available or provider is None:
        return {"panels": {}, "node": None, "meta": meta}

    facts = extract_facts(prediction)
    requested = {p for p in panels if p in PANEL_NAMES}

    def runner(name: str):
        builders = {
            "situation": lambda: build_situation(facts),
            "risk": lambda: build_risk(facts),
            "recommendations": lambda: build_recommendations(facts, list(recommendations or [])),
            "eta": lambda: build_eta(facts),
            "deadline": lambda: build_deadline(facts),
            "drivers": lambda: build_drivers(facts, explanation),
            "trend": lambda: build_trend(facts, trend),
            "node": lambda: build_node(facts, node),
            "edge": lambda: build_edge(facts, edge),
        }
        return _chat(provider, builders[name]())

    results: Dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = {ex.submit(runner, n): n for n in requested}
        for fut, n in futures.items():
            results[n] = fut.result()

    panels_out = {}
    for n in requested:
        text = results.get(n)
        if text:
            panels_out[n] = text

    rec_text = panels_out.get("recommendations")
    if rec_text:
        panels_out["recommendations_list"] = _parse_numbered(rec_text, len(recommendations or []))

    return {
        "panels": {k: v for k, v in panels_out.items() if k != "recommendations_list"},
        "recommendations_list": panels_out.get("recommendations_list", []),
        "node": panels_out.get("node"),
        "edge": panels_out.get("edge"),
        "meta": meta,
    }


def chat(
    prediction: Optional[Dict],
    question: str,
    history: Optional[Sequence[Dict]] = None,
) -> Optional[str]:
    """Answer a free-form question with the shipment context attached."""
    try:
        provider = get_llm()
        if not provider.is_available():
            return None
    except Exception:
        return None
    facts = extract_facts(prediction)
    system = _SYSTEM + (
        "\n\nThe user is investigating a shipment. Answer their question using the "
        "shipment facts; if the question needs data you do not have, say so and "
        "recommend the relevant dashboard view. Never invent facts."
    )
    parts = [f"Shipment facts:\n{_facts_json(facts)}", f"Question: {question}"]
    prompt = "\n\n".join(parts)
    messages: List[Dict[str, str]] = [{"role": "system", "content": system}]
    for h in (history or [])[-8:]:
        role = "assistant" if h.get("role") in ("assistant", "ai") else "user"
        if h.get("content"):
            messages.append({"role": role, "content": str(h["content"])})
    messages.append({"role": "user", "content": prompt})
    try:
        return _clean(provider.chat_messages(messages))
    except Exception as exc:  # pragma: no cover
        logger.warning("LLM chat failed: %s", exc)
        return None


def report(
    prediction: Optional[Dict],
    explanation: Optional[Dict] = None,
    critical: Optional[Dict] = None,
) -> Optional[Dict]:
    """Generate the full LOGIX Shipment Risk Report (Markdown)."""
    try:
        provider = get_llm()
        if not provider.is_available():
            return None
    except Exception:
        return None
    facts = extract_facts(prediction)
    extras: Dict[str, Any] = {}
    top = (explanation or {}).get("top_factors") or []
    if top:
        extras["top_risk_drivers"] = [
            {"factor": f.get("name"), "contribution": f.get("contribution", f.get("value", 0))}
            for f in top[:6]
        ]
    if critical:
        extras["critical_checkpoints"] = critical.get("critical_nodes")
    facts.update(extras)

    prompt = (
        "Write a complete LOGIX Shipment Risk Report in Markdown using ONLY the "
        "shipment facts. Include these sections: 1) Executive Summary (3-4 sentences), "
        "2) Current Shipment Status, 3) ETA and Deadline Risk, 4) Top Risk Drivers, "
        "5) Critical Checkpoints, 6) Alternative Route Analysis (only routes in the "
        "facts), 7) Recommended Actions, 8) Key Data Timestamps. Keep numbers exactly "
        "as given. Do not invent routes, checkpoints or probabilities."
        f"\n\nFacts:\n{_facts_json(facts)}"
    )
    try:
        idx = provider.chat(prompt, system=_SYSTEM)
    except Exception as exc:  # pragma: no cover
        logger.warning("LLM report failed: %s", exc)
        return None
    if not idx:
        return None
    title = f"LOGIX Shipment Risk Report — {facts.get('shipment_id') or 'Shipment'}"
    return {"title": title, "markdown": idx}


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_numbered(text: str, expected: int) -> List[str]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    out: List[str] = []
    for ln in lines:
        rest = ln
        if rest[0].isdigit():
            rest = rest.split(".", 1)[-1].strip()
            if not rest.startswith(" ") and rest:
                out.append(rest)
                continue
        out.append(rest)
    out = out[:expected] if expected else out
    return out + [""] * (expected - len(out))