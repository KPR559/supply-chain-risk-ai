import React from "react";
import Explanation from "../components/Explanation.jsx";
import KeyDriversTrend from "../components/KeyDriversTrend.jsx";

export default function RiskContributorsView({ data }) {
  const { prediction, explanation } = data;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Risk Contributors</div>
          <div className="view-sub">Which factors push delay risk up or down</div>
        </div>
      </div>

      <section className="panel">
        <h2>Factor Attribution</h2>
        <Explanation data={explanation} />
      </section>

      <section className="panel">
        <h2>Driver Trends</h2>
        <KeyDriversTrend explanation={explanation} nodes={prediction?.node_predictions} />
      </section>
    </div>
  );
}
