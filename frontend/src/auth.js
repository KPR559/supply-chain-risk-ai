// Session handling for the dashboard.
// Credentials are verified by the backend (POST /api/v1/login) against the
// DuckDB users table (PBKDF2-hashed passwords). The client only keeps the
// opaque session token — never any password. A stored session is valid only
// if it carries a token (old client-side sessions are ignored).

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
    if (parsed && parsed.username && parsed.token) {
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

export function getSession() {
  return (
    readStore(storeOf("localStorage")) ||
    readStore(storeOf("sessionStorage"))
  );
}

export function saveSession(username, token, remember = true) {
  const payload = JSON.stringify({
    username,
    token,
    at: new Date().toISOString(),
  });
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
