import React, { useState } from "react";
import { api } from "../api.js";
import loginVideo from "../video/Screen Recording 2026-09-14 at 10.32.11\u202FPM.mov";

export default function LoginView({ onLogin, onRegister }) {
  const [mode, setMode] = useState("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotUser, setForgotUser] = useState("");
  const [forgotToken, setForgotToken] = useState("");
  const [forgotNewPw, setForgotNewPw] = useState("");
  const [forgotConfirm, setForgotConfirm] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState(null);
  const [forgotSuccess, setForgotSuccess] = useState(null);

  const isSignup = mode === "signup";

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setSuccess(null);
    setConfirm("");
    setShowForgot(false);
    setForgotError(null);
    setForgotSuccess(null);
  };

  const handleForgotRequest = async (e) => {
    e.preventDefault();
    setForgotBusy(true);
    setForgotError(null);
    setForgotSuccess(null);
    try {
      const res = await api.forgotPassword(forgotUser.trim());
      if (res.reset_token) {
        setForgotToken(res.reset_token);
        setForgotSuccess("Reset token generated — copy it and set a new password below.");
      } else {
        setForgotSuccess("If the account exists, a reset token was generated.");
      }
    } catch (err) {
      if (err.status === 429) setForgotError("Too many attempts, please wait a minute.");
      else setForgotError(err.message || "Failed to request reset.");
    } finally {
      setForgotBusy(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    if (forgotNewPw !== forgotConfirm) {
      setForgotError("Passwords do not match.");
      return;
    }
    if (forgotNewPw.length < 8) {
      setForgotError("New password must be at least 8 characters.");
      return;
    }
    setForgotBusy(true);
    setForgotError(null);
    try {
      await api.resetPassword(forgotToken.trim(), forgotNewPw);
      setForgotSuccess("Password reset — please sign in with your new password.");
      setForgotToken("");
      setForgotNewPw("");
      setForgotConfirm("");
      setShowForgot(false);
      setMode("signin");
      setSuccess("Password reset — please sign in.");
    } catch (err) {
      setForgotError(err.message || "Reset failed.");
    } finally {
      setForgotBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const user = username.trim();
    if (!user) {
      setError("Please enter your username.");
      setSuccess(null);
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      setSuccess(null);
      return;
    }
    if (isSignup && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (isSignup && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (isSignup) {
        const err = await onRegister(user, password);
        if (err) {
          setError(err);
        } else {
          setSuccess("Account created — please sign in.");
          setMode("signin");
          setPassword("");
          setConfirm("");
        }
      } else {
        const err = await onLogin(user, password, remember);
        if (err) setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <aside className="login-side">
        <video
          className="login-video"
          src={loginVideo}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
        />
        <div className="login-side-inner">
          <div className="login-side-brand">
            <div className="brand-logo login-logo">∞</div>
            <div>
              <div className="brand-name">LOGIX</div>
              <div className="brand-sub">AI Supply Chain Suite</div>
            </div>
          </div>

          <h1 className="login-hero">
            “See risks before they
            <br />
            become delays.”
          </h1>
        </div>
      </aside>

      <main className="login-main">
        <form className="login-card" onSubmit={submit} noValidate>
          <div className="login-brand">LOGIX</div>
          <p className="login-tagline-mobile">
            “See risks before they become delays.”
          </p>
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

          {error && (
            <div className="banner error login-error" role="alert">
              {error}
            </div>
          )}
          {success && (
            <div className="banner success login-success" role="status">
              {success}
            </div>
          )}

          <label className="login-field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              aria-invalid={!!error}
              placeholder="Enter your username"
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
                required
                aria-invalid={!!error}
                placeholder="Enter your password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
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
                required
                aria-invalid={!!error}
                placeholder="Confirm your password"
              />
            </label>
          )}
          {isSignup ? (
            <p className="login-hint">
              Username: 3–32 chars (letters, digits, <code>_ . -</code>) ·
              password: min 8 characters.
            </p>
          ) : (
            null
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

          {!isSignup && !showForgot && (
            <button type="button" className="link-btn" onClick={() => setShowForgot(true)}>
              Forgot password?
            </button>
          )}

          {showForgot && !isSignup && (
            <div className="forgot-panel">
              <h3 className="forgot-title">Reset password</h3>
              <p className="muted" style={{ fontSize: "12px" }}>
                Enter your username to get a reset token (demo: token is shown here).
              </p>
              {forgotError && <div className="banner error login-error" role="alert">{forgotError}</div>}
              {forgotSuccess && <div className="banner success login-success" role="status">{forgotSuccess}</div>}
              {!forgotToken ? (
                <form onSubmit={handleForgotRequest} className="forgot-form">
                  <label className="login-field">
                    <span>Username</span>
                    <input
                      type="text"
                      value={forgotUser}
                      onChange={(e) => setForgotUser(e.target.value)}
                      placeholder="Enter your username"
                    />
                  </label>
                  <button className="btn" type="submit" disabled={forgotBusy}>
                    {forgotBusy ? "Requesting…" : "Get reset token"}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setShowForgot(false)}>
                    Back to sign in
                  </button>
                </form>
              ) : (
                <form onSubmit={handleReset} className="forgot-form">
                  <label className="login-field">
                    <span>Reset token</span>
                    <input type="text" value={forgotToken} onChange={(e) => setForgotToken(e.target.value)} />
                  </label>
                  <label className="login-field">
                    <span>New password</span>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={forgotNewPw}
                      onChange={(e) => setForgotNewPw(e.target.value)}
                      placeholder="••••••••"
                    />
                  </label>
                  <label className="login-field">
                    <span>Confirm new password</span>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={forgotConfirm}
                      onChange={(e) => setForgotConfirm(e.target.value)}
                      placeholder="••••••••"
                    />
                  </label>
                  <button className="btn" type="submit" disabled={forgotBusy}>
                    {forgotBusy ? "Resetting…" : "Reset password"}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setShowForgot(false)}>
                    Back to sign in
                  </button>
                </form>
              )}
            </div>
          )}

        </form>
        <p className="login-foot">
          © 2026 LOGIX · Secure Supply Chain Intelligence
        </p>
      </main>
    </div>
  );
}
