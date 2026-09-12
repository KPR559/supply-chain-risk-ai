import React from "react";
import RootCauseAnalysis from "../components/RootCauseAnalysis.jsx";
import TabState from "../components/TabState.jsx";

export default function ChartsGraphsView({ data }) {
  const { prediction, explanation, critical, loading, apiError, onRetry } = data;
  const ready = Boolean(
    critical?.critical_nodes?.length || explanation?.top_factors?.length
  );

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Charts & Graphs</div>
          <div className="view-sub">Delay composition: impact pathway, drivers and mode split</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!ready}
        emptyText="No composition data yet — select a shipment to run the engine."
        loadingText="Composing charts…"
      />

      {ready && (
        <section className="panel">
          <h2>Root Cause Composition</h2>
          <RootCauseAnalysis
            critical={critical}
            explanation={explanation}
            prediction={prediction}
          />
        </section>
      )}
    </div>
  );
}
