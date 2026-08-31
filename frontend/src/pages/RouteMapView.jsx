import React from "react";
import RouteMap from "../components/RouteMap.jsx";
import CheckpointCards from "../components/CheckpointCards.jsx";
import PercentileChart from "../components/PercentileChart.jsx";
import NodeRiskTable from "../components/NodeRiskTable.jsx";

export default function RouteMapView({ data }) {
  const { prediction, routesMeta } = data;
  const route = prediction?.route_id;
  const routeName = routesMeta.find((r) => r.route_id === route)?.name || route;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Route & Risk Map</div>
          <div className="view-sub">
            {prediction?.shipment_id} · {routeName} · Frankfurt → India
          </div>
        </div>
      </div>

      <section className="panel">
        <RouteMap graph={route} nodes={prediction?.node_predictions} />
      </section>

      <section className="panel compact">
        <h2>Risk at Each Checkpoint</h2>
        <CheckpointCards nodes={prediction?.node_predictions} />
      </section>

      <div className="view-grid-2">
        <section className="panel">
          <h2>Checkpoint Detail</h2>
          <NodeRiskTable nodes={prediction?.node_predictions} />
        </section>
        <section className="panel">
          <h2>Estimated Arrival Distribution</h2>
          <PercentileChart mc={prediction?.monte_carlo} />
        </section>
      </div>
    </div>
  );
}