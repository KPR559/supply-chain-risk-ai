const BASE = (import.meta.env.VITE_API_BASE || "/api/v1").replace(/\/$/, "");

function httpError(status, path, body) {
  const err = new Error(body?.detail || `${status}: ${path}`);
  err.status = status;
  return err;
}

async function get(path, { token = null } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { headers });
  } catch (e) {
    const err = new Error(`Network error: ${path}`);
    err.status = 0;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw httpError(res.status, path, body);
  }
  return res.json();
}

async function del(path, { token = null } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: "DELETE", headers });
  } catch (e) {
    const err = new Error(`Network error: ${path}`);
    err.status = 0;
    throw err;
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw httpError(res.status, path, errBody);
  }
  return res.json();
}

async function post(path, body, { token = null } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error(`Network error: ${path}`);
    err.status = 0;
    throw err;
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw httpError(res.status, path, errBody);
  }
  return res.json();
}

const ROUTE_ENDPOINTS = {
  asia_europe_suez: ["shanghai", "rotterdam"],
  asia_europe_cape: ["shanghai", "rotterdam"],
  trans_pacific: ["shanghai", "los_angeles"],
  asia_us_east_panama: ["shanghai", "new_york"],
  suez: ["shanghai", "rotterdam"],
  cape: ["shanghai", "rotterdam"],
  dubai: ["shanghai", "rotterdam"],
};

export const api = {
  health: () => get("/health"),
  login: (username, password) => post("/login", { username, password }),
  register: (username, password) => post("/register", { username, password }),
  me: (token) => get("/me", { token }),
  refresh: (refreshToken) => post("/refresh", {}, { token: refreshToken }),
  forgotPassword: (username) => post("/forgot-password", { username }),
  resetPassword: (token, newPassword) => post("/reset-password", { token, new_password: newPassword }),
  changePassword: (oldPassword, newPassword, token) => post("/change-password", { old_password: oldPassword, new_password: newPassword }, { token }),
  logout: (token) => post("/logout", {}, { token }),
  deleteAccount: (token) => del("/account", { token }),
  demo: () => get("/demo"),
  predict: (route, { nSim = null, deadlineDate = null } = {}) => {
    const [origin, destination] = ROUTE_ENDPOINTS[route] || ["shanghai", "rotterdam"];
    return post("/predict", {
      origin,
      destination,
      route_id: route,
      ...(nSim ? { n_sim: nSim } : {}),
      ...(deadlineDate ? { deadline_date: deadlineDate } : {}),
    });
  },
  whatif: (shipmentId, name, nodeId, adjustments) =>
    post("/what-if", { shipment_id: shipmentId, name, node_id: nodeId, adjustments }),
  compare: (shipmentId, objectives) =>
    post("/compare-routes", { shipment_id: shipmentId, objectives }),
  explain: (shipmentId) => get(`/explanation/${shipmentId}`),
  critical: (shipmentId) => get(`/critical-nodes/${shipmentId}`),
  llmExplain: ({ prediction, explanation = null, recommendations = null, panels = null, trend = null, nodeId = null, edge = null }) =>
    post("/llm/explain", {
      prediction,
      explanation,
      recommendations,
      panels,
      trend,
      node_id: nodeId,
      edge,
    }),
  llmChat: (prediction, question, history = []) =>
    post("/llm/chat", { prediction, question, history }),
  llmReport: (prediction, explanation = null, critical = null) =>
    post("/llm/report", { prediction, explanation, critical }),
  graph: (routeId) => get(`/graph/${routeId}`),
  graphs: () => get("/graphs"),
  metrics: () => get("/metrics"),
  dataQuality: () => get("/data-quality"),
  routes: () => get("/routes"),
};