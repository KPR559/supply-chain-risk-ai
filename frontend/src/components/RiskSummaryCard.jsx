import React from "react";
import { NA, overallReason, riskBand } from "../models.js";

const BAND_COLOR = { low: "#22c55e", medium: "#f59e0b", high: "#ef4444", critical: "#ef4444" };

function Gauge({ score, band, label }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, Math.max(0, score / 100));
  return (
    <div className="gauge-wrap" role="img" aria-label={`Overall risk ${score} out of 100, ${label}`}>
      <svg viewBox="0 0 110 110" className="gauge-svg" aria-hidden="true">
        <circle cx="55" cy="55" r={R} fill="none" stroke="rgba(148,163,184,0.16)" strokeWidth="10" />
        <circle
          cx="55"
          cy="55"
          r={R}
          fill="none"
          stroke={BAND_COLOR[band] || "#38bdf8"}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(frac * C).toFixed(1)} ${C.toFixed(1)}`}
          transform="rotate(-90 55 55)"
        />
      </svg>
      <div className="gauge-center">
        <div className="gauge-score">{score}</div>
        <div className="gauge-den">/100</div>
      </div>
      <div className="gauge-band">
        <span className={`risk-pill big ${band === "critical" ? "high" : band}`}>{label.toUpperCase()}</span>
      </div>
    </div>
  );
}

export default function RiskSummaryCard({ prediction, explanation, critical, lastUpdated }) {
  const nodes = prediction?.node_predictions || [];
  const band = riskBand(nodes, prediction?.monte_carlo);
  const mainReason = overallReason({ prediction, explanation, critical });

  return (
    <section className="panel risk-card" aria-label="Risk summary">
      <h2>Risk Summary</h2>
      <Gauge score={band.score} band={band.band} label={band.label} />
      <p className="muted gauge-note">
        Score {band.score}/100 · from the highest checkpoint delay probability
        {band.escalated ? " · escalated by live disruption" : ""}
      </p>

      <dl className="risk-facts">
        <div className="risk-fact">
          <dt>Prediction confidence</dt>
          <dd className="muted" title="Confidence is not currently calculated by the prediction service.">
            Not available for this prediction
          </dd>
        </div>
        <div className="risk-fact">
          <dt>Risk trend</dt>
          <dd className="muted">Trend unavailable</dd>
        </div>
        <div className="risk-fact">
          <dt>Last updated</dt>
          <dd>{lastUpdated || NA}</dd>
        </div>
      </dl>

      <div className="risk-reason">
        <div className="summary-label">Main reason</div>
        <p>{mainReason}</p>
      </div>
    </section>
  );
}
