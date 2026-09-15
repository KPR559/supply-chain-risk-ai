import React, { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "../prefs.js";
import { DEFAULT_UI, loadUiPrefs, saveUiPrefs } from "../prefs.js";

const SIM_OPTIONS = [1000, 5000, 10000, 50000];

export default function SystemSettingsView({ data }) {
  const { nSim, onSimChange, loading, onBackToSettings } = data;
  const onBack = onBackToSettings;
  const [highRiskPct, setHighRiskPct] = useState(() => Math.round(loadPrefs().highRisk * 100));
  const [missRiskPct, setMissRiskPct] = useState(() => Math.round(loadPrefs().missRisk * 100));
  const [saved, setSaved] = useState(false);
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

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <button className="back-link" onClick={onBack} type="button">
            <ArrowLeft size={14} aria-hidden="true" /> Back to Settings
          </button>
          <div className="view-title">System Settings</div>
          <div className="view-sub">Application behavior, simulation, display, and alert preferences</div>
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
            <div className="metric-label">High-risk checkpoint &ge; (%)</div>
            <input
              type="number"
              min="1"
              max="99"
              value={highRiskPct}
              onChange={(e) => setHighRiskPct(Number(e.target.value))}
            />
          </div>
          <div className="metric-cell">
            <div className="metric-label">Deadline-miss alert &ge; (%)</div>
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
          {saved && <span className="muted">Saved&nbsp;&#10003;</span>}
        </div>
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
            <div className="metric-value">Demo &middot; TECHNOVA 2026</div>
          </div>
        </div>
      </section>
    </div>
  );
}
