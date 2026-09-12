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

export default function LoginView({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const err = await onLogin(username.trim(), password, remember);
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
          <h2 className="login-title">Sign in</h2>

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

          <label className="remember-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Keep me signed in</span>
          </label>

          <button className="btn login-btn" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in →"}
          </button>

        </form>
      </main>
    </div>
  );
}
