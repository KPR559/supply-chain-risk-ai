const BASE = (import.meta.env.VITE_API_BASE || "/api/v1").replace(/\/$/, "");

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `${res.status}: ${path}`);
  }
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `${res.status}: ${path}`);
  }
  return res.json();
}

export const api = {
  health: () => get("/health"),
  demo: () => get("/demo"),
  predict: (route, { nSim = null } = {}) =>
    post("/predict", {
      origin: "frankfurt",
      destination: "final_destination",
      route_id: route,
      ...(nSim ? { n_sim: nSim } : {}),
    }),
  whatif: (shipmentId, name, nodeId, adjustments) =>
    post("/what-if", { shipment_id: shipmentId, name, node_id: nodeId, adjustments }),
  compare: (shipmentId, objectives) =>
    post("/compare-routes", { shipment_id: shipmentId, objectives }),
  explain: (shipmentId) => get(`/explanation/${shipmentId}`),
  critical: (shipmentId) => get(`/critical-nodes/${shipmentId}`),
  graph: (routeId) => get(`/graph/${routeId}`),
  metrics: () => get("/metrics"),
  dataQuality: () => get("/data-quality"),
  routes: () => get("/routes"),
};