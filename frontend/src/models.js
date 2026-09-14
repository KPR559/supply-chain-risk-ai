// Typed data shapes (JSDoc) + safe formatting helpers for dashboard views.
//
// The backend has no 0–100 risk score, no trend series, and no tracking feed,
// so anything derived on the frontend is computed here, in one place, with
// explicit fallbacks. Never render undefined/null/NaN — use the `na()` value.
//
// Thresholds mirror the backend/app convention (riskClass: 0.35 / 0.6):
//   prob < 0.35 → Low · 0.35–0.6 → Medium · ≥ 0.6 → High
// "Critical" is an escalation of High when a disrupted regime is present or
// the deadline-miss probability reaches the will-likely-miss band (≥ 0.6).

/**
 * @typedef {Object} Checkpoint
 * @property {string} node_id
 * @property {string} [label]
 * @property {string} [kind]
 * @property {number} [delay_probability]
 * @property {number} [expected_delay_hours]
 * @property {number} [p50] @property {number} [p80] @property {number} [p90]
 * @property {number} [congestion] @property {number} [weather] @property {number} [conflict]
 * @property {number} [regime]  // 1 = disrupted, 0 = stable
 */

/**
 * @typedef {Object} MonteCarlo
 * @property {number} [expected_days]
 * @property {number} [expected_delay_hours]
 * @property {string} [expected_eta_date]  // YYYY-MM-DD
 * @property {Object} [percentiles]        // p10..p95 in days
 * @property {Object} [eta_date]           // p10..p95 as YYYY-MM-DD
 * @property {number} [p_miss_deadline]
 * @property {string} [deadline_date]
 * @property {number} [n_simulations]
 */

/**
 * @typedef {Object} Recommendation
 * @property {"high"|"medium"|"low"} priority
 * @property {string} title
 * @property {string} why
 * @property {string} impact
 * @property {string} actionLabel
 * @property {string} target  // view id for onNavigate
 */

export const NA = "—";
export const NA_TEXT = "Not available";

/** 0..1 → "64%". Nullish/NaN → "—". */
export function fmtPct(x) {
  const n = Number(x);
  if (x == null || Number.isNaN(n)) return NA;
  return `${Math.round(n * 100)}%`;
}

/** Hours → "+2.4 days". Nullish → "—". */
export function fmtDelayDays(hours) {
  if (hours == null || Number.isNaN(Number(hours))) return NA;
  const d = Number(hours) / 24;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)} days`;
}

/** Days → "38.5 days". Nullish → "—". */
export function fmtDays(v) {
  if (v == null || Number.isNaN(Number(v))) return NA;
  return `${Number(v).toFixed(1)} days`;
}

/** Percentile key "p10" → "P10", "p90" → "P90". */
export function formatPercentileLabel(key) {
  const k = String(key || "").replace(/^p/i, "");
  return `P${k || "—"}`;
}

/**
 * Deadline-miss risk tier. Suggested frontend thresholds (0.2 / 0.5 / 0.8)
 * with a Critical tier at ≥80%.
 * @returns {{ label: string, cls: "low"|"med"|"high"|"critical" }}
 */
export function getDeadlineRiskLevel(miss) {
  const m = Number(miss);
  if (!Number.isFinite(m)) return { label: "On track", cls: "low" };
  if (m >= 0.8) return { label: "Will likely miss", cls: "critical" };
  if (m >= 0.5) return { label: "High risk", cls: "high" };
  if (m >= 0.2) return { label: "At risk", cls: "med" };
  return { label: "On track", cls: "low" };
}

/**
 * Arrival buffer (days) → display label + styling.
 * Positive → green "+N days" · zero → amber "No buffer" · negative → red "N days overdue".
 * @returns {{ cls: ""|"low"|"med"|"high", label: string }}
 */
export function getBufferStatus(buffer) {
  const n = Number(buffer);
  if (buffer == null || Number.isNaN(n)) return { cls: "", label: NA };
  if (n < 0) return { cls: "high", label: `${Math.abs(n)} days overdue` };
  if (n === 0) return { cls: "med", label: "No buffer" };
  return { cls: "low", label: `+${n} days buffer` };
}

/** Whole days between two YYYY-MM-DD dates. Nullish/invalid → null. */
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(a + "T00:00:00") - new Date(b + "T00:00:00");
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86400000);
}

/**
 * Shipment-level risk derived from the highest checkpoint delay probability.
 * Backend thresholds preserved; Critical is an escalation, not a 4th band.
 * @returns {{ score: number, band: "low"|"medium"|"high"|"critical", label: string, escalated: boolean }}
 */
export function riskBand(nodes, mc) {
  const list = nodes || [];
  const maxProb = list.length ? Math.max(...list.map((n) => n.delay_probability ?? 0)) : 0;
  const disrupted = list.some((n) => n.regime === 1);
  const miss = mc?.p_miss_deadline ?? 0;
  let band = maxProb >= 0.6 ? "high" : maxProb >= 0.35 ? "medium" : "low";
  let escalated = false;
  if (band === "high" && (disrupted || miss >= 0.6)) {
    band = "critical";
    escalated = true;
  }
  const label = { low: "Low", medium: "Medium", high: "High", critical: "Critical" }[band];
  return { score: Math.round(maxProb * 100), band, label, escalated };
}

/** Deadline verdict bands (same 0.35/0.6 cutoffs as the ETA view). */
export function missVerdict(miss, hasDeadline) {
  if (!hasDeadline) return { label: "No deadline set", cls: "" };
  if (miss >= 0.6) return { label: "Will likely miss", cls: "high" };
  if (miss >= 0.35) return { label: "At risk", cls: "med" };
  return { label: "On track", cls: "low" };
}

/**
 * Plain-language main reason for the current risk picture.
 * Priority: live disruption → dominant critical node → top SHAP driver →
 * worst checkpoint → balanced profile. Rule-based sentences only — no
 * invented causes; every clause names data present in the payload.
 */
export function overallReason({ prediction, explanation, critical }) {
  const nodes = prediction?.node_predictions || [];
  const disrupted = nodes.filter((n) => n.regime === 1);
  if (disrupted.length > 0) {
    const names = disrupted.map((n) => n.label || n.node_id).join(", ");
    return `Primary risk is driven by active disruption at ${names}.`;
  }
  const topCrit = (critical?.critical_nodes || [])[0];
  if (topCrit) {
    return `Primary risk is concentrated at ${topCrit.label || topCrit.node_id}, which carries the largest share of total expected delay.`;
  }
  const topFactor = (explanation?.top_factors || [])[0];
  if (topFactor && topFactor.contribution > 0) {
    const at = explanation.node_label || explanation.node_id;
    return `Primary risk is driven by ${describeFactor(topFactor.name).label.toLowerCase()}${at ? ` at ${at}` : ""}.`;
  }
  const worst = [...nodes].sort((a, b) => (b.delay_probability ?? 0) - (a.delay_probability ?? 0))[0];
  if (worst && (worst.delay_probability ?? 0) >= 0.35) {
    return `Primary risk is elevated delay probability at ${worst.label || worst.node_id}.`;
  }
  return "No dominant risk driver — the profile looks balanced.";
}

/**
 * Compact "current situation" brief: verdict sentence + exposure sentence.
 * Purely rule-based over live data.
 */
export function situationSummary({ prediction, critical, selectedShipment }) {
  const mc = prediction?.monte_carlo;
  const nodes = prediction?.node_predictions || [];
  const miss = mc?.p_miss_deadline ?? 0;
  const hasDeadline = mc?.deadline_date != null;
  const id = selectedShipment?.id || prediction?.shipment_id || "This shipment";
  const verdict = !hasDeadline
    ? `${id} has no customer deadline set, so deadline risk cannot be assessed.`
    : miss >= 0.6
      ? `${id} is at critical risk of missing the customer deadline.`
      : miss >= 0.35
        ? `${id} is at risk of missing the customer deadline.`
        : `${id} is currently on track for the customer deadline.`;
  const exposures = (critical?.critical_nodes || [])
    .slice(0, 3)
    .map((c) => c.label || c.node_id);
  const pool = exposures.length
    ? exposures
    : [...nodes].sort((a, b) => (b.delay_probability ?? 0) - (a.delay_probability ?? 0))
      .slice(0, 3).map((n) => n.label || n.node_id);
  const exposure = pool.length
    ? `The largest risk exposure is concentrated around ${pool.join(", ")}.`
    : "No checkpoint stands out in the risk profile.";
  return `${verdict} ${exposure}`;
}

// Friendly display names for model feature names. Raw names are kept in
// `title` tooltips for debugging; the UI shows `label` + `hint`.
const FACTOR_GROUPS = [
  { match: /^(base|baseline.*)$/, label: "Baseline route risk", hint: "The route's inherent delay tendency." },
  { match: /^regime/, label: "Active disruption regime", hint: "Current disruption conditions are increasing delay exposure." },
  { match: /^conflict/, label: "Geopolitical disruption risk", hint: "Geopolitical tension near the corridor is elevating risk." },
  { match: /^weather/, label: "Weather conditions", hint: "Adverse weather patterns are slowing transit." },
  { match: /^(congestion|port_congestion)/, label: "Port congestion", hint: "Port crowding is adding dwell time." },
  { match: /^customs/, label: "Customs clearance risk", hint: "Clearance workload and timing are adding delay." },
  { match: /^(delay_|historical_delay)/, label: "Historical delay pattern", hint: "Past delays on this leg predict further slippage." },
  { match: /season|month|day_of|week_of|holiday/, label: "Seasonal timing effect", hint: "Calendar effects such as season, weekday or holidays." },
  { match: /^capacity/, label: "Capacity constraints", hint: "Limited capacity is constraining throughput." },
];

function prettify(name) {
  return String(name).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** @returns {{ label: string, hint: string, raw: string }} */
export function describeFactor(name) {
  const raw = String(name || "unknown");
  const group = FACTOR_GROUPS.find((g) => g.match.test(raw));
  if (group) return { label: group.label, hint: group.hint, raw };
  return { label: prettify(raw), hint: "Model-estimated contribution to delay probability.", raw };
}

const KIND_LABELS = {
  origin: "Origin",
  warehouse: "Hub",
  hub: "Hub",
  canal: "Canal",
  sea: "Open Sea",
  ocean: "Open Sea",
  transshipment: "Transshipment",
  port: "Port",
  customs: "Customs",
  destination: "Final Destination",
};

/** Human label for a checkpoint kind string. */
export function kindLabel(kind) {
  return KIND_LABELS[kind] || (kind ? prettify(kind) : "Checkpoint");
}

/**
 * Four-tier risk level for checkpoint display. Backend cutoffs (0.35 / 0.6)
 * preserved; ≥0.8 adds a Critical tier for visual emphasis only.
 * @returns {{ label: "Low Risk"|"Medium Risk"|"High Risk"|"Critical Risk", cls: "low"|"med"|"high", critical: boolean }}
 */
export function getRiskLevel(prob) {
  const p = Number(prob);
  if (!Number.isFinite(p)) return { label: "Low Risk", cls: "low", critical: false };
  if (p >= 0.8) return { label: "Critical Risk", cls: "high", critical: true };
  if (p >= 0.6) return { label: "High Risk", cls: "high", critical: false };
  if (p >= 0.35) return { label: "Medium Risk", cls: "med", critical: false };
  return { label: "Low Risk", cls: "low", critical: false };
}

/** Backwards-compatible pill class for a delay probability. */
export function getRiskColor(prob) {
  return getRiskLevel(prob).cls;
}

/** Hours → "79.6 h". Nullish/NaN → "-". */
export function formatHours(h) {
  if (h == null || Number.isNaN(Number(h))) return "-";
  return `${Number(h).toFixed(1)} h`;
}

/** Regime → "disrupted" | "normal" | "unknown". */
export function getRegimeLabel(regime) {
  if (regime === 1) return "disrupted";
  if (regime === 0) return "normal";
  return "unknown";
}

/** Checkpoint operational status from risk + regime signals. */
export function getStatusLabel(node) {
  if (!node) return "Unknown";
  if (node.regime === 1) return "Disrupted";
  if ((node.delay_probability ?? 0) >= 0.8) return "Delayed";
  if ((node.expected_delay_hours ?? 0) > 24) return "Delayed";
  return "On Time";
}

/** Status badge class for shipment registry statuses. */
export function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("deliver")) return "low";
  if (s.includes("delay") || s.includes("disrupt")) return "high";
  if (s.includes("customs") || s.includes("hold") || s.includes("risk")) return "med";
  return "";
}

/**
 * Checkpoint kinds for the demo corridor, keyed by node id. node_predictions
 * do not always carry a "kind" field; the corridor topology defines these, so
 * this map fills the gap so the Kind column never renders an unexplained "-".
 */
const NODE_KIND_BY_ID = {
  frankfurt: "origin",
  european_hub: "hub",
  suez: "canal",
  cape_of_good_hope: "ocean",
  indian_ocean: "ocean",
  colombo: "port",
  dubai: "port",
  mumbai: "port",
  customs: "customs",
  final_destination: "destination",
};

/**
 * Checkpoint kind for display. Prefers the backend-reported node.kind, falls
 * back to the corridor topology by node id, then to a neutral "checkpoint"
 * placeholder — never "-".
 */
export function getCheckpointKind(node) {
  if (node?.kind) return node.kind;
  if (!node) return "checkpoint";
  return NODE_KIND_BY_ID[node.node_id] || "checkpoint";
}

/**
 * Risk tier for the Checkpoint Risk risk badge.
 * 0–10% Low · 10–30% Moderate · 30–70% High · >70% Critical.
 * @returns {{ label: "Low Risk"|"Moderate Risk"|"High Risk"|"Critical Risk", cls: "low"|"med"|"high"|"critical", critical: boolean }}
 */
export function getCheckpointRiskLevel(prob) {
  const p = Number(prob);
  if (!Number.isFinite(p)) return { label: "Low Risk", cls: "low", critical: false };
  if (p > 0.7) return { label: "Critical Risk", cls: "critical", critical: true };
  if (p > 0.3) return { label: "High Risk", cls: "high", critical: false };
  if (p > 0.1) return { label: "Moderate Risk", cls: "med", critical: false };
  return { label: "Low Risk", cls: "low", critical: false };
}

/** Checkpoint status badge label + pill tone from regime + risk tier. */
export function getCheckpointStatus(node) {
  const level = getCheckpointRiskLevel(node?.delay_probability);
  if (node?.regime === 1) {
    return level.critical
      ? { label: "Critical", tone: "critical" }
      : { label: "Disrupted", tone: "high" };
  }
  if (level.critical || level.cls === "high") return { label: "Elevated", tone: "med" };
  if ((node?.expected_delay_hours ?? 0) > 12) return { label: "Elevated", tone: "med" };
  return { label: "On Time", tone: "low" };
}

/** Hours → compact duration with unit: "79.6 h" or "3.3 days". Nullish → "—". */
export function fmtDelayDuration(hours) {
  if (hours == null || Number.isNaN(Number(hours))) return NA;
  const h = Number(hours);
  return h < 24 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`;
}

/** Main risk drivers derived from the per-node monitoring signals. */
export function getCheckpointDrivers(node) {
  const drivers = [];
  if (!node) return ["Contribution within model norms"];
  if (node.regime === 1) drivers.push("Active disruption regime");
  if ((node.congestion ?? 0) >= 0.3) drivers.push("Elevated congestion level");
  if ((node.weather ?? 0) >= 0.3) drivers.push("Severe weather exposure");
  if ((node.conflict ?? 0) >= 0.3) drivers.push("Geopolitical / conflict risk");
  if ((node.delay_probability ?? 0) > 0.7) drivers.push("Very high delay probability");
  if ((node.expected_delay_hours ?? 0) > 24) drivers.push("Long expected queue time");
  return drivers.length ? drivers : ["Contribution within model norms"];
}

/** Suggested mitigation for a checkpoint, chosen from its kind. */
export function getCheckpointMitigation(node) {
  const map = {
    canal: "Consider alternative routing (e.g. Cape of Good Hope) during high-risk windows and pre-clear transit slots.",
    port: "Engage the local port agent, pre-book berthing, and monitor dwell-time windows to cut turnaround.",
    customs: "Pre-submit clearance documentation and parallelize inspections to compress customs dwell.",
    ocean: "Track weather windows and adjust sailing speed dynamically to absorb sea-leg variability.",
    destination: "Coordinate last-mile delivery windows with the consignee and buffer local storage.",
    origin: "Add buffer inventory before departure and confirm trucking capacity early.",
    hub: "Gate shipments through this hub in priority order and monitor transshipment buffers.",
    checkpoint: "Monitor checkpoint indicators and review contingency plans for this leg.",
  };
  return map[getCheckpointKind(node)] || map.checkpoint;
}
