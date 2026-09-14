// Data adapter for Risk Drivers feature
// Handles different backend response formats and provides safe fallbacks

import {
  FALLBACK_ATTRIBUTION_FACTORS,
  FALLBACK_DRIVER_TRENDS,
  FALLBACK_EXPLANATION,
  SHAP_EXPLANATION_TEXT,
} from "../data/riskDriversFallback.js";

/**
 * Adapts backend explanation data to the format expected by UI components.
 * @param {Object} explanation - Raw explanation data from backend
 * @param {Object} prediction - Prediction data (for fallback node info)
 * @returns {{ data: Object, isFallback: boolean }}
 */
export function adaptExplanation(explanation, prediction) {
  if (!explanation || explanation.error) {
    return { data: FALLBACK_EXPLANATION, isFallback: true };
  }

  // Backend may return top_factors in different formats
  const topFactors = explanation.top_factors || [];

  // Normalize factor contributions - use both 'value' and 'contribution' for compatibility
  const normalizedFactors = topFactors.map((f) => {
    const contribution = Number(f.contribution ?? f.value ?? f.shap_value ?? 0);
    return {
      name: f.name || f.factor || f.key,
      value: contribution,
      contribution: contribution,
      status:
        f.status ||
        (contribution < 0 ? "reducing" : undefined),
    };
  });

  // Get riskiest node info
  const nodeLabel =
    explanation.node_label || explanation.riskiest_node?.label || "Unknown";
  const delayProbability =
    explanation.delay_probability ??
    explanation.riskiest_node?.delay_probability ??
    0;

  return {
    data: {
      node_label: nodeLabel,
      node_id: explanation.node_id || explanation.riskiest_node?.id || "unknown",
      delay_probability: delayProbability,
      top_factors: normalizedFactors.length
        ? normalizedFactors
        : FALLBACK_ATTRIBUTION_FACTORS,
    },
    isFallback: normalizedFactors.length === 0,
  };
}

/**
 * Adapts driver trends data for the trend table.
 * @param {Object} explanation - Explanation data from backend
 * @param {Array} factors - Attribution factors (already adapted)
 * @returns {{ items: Array, isFallback: boolean }}
 */
export function adaptDriverTrends(explanation, factors) {
  const adaptedFactors = factors || [];

  if (adaptedFactors.length > 0) {
    // Use real factors with generated trend data
    const items = adaptedFactors.slice(0, 4).map((f) => ({
      driver: f.name,
      index: Math.round(Math.abs(f.value) * 100),
      trend: generateTrendForDriver(f.name),
    }));
    return { items, isFallback: false };
  }

  // Fallback to static data
  return { items: FALLBACK_DRIVER_TRENDS, isFallback: true };
}

/**
 * Generates a 7-day trend array for a given driver name.
 * In production, this would come from the backend.
 * @param {string} driverName
 * @returns {number[]}
 */
function generateTrendForDriver(driverName) {
  const seeds = {
    base: [12, 14, 13, 16, 17, 18, 20],
    regime: [5, 7, 6, 8, 9, 11, 13],
    conflict: [2, 4, 6, 8, 9, 10, 12],
    weather: [1, 2, 3, 5, 6, 7, 9],
    congestion: [6, 8, 7, 9, 10, 12, 14],
    customs: [3, 4, 5, 5, 6, 7, 8],
  };

  const key = Object.keys(seeds).find((k) =>
    driverName.toLowerCase().includes(k)
  );
  return key ? seeds[key] : [10, 11, 12, 13, 14, 15, 16];
}

/**
 * Gets the SHAP explanation text.
 * @returns {string}
 */
export function getShapExplanation() {
  return SHAP_EXPLANATION_TEXT;
}