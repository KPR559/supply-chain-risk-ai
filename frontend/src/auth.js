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

export function validate(username, password) {
  return (
    username.trim() === DEFAULT_CREDENTIALS.username &&
    password === DEFAULT_CREDENTIALS.password
  );
}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
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

export function saveSession(username) {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ username, at: new Date().toISOString() })
    );
  } catch {
    // storage unavailable (private mode) — session just won't persist
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
