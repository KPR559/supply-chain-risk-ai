import React from "react";
import { getDeadlineRiskLevel } from "../models.js";
import { formatDate } from "../utils/helpers.js";
import RiskBadge from "./RiskBadge.jsx";

export default function DeadlineRiskCard({ mc, deadline, hasDeadline }) {
  if (!hasDeadline || !deadline) {
    return (
      <section className="panel">
        <h2>Deadline Risk</h2>
        <div className="deadline-gap">
          <p className="muted">
            No required delivery date on this prediction. Set one on the shipment record to
            enable deadline risk.
          </p>
        </div>
      </section>
    );
  }

  const miss = mc?.p_miss_deadline ?? 0;
  const pct = Math.round(Number(miss) * 100);
  const tier = getDeadlineRiskLevel(miss);
  const sims = mc?.n_simulations;

  return (
    <section className="panel">
      <h2>Deadline Risk</h2>
      <div className="deadline-grid">
        <div className="deadline-side">
          <div className={`deadline-pct ${tier.cls}`}>{pct}%</div>
          <RiskBadge tone={tier.cls}>{tier.label}</RiskBadge>
        </div>
        <div className="deadline-meta">
          <p className="muted">
            {pct}% of {sims?.toLocaleString() ?? "—"} simulated arrivals land after{" "}
            <b>{formatDate(deadline)}</b>.
          </p>
          <div className="meta-line">
            <span>Simulations <b>{sims?.toLocaleString() ?? "—"}</b></span>
            <span>Deadline <b>{formatDate(deadline)}</b></span>
          </div>
        </div>
      </div>
    </section>
  );
}