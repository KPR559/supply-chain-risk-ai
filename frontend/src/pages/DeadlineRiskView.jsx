import React from "react";
import TabState from "../components/TabState.jsx";
import { formatDate, riskClass } from "../utils/helpers.js";

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(a + "T00:00:00") - new Date(b + "T00:00:00");
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86400000);
}

export default function DeadlineRiskView({ data }) {
  const { prediction, selectedShipment, loading, apiError, onRetry } = data;
  const mc = prediction?.monte_carlo;
  const miss = mc?.p_miss_deadline ?? 0;
  const pct = Math.round(miss * 100);
  const deadline = mc?.deadline_date || selectedShipment?.requiredDate || null;
  const expectedEta = mc?.expected_eta_date || null;
  const buffer = daysBetween(deadline, expectedEta);

  const verdict =
    !deadline || mc?.deadline_date == null
      ? { label: "No deadline set", cls: "" }
      : pct >= 60
        ? { label: "Will likely miss", cls: "high" }
        : pct >= 35
          ? { label: "At risk", cls: "med" }
          : { label: "On track", cls: "low" };

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Deadline Risk</div>
          <div className="view-sub">Probability of arriving after the required delivery date</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!prediction}
        emptyText="No prediction yet — select a shipment to run the engine."
        loadingText="Evaluating deadline risk…"
      />

      {prediction && (
        <>
          <section className="panel">
            <h2>Miss Probability</h2>
            {deadline && mc?.deadline_date != null ? (
              <div className="deadline-hero">
                <div className={`deadline-pct ${verdict.cls}`}>{pct}%</div>
                <div>
                  <div>
                    <span className={`risk-pill ${verdict.cls || riskClass(miss)}`}>{verdict.label}</span>
                  </div>
                  <p className="muted">
                    {pct}% of {mc.n_simulations?.toLocaleString()} simulated arrivals land after{" "}
                    <b>{formatDate(deadline)}</b>.
                  </p>
                </div>
              </div>
            ) : (
              <p className="muted">
                No required delivery date on this prediction. Set one on the shipment record to
                enable deadline risk.
              </p>
            )}
          </section>
          {deadline && (
            <section className="panel compact">
              <h2>Dates</h2>
              <div className="shipment-detail">
                <span>Required delivery <b>{formatDate(deadline)}</b></span>
                <span>Expected ETA <b>{formatDate(expectedEta)}</b></span>
                <span>P90 arrival <b>{formatDate(mc?.eta_date?.p90)}</b></span>
                {buffer != null && (
                  <span>
                    Buffer <b>{buffer >= 0 ? `+${buffer} days` : `${buffer} days overdue`}</b>
                  </span>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
