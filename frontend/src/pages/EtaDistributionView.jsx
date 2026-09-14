import React from "react";
import { Download } from "lucide-react";
import PercentileChart from "../components/PercentileChart.jsx";
import PercentileSummary from "../components/PercentileSummary.jsx";
import DeadlineRiskCard from "../components/DeadlineRiskCard.jsx";
import DatesSummary from "../components/DatesSummary.jsx";
import TabState from "../components/TabState.jsx";
import { daysBetween } from "../models.js";

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
  const expectedDays = mc?.expected_days;
  const sims = mc?.n_simulations;
  const deadline = mc?.deadline_date || selectedShipment?.requiredDate || null;
  const expectedEta = mc?.expected_eta_date || null;
  const p90Date = mc?.eta_date?.p90 || null;
  const hasDeadline = !!deadline;
  const buffer = daysBetween(deadline, expectedEta);

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">ETA Distribution</div>
          <div className="view-sub">
            {mc
              ? `Expected ${expectedDays != null ? expectedDays.toFixed(1) : "-"} days · ${
                  sims != null ? sims.toLocaleString() : "-"
                } simulations`
              : "Running simulation…"}
          </div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!mc}
        emptyText={
          !selectedShipment
            ? "Select a shipment to view ETA distribution."
            : "ETA distribution data is not available for this shipment."
        }
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

          <PercentileSummary mc={mc} />

          <DeadlineRiskCard mc={mc} deadline={deadline} hasDeadline={hasDeadline} />

          {hasDeadline && (
            <DatesSummary
              deadline={deadline}
              expectedEta={expectedEta}
              p90Date={p90Date}
              buffer={buffer}
            />
          )}
        </>
      )}
    </div>
  );
}