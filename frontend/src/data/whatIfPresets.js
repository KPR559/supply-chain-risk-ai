// Scenario presets for What-if Simulator
// Each preset defines a node_id and adjustments that the backend understands

export const SCENARIO_PRESETS = [
  {
    id: "baseline",
    name: "Baseline / Normal Conditions",
    description: "No disruptions — current corridor conditions.",
    node_id: null,
    adjustments: {},
    isCustom: false,
  },
  {
    id: "suez_30",
    name: "Suez Canal +30% Congestion",
    description: "Moderate congestion increase at Suez Canal checkpoint.",
    node_id: "suez",
    adjustments: { congestion_mult: 1.3 },
    isCustom: false,
  },
  {
    id: "suez_60",
    name: "Suez Canal +60% Congestion",
    description: "Severe congestion increase at Suez Canal checkpoint.",
    node_id: "suez",
    adjustments: { congestion_mult: 1.6 },
    isCustom: false,
  },
  {
    id: "suez_closed",
    name: "Suez Canal Closed",
    description: "Complete closure of Suez Canal — forces rerouting.",
    node_id: "suez",
    adjustments: { close: true },
    isCustom: false,
  },
  {
    id: "indian_ocean_weather",
    name: "Severe Weather at Indian Ocean",
    description: "Adverse weather conditions adding delay in the Indian Ocean leg.",
    node_id: "indian_ocean",
    adjustments: { weather_shift: 24 },
    isCustom: false,
  },
  {
    id: "mumbai_congestion",
    name: "Mumbai Port Congestion",
    description: "Increased port congestion at Mumbai destination.",
    node_id: "mumbai",
    adjustments: { congestion_mult: 1.5 },
    isCustom: false,
  },
  {
    id: "customs_delay",
    name: "Customs Clearance Delay",
    description: "Additional customs processing time at destination.",
    node_id: "customs",
    adjustments: { weather_shift: 12, congestion_mult: 1.2 },
    isCustom: false,
  },
  {
    id: "multi_disruption",
    name: "Multi-Checkpoint Disruption",
    description: "Combined disruptions across multiple checkpoints.",
    node_id: "suez",
    adjustments: { congestion_mult: 1.4, weather_shift: 18 },
    isCustom: false,
  },
  {
    id: "custom",
    name: "Custom Scenario",
    description: "Define your own checkpoint, congestion, and weather adjustments.",
    node_id: "suez",
    adjustments: { congestion_mult: 1.0, weather_shift: 0 },
    isCustom: true,
  },
];

/**
 * Get preset by ID
 */
export function getPresetById(id) {
  return SCENARIO_PRESETS.find((p) => p.id === id) || SCENARIO_PRESETS[0];
}

/**
 * Get all presets except custom
 */
export function getStandardPresets() {
  return SCENARIO_PRESETS.filter((p) => !p.isCustom);
}

/**
 * Get custom preset
 */
export function getCustomPreset() {
  return SCENARIO_PRESETS.find((p) => p.isCustom);
}