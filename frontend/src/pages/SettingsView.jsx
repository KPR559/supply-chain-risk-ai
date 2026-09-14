import React, { useState } from "react";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "../prefs.js";
import { DEFAULT_UI, loadUiPrefs, saveUiPrefs } from "../prefs.js";
import { api } from "../api.js";
import { getSession } from "../auth.js";

const SIM_OPTIONS = [1000, 5000, 10000, 50000];

export default function SettingsView({ data }) {
  const { nSim, onSimChange, loading, user, onLogout, onDeleteAccount } = data;
  const [highRiskPct, setHighRiskPct] = useState(() => Math.round(loadPrefs().highRisk * 100));
  const [missRiskPct, setMissRiskPct] = useState(() => Math.round(loadPrefs().missRisk * 100));
  const [saved, setSaved] = useState(false);

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changeError, setChangeError] = useState(null);
  const [changeSuccess, setChangeSuccess] = useState(null);
  const [changeBusy, setChangeBusy] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [ui, setUi] = useState(() => loadUiPrefs());

  const setUiPref = (patch) => {
    setUi((prev) => saveUiPrefs({ ...prev, ...patch }));
  };

  const saveThresholds = () => {
    savePrefs({ highRisk: highRiskPct / 100, missRisk: missRiskPct / 100 });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const resetThresholds = () => {
    setHighRiskPct(Math.round(DEFAULT_PREFS.highRisk * 100));
    setMissRiskPct(Math.round(DEFAULT_PREFS.missRisk * 100));
    savePrefs(DEFAULT_PREFS);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleChangePw = async (e) => {
    e.preventDefault();
    if (newPw !== confirmPw) {
      setChangeError("New passwords do not match.");
      return;
    }
    if (newPw.length < 8) {
      setChangeError("New password must be at least 8 characters.");
      return;
    }
    setChangeBusy(true);
    setChangeError(null);
    setChangeSuccess(null);
    try {
      const token = getSession()?.token;
      await api.changePassword(oldPw, newPw, token);
      setChangeSuccess("Password changed — please sign in again.");
      setOldPw("");
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => {
        if (onLogout) onLogout();
      }, 1200);
    } catch (err) {
      setChangeError(err.message || "Change failed.");
    } finally {
      setChangeBusy(false);
    }
  };

  const doDelete = async () => {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const err = await onDeleteAccount();
      if (err) {
        setDeleteError(err);
        setConfirmingDelete(false);
      }
      // on success App signs out, returning to the login screen
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Settings</div>
          <div className="view-sub">Engine, alert and account preferences</div>
        </div>
      </div>

      <section className="panel">
        <h2>Monte Carlo Engine</h2>
        <p className="muted">
          Simulation runs per prediction. More runs tighten the ETA percentiles but take longer.
          Changing this re-runs the engine for the selected shipment.
        </p>
        <div className="route-toggles">
          {SIM_OPTIONS.map((n) => (
            <button
              key={n}
              className={`route-chip ${nSim === n ? "on active" : "on"}`}
              onClick={() => onSimChange && onSimChange(n)}
              disabled={loading}
              title={loading ? "Engine is running…" : `Re-run with ${n.toLocaleString()} simulations`}
            >
              <span className="chip-dot" />
              {n.toLocaleString()}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Display</h2>
        <p className="muted">Frontend-only preferences, stored in this browser.</p>
        <div className="setting-row">
          <span className="setting-label">Density</span>
          <span className="seg" role="group" aria-label="Display density">
            <button className={`seg-btn ${ui.density === "comfortable" ? "on" : ""}`} onClick={() => setUiPref({ density: "comfortable" })}>Comfortable</button>
            <button className={`seg-btn ${ui.density === "compact" ? "on" : ""}`} onClick={() => setUiPref({ density: "compact" })}>Compact</button>
          </span>
        </div>
        <div className="setting-row">
          <span className="setting-label">Default map layout</span>
          <span className="seg" role="group" aria-label="Default map layout">
            <button className={`seg-btn ${ui.mapLayout === "world" ? "on" : ""}`} onClick={() => setUiPref({ mapLayout: "world" })}>World</button>
            <button className={`seg-btn ${ui.mapLayout === "graph" ? "on" : ""}`} onClick={() => setUiPref({ mapLayout: "graph" })}>Graph</button>
          </span>
        </div>
        <div className="setting-row">
          <span className="setting-label">Toast notifications</span>
          <span className="seg" role="group" aria-label="Toast notifications">
            <button className={`seg-btn ${ui.toasts ? "on" : ""}`} onClick={() => setUiPref({ toasts: true })}>On</button>
            <button className={`seg-btn ${!ui.toasts ? "on" : ""}`} onClick={() => setUiPref({ toasts: false })}>Off</button>
          </span>
        </div>
        {(ui.density !== DEFAULT_UI.density || ui.mapLayout !== DEFAULT_UI.mapLayout || ui.toasts !== DEFAULT_UI.toasts) && (
          <div className="route-toggles" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => setUi(saveUiPrefs(DEFAULT_UI))}>Reset display defaults</button>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Alert Thresholds</h2>
        <p className="muted">
          Stored in this browser. The dashboard alerts drawer flags anything at or above these levels.
        </p>
        <div className="metric-strip">
          <div className="metric-cell">
            <div className="metric-label">High-risk checkpoint ≥ (%)</div>
            <input
              type="number"
              min="1"
              max="99"
              value={highRiskPct}
              onChange={(e) => setHighRiskPct(Number(e.target.value))}
            />
          </div>
          <div className="metric-cell">
            <div className="metric-label">Deadline-miss alert ≥ (%)</div>
            <input
              type="number"
              min="1"
              max="99"
              value={missRiskPct}
              onChange={(e) => setMissRiskPct(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="route-toggles" style={{ marginTop: 10 }}>
          <button className="btn" onClick={saveThresholds}>Save thresholds</button>
          <button className="btn ghost" onClick={resetThresholds}>Reset defaults</button>
          {saved && <span className="muted">Saved ✓</span>}
        </div>
      </section>

      <section className="panel">
        <h2>Account</h2>
        <p className="muted">Signed in as <b>{user || "—"}</b></p>
        <h3>Change password</h3>
        <form className="change-pw-form" onSubmit={handleChangePw}>
          {changeError && <div className="banner error login-error">{changeError}</div>}
          {changeSuccess && <div className="banner success login-success">{changeSuccess}</div>}
          <label className="login-field">
            <span>Current password</span>
            <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="••••••••" />
          </label>
          <label className="login-field">
            <span>New password</span>
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="••••••••" />
          </label>
          <label className="login-field">
            <span>Confirm new password</span>
            <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="••••••••" />
          </label>
          <div className="delete-confirm-actions">
            <button className="btn mini-btn" type="submit" disabled={changeBusy}>
              {changeBusy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>

        <h3>Danger zone</h3>
        {onDeleteAccount &&
          (confirmingDelete ? (
            <div className="delete-confirm">
              <span>
                Delete <b>{user}</b> forever?
              </span>
              <div className="delete-confirm-actions">
                <button
                  className="btn danger mini-btn"
                  onClick={doDelete}
                  disabled={deleteBusy}
                  title="Permanently delete this account"
                >
                  {deleteBusy ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  className="btn ghost mini-btn"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteError(null);
                  }}
                  disabled={deleteBusy}
                >
                  Keep
                </button>
              </div>
              {deleteError && <em className="form-error">{deleteError}</em>}
            </div>
          ) : (
            <div>
              <button
                className="btn danger mini-btn"
                onClick={() => setConfirmingDelete(true)}
                title="Permanently delete this account"
              >
                Delete account
              </button>
              {deleteError && <em className="form-error">{deleteError}</em>}
            </div>
          ))}
      </section>

      <section className="panel">
        <h2>About LOGIX</h2>
        <div className="metric-strip">
          <div className="metric-cell">
            <div className="metric-label">Product</div>
            <div className="metric-value">AI Supply Chain Suite</div>
          </div>
          <div className="metric-cell">
            <div className="metric-label">Version</div>
            <div className="metric-value">1.0.0</div>
          </div>
          <div className="metric-cell">
            <div className="metric-label">Build</div>
            <div className="metric-value">Demo · TECHNOVA 2026</div>
          </div>
        </div>
      </section>
    </div>
  );
}
