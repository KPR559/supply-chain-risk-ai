import React from "react";
import CheckpointCards from "../components/CheckpointCards.jsx";
import NodeRiskTable from "../components/NodeRiskTable.jsx";
import TabState from "../components/TabState.jsx";

export default function CheckpointRiskView({ data }) {
  const { prediction, loading, apiError, onRetry } = data;
  const nodes = prediction?.node_predictions || [];
  const ready = nodes.length > 0;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Checkpoint Risk</div>
          <div className="view-sub">Per-checkpoint delay probability along the corridor</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!ready}
        emptyText="No checkpoint data yet — select a shipment to run the engine."
        loadingText="Scoring checkpoints…"
      />

      {ready && (
        <>
          <section className="panel compact">
            <h2>Risk at Each Checkpoint</h2>
            <CheckpointCards nodes={nodes} />
          </section>

          <section className="panel">
            <h2>Checkpoint Detail</h2>
            <NodeRiskTable nodes={nodes} />
          </section>
        </>
      )}
    </div>
  );
}
