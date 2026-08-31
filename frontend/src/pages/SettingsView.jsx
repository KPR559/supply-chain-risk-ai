import React, { useState } from "react";

export default function SettingsView({ data, nSim, onNSimChange, onApply, onReset }) {
  const { health } = data;
  const config = health?.data || {};
  const [local, setLocal] = useState(nSim ?? 10000);
  const [applied, setApplied] = useState(false);

  const apply = () => {
    onNSimChange(local);
    onApply();
    setApplied(true);
    setTimeout(() => setApplied(false), 2500);
  };

  const reset = () => {
    setLocal(10000);
    onReset();
  };

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Settings</div>
          <div className="view-sub">Runtime options for predictions on this dashboard</div>
        </div>
      </div>

      <div className="view-grid-2">
        <section className="panel">
          <h2>Simulation</h2>
          <div className="setting-row">
            <div>
              <div className="setting-name">Monte Carlo simulations</div>
              <div className="setting-desc">
                Draws per route. Higher = smoother percentiles, slower response. Applies to the next prediction.
              </div>
            </div>
            <div className="setting-control">
              <input
                type="number"
                min="1000"
                max="50000"
                step="1000"
                value={local}
                onChange={(e) => setLocal(Math.max(1000, Math.min(50000, Number(e.target.value))))}
              />
              <div className="setting-range">
                <input
                  type="range"
                  min="1000"
                  max="50000"
                  step="1000"
                  value={local}
                  onChange={(e) => setLocal(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
          <div className="view-actions">
            <button className="btn" onClick={apply} disabled={applied}>
              {applied ? "Applied ✓" : "Apply & re-predict"}
            </button>
            <button className="btn ghost" onClick={reset}>Reset defaults</button>
          </div>
        </section>

        <section className="panel">
          <h2>Server Configuration</h2>
          <div className="metric-row">
            <span>Environment</span>
            <b>{config.app_env || "development"}</b>
          </div>
          <div className="metric-row">
            <span>Graph backend</span>
            <b>{config.graph_backend || "networkx"}</b>
          </div>
          <div className="metric-row">
            <span>NLP engine</span>
            <b>{config.nlp_engine || "local"}</b>
          </div>
          <div className="metric-row">
            <span>Default simulations</span>
            <b>{config.mc_simulations?.toLocaleString?.() || "10,000"}</b>
          </div>
          <div className="metric-row">
            <span>Model artifacts</span>
            <b>{(health?.models || []).join(", ") || "—"}</b>
          </div>
          <div className="note">
            Thresholds (delay &gt; {config.delay_threshold_hours ?? 24}h), decay half-life and API port are
            configured server-side in <span className="mono">.env</span>.
          </div>
        </section>
      </div>
    </div>
  );
}