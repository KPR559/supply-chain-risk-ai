// Local UI preferences shared by the Settings and Alerts views.
// Persisted per browser (localStorage); thresholds are fractions 0..1.
const KEY = "scm.prefs.v1";

export const DEFAULT_PREFS = { highRisk: 0.6, missRisk: 0.3 };

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw);
    return {
      highRisk: clampNum(p.highRisk, DEFAULT_PREFS.highRisk),
      missRisk: clampNum(p.missRisk, DEFAULT_PREFS.missRisk),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  const clean = {
    highRisk: clampNum(prefs.highRisk, DEFAULT_PREFS.highRisk),
    missRisk: clampNum(prefs.missRisk, DEFAULT_PREFS.missRisk),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // storage unavailable — prefs apply for this session only
  }
  return clean;
}

function clampNum(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(0.99, Math.max(0.01, n));
}

// Display / behavior preferences (Settings page). Frontend-only.
const UI_KEY = "scm.ui.v1";

export const DEFAULT_UI = {
  density: "comfortable", // comfortable | compact
  mapLayout: "globe", // globe | world | graph
  toasts: true,
};

export function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return { ...DEFAULT_UI };
    const p = JSON.parse(raw);
    return {
      density: p.density === "compact" ? "compact" : "comfortable",
      // "network" is the pre-rename stored value for the graph layout.
      mapLayout: p.mapLayout === "graph" || p.mapLayout === "network"
        ? "graph"
        : p.mapLayout === "world"
          ? "world"
          : "globe",
      toasts: p.toasts !== false,
    };
  } catch {
    return { ...DEFAULT_UI };
  }
}

export function saveUiPrefs(prefs) {
  const clean = {
    density: prefs.density === "compact" ? "compact" : "comfortable",
    mapLayout: prefs.mapLayout === "graph"
      ? "graph"
      : prefs.mapLayout === "world"
        ? "world"
        : "globe",
    toasts: prefs.toasts !== false,
  };
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(clean));
  } catch {
    // ignore — prefs apply for this session only
  }
  try {
    document.body.dataset.density = clean.density;
  } catch {
    // ignore
  }
  return clean;
}
