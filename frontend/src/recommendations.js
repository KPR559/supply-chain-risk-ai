// Rule-based recommendation service for the Dashboard.
import { describeFactor } from "./models.js";
//
// IMPORTANT: these are deterministic rules over live engine data — not LLM or
// backend-AI output. Keep it that way: every recommendation cites the data
// point that triggered it (`why`), and every action navigates to a real view
// (`target` is a sidebar view id consumed by onNavigate). When a backend
// recommendation endpoint exists, replace `buildRecommendations` wholesale.

/**
 * @param {Object} args
 * @param {Object} args.prediction
 * @param {Object} [args.explanation]
 * @param {Object} [args.critical]
 * @returns {import("./models.js").Recommendation[]}
 */
export function buildRecommendations({ prediction, explanation, critical }) {
  if (!prediction) return [];
  const out = [];
  const mc = prediction.monte_carlo;
  const nodes = prediction.node_predictions || [];
  const miss = mc?.p_miss_deadline ?? 0;
  const hasDeadline = mc?.deadline_date != null;

  if (hasDeadline && miss >= 0.6) {
    out.push({
      priority: "high",
      title: "Evaluate an alternative route",
      why: `Deadline-miss probability is ${Math.round(miss * 100)}% — the current route is unlikely to deliver on time.`,
      impact: "May cut disruption exposure and protect the customer commitment.",
      actionLabel: "Compare Routes",
      target: "compare",
    });
  }

  const disrupted = nodes.filter((n) => n.regime === 1);
  if (disrupted.length > 0) {
    const names = disrupted.map((n) => n.label || n.node_id).join(", ");
    out.push({
      priority: "high",
      title: "Recalculate ETA after the disruption update",
      why: `${names} ${disrupted.length === 1 ? "is" : "are"} in a disrupted regime — the current ETA may already be stale.`,
      impact: "Refreshes every dependent metric (KPIs, deadline risk, alerts).",
      actionLabel: "Open What-if Simulator",
      target: "simulator",
    });
  }

  const critList = critical?.critical_nodes || [];
  if (critList.length > 0) {
    const top = critList[0];
    const name = top.label || top.node_id;
    out.push({
      priority: hasDeadline && miss >= 0.35 ? "high" : "medium",
      title: `Monitor ${name}`,
      why: `${name} carries the largest share of total shipment delay.`,
      impact: "Early detection at the dominant checkpoint prevents cascade delays.",
      actionLabel: "View Checkpoint",
      target: "checkpoints",
    });
  }

  const customs = nodes
    .filter((n) => (n.kind === "customs" || /custom/i.test(n.label || "")) && (n.delay_probability ?? 0) >= 0.35)
    .sort((a, b) => (b.delay_probability ?? 0) - (a.delay_probability ?? 0))[0];
  if (customs) {
    out.push({
      priority: "medium",
      title: "Prepare customs documentation early",
      why: `${customs.label || customs.node_id} shows ${Math.round((customs.delay_probability ?? 0) * 100)}% delay probability.`,
      impact: "Pre-cleared paperwork removes the most common customs-hold cause.",
      actionLabel: "View Checkpoint",
      target: "checkpoints",
    });
  }

  const topFactor = (explanation?.top_factors || [])[0];
  if (topFactor && topFactor.contribution > 0 && out.length < 4) {
    const node = explanation.node_label || explanation.node_id;
    const friendly = describeFactor(topFactor.name);
    const isBaseline = /baseline/i.test(friendly.label);
    out.push({
      priority: "medium",
      title: isBaseline ? `Evaluate ${node} mitigation options` : `Reduce ${node} exposure — ${friendly.label}`,
      why: `Top delay driver (${friendly.label}) contributes +${Number(topFactor.contribution).toFixed(2)} to delay probability at ${node}.`,
      impact: "Directly lowers the riskiest checkpoint's delay probability.",
      actionLabel: "View Risk Drivers",
      target: "contributors",
    });
  }

  if (out.length === 0) {
    out.push({
      priority: "low",
      title: "Maintain routine monitoring",
      why: "No checkpoint breaches risk thresholds and the deadline outlook is healthy.",
      impact: "Keeps situational awareness without spending mitigation budget.",
      actionLabel: "Export Status Report",
      action: "export",
    });
  }

  return out.slice(0, 4);
}
