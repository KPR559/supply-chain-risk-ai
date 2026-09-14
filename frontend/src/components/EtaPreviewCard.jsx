import React from "react";
import { ArrowRight } from "lucide-react";
import PercentileChart from "./PercentileChart.jsx";
import { formatDate } from "../utils/helpers.js";
import { NA, fmtPct, missVerdict } from "../models.js";

export default function EtaPreviewCard({ prediction, selectedShipment, onNavigate }) {
  const mc = prediction?.monte_carlo;
  if (!mc) return null;
  const miss = mc.p_miss_deadline ?? 0;
  const hasDeadline = mc.deadline_date != null;
  const verdict = missVerdict(miss, hasDeadline);

  return (
    <section className="panel" aria-label="ETA distribution preview">
      <div className="panel-head">
        <div>
          <h2>ETA Distribution</h2>
          <p className="muted">
            Risk-adjusted arrival uncertainty · {mc.n_simulations?.toLocaleString() ?? NA} Monte Carlo simulations
          </p>
        </div>
        {onNavigate && (
          <button className="btn ghost mini-btn" onClick={() => onNavigate("eta")}>
            Open ETA View <ArrowRight size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      <PercentileChart mc={mc} />
      <div className="metric-strip eta-summary">
        <div className="metric-cell">
          <div className="metric-label">Most likely arrival</div>
          <div className="metric-value">{mc.expected_eta_date ? formatDate(mc.expected_eta_date) : NA}</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">P90 arrival</div>
          <div className="metric-value">{mc.eta_date?.p90 ? formatDate(mc.eta_date.p90) : NA}</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">Deadline miss risk</div>
          <div className="metric-value">{hasDeadline ? fmtPct(miss) : NA}</div>
        </div>
      </div>
      {hasDeadline ? (
        <p className="muted eta-verdict">
          <span className={`risk-pill ${verdict.cls}`}>{verdict.label}</span>{" "}
          Customer deadline {formatDate(mc.deadline_date || selectedShipment?.requiredDate)}
          {miss >= 0.6
            ? " — the current prediction is unlikely to meet the customer deadline."
            : miss >= 0.35
              ? " — the current prediction is at risk of missing the customer deadline."
              : " — the current prediction is expected to meet the customer deadline."}
        </p>
      ) : (
        <p className="muted eta-verdict">
          No customer deadline set — set a required delivery date on the shipment to enable deadline risk.
        </p>
      )}
    </section>
  );
}
