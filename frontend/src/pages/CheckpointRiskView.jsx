import React from "react";
import CheckpointCards from "../components/CheckpointCards.jsx";
import NodeRiskTable from "../components/NodeRiskTable.jsx";

export default function CheckpointRiskView({ data }) {
  const { prediction } = data;
  const nodes = prediction?.node_predictions || [];

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Checkpoint Risk</div>
          <div className="view-sub">Per-checkpoint delay probability along the corridor</div>
        </div>
      </div>

      <section className="panel compact">
        <h2>Risk at Each Checkpoint</h2>
        <CheckpointCards nodes={nodes} />
      </section>

      <section className="panel">
        <h2>Checkpoint Detail</h2>
        <NodeRiskTable nodes={nodes} />
      </section>
    </div>
  );
}
