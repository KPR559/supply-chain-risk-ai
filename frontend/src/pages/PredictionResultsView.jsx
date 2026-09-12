import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import SummaryCards from "../components/SummaryCards.jsx";
import MetricsPanel from "../components/MetricsPanel.jsx";
import TabState from "../components/TabState.jsx";

export default function PredictionResultsView({ data }) {
  const { prediction, dq, loading, apiError, onRetry } = data;
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .metrics()
      .then((m) => alive && setMetrics(m))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Prediction Results</div>
          <div className="view-sub">
            {prediction
              ? `${prediction.shipment_id} · ${prediction.route_name} · Monte Carlo ETA`
              : "Running prediction engine…"}
          </div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!prediction}
        emptyText="No prediction yet — select a shipment to run the engine."
        loadingText="Running prediction engine…"
      />

      {prediction && <SummaryCards prediction={prediction} />}
      {error && <div className="banner error">{error}</div>}

      <section className="panel">
        <h2>Model Confidence</h2>
        <MetricsPanel metrics={metrics} dq={dq} />
      </section>
    </div>
  );
}
