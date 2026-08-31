export function riskColor(prob) {
  if (prob >= 0.6) return "#f44336";
  if (prob >= 0.35) return "#ffb300";
  return "#26a69a";
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

export const DONUT_COLORS = ["#4cc2ff", "#ffb300", "#f44336", "#26a69a", "#ab47bc", "#78909c"];
