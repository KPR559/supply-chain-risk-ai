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

export const ROUTE_IDS = ["asia_europe_suez", "asia_europe_cape", "trans_pacific", "asia_us_east_panama"];

// Back-compat: old localStorage may still hold suez/cape/dubai
const ROUTE_ALIAS = { suez: "asia_europe_suez", cape: "asia_europe_cape", dubai: "asia_europe_suez" };
function migrateRouteId(id) {
  return ROUTE_ALIAS[id] || id;
}

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
    origin: "Shanghai, China",
    destination: "Rotterdam, Netherlands",
    type: "Automotive Parts",
    mode: "Sea",
    departureDate: "2026-09-10",
    etaDate: "2026-10-05",
    requiredDate: "2026-10-05",
    priority: "High",
    location: "Suez Canal",
    status: "In Transit",
    routeId: "asia_europe_suez",
  },
  {
    id: "SHP002",
    origin: "Shanghai, China",
    destination: "Rotterdam, Netherlands",
    type: "Electronics",
    mode: "Sea",
    departureDate: "2026-09-05",
    etaDate: "2026-10-10",
    requiredDate: "2026-10-08",
    priority: "Medium",
    location: "Cape of Good Hope",
    status: "In Transit",
    routeId: "asia_europe_cape",
  },
  {
    id: "SHP003",
    origin: "Shanghai, China",
    destination: "Los Angeles, USA",
    type: "Pharmaceuticals",
    mode: "Sea",
    departureDate: "2026-09-12",
    etaDate: "2026-09-26",
    requiredDate: "2026-09-25",
    priority: "Critical",
    location: "Taiwan Strait",
    status: "Delayed",
    routeId: "trans_pacific",
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

function migrateList(list) {
  let changed = false;
  const out = list.map((s) => {
    const nid = migrateRouteId(s.routeId);
    if (nid !== s.routeId) { changed = true; return { ...s, routeId: nid }; }
    return s;
  });
  return { list: out, changed };
}

export function loadShipments(username) {
  const stored = read(userKey(STORE_KEY, username));
  if (stored !== null) {
    const arr = Array.isArray(stored) ? stored : [];
    const { list, changed } = migrateList(arr);
    if (changed) write(userKey(STORE_KEY, username), list);
    return list;
  }
  // Fallback: if this username has no stored data yet, check whether the
  // built-in "admin" key still holds shipments from a recent rename.
  if (username && username.toLowerCase() !== "admin") {
    const adminData = read(userKey(STORE_KEY, "admin"));
    if (adminData !== null && Array.isArray(adminData) && adminData.length > 0) {
      write(userKey(STORE_KEY, username), adminData);
      drop(userKey(STORE_KEY, "admin"));
      return migrateList(adminData).list;
    }
  }
  const legacy = read(STORE_KEY);
  if (Array.isArray(legacy) && legacy.length > 0) {
    const { list } = migrateList(legacy);
    write(userKey(STORE_KEY, username), list);
    drop(STORE_KEY);
    return list;
  }
  if (username && username.toLowerCase() === "admin") {
    return SEED.map((s) => ({ ...s }));
  }
  return [];
}

export function saveShipments(list, username) {
  write(userKey(STORE_KEY, username), list);
}

export function loadSelectedId(username) {
  const saved = read(userKey(SELECTED_KEY, username));
  if (typeof saved === "string") return saved;
  // Fallback: check the "admin" key for a recently renamed account
  if (username && username.toLowerCase() !== "admin") {
    const adminSel = read(userKey(SELECTED_KEY, "admin"));
    if (typeof adminSel === "string") {
      write(userKey(SELECTED_KEY, username), adminSel);
      drop(userKey(SELECTED_KEY, "admin"));
      return adminSel;
    }
  }
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

export function migrateUserKeys(oldUsername, newUsername) {
  // Account rename: move the shipment registry and selection under the new
  // per-account namespace so no stored data is orphaned.
  if (!oldUsername || !newUsername || oldUsername.toLowerCase() === newUsername.toLowerCase()) return;
  const fromStore = userKey(STORE_KEY, oldUsername);
  const toStore = userKey(STORE_KEY, newUsername);
  const fromSel = userKey(SELECTED_KEY, oldUsername);
  const toSel = userKey(SELECTED_KEY, newUsername);
  const oldData = read(fromStore);
  if (oldData !== null) {
    write(toStore, oldData);
    drop(fromStore);
  }
  const oldSel = read(fromSel);
  if (oldSel !== null) {
    write(toSel, oldSel);
    drop(fromSel);
  }
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
    routeId: "asia_europe_suez",
  };
}
