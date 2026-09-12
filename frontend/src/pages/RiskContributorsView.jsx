import React from "react";
import Explanation from "../components/Explanation.jsx";
import KeyDriversTrend from "../components/KeyDriversTrend.jsx";
import TabState from "../components/TabState.jsx";

export default function RiskContributorsView({ data }) {
  const { prediction, explanation, loading, apiError, onRetry } = data;
  const ready = Boolean(explanation);

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Risk Contributors</div>
          <div className="view-sub">Which factors push delay risk up or down</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!ready}
        emptyText="No factor attribution yet — select a shipment to run the engine."
        loadingText="Attributing risk factors…"
      />

      {ready && (
        <>
          <section className="panel">
            <h2>Factor Attribution</h2>
            <Explanation data={explanation} />
          </section>

          <section className="panel">
            <h2>Driver Trends</h2>
            <KeyDriversTrend explanation={explanation} nodes={prediction?.node_predictions} />
          </section>
        </>
      )}
    </div>
  );
}
