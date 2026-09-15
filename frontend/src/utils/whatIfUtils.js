// What-if Simulator utilities
// Formatters, validators, and explanation generators

import { SCENARIO_PRESETS, getPresetById } from "../data/whatIfPresets.js";
import { fmtDays, fmtPct, formatHours, daysBetween } from "../models.js";

const NA = "—";

/**
 * Format ETA duration in days
 */
export function formatEta(days) {
  if (days == null || Number.isNaN(Number(days))) return NA;
  return `${Number(days).toFixed(1)} days`;
}

/**
 * Format delay in days
 */
export function formatDelay(days) {
  if (days == null || Number.isNaN(Number(days))) return NA;
  return `${Number(days).toFixed(1)} days`;
}

/**
 * Format percentage
 */
export function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return NA;
  const pct = Number(value) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(pct)}%`;
}

/**
 * Format resilience score
 */
export function formatResilience(score) {
  if (score == null || Number.isNaN(Number(score))) return NA;
  return `${Math.round(Number(score))}/100`;
}

/**
 * Format change with sign
 */
export function formatChange(value, unit = "days") {
  if (value == null || Number.isNaN(Number(value))) return NA;
  const num = Number(value);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(1)} ${unit}`;
}

/**
 * Get change class for styling (positive/negative/neutral)
 */
export function getChangeClass(value, inverse = false) {
  if (value == null || Number.isNaN(Number(value))) return "";
  const num = Number(value);
  if (num === 0) return "neutral";
  const isPositive = inverse ? num < 0 : num > 0;
  return isPositive ? "negative" : "positive";
}

/**
 * Validate scenario inputs
 */
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

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Determine risk level class for styling
 */
export function getRiskLevelClass(risk) {
  if (risk == null || Number.isNaN(Number(risk))) return "";
  const value = Number(risk) <= 1 ? Number(risk) * 100 : Number(risk);
  if (value <= 20) return "low";
  if (value <= 50) return "medium";
  if (value <= 75) return "high";
  return "critical";
}

/**
 * Get risk level label
 */
export function getRiskLevelLabel(risk) {
  if (risk == null || Number.isNaN(Number(risk))) return "Unknown";
  const value = Number(risk) <= 1 ? Number(risk) * 100 : Number(risk);
  if (value <= 20) return "Low Risk";
  if (value <= 50) return "Medium Risk";
  if (value <= 75) return "High Risk";
  return "Critical Risk";
}

/**
 * Generate scenario impact explanation based on baseline and scenario data
 */
export function generateScenarioImpact(baseline, scenario, checkpoint, adjustments) {
  if (!baseline || !scenario) {
    return "Unable to generate impact explanation — missing baseline or scenario data.";
  }

  const delayChange = scenario.expected_delay_hours
    ? (scenario.expected_delay_hours - (baseline.expected_delay_hours || 0)) / 24
    : 0;
  const p90Change = scenario.percentiles?.p90
    ? scenario.percentiles.p90 - (baseline.percentiles?.p90 || 0)
    : 0;
  const riskChange = scenario.p_miss_deadline
    ? (scenario.p_miss_deadline - (baseline.p_miss_deadline || 0)) * 100
    : 0;
  const etaChange = scenario.expected_eta_days
    ? scenario.expected_eta_days - (baseline.expected_eta_days || 0)
    : 0;

  const parts = [];
  const nodeName = checkpoint?.label || checkpoint?.node_id || "the selected checkpoint";

  // Check if Suez is closed
  if (adjustments?.close === true) {
    parts.push(`Closing the ${nodeName} significantly increases transit time and deadline-miss probability.`);
  } else if (adjustments?.congestion_mult && adjustments.congestion_mult > 1) {
    const pct = Math.round((adjustments.congestion_mult - 1) * 100);
    parts.push(`Additional congestion at ${nodeName} (${pct}% increase) increases expected dwell time at this checkpoint.`);
  } else if (adjustments?.weather_shift && adjustments.weather_shift > 0) {
    parts.push(`Severe weather at ${nodeName} adds ${adjustments.weather_shift}h of delay and increases uncertainty in the arrival distribution.`);
  }

  // Add quantitative impact
  if (Math.abs(delayChange) > 0.1) {
    parts.push(`Expected delay increases by ${delayChange.toFixed(1)} days.`);
  }
  if (Math.abs(p90Change) > 0.1) {
    parts.push(`P90 arrival shifts by ${p90Change.toFixed(1)} days.`);
  }
  if (Math.abs(riskChange) > 1) {
    parts.push(`Deadline miss probability changes by ${riskChange.toFixed(0)}%.`);
  }
  if (Math.abs(etaChange) > 0.1) {
    parts.push(`Expected transit duration changes by ${etaChange.toFixed(1)} days.`);
  }

  // Check if impact is minimal
  if (
    Math.abs(delayChange) <= 0.1 &&
    Math.abs(p90Change) <= 0.1 &&
    Math.abs(riskChange) <= 1 &&
    Math.abs(etaChange) <= 0.1
  ) {
    return `The selected scenario has limited impact because ${nodeName} is not on the critical path or the adjustments are minimal.`;
  }

  return parts.join(" ");
}

/**
 * Generate dynamic recommendations based on scenario results
 */
export function generateRecommendations(baseline, scenario, checkpoint, adjustments, alternativeRoutes = []) {
  const recommendations = [];

  if (!baseline || !scenario) return recommendations;

  const delayChange = scenario.expected_delay_hours
    ? (scenario.expected_delay_hours - (baseline.expected_delay_hours || 0)) / 24
    : 0;
  const p90Change = scenario.percentiles?.p90
    ? scenario.percentiles.p90 - (baseline.percentiles?.p90 || 0)
    : 0;
  const riskChange = scenario.p_miss_deadline
    ? (scenario.p_miss_deadline - (baseline.p_miss_deadline || 0)) * 100
    : 0;
  const missProb = scenario.p_miss_deadline || 0;
  const nodeName = checkpoint?.label || checkpoint?.node_id || "checkpoint";

  // Critical: deadline miss probability very high
  if (missProb >= 0.8) {
    recommendations.push({
      priority: "critical",
      title: "Reroute immediately",
      text: `Consider rerouting through the Cape of Good Hope to avoid ${nodeName} disruption.`,
    });
  }
  // High: significant delay increase
  else if (delayChange > 5 || p90Change > 7) {
    recommendations.push({
      priority: "high",
      title: "Pre-book alternative capacity",
      text: `Significant delay increase detected. Pre-book alternative vessel capacity to mitigate impact.`,
    });
  }
  // High: deadline at risk
  else if (missProb >= 0.5 && riskChange > 10) {
    recommendations.push({
      priority: "high",
      title: "Increase deadline buffer",
      text: `Deadline miss probability is elevated. Increase buffer time before the customer deadline.`,
    });
  }

  // Medium: checkpoint-specific actions
  if (adjustments?.congestion_mult && adjustments.congestion_mult > 1.3) {
    recommendations.push({
      priority: "medium",
      title: "Monitor congestion closely",
      text: `Monitor ${nodeName} congestion closely and prepare contingency routing.`,
    });
  }
  if (adjustments?.weather_shift && adjustments.weather_shift > 12) {
    recommendations.push({
      priority: "medium",
      title: "Track weather forecasts",
      text: `Track weather forecasts for ${nodeName} and prepare for extended delays.`,
    });
  }
  if (nodeName.toLowerCase().includes("customs") || nodeName.toLowerCase().includes("clearance")) {
    recommendations.push({
      priority: "medium",
      title: "Prioritize documentation",
      text: "Prioritize customs clearance documentation to minimize processing delays.",
    });
  }

  // Low: general monitoring
  if (delayChange > 0 && recommendations.length === 0) {
    recommendations.push({
      priority: "low",
      title: "Monitor situation",
      text: "The scenario shows moderate impact. Continue monitoring and review if conditions worsen.",
    });
  }

  // No action needed
  if (recommendations.length === 0) {
    recommendations.push({
      priority: "low",
      title: "No immediate action required",
      text: "The scenario does not require immediate action under current conditions.",
    });
  }

  return recommendations;
}

/**
 * Get checkpoint impact data for table
 */
export function getCheckpointImpacts(baseline, scenario, prediction) {
  if (!prediction?.node_predictions) return [];

  const baselineNodes = baseline?.node_predictions || [];
  const scenarioNodes = scenario?.node_predictions || [];

  return prediction.node_predictions.map((node) => {
    const baseNode = baselineNodes.find((n) => n.node_id === node.node_id);
    const scenNode = scenarioNodes.find((n) => n.node_id === node.node_id);

    const baseRisk = baseNode?.delay_probability || 0;
    const scenRisk = scenNode?.delay_probability || 0;
    const baseDelay = baseNode?.expected_delay_hours || 0;
    const scenDelay = scenNode?.expected_delay_hours || 0;

    const riskChange = (scenRisk - baseRisk) * 100;
    const delayChange = (scenDelay - baseDelay) / 24;

    let status = "Normal";
    let statusClass = "low";
    if (scenRisk >= 0.8) { status = "Critical"; statusClass = "critical"; }
    else if (scenRisk >= 0.6) { status = "Disrupted"; statusClass = "high"; }
    else if (scenRisk >= 0.35) { status = "Elevated"; statusClass = "medium"; }

    return {
      node_id: node.node_id,
      label: node.label,
      isAffected: node.node_id === scenario?.node_id,
      baseRisk: Math.round(baseRisk * 100),
      scenRisk: Math.round(scenRisk * 100),
      riskChange: Math.round(riskChange * 10) / 10,
      baseDelay: Math.round(baseDelay * 10) / 10,
      scenDelay: Math.round(scenDelay * 10) / 10,
      delayChange: Math.round(delayChange * 10) / 10,
      status,
      statusClass,
    };
  });
}

/**
 * Generate a simple ETA comparison chart data
 */
export function generateEtaComparisonData(baseline, scenario) {
  return {
    baseline: {
      p50: baseline?.percentiles?.p50 || baseline?.expected_eta_days || 0,
      p90: baseline?.percentiles?.p90 || 0,
    },
    scenario: {
      p50: scenario?.percentiles?.p50 || scenario?.expected_eta_days || 0,
      p90: scenario?.percentiles?.p90 || 0,
    },
  };
}

/**
 * Format scenario history entry
 */
export function formatHistoryEntry(scenarioResult, preset, adjustments) {
  return {
    id: Date.now().toString(),
    name: preset?.name || "Custom Scenario",
    checkpoint: preset?.node_id || scenarioResult?.node_id || "Unknown",
    time: new Date().toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }),
    p90Eta: scenarioResult?.monte_carlo?.percentiles?.p90 || scenarioResult?.percentiles?.p90,
    delayRisk: scenarioResult?.p_miss_deadline || scenarioResult?.monte_carlo?.p_miss_deadline,
    congestion_mult: adjustments?.congestion_mult ?? preset?.adjustments?.congestion_mult ?? 1.0,
    weather_shift: adjustments?.weather_shift ?? preset?.adjustments?.weather_shift ?? 0,
    timestamp: Date.now(),
  };
}