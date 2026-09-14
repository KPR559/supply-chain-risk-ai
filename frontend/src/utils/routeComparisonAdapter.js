// Data adapter for Route Comparison feature
// Handles different backend response formats and provides safe fallbacks

import { FALLBACK_ROUTES } from "../data/routeComparisonFallback.js";
import { generateRecommendation } from "./formatters.js";

/**
 * Adapts backend compare routes response to the format expected by UI components.
 * @param {Object} compareData - Raw compare data from backend
 * @returns {{ routes: Array, isFallback: boolean, recommendation: Object }}
 */
export function adaptRouteComparison(compareData) {
  if (!compareData || !compareData.options || compareData.options.length === 0) {
    return {
      routes: FALLBACK_ROUTES,
      isFallback: true,
      recommendation: generateRecommendation(FALLBACK_ROUTES),
    };
  }

  // Normalize backend route data
  const normalizedRoutes = compareData.options.map((r) => ({
    id: r.route_id || r.id || r.routeId,
    scenario: r.scenario || r.route_name || r.name || getRouteDisplayName(r.route_id || r.id),
    route: r.route || r.route_path || r.routeName || getRoutePath(r.route_id || r.id),
    p50Eta: r.p50_eta ?? r.eta_p50 ?? r.expected_eta_days ?? r.p50Eta,
    p90Eta: r.p90_eta ?? r.eta_p90 ?? r.p90_eta_days ?? r.p90Eta,
    delayRisk: r.delay_risk ?? r.risk ?? r.delay_probability ?? r.delayRisk,
    distance: r.distance ?? r.distance_km ?? r.distanceKm,
    resilience: r.resilience ?? r.resilience_score ?? r.resilienceScore,
    recommended: r.recommended ?? false,
  }));

  // Get backend recommendation if available
  let backendRecommendation = null;
  if (compareData.recommended) {
    const rec = compareData.recommended;
    const recRouteId = rec.balanced || rec.lowest_risk || rec.fastest || Object.values(rec)[0];
    if (recRouteId) {
      backendRecommendation = normalizedRoutes.find((r) => r.id === recRouteId);
    }
  }

  // Generate recommendation
  const recommendation = backendRecommendation
    ? { route: backendRecommendation, text: `${backendRecommendation.scenario} offers the best balance of risk and transit time for this shipment corridor.` }
    : generateRecommendation(normalizedRoutes);

  return {
    routes: normalizedRoutes,
    isFallback: false,
    recommendation,
  };
}

/**
 * Gets display name for a route ID
 * @param {string} routeId
 * @returns {string}
 */
function getRouteDisplayName(routeId) {
  const names = {
    current: "Current Route (Suez)",
    suez: "Current Route (Suez)",
    cape: "Cape of Good Hope",
    transshipment: "Alternate Transshipment",
    dubai: "Alternate Transshipment",
  };
  return names[routeId] || routeId;
}

/**
 * Gets SVG path for a route ID
 * @param {string} routeId
 * @returns {string}
 */
function getRoutePath(routeId) {
  const paths = {
    current: "M2,12 L8,10 L14,8 L20,10 L26,12 L32,10",
    cape: "M2,12 L8,10 L14,14 L20,12 L26,10 L32,8",
    transshipment: "M2,12 L8,10 L14,6 L20,8 L26,10 L32,12",
    suez: "M2,12 L8,10 L14,8 L20,10 L26,12 L32,10",
    dubai: "M2,12 L8,10 L14,6 L20,8 L26,10 L32,12",
  };
  return paths[routeId] || paths.current;
}