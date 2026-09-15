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
// Exact per-feature display names. Checked FIRST in describeFactor, so each
// model feature gets its own label + meaning instead of a group bucket.
// (Covers all 84 trained features: 73 numeric + 11 one-hot flags.)
const FACTOR_DETAILS = {
  // ---- historical delay: what past delays say about this leg ----
  delay_lag_1: { label: "Yesterday's delay", hint: "Delay recorded at this checkpoint yesterday — delays persist day to day." },
  delay_lag_3: { label: "Delay 3 days ago", hint: "Delay recorded at this checkpoint 3 days ago." },
  delay_lag_7: { label: "Delay a week ago", hint: "Delay recorded at this checkpoint 7 days ago — weekly persistence." },
  delay_lag_14: { label: "Delay 2 weeks ago", hint: "Delay recorded at this checkpoint 14 days ago." },
  delay_ewma: { label: "Delay trend (2-week average)", hint: "Exponentially weighted average of recent delays — rising means conditions are deteriorating." },
  delay_roll_mean_7d: { label: "7-day average delay", hint: "Mean delay over the trailing 7 days (past only, no leakage)." },
  delay_roll_mean_30d: { label: "30-day average delay", hint: "Mean delay over the trailing 30 days — the leg's current norm." },
  delay_roll_mean_90d: { label: "90-day average delay", hint: "Mean delay over the trailing quarter — structural slowness of this leg." },
  delay_roll_mean_365d: { label: "Yearly average delay", hint: "Mean delay over the trailing year — long-run baseline for this checkpoint." },
  delay_roll_std_7d: { label: "Delay volatility (7 days)", hint: "How erratic delays were this week — high volatility means unpredictable arrivals." },
  delay_roll_std_30d: { label: "Delay volatility (30 days)", hint: "Month-scale spread of delays — wide spread widens the ETA range." },
  delay_roll_std_90d: { label: "Delay volatility (quarter)", hint: "Quarter-scale spread of delays." },
  delay_roll_std_365d: { label: "Delay volatility (year)", hint: "Year-scale spread of delays." },
  delay_frequency_30d: { label: "How often delayed (30 days)", hint: "Share of days this leg was delayed in the last month." },
  delay_frequency_90d: { label: "How often delayed (quarter)", hint: "Share of days this leg was delayed in the last quarter." },
  delay_anomaly: { label: "Delay surprise score", hint: "How surprising today's delay is versus its 30-day history (rolling z-score)." },
  baseline_90d: { label: "90-day delay baseline", hint: "Reference delay level for this checkpoint over 90 days." },
  // ---- regime / disruption state ----
  regime_disrupted: { label: "Active disruption regime", hint: "Anomaly detectors agree this checkpoint is currently disrupted." },
  regime_cusum: { label: "Sudden regime shift (CUSUM)", hint: "Cumulative-sum detector flagged an abrupt level shift in delays." },
  regime_iso: { label: "Anomalous pattern (Isolation Forest)", hint: "This checkpoint's risk profile looks unlike its normal behaviour." },
  regime_roll_z: { label: "Delay surprise (z-score)", hint: "Today's delay measured in standard deviations above its rolling norm." },
  regime_days_adj: { label: "Disrupted days this week", hint: "Count of disrupted days in the trailing 7 days." },
  regime_duration_days: { label: "Days in current regime", hint: "How long the current normal/disruption/recovery state has lasted." },
  change_point_flag: { label: "Regime change-point", hint: "A statistical change-point fired — operating conditions just shifted." },
  // ---- congestion / port pressure ----
  congestion_index: { label: "Port congestion now", hint: "Current congestion level at this checkpoint (0 clear → 1 gridlocked)." },
  congestion_percentile: { label: "Congestion vs history", hint: "Where today's congestion sits against the last 120 days." },
  congestion_trend: { label: "Congestion trend", hint: "Whether congestion has been building or easing over 2 weeks." },
  congestion_anomaly: { label: "Congestion spike", hint: "Today's congestion minus its 90-day baseline — a spike adds dwell time." },
  congestion_baseline: { label: "Usual congestion", hint: "90-day average congestion — the norm this reading is judged against." },
  port_pressure_index: { label: "Port pressure index", hint: "Composite load across vessels, berths and yard at this port." },
  activity_7d_avg: { label: "Port activity (7 days)", hint: "Average vessel/port activity this week." },
  activity_30d_avg: { label: "Port activity (30 days)", hint: "Average vessel/port activity this month." },
  activity_zscore: { label: "Activity anomaly", hint: "Unusual port activity versus its norm — surges strain capacity." },
  operational_risk_score: { label: "Operational risk", hint: "Composite operational strain (activity + pressure) at this checkpoint." },
  // ---- weather ----
  weather_severity: { label: "Weather severity now", hint: "Current sea/weather severity at this checkpoint (0 calm → 1 severe)." },
  weather_extreme: { label: "Extreme weather flag", hint: "Severity crossed the extreme threshold — storms-grade disruption." },
  weather_trend: { label: "Weather trend", hint: "Whether conditions have been worsening over the past week." },
  weather_mean_7d: { label: "Weather this week", hint: "Average severity over the trailing 7 days." },
  wind_speed_7d_avg: { label: "Wind (7-day average)", hint: "Sustained winds slow vessels and port handling." },
  precipitation_7d_sum: { label: "Rainfall (7-day total)", hint: "Accumulated rain — flooding and low visibility delay legs." },
  weather_anomaly_score: { label: "Weather anomaly", hint: "How unusual current weather is for this checkpoint and date." },
  extreme_weather_flag: { label: "Extreme weather event", hint: "A named/severe weather event is affecting this leg." },
  // ---- customs ----
  customs_workload: { label: "Customs workload", hint: "Pending clearance volume at this checkpoint today." },
  customs_weekday_effect: { label: "Customs weekday effect", hint: "Weekend/Monday staffing patterns that slow clearance." },
  customs_workload_7d: { label: "Customs backlog trend", hint: "Average workload over 7 days — a growing backlog compounds." },
  customs_risk: { label: "Customs risk (composite)", hint: "Workload + backlog + holiday effects combined." },
  // ---- geopolitical / events ----
  conflict_risk_score: { label: "Conflict risk", hint: "Armed-conflict exposure near this checkpoint (ACLED-style signal)." },
  conflict_trend: { label: "Conflict trend", hint: "Whether regional tension has been rising over 2 weeks." },
  conflict_recency: { label: "Recent conflict activity", hint: "How recently conflict events occurred near this corridor." },
  geopolitical_risk: { label: "Geopolitical risk", hint: "Sanctions, unrest and route-threat exposure on this leg." },
  event_presence: { label: "Live disruption event", hint: "A documented real-world event (strike, closure, storm) is active here." },
  event_severity: { label: "Event severity", hint: "How severe the active documented event is (0–1)." },
  disruption_flag: { label: "Disruption declared", hint: "An active disruption has been declared at this checkpoint." },
  major_disruption_flag: { label: "Major disruption", hint: "A severe, corridor-level disruption (e.g. canal blockage) is active." },
  // ---- calendar / seasonality ----
  month: { label: "Month of year", hint: "Seasonal shipping patterns tied to the calendar month." },
  day_of_week: { label: "Day of week", hint: "Weekday/weekend operating rhythm at ports and customs." },
  day_of_year: { label: "Day of year", hint: "Position in the annual cycle — peak vs off-peak season." },
  week_of_year: { label: "Week of year", hint: "Week number — captures holiday and peak-season weeks." },
  season_quarter: { label: "Season (quarter)", hint: "Which quarter — monsoon, winter-storm and peak-season effects." },
  fourier_sin_1: { label: "Annual cycle (sine)", hint: "Yearly seasonality wave — models repeating annual delay rhythms." },
  fourier_cos_1: { label: "Annual cycle (cosine)", hint: "Yearly seasonality wave — models repeating annual delay rhythms." },
  fourier_sin_2: { label: "Half-year cycle (sine)", hint: "Twice-yearly rhythm such as monsoon/peak-season pairs." },
  fourier_cos_2: { label: "Half-year cycle (cosine)", hint: "Twice-yearly rhythm such as monsoon/peak-season pairs." },
  fourier_sin_3: { label: "Quarterly cycle (sine)", hint: "Quarterly rhythm in shipping demand and weather." },
  fourier_cos_3: { label: "Quarterly cycle (cosine)", hint: "Quarterly rhythm in shipping demand and weather." },
  is_holiday: { label: "Public holiday", hint: "A public holiday is reducing staffing and throughput today." },
  days_to_holiday: { label: "Days to next holiday", hint: "Pre-holiday rush builds congestion before the break." },
  days_since_holiday: { label: "Days since holiday", hint: "Post-holiday backlog still clearing through the system." },
  holiday_period_flag: { label: "Holiday period", hint: "Today falls inside an extended holiday shutdown window." },
  // ---- route / checkpoint context ----
  latitude: { label: "Checkpoint latitude", hint: "Geographic position — lets the model learn region-specific behaviour." },
  longitude: { label: "Checkpoint longitude", hint: "Geographic position — lets the model learn region-specific behaviour." },
  out_degree: { label: "Onward connections", hint: "Number of downstream legs — more options means easier rerouting." },
  in_degree: { label: "Inbound connections", hint: "Number of upstream legs feeding this checkpoint." },
  checkpoint_type_port: { label: "Checkpoint is a seaport", hint: "Seaports face berth, yard and customs delays." },
  checkpoint_type_sea: { label: "Open-sea leg", hint: "Open water — mainly weather and speed driven." },
  checkpoint_type_strait: { label: "Strait transit", hint: "Narrow chokepoint — congestion and geopolitics dominate." },
  regime_state_DISRUPTION: { label: "State: disruption", hint: "Checkpoint officially in a disruption regime." },
  regime_state_NORMAL: { label: "State: normal", hint: "Checkpoint operating normally — pulls risk down." },
  regime_state_RECOVERY: { label: "State: recovery", hint: "Checkpoint recovering — residual backlog still possible." },
  regime_state_SEVERE_DISRUPTION: { label: "State: severe disruption", hint: "Checkpoint in severe disruption — strongest risk signal." },
  season_spring: { label: "Season: spring", hint: "Spring sailing conditions on this corridor." },
  season_summer: { label: "Season: summer", hint: "Summer conditions — monsoon exposure on some legs." },
  season_unknown: { label: "Season: unknown", hint: "Season tag missing — neutral calendar signal." },
  season_winter: { label: "Season: winter", hint: "Winter conditions — storm exposure on some legs." },
};
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
  if (Object.hasOwn(FACTOR_DETAILS, raw)) {
    const d = FACTOR_DETAILS[raw];
    return { label: d.label, hint: d.hint, raw };
  }
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
