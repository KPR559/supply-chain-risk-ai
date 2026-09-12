// Demo-grade auth gate for the dashboard.
//
// The default credentials below are intentionally simple so reviewers can
// sign in without setup. This is NOT real security (no backend session, no
// hashing) — it only gates the UI. For production, replace `validate()`
// with a call to a backend login endpoint and store a proper token.

export const DEFAULT_CREDENTIALS = {
  username: "admin",
  password: "admin123",
};

const SESSION_KEY = "scm.auth.v1";

function storeOf(name) {
  try {
    const store =
      typeof globalThis !== "undefined" ? globalThis[name] : undefined;
    return store || null;
  } catch {
    return null;
  }
}

function readStore(store) {
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.username === DEFAULT_CREDENTIALS.username) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStore(store, payload) {
  if (!store) return;
  try {
    store.setItem(SESSION_KEY, payload);
  } catch {
    // storage unavailable (private mode) — session just won't persist
  }
}

function dropStore(store) {
  if (!store) return;
  try {
    store.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function validate(username, password) {
  return (
    username.trim() === DEFAULT_CREDENTIALS.username &&
    password === DEFAULT_CREDENTIALS.password
  );
}

export function getSession() {
  return (
    readStore(storeOf("localStorage")) ||
    readStore(storeOf("sessionStorage"))
  );
}

export function saveSession(username, remember = true) {
  const payload = JSON.stringify({ username, at: new Date().toISOString() });
  if (remember) {
    dropStore(storeOf("sessionStorage"));
    writeStore(storeOf("localStorage"), payload);
  } else {
    dropStore(storeOf("localStorage"));
    writeStore(storeOf("sessionStorage"), payload);
  }
}

export function clearSession() {
  dropStore(storeOf("localStorage"));
  dropStore(storeOf("sessionStorage"));
}
