import React from "react";
import PercentileChart from "../components/PercentileChart.jsx";
import TabState from "../components/TabState.jsx";

export default function EtaDistributionView({ data }) {
  const { prediction, loading, apiError, onRetry } = data;
  const mc = prediction?.monte_carlo;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">ETA Distribution</div>
          <div className="view-sub">
            {mc
              ? `Expected ${mc.expected_days?.toFixed(1)} days · ${mc.n_simulations?.toLocaleString()} simulations`
              : "Running simulation…"}
          </div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!mc}
        emptyText="No simulation yet — select a shipment to run the engine."
        loadingText="Running Monte Carlo simulation…"
      />

      {mc && (
        <>
          <section className="panel">
            <h2>Estimated Arrival Distribution</h2>
            <PercentileChart mc={mc} />
          </section>

          <section className="panel compact">
            <h2>Percentiles (days)</h2>
            <div className="shipment-detail">
              <span>P10 <b>{mc.percentiles?.p10?.toFixed(1)}</b></span>
              <span>P25 <b>{mc.percentiles?.p25?.toFixed(1)}</b></span>
              <span>P50 <b>{mc.percentiles?.p50?.toFixed(1)}</b></span>
              <span>P80 <b>{mc.percentiles?.p80?.toFixed(1)}</b></span>
              <span>P90 <b>{mc.percentiles?.p90?.toFixed(1)}</b></span>
              <span>P95 <b>{mc.percentiles?.p95?.toFixed(1)}</b></span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
