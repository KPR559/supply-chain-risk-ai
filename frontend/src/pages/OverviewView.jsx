import React from "react";
import SummaryCards from "../components/SummaryCards.jsx";
import RouteMap from "../components/RouteMap.jsx";
import CheckpointCards from "../components/CheckpointCards.jsx";
import PercentileChart from "../components/PercentileChart.jsx";
import RootCauseAnalysis from "../components/RootCauseAnalysis.jsx";
import ComparePanel from "../components/ComparePanel.jsx";
import AlertsPanel from "../components/AlertsPanel.jsx";
import KeyDriversTrend from "../components/KeyDriversTrend.jsx";
import DataSourcesHealth from "../components/DataSourcesHealth.jsx";
import RecentShipments from "../components/RecentShipments.jsx";
import WhatIfPanel from "../components/WhatIfPanel.jsx";

export default function OverviewView({ data }) {
  const { prediction, explanation, critical, health, dq, routesMeta } = data;

  return (
    <div className="view-stack">
      <SummaryCards prediction={prediction} />

      <div className="dashboard-grid">
        <div className="col-left">
          <section className="panel">
            <h2>Route & Risk Map</h2>
            <RouteMap graph={prediction?.route_id} nodes={prediction?.node_predictions} />
          </section>

          <section className="panel compact">
            <h2>Risk at Each Checkpoint</h2>
            <CheckpointCards nodes={prediction?.node_predictions} />
          </section>

          <section className="panel">
            <h2>Estimated Arrival Distribution</h2>
            <PercentileChart mc={prediction?.monte_carlo} />
          </section>

          <section className="panel compact">
            <h2>Early Warning Alerts</h2>
            <AlertsPanel nodes={prediction?.node_predictions} />
          </section>
        </div>

        <div className="col-right">
          <section className="panel">
            <h2>Root Cause Analysis</h2>
            <RootCauseAnalysis
              critical={critical}
              explanation={explanation}
              prediction={prediction}
            />
          </section>

          <section className="panel">
            <h2>Route Comparison</h2>
            <ComparePanel prediction={prediction} />
          </section>

          <section className="panel compact">
            <h2>Custom Scenario</h2>
            <WhatIfPanel prediction={prediction} />
          </section>

          <div className="bottom-trio">
            <section className="panel compact">
              <h2>Key Drivers Trend</h2>
              <KeyDriversTrend explanation={explanation} nodes={prediction?.node_predictions} />
            </section>
            <section className="panel compact">
              <h2>Data Sources Health</h2>
              <DataSourcesHealth health={health} dq={dq} />
            </section>
            <section className="panel compact">
              <h2>Recent Shipments</h2>
              <RecentShipments prediction={prediction} routesMeta={routesMeta} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}