import React from "react";
import ComparePanel from "../components/ComparePanel.jsx";
import TabState from "../components/TabState.jsx";

export default function CompareRoutesView({ data }) {
  const { prediction, loading, apiError, onRetry } = data;
  const ready = Boolean(prediction);

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Route Comparison</div>
          <div className="view-sub">Which corridor performs best per objective</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!ready}
        emptyText="Nothing to compare yet — select a shipment to run the engine."
        loadingText="Loading comparison…"
      />

      {ready && (
        <section className="panel">
          <h2>Alternative Routes</h2>
          <ComparePanel prediction={prediction} />
        </section>
      )}
    </div>
  );
}
