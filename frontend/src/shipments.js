// Shipment registry: each shipment keeps its own independent record.
//
// Persisted to localStorage so user-added shipments survive reloads.
// `routeId` links a shipment to a corridor route (suez/cape/dubai) that the
// prediction engine understands; all other fields are free-form record info.

export const STATUSES = [
  "In Transit",
  "At Port",
  "Customs Hold",
  "Delayed",
  "Delivered",
];

export const PRIORITIES = ["Low", "Medium", "High", "Critical"];

export const ROUTE_IDS = ["suez", "cape", "dubai"];

const STORE_KEY = "scm.shipments.v1";
const SELECTED_KEY = "scm.selectedShipment.v1";

// Records are namespaced per account: every login gets an isolated registry.
// `userKey` is `${base}.${username}`; the old shared keys are adopted once
// (so pre-existing records move to whoever signs in first) and then removed.
function userKey(base, username) {
  return username ? `${base}.${username.toLowerCase()}` : base;
}

const SEED = [
  {
    id: "SHP001",
    origin: "Frankfurt, Germany",
    destination: "Mumbai, India",
    type: "Automotive Parts",
    mode: "Sea + Road",
    departureDate: "2026-09-10",
    etaDate: "2026-09-25",
    requiredDate: "2026-09-25",
    priority: "High",
    location: "Hamburg Port",
    status: "In Transit",
    routeId: "suez",
  },
  {
    id: "SHP002",
    origin: "Frankfurt, Germany",
    destination: "Chennai, India",
    type: "Electronics",
    mode: "Sea",
    departureDate: "2026-09-05",
    etaDate: "2026-10-02",
    requiredDate: "2026-10-01",
    priority: "Medium",
    location: "Cape of Good Hope",
    status: "In Transit",
    routeId: "cape",
  },
  {
    id: "SHP003",
    origin: "Frankfurt, Germany",
    destination: "Mumbai, India",
    type: "Pharmaceuticals",
    mode: "Sea + Air",
    departureDate: "2026-09-12",
    etaDate: "2026-09-28",
    requiredDate: "2026-09-26",
    priority: "Critical",
    location: "Jebel Ali Port",
    status: "Delayed",
    routeId: "dubai",
  },
];

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — registry just won't persist
  }
}

function drop(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function loadShipments(username) {
  const stored = read(userKey(STORE_KEY, username));
  if (Array.isArray(stored) && stored.length > 0) return stored;
  const legacy = read(STORE_KEY);
  if (Array.isArray(legacy) && legacy.length > 0) {
    // Adopt the old shared registry once, then drop it.
    write(userKey(STORE_KEY, username), legacy);
    drop(STORE_KEY);
    return legacy;
  }
  return SEED.map((s) => ({ ...s }));
}

export function saveShipments(list, username) {
  write(userKey(STORE_KEY, username), list);
}

export function loadSelectedId(username) {
  const saved = read(userKey(SELECTED_KEY, username));
  if (typeof saved === "string") return saved;
  const legacy = read(SELECTED_KEY);
  if (typeof legacy === "string") {
    write(userKey(SELECTED_KEY, username), legacy);
    drop(SELECTED_KEY);
    return legacy;
  }
  return null;
}

export function saveSelectedId(id, username) {
  write(userKey(SELECTED_KEY, username), id);
}

export function blankShipment() {
  return {
    id: "",
    origin: "",
    destination: "",
    type: "",
    mode: "",
    departureDate: "",
    etaDate: "",
    requiredDate: "",
    priority: "Medium",
    location: "",
    status: "In Transit",
    routeId: "suez",
  };
}
