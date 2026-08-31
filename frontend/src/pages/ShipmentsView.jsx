import React from "react";
import RecentShipments from "../components/RecentShipments.jsx";
import CheckpointCards from "../components/CheckpointCards.jsx";
import { delayDaysFromHours } from "../utils/helpers.js";

export default function ShipmentsView({ data }) {
  const { prediction, routesMeta } = data;
  const mc = prediction?.monte_carlo;
  const nodes = prediction?.node_predictions || [];

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Shipments</div>
          <div className="view-sub">Active shipments on the Frankfurt → India corridor</div>
        </div>
      </div>

      <section className="panel">
        <h2>Current Shipment</h2>
        <div className="shipment-card">
          <div className="shipment-card-main">
            <div className="shipment-idh">FRK-IND-9281 · {prediction?.route_name}</div>
            <div className="shipment-detail">
              <span>Expected arrival <b>{mc?.expected_days?.toFixed(1)} d</b></span>
              <span>P90 <b>{mc?.percentiles?.p90?.toFixed(1)} d</b></span>
              <span>Expected delay <b>{delayDaysFromHours(mc?.expected_delay_hours)}</b></span>
              <span>{mc?.n_simulations?.toLocaleString()} simulations</span>
            </div>
          </div>
          <div className="shipment-card-route">
            <CheckpointCards nodes={nodes} />
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>All Active Shipments</h2>
        <RecentShipments prediction={prediction} routesMeta={routesMeta} />
      </section>
    </div>
  );
}