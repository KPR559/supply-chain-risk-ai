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

export function loadShipments() {
  const stored = read(STORE_KEY);
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return SEED.map((s) => ({ ...s }));
}

export function saveShipments(list) {
  write(STORE_KEY, list);
}

export function loadSelectedId() {
  const saved = read(SELECTED_KEY);
  return typeof saved === "string" ? saved : null;
}

export function saveSelectedId(id) {
  write(SELECTED_KEY, id);
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
