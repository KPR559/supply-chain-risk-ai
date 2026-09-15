// What-if Simulator utilities
// Formatters, helpers, and history helpers for the new data shape returned
// by the comprehensive `/what-if` backend endpoint.

const NA = "—";

export function formatEta(days) {
  if (days == null || Number.isNaN(Number(days))) return NA;
  return `${Number(days).toFixed(1)} days`;
}

export function formatDelay(days) {
  if (days == null || Number.isNaN(Number(days))) return NA;
  return `${Number(days).toFixed(1)} days`;
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return NA;
  const num = Number(value);
  const pct = Math.abs(num) <= 1.05 ? num * 100 : num;
  return `${Math.round(pct)}%`;
}

export function formatResilience(score) {
  if (score == null || Number.isNaN(Number(score))) return NA;
  return `${Math.round(Number(score))}/100`;
}

export function formatChange(value, unit = "days") {
  if (value == null || Number.isNaN(Number(value))) return NA;
  const num = Number(value);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(1)} ${unit}`;
}

export function getChangeClass(value, inverse = false) {
  if (value == null || Number.isNaN(Number(value))) return "";
  const num = Number(value);
  if (Math.abs(num) < 0.05) return "neutral";
  const isPositive = inverse ? num < 0 : num > 0;
  return isPositive ? "negative" : "positive";
}

export function validateScenarioInputs(congestion, weather) {
  const errors = [];
  const congestionNum = Number(congestion);
  if (congestion == null || congestion === "") {
    errors.push("Congestion multiplier is required");
  } else if (Number.isNaN(congestionNum)) {
    errors.push("Congestion multiplier must be a number");
  } else if (congestionNum < 0) {
    errors.push("Congestion multiplier cannot be negative");
  } else if (congestionNum > 10) {
    errors.push("Congestion multiplier is too high (max 10)");
  }

  const weatherNum = Number(weather);
  if (weather == null || weather === "") {
    errors.push("Weather delay is required");
  } else if (Number.isNaN(weatherNum)) {
    errors.push("Weather delay must be a number");
  } else if (weatherNum < 0) {
    errors.push("Weather delay cannot be negative");
  } else if (weatherNum > 500) {
    errors.push("Weather delay is too high (max 500 hours)");
  }

  return { isValid: errors.length === 0, errors };
}

export function getRiskLevelClass(risk) {
  if (risk == null || Number.isNaN(Number(risk))) return "";
  const value = Number(risk) <= 1.05 ? Number(risk) * 100 : Number(risk);
  if (value <= 20) return "low";
  if (value <= 50) return "medium";
  if (value <= 75) return "high";
  return "critical";
}

export function getRiskLevelLabel(risk) {
  if (risk == null || Number.isNaN(Number(risk))) return "Unknown";
  const value = Number(risk) <= 1.05 ? Number(risk) * 100 : Number(risk);
  if (value <= 20) return "Low Risk";
  if (value <= 50) return "Medium Risk";
  if (value <= 75) return "High Risk";
  return "Critical Risk";
}

export function formatEtaDate(dateStr) {
  if (!dateStr) return NA;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return NA;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function dateFromDays(originDate, days) {
  if (!originDate || days == null || Number.isNaN(Number(days))) return null;
  const d = new Date(originDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Math.round(Number(days)));
  return d.toISOString().slice(0, 10);
}

export function getCheckpointImpacts(result) {
  return result?.checkpoint_impact || [];
}

export function formatHistoryEntry(result, rerunPayload = null) {
  const scenario = result || {};
  const mc = scenario.monte_carlo || {};
  return {
    id: Date.now().toString(),
    name: scenario.scenario_name || "Custom Scenario",
    checkpoint: (scenario.affected_nodes || []).map(
      (n) => (scenario.per_node_scenario || []).find((p) => p.node_id === n)?.label || n
    ).join(", ") || "Unknown",
    time: new Date().toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }),
    p90Eta: mc.percentiles?.p90 ?? scenario.scenario?.p90_eta_days,
    delayRisk: mc.p_miss_deadline ?? scenario.scenario?.p_miss_deadline,
    expectedDays: mc.expected_days ?? scenario.scenario?.expected_days,
    deltaDays: scenario.delta?.expected_days ?? null,
    resilience: mc.resilience_score ?? scenario.scenario?.resilience_score,
    rerun: rerunPayload || null,
    timestamp: Date.now(),
  };
}