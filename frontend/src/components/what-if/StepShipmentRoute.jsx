import React from "react";
import { formatEta } from "../../utils/whatIfUtils.js";

export default function StepShipmentRoute({ prediction, shipments, routeNodes, onNext }) {
  const mc = prediction?.monte_carlo || {};
  const percents = mc.percentiles || {};
  const routeName = prediction?.route_name || prediction?.route_id;
  const destLabel = prediction?.destination || "—";
  const originLabel = prediction?.origin || "—";

  return (
    <section className="panel wizard-step-panel">
      <h2>Shipment & Route</h2>
      <p className="muted">Review the shipment and corridor before building your scenario.</p>

      <div className="shipment-overview">
        <div className="shipment-overview-card">
          <div className="overview-label">Shipment</div>
          <div className="overview-value mono">{prediction?.shipment_id || "—"}</div>
        </div>
        <div className="shipment-overview-card">
          <div className="overview-label">Corridor</div>
          <div className="overview-value">{routeName}</div>
        </div>
        <div className="shipment-overview-card">
          <div className="overview-label">Route</div>
          <div className="overview-value">{originLabel} → {destLabel}</div>
        </div>
        <div className="shipment-overview-card">
          <div className="overview-label">Expected Transit</div>
          <div className="overview-value">{formatEta(mc.expected_days)}</div>
        </div>
        <div className="shipment-overview-card">
          <div className="overview-label">P90 ETA</div>
          <div className="overview-value">{formatEta(percents.p90)}</div>
        </div>
        <div className="shipment-overview-card">
          <div className="overview-label">Checkpoints</div>
          <div className="overview-value">{routeNodes.length}</div>
        </div>
      </div>

      <div className="route-strip">
        {routeNodes.map((n, i) => (
          <React.Fragment key={n.node_id}>
            {i > 0 && <div className="route-strip-link" aria-hidden="true" />}
            <div className="route-strip-node" title={n.label}>
              <span className="route-strip-seq">{i + 1}</span>
              <span className="route-strip-label">{n.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      <div className="wizard-step-actions">
        <button className="btn btn-primary" onClick={onNext}>
          Continue to Scenario Selection →
        </button>
      </div>
    </section>
  );
}