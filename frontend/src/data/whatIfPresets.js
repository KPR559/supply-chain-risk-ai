// Scenario presets for What-if Simulator
// Presets are now fetched from the backend via `/what-if/presets/{route_id}`
// to guarantee they are route-aware. This module provides a local fallback
// catalog used when the backend endpoint is unavailable.

const CHOKEPOINTS = new Set([
  "suez",
  "panama_canal",
  "strait_of_malacca",
  "bab_el_mandeb",
  "strait_of_hormuz",
  "strait_of_gibraltar",
  "taiwan_strait",
]);

function buildLocalPresets(routeNodeIds = [], nodeLabels = {}) {
  const nodes = routeNodeIds || [];
  const label = (id) => nodeLabels[id] || id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const presets = [];

  presets.push({
    id: "baseline",
    name: "Normal Conditions",
    description: "No disruptions — current corridor conditions.",
    scenario_type: "baseline",
    scope: "single",
    node_id: null,
    adjustments: {},
    available: true,
  });

  if (!nodes.length) {
    presets.push({
      id: "custom",
      name: "Custom Scenario",
      description: "Define your own scenario.",
      scenario_type: "custom",
      scope: "single",
      node_id: null,
      adjustments: { congestion_mult: 1.0, weather_shift: 0 },
      available: true,
    });
    return presets;
  }

  const congestionLevels = [
    ["moderate_congestion", "Moderate Congestion", "30% congestion increase", 1.3],
    ["severe_congestion", "Severe Congestion", "60% congestion increase", 1.6],
    ["major_congestion", "Major Congestion", "100% congestion increase", 2.0],
  ];
  for (const [id, name, desc, mult] of congestionLevels) {
    presets.push({
      id,
      name,
      description: `${desc} at ${label(nodes[Math.floor(nodes.length / 2)])}.`,
      scenario_type: "congestion",
      scope: "single",
      node_id: nodes[Math.floor(nodes.length / 2)],
      adjustments: { congestion_mult: mult },
      available: true,
    });
  }

  presets.push({
    id: "severe_weather",
    name: "Severe Weather",
    description: "Severe weather adding 48 hours of additional delay.",
    scenario_type: "weather",
    scope: "single",
    node_id: nodes[Math.floor(nodes.length / 2)],
    adjustments: { weather_shift: 48 },
    available: true,
  });

  for (const nid of nodes) {
    if (CHOKEPOINTS.has(nid)) {
      presets.push({
        id: `closure_${nid}`,
        name: `${label(nid)} Closed`,
        description: `Complete closure of ${label(nid)}.`,
        scenario_type: "closure",
        scope: "single",
        node_id: nid,
        adjustments: { close: true },
        available: true,
      });
    }
  }

  if (nodes.length >= 3) {
    const multiNodes = nodes.slice(-3);
    presets.push({
      id: "multi_disruption",
      name: "Multi-Checkpoint Disruption",
      description: "Combined disruptions across multiple route checkpoints.",
      scenario_type: "multi_checkpoint",
      scope: "multi",
      node_ids: multiNodes,
      node_adjustments: multiNodes.map((n) => ({ node_id: n, congestion_mult: 1.4, weather_shift: 12 })),
      available: true,
    });
  }

  presets.push({
    id: "custom",
    name: "Custom Scenario",
    description: "Define your own checkpoint, congestion, weather, and closure adjustments.",
    scenario_type: "custom",
    scope: "single",
    node_id: nodes[0],
    adjustments: { congestion_mult: 1.0, weather_shift: 0 },
    available: true,
  });

  return presets;
}

export const SCENARIO_PRESETS = buildLocalPresets();

export function buildPresetsForRoute(routeNodeIds, nodeLabels) {
  return buildLocalPresets(routeNodeIds, nodeLabels);
}

export function getPresetById(id, presets = SCENARIO_PRESETS) {
  return presets.find((p) => p.id === id) || presets[0];
}

export function getStandardPresets(presets = SCENARIO_PRESETS) {
  return presets.filter((p) => !p.isCustom);
}

export function getCustomPreset(presets = SCENARIO_PRESETS) {
  return presets.find((p) => p.isCustom);
}