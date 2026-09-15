// Formatting utilities for Route Comparison and other pages

export const NA = "N/A";

/**
 * Format a number with comma separators
 * @param {number} value - The number to format
 * @returns {string} Formatted number with commas, or N/A if invalid
 */
export function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return NA;
  return Number(value).toLocaleString();
}

/**
 * Format distance in kilometers
 * @param {number} km - Distance in kilometers
 * @returns {string} Formatted distance with "km" suffix
 */
export function formatDistance(km) {
  if (km == null || Number.isNaN(Number(km))) return NA;
  return `${Number(km).toLocaleString()} km`;
}

/**
 * Format ETA in days
 * @param {number} days - ETA in days
 * @returns {string} Formatted ETA with "days" suffix
 */
export function formatEta(days) {
  if (days == null || Number.isNaN(Number(days))) return NA;
  return `${Number(days).toFixed(0)} days`;
}

/**
 * Format delay risk percentage
 * @param {number} risk - Risk as a decimal (0-1) or percentage (0-100)
 * @returns {string} Formatted risk percentage
 */
export function formatDelayRisk(risk) {
  if (risk == null || Number.isNaN(Number(risk))) return NA;
  const value = Number(risk);
  const percent = value <= 1 ? Math.round(value * 100) : Math.round(value);
  return `${percent}%`;
}

/**
 * Get risk level class for styling
 * @param {number} risk - Risk as percentage (0-100)
 * @returns {string} CSS class name
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
 * @param {number} risk - Risk as percentage (0-100)
 * @returns {string} Human-readable risk level
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
 * Format resilience score
 * @param {number} score - Resilience score (0-100)
 * @returns {string} Formatted resilience score
 */
export function formatResilience(score) {
  if (score == null || Number.isNaN(Number(score))) return NA;
  return `${Math.round(Number(score))}/100`;
}

/**
 * Get resilience level label
 * @param {number} score - Resilience score (0-100)
 * @returns {string} Human-readable resilience level
 */
export function getResilienceLevel(score) {
  if (score == null || Number.isNaN(Number(score))) return "Unknown";
  const value = Math.round(Number(score));
  if (value < 40) return "Low resilience";
  if (value < 70) return "Moderate resilience";
  return "High resilience";
}

/**
 * Get route path for mini route indicator
 * @param {string} routeId - Route identifier
 * @returns {string} SVG path data
 */
export function getRoutePath(routeId) {
  const paths = {
    current: "M2,12 L8,10 L14,8 L20,10 L26,12 L32,10",
    cape: "M2,12 L8,10 L14,14 L20,12 L26,10 L32,8",
    transshipment: "M2,12 L8,10 L14,6 L20,8 L26,10 L32,12",
    suez: "M2,12 L8,10 L14,8 L20,10 L26,12 L32,10",
    dubai: "M2,12 L8,10 L14,6 L20,8 L26,10 L32,12",
    asia_europe_suez: "M2,12 L8,10 L14,8 L20,10 L26,12 L32,10",
    asia_europe_cape: "M2,12 L8,10 L14,14 L20,12 L26,10 L32,8",
    trans_pacific: "M2,12 L8,11 L14,10 L20,10 L26,11 L32,12",
    asia_us_east_panama: "M2,12 L8,10 L14,6 L20,8 L26,10 L32,12",
  };
  return paths[routeId] || paths.current;
}

/**
 * Get display name for route
 * @param {string} routeId - Route identifier
 * @returns {string} Human-readable route name
 */
export function getRouteDisplayName(routeId) {
  const names = {
    current: "Current Route (Suez)",
    suez: "Current Route (Suez)",
    cape: "Cape of Good Hope",
    transshipment: "Alternate Transshipment",
    dubai: "Alternate Transshipment",
    asia_europe_suez: "Asia–Europe via Suez",
    asia_europe_cape: "Asia–Europe via Cape",
    trans_pacific: "Trans-Pacific Direct",
    asia_us_east_panama: "Asia–US East via Panama",
  };
  return names[routeId] || routeId;
}

/**
 * Generate recommendation text based on route data
 * @param {Array} routes - Array of route objects
 * @returns {{ route: Object|null, text: string }} Recommended route and explanation
 */
export function generateRecommendation(routes) {
  if (!routes || routes.length === 0) {
    return { route: null, text: "No routes available for comparison." };
  }

  // Find explicitly recommended route
  const explicitRec = routes.find((r) => r.recommended === true);
  if (explicitRec) {
    return {
      route: explicitRec,
      text: `${explicitRec.scenario} offers the best balance of risk and transit time for this shipment corridor.`,
    };
  }

  // Fallback: score routes based on multiple criteria
  // Lower delay risk (weight: 0.4), Lower P50 ETA (weight: 0.3), Higher resilience (weight: 0.3)
  const scored = routes.map((r) => {
    const riskScore = r.delayRisk != null ? (1 - r.delayRisk / 100) * 40 : 0;
    const etaScore = r.p50Eta != null ? (1 - Math.min(r.p50Eta / 60, 1)) * 30 : 0;
    const resilienceScore = r.resilience != null ? (r.resilience / 100) * 30 : 0;
    return { ...r, totalScore: riskScore + etaScore + resilienceScore };
  });

  const best = scored.reduce((a, b) => (a.totalScore > b.totalScore ? a : b), scored[0]);

  return {
    route: best,
    text: `${best.scenario} offers the best balance of risk and transit time for this shipment corridor.`,
  };
}