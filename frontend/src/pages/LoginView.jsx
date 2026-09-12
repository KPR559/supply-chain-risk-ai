import React, { useState } from "react";
import { DEFAULT_CREDENTIALS } from "../auth.js";

const HIGHLIGHTS = [
  {
    icon: "◉",
    title: "Corridor risk scoring",
    text: "Per-checkpoint delay probability across Suez, Cape and Dubai routes.",
  },
  {
    icon: "◔",
    title: "Probabilistic ETA",
    text: "10,000-run Monte Carlo arrivals with deadline-miss risk.",
  },
  {
    icon: "⬡",
    title: "What-if simulator",
    text: "Stress-test congestion, weather and closures before they happen.",
  },
  {
    icon: "◫",
    title: "Explainable drivers",
    text: "SHAP-style attribution shows exactly what pushes risk up.",
  },
];

export default function LoginView({ onLogin, onRegister }) {
  const [mode, setMode] = useState("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isSignup = mode === "signup";

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setConfirm("");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (isSignup && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const err = isSignup
        ? await onRegister(username.trim(), password, remember)
        : await onLogin(username.trim(), password, remember);
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <aside className="login-side">
        <div className="login-side-inner">
          <div className="login-side-brand">
            <div className="brand-logo login-logo">∞</div>
            <div>
              <div className="brand-name">LOGIX</div>
              <div className="brand-sub">AI Supply Chain Suite</div>
            </div>
          </div>

          <h1 className="login-hero">
            Predictive risk &amp; decision intelligence for global supply chains
          </h1>

          <ul className="login-points">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title}>
                <span className="login-point-icon">{h.icon}</span>
                <div>
                  <div className="login-point-title">{h.title}</div>
                  <div className="login-point-text">{h.text}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="login-side-stats">
            <div><b>10</b><span>checkpoints</span></div>
            <div><b>3</b><span>corridors</span></div>
            <div><b>10k</b><span>simulations</span></div>
          </div>
        </div>
      </aside>

      <main className="login-main">
        <form className="login-card" onSubmit={submit}>
          <div className="login-brand">LOGIX</div>
          <h2 className="login-title">{isSignup ? "Create account" : "Sign in"}</h2>

          <div className="auth-tabs" role="tablist" aria-label="Sign in or create account">
            <button
              type="button"
              role="tab"
              aria-selected={!isSignup}
              className={`auth-tab ${!isSignup ? "active" : ""}`}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isSignup}
              className={`auth-tab ${isSignup ? "active" : ""}`}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
          </div>

          {error && <div className="banner error login-error">{error}</div>}

          <label className="login-field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              placeholder="admin"
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <div className="password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? "Hide password" : "Show password"}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "◠" : "◉"}
              </button>
            </div>
          </label>

          {isSignup && (
            <label className="login-field">
              <span>Confirm password</span>
              <input
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </label>
          )}
          {isSignup ? (
            <p className="login-hint">
              Username: 3–32 chars (letters, digits, <code>_ . -</code>) ·
              password: min 8 characters.
            </p>
          ) : (
            <p className="login-hint">
              Demo credentials — username <code>{DEFAULT_CREDENTIALS.username}</code>
              {" · "}password <code>{DEFAULT_CREDENTIALS.password}</code>
            </p>
          )}

          <label className="remember-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Keep me signed in</span>
          </label>

          <button className="btn login-btn" type="submit" disabled={busy}>
            {busy ? (isSignup ? "Creating account…" : "Signing in…") : isSignup ? "Create account →" : "Sign in →"}
          </button>

        </form>
      </main>
    </div>
  );
}
