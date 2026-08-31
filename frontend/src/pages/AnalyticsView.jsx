import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import MetricsPanel from "../components/MetricsPanel.jsx";
import KeyDriversTrend from "../components/KeyDriversTrend.jsx";
import PercentileChart from "../components/PercentileChart.jsx";
import CriticalNodes from "../components/CriticalNodes.jsx";

export default function AnalyticsView({ data }) {
  const { prediction, explanation, critical, dq } = data;
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
          <div className="view-title">Analytics</div>
          <div className="view-sub">Model performance, calibration and data quality</div>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}

      <div className="view-grid-2">
        <section className="panel">
          <h2>Model Metrics</h2>
          <MetricsPanel metrics={metrics} dq={dq} />
        </section>
        <section className="panel">
          <h2>Key Drivers Trend</h2>
          <KeyDriversTrend explanation={explanation} nodes={prediction?.node_predictions} />
        </section>
      </div>

      <div className="view-grid-2">
        <section className="panel">
          <h2>ETA Distribution</h2>
          <PercentileChart mc={prediction?.monte_carlo} />
        </section>
        <section className="panel">
          <h2>Critical Checkpoints</h2>
          <CriticalNodes data={critical} />
        </section>
      </div>
    </div>
  );
}