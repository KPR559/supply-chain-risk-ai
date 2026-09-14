// Fallback/mock data for Risk Drivers feature
// Used when backend data is unavailable or for demo purposes

export const FALLBACK_ATTRIBUTION_FACTORS = [
  { name: "base", value: 17.46 },
  { name: "regime", value: -3.13, status: "reducing" },
  { name: "conflict", value: 1.17 },
  { name: "weather", value: -0.06, status: "reducing" },
  { name: "congestion", value: 0.04 },
  { name: "customs", value: 0.01 },
];

export const FALLBACK_DRIVER_TRENDS = [
  {
    driver: "base",
    index: 1746,
    trend: [12, 14, 13, 16, 17, 18, 20],
  },
  {
    driver: "regime",
    index: 313,
    trend: [5, 7, 6, 8, 9, 11, 13],
  },
  {
    driver: "conflict",
    index: 117,
    trend: [2, 4, 6, 8, 9, 10, 12],
  },
  {
    driver: "weather",
    index: 6,
    trend: [1, 2, 3, 5, 6, 7, 9],
  },
];

export const FALLBACK_EXPLANATION = {
  node_label: "Suez Canal",
  node_id: "suez_canal",
  delay_probability: 0.99,
  top_factors: [
    { name: "base", contribution: 17.46 },
    { name: "regime", contribution: -3.13 },
    { name: "conflict", contribution: 1.17 },
    { name: "weather", contribution: -0.06 },
    { name: "congestion", contribution: 0.04 },
    { name: "customs", contribution: 0.01 },
  ],
};

export const SHAP_EXPLANATION_TEXT =
  "SHAP contribution shows how much a factor changes the prediction relative to the baseline.";