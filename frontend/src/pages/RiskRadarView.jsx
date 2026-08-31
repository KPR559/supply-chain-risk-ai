import React from "react";
import NodeRiskTable from "../components/NodeRiskTable.jsx";
import CriticalNodes from "../components/CriticalNodes.jsx";
import CheckpointCards from "../components/CheckpointCards.jsx";
import Explanation from "../components/Explanation.jsx";

export default function RiskRadarView({ data }) {
  const { prediction, critical, explanation } = data;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Risk Radar</div>
          <div className="view-sub">Per-checkpoint risk profiling and critical-node attribution</div>
        </div>
      </div>

      <section className="panel compact">
        <h2>Risk at Each Checkpoint</h2>
        <CheckpointCards nodes={prediction?.node_predictions} />
      </section>

      <div className="view-grid-2">
        <section className="panel">
          <h2>Checkpoint Predictions</h2>
          <NodeRiskTable nodes={prediction?.node_predictions} />
        </section>
        <section className="panel">
          <h2>Critical Checkpoints</h2>
          <CriticalNodes data={critical} />
        </section>
      </div>

      <section className="panel">
        <h2>Driver Explainability</h2>
        <Explanation data={explanation} />
      </section>
    </div>
  );
}