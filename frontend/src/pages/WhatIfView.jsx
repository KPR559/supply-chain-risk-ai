import React from "react";
import WhatIfPanel from "../components/WhatIfPanel.jsx";

export default function WhatIfView({ data }) {
  const { prediction } = data;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">What-if Simulator</div>
          <div className="view-sub">Stress-test the corridor — congestion, weather, closures</div>
        </div>
      </div>

      <section className="panel">
        <h2>Custom Scenario</h2>
        <WhatIfPanel prediction={prediction} />
      </section>

      <section className="panel">
        <h2>How to use</h2>
        <div className="howto">
          <ol>
            <li>Pick a preset (e.g. "Suez closed") or tune congestion × / weather +h on the scenario panel and run it.</li>
            <li>Read the baseline vs scenario Δ — how much the ETA P90 and expected days move.</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
