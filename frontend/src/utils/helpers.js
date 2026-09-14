export function riskColor(prob) {
  if (prob >= 0.6) return "#ef4444";
  if (prob >= 0.35) return "#f59e0b";
  return "#22c55e";
}

export function riskClass(prob) {
  if (prob >= 0.6) return "high";
  if (prob >= 0.35) return "med";
  return "low";
}

export function riskLabel(prob) {
  if (prob >= 0.6) return "High Risk";
  if (prob >= 0.35) return "Medium";
  return "Low Risk";
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatShortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function routeDisplayName(routeId) {
  const names = {
    suez: "Current Route (Suez)",
    cape: "Cape of Good Hope",
    dubai: "Alternate Transshipment",
  };
  return names[routeId] || routeId;
}

export function computeResilienceScore(nodes, mc) {
  if (!nodes?.length || !mc) return 0;
  const avgRisk = nodes.reduce((a, n) => a + n.delay_probability, 0) / nodes.length;
  const unc = (mc.percentiles?.p90 ?? 0) - (mc.percentiles?.p10 ?? 0);
  const uncFactor = Math.min(unc / 20, 1);
  return Math.round(Math.max(0, 100 - avgRisk * 55 - uncFactor * 25));
}

export function resilienceLabel(score) {
  if (score >= 75) return "Strong";
  if (score >= 50) return "Moderate";
  return "Weak";
}

export function delayDaysFromHours(hours) {
  if (hours == null) return "—";
  const d = hours / 24;
  return d >= 0 ? `+${d.toFixed(1)} days` : `${d.toFixed(1)} days`;
}

export const DONUT_COLORS = ["#38bdf8", "#f59e0b", "#ef4444", "#22c55e", "#a78bfa", "#78909c"];
