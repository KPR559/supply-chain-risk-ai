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
  canal: "Canal",
  sea: "Open Sea",
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
