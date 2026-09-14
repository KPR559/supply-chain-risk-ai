import React from "react";
import { ArrowRight, CalendarClock, MapPin, Navigation, Ship } from "lucide-react";
import { formatDate } from "../utils/helpers.js";
import { NA, statusClass } from "../models.js";

export default function ShipmentSummaryCard({ shipment, prediction, risk }) {
  const mc = prediction?.monte_carlo;
  const eta = mc?.expected_eta_date || shipment?.etaDate || null;
  const status = shipment?.status || "Unknown";
  const location = shipment?.location || null;

  return (
    <section className="panel summary-card" aria-label="Shipment summary">
      <div className="summary-id-row">
        <div className="summary-id-block">
          <span className="summary-label">Shipment</span>
          <span className="summary-id">{shipment?.id || prediction?.shipment_id || NA}</span>
        </div>
        <div className="summary-badges">
          <span className={`risk-pill ${statusClass(status)}`}>{status}</span>
          {risk && <span className={`risk-pill ${risk.band === "critical" ? "high" : risk.band}`}>{risk.label} risk</span>}
        </div>
      </div>

      <div className="summary-route">
        <span className="summary-stop">
          <MapPin size={16} aria-hidden="true" />
          <span className="summary-stop-value">{shipment?.origin || NA}</span>
        </span>
        <span className="summary-connector" aria-hidden="true">
          <span className="summary-line" />
          <ArrowRight size={17} />
        </span>
        <span className="summary-stop">
          <MapPin size={16} aria-hidden="true" />
          <span className="summary-stop-value">{shipment?.destination || NA}</span>
        </span>
      </div>

      <dl className="summary-facts">
        <div className="summary-fact highlight">
          <dt><Navigation size={14} aria-hidden="true" /> Current location</dt>
          <dd>{location || "Not tracked"}</dd>
        </div>
        <div className="summary-fact">
          <dt><Ship size={14} aria-hidden="true" /> Transport mode</dt>
          <dd>{shipment?.mode || NA}</dd>
        </div>
        <div className="summary-fact">
          <dt><CalendarClock size={14} aria-hidden="true" /> Expected arrival</dt>
          <dd>{eta ? formatDate(eta) : NA}</dd>
        </div>
      </dl>
    </section>
  );
}
