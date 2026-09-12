const BASE = (import.meta.env.VITE_API_BASE || "/api/v1").replace(/\/$/, "");

async function get(path, { token = null } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `${res.status}: ${path}`);
  }
  return res.json();
}

async function del(path, { token = null } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `${res.status}: ${path}`);
  }
  return res.json();
}

async function post(path, body, { token = null } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
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
  login: (username, password) => post("/login", { username, password }),
  register: (username, password) => post("/register", { username, password }),
  me: (token) => get("/me", { token }),
  logout: (token) => post("/logout", {}, { token }),
  deleteAccount: (token) => del("/account", { token }),
  demo: () => get("/demo"),
  predict: (route, { nSim = null, deadlineDate = null } = {}) =>
    post("/predict", {
      origin: "frankfurt",
      destination: "final_destination",
      route_id: route,
      ...(nSim ? { n_sim: nSim } : {}),
      ...(deadlineDate ? { deadline_date: deadlineDate } : {}),
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