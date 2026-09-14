// Alert list builder + read/dismiss persistence for the dashboard Alerts drawer.
// Pure rule-based derivation over live engine data + user thresholds from
// prefs.js. The backend provides no per-alert timestamps or severities, so
// severity is assigned by rule below and recency is the last prediction run.
import { loadPrefs } from "./prefs.js";

const READ_KEY = "scm.alerts.read.v1";
const DISMISSED_KEY = "scm.alerts.dismissed.v1";

function loadIds(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveIds(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set].slice(-200)));
  } catch {
    // storage unavailable — state applies for this session only
  }
}

export function loadReadIds() {
  return loadIds(READ_KEY);
}

export function loadDismissedIds() {
  return loadIds(DISMISSED_KEY);
}

export function markAlertRead(id) {
  const s = loadIds(READ_KEY);
  s.add(id);
  saveIds(READ_KEY, s);
  return s;
}

export function markAllAlertsRead(ids) {
  const s = loadIds(READ_KEY);
  ids.forEach((id) => s.add(id));
  saveIds(READ_KEY, s);
  return s;
}

export function dismissAlert(id) {
  const s = loadIds(DISMISSED_KEY);
  s.add(id);
  saveIds(DISMISSED_KEY, s);
  return s;
}

/**
 * @param {Object} args
 * @param {Object} args.prediction
 * @param {Object} [args.explanation]
 * @param {Object} [args.critical]
 * @returns {{ id: string, sev: "error"|"warn", level: "CRITICAL"|"HIGH"|"MEDIUM", title: string, detail: string, action: string, checkpoint: string|null, target: string, targetLabel: string }[]}
 */
export function buildAlertList({ prediction, explanation, critical }) {
  if (!prediction) return [];
  const prefs = loadPrefs();
  const out = [];
  const mc = prediction.monte_carlo;
  const nodes = prediction.node_predictions || [];
  const sid = prediction.shipment_id || "shipment";
  const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;

  if (mc?.deadline_date != null) {
    const miss = mc.p_miss_deadline ?? 0;
    if (miss >= prefs.missRisk) {
      const critical = miss >= 0.6;
      out.push({
        id: `${sid}:deadline`,
        sev: critical ? "error" : "warn",
        level: critical ? "CRITICAL" : "HIGH",
        title: "Customer deadline at risk",
        detail: `Simulated deadline-miss probability is ${pct(miss)} — current arrival exceeds the customer deadline.`,
        action: "Bring the departure forward, shift a high-risk leg to a faster route, or renegotiate the delivery date.",
        checkpoint: null,
        target: "eta",
        targetLabel: "View ETA",
      });
    }
  }

  for (const n of nodes) {
    const p = n.delay_probability ?? 0;
    if (p < prefs.highRisk) continue;
    const name = n.label || n.node_id;
    out.push({
      id: `${sid}:node:${n.node_id}`,
      sev: p >= 0.8 ? "error" : "warn",
      level: p >= 0.8 ? "CRITICAL" : "HIGH",
      title: `${name} disruption`,
      detail: `Delay probability ${pct(p)}${n.expected_delay_hours != null ? ` · expected delay +${n.expected_delay_hours}h` : ""} — delay probability increased significantly.`,
      action: "Add dwell buffer upstream, pre-book alternative capacity, or reroute around this checkpoint.",
      checkpoint: name,
      target: "checkpoints",
      targetLabel: "View Checkpoint",
    });
  }

  const disrupted = nodes.filter((n) => n.regime === 1);
  if (disrupted.length > 0) {
    out.push({
      id: `${sid}:regime`,
      sev: "error",
      level: "CRITICAL",
      title: "Active disruption on corridor",
      detail: `${disrupted.map((n) => n.label || n.node_id).join(", ")} ${disrupted.length === 1 ? "is" : "are"} in a disrupted regime.`,
      action: "Treat these legs as volatile: shorten planning horizon and monitor congestion/weather feeds daily.",
      checkpoint: disrupted[0].label || disrupted[0].node_id,
      target: "checkpoints",
      targetLabel: "View Checkpoint",
    });
  }

  const critList = critical?.critical_nodes || [];
  if (critList.length > 0) {
    const top = critList[0];
    const name = top.label || top.node_id;
    out.push({
      id: `${sid}:critical`,
      sev: "warn",
      level: "HIGH",
      title: "Delay concentrated at one checkpoint",
      detail: `${name} carries ${pct(top.delay_share ?? 0)} of total expected delay across ${critList.length} critical checkpoints.`,
      action: `Focus mitigation spend on ${name} first — it dominates the shipment delay.`,
      checkpoint: name,
      target: "checkpoints",
      targetLabel: "View Checkpoint",
    });
  }

  const topFactor = (explanation?.top_factors || [])[0];
  if (topFactor && topFactor.contribution > 0) {
    out.push({
      id: `${sid}:driver:${topFactor.name}`,
      sev: "warn",
      level: "MEDIUM",
      title: `Rising driver: ${topFactor.name}`,
      detail: `Local contribution +${Number(topFactor.contribution).toFixed(2)} to delay probability at ${explanation.node_label || explanation.node_id}.`,
      action: "Attack this driver directly (e.g. congestion → off-peak slots; weather → seasonal buffer).",
      checkpoint: explanation.node_label || explanation.node_id,
      target: "contributors",
      targetLabel: "View Risk Drivers",
    });
  }

  return out;
}
