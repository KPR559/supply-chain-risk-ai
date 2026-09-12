import React from "react";
import CriticalNodes from "../components/CriticalNodes.jsx";
import TabState from "../components/TabState.jsx";

export default function CriticalCheckpointsView({ data }) {
  const { critical, loading, apiError, onRetry } = data;
  const count = critical?.critical_nodes?.length || 0;
  const ready = count > 0;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Critical Checkpoints</div>
          <div className="view-sub">
            {count ? `Ranked by share of total shipment delay · ${count} checkpoints` : "Ranking delays…"}
          </div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!ready}
        emptyText="No ranking yet — select a shipment to run the engine."
        loadingText="Ranking checkpoints…"
      />

      {ready && (
        <section className="panel">
          <h2>Delay-Share Ranking</h2>
          <CriticalNodes data={critical} />
        </section>
      )}
    </div>
  );
}
