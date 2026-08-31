import React from "react";
import WhatIfPanel from "../components/WhatIfPanel.jsx";
import ComparePanel from "../components/ComparePanel.jsx";

export default function SimulatorView({ data }) {
  const { prediction } = data;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">What-if Simulator</div>
          <div className="view-sub">
            Stress-test the corridor — congestion, weather, closures — and compare alternative routes
          </div>
        </div>
      </div>

      <div className="view-grid-2">
        <section className="panel">
          <h2>Custom Scenario</h2>
          <WhatIfPanel prediction={prediction} />
        </section>
        <section className="panel">
          <h2>Route Comparison</h2>
          <ComparePanel prediction={prediction} />
        </section>
      </div>

      <section className="panel">
        <h2>How to use</h2>
        <div className="howto">
          <ol>
            <li>Pick a preset (e.g. "Suez closed") or tune congestion × / weather +h on the scenario panel and run it.</li>
            <li>Read the baseline vs scenario Δ — how much the ETA P90 and expected days move.</li>
            <li>Use the route comparison to see which corridor performs best under the objective (fastest / lowest risk / balanced).</li>
          </ol>
        </div>
      </section>
    </div>
  );
}