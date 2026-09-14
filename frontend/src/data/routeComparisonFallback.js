// Fallback data for Route Comparison feature
// Used when backend data is unavailable

export const FALLBACK_ROUTES = [
  {
    id: "current",
    scenario: "Current Route (Suez)",
    route: "Frankfurt → Suez Canal → Mumbai",
    p50Eta: 39,
    p90Eta: 49,
    delayRisk: 37,
    distance: 18560,
    resilience: 53,
    recommended: false,
  },
  {
    id: "cape",
    scenario: "Cape of Good Hope",
    route: "Frankfurt → Cape of Good Hope → Mumbai",
    p50Eta: 34,
    p90Eta: 39,
    delayRisk: 27,
    distance: 28060,
    resilience: 74,
    recommended: true,
  },
  {
    id: "transshipment",
    scenario: "Alternate Transshipment",
    route: "Frankfurt → Alternate Hub → Mumbai",
    p50Eta: 33,
    p90Eta: 41,
    delayRisk: 37,
    distance: 16960,
    resilience: 58,
    recommended: false,
  },
];

export const ROUTE_PATHS = {
  current: "M2,12 L8,10 L14,8 L20,10 L26,12 L32,10",
  cape: "M2,12 L8,10 L14,14 L20,12 L26,10 L32,8",
  transshipment: "M2,12 L8,10 L14,6 L20,8 L26,10 L32,12",
};