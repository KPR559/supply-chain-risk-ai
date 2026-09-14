import React from "react";
import { Download } from "lucide-react";
import PercentileChart from "../components/PercentileChart.jsx";
import TabState from "../components/TabState.jsx";
import { formatDate, riskClass } from "../utils/helpers.js";

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(a + "T00:00:00") - new Date(b + "T00:00:00");
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86400000);
}

export default function EtaDistributionView({ data }) {
  const { prediction, selectedShipment, loading, apiError, onRetry, notify } = data;

  const downloadChart = () => {
    const svg = document.querySelector(".distribution-chart .dist-svg");
    if (!svg) {
      if (notify) notify("Chart is not available for download.");
      return;
    }
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logix-eta-chart-${prediction?.shipment_id || "chart"}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (notify) notify("ETA chart downloaded (SVG).");
  };
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
          <div className="view-title">ETA Distribution</div>
          <div className="view-sub">
            {mc
              ? `Expected ${mc.expected_days?.toFixed(1)} days · ${mc.n_simulations?.toLocaleString()} simulations`
              : "Running simulation…"}
          </div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!mc}
        emptyText="No simulation yet — select a shipment to run the engine."
        loadingText="Running Monte Carlo simulation…"
      />

      {mc && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Estimated Arrival Distribution</h2>
              <button className="btn ghost mini-btn" onClick={downloadChart}>
                <Download size={13} aria-hidden="true" /> Chart (SVG)
              </button>
            </div>
            <PercentileChart mc={mc} />
          </section>

          <section className="panel compact">
            <h2>Percentiles (days)</h2>
            <div className="shipment-detail">
              <span>P10 <b>{mc.percentiles?.p10 != null ? `${mc.percentiles.p10.toFixed(1)} days` : "Not available"}</b></span>
              <span>P25 <b>{mc.percentiles?.p25 != null ? `${mc.percentiles.p25.toFixed(1)} days` : "Not available"}</b></span>
              <span>P50 <b>{mc.percentiles?.p50 != null ? `${mc.percentiles.p50.toFixed(1)} days` : "Not available"}</b></span>
              <span>P80 <b>{mc.percentiles?.p80 != null ? `${mc.percentiles.p80.toFixed(1)} days` : "Not available"}</b></span>
              <span>P90 <b>{mc.percentiles?.p90 != null ? `${mc.percentiles.p90.toFixed(1)} days` : "Not available"}</b></span>
              <span>P95 <b>{mc.percentiles?.p95 != null ? `${mc.percentiles.p95.toFixed(1)} days` : "Not available"}</b></span>
            </div>
          </section>

          <section className="panel">
            <h2>Deadline Risk</h2>
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
