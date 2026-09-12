import React, { useState } from "react";
import { DEFAULT_CREDENTIALS, validate } from "../auth.js";

export default function LoginView({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    if (validate(username, password)) {
      setError(null);
      onLogin(username.trim());
    } else {
      setError("Invalid username or password.");
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">LOGIX</div>
        <h1 className="login-title">Supply Chain Intelligence</h1>
        <p className="login-sub">
          Frankfurt → India · Sign in to open the resilience dashboard
        </p>

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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </label>

        <button className="btn login-btn" type="submit">
          Sign in
        </button>

        <p className="login-hint">
          Demo credentials — username <code>{DEFAULT_CREDENTIALS.username}</code>
          {" · "}password <code>{DEFAULT_CREDENTIALS.password}</code>
        </p>
      </form>
    </div>
  );
}
