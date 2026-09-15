// Fallback data for Route Comparison feature
// Used when backend data is unavailable

import { getRouteDisplayName, getRoutePath } from "../utils/formatters.js";

export const FALLBACK_ROUTE_IDS = [
  "asia_europe_suez",
  "asia_europe_cape",
  "trans_pacific",
  "asia_us_east_panama",
];

export const FALLBACK_ROUTES = [
  {
    id: "asia_europe_suez",
    scenario: getRouteDisplayName("asia_europe_suez"),
    route: getRoutePath("asia_europe_suez"),
    p50Eta: 40,
    p90Eta: 48,
    delayRisk: 37,
    distance: 19330,
    resilience: 53,
    recommended: false,
  },
  {
    id: "asia_europe_cape",
    scenario: getRouteDisplayName("asia_europe_cape"),
    route: getRoutePath("asia_europe_cape"),
    p50Eta: 46,
    p90Eta: 55,
    delayRisk: 27,
    distance: 24101,
    resilience: 74,
    recommended: false,
  },
  {
    id: "trans_pacific",
    scenario: getRouteDisplayName("trans_pacific"),
    route: getRoutePath("trans_pacific"),
    p50Eta: 15,
    p90Eta: 21,
    delayRisk: 24,
    distance: 10457,
    resilience: 78,
    recommended: true,
  },
  {
    id: "asia_us_east_panama",
    scenario: getRouteDisplayName("asia_us_east_panama"),
    route: getRoutePath("asia_us_east_panama"),
    p50Eta: 32,
    p90Eta: 41,
    delayRisk: 31,
    distance: 18812,
    resilience: 62,
    recommended: false,
  },
];

export const ROUTE_PATHS = Object.fromEntries(
  FALLBACK_ROUTES.map((r) => [r.id, r.route])
);