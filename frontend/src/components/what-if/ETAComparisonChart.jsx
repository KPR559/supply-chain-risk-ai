import React from "react";
import { formatEta } from "../../utils/whatIfUtils.js";

export default function ETAComparisonChart({ result }) {
  if (!result) return null;

  const base = result.baseline || {};
  const scen = result.scenario || {};

  const dataPoints = [
    { label: "Baseline P50", value: base.p50_eta_days, color: "#38bdf8", isBaseline: true },
    { label: "Scenario P50", value: scen.p50_eta_days, color: "#f59e0b", isBaseline: false },
    { label: "Baseline P90", value: base.p90_eta_days, color: "#38bdf8", isBaseline: true, opacity: 0.6 },
    { label: "Scenario P90", value: scen.p90_eta_days, color: "#f59e0b", isBaseline: false, opacity: 0.6 },
  ].filter((d) => d.value != null && d.value > 0);

  if (dataPoints.length === 0) return null;

  const maxVal = Math.max(...dataPoints.map((d) => d.value), 1);

  return (
    <section className="panel what-if-eta-chart">
      <h2>ETA Comparison</h2>
      <p className="muted">Baseline vs scenario arrival distribution (P50 / P90)</p>

      <div className="eta-chart">
        {dataPoints.map((point, idx) => (
          <div
            key={idx}
            className="eta-bar-row"
            style={{ "--bar-color": point.color, "--bar-opacity": point.opacity || 1 }}
          >
            <div className="eta-bar-label">
              <span className={`eta-badge ${point.isBaseline ? "baseline" : "scenario"}`}>
                {point.label}
              </span>
              <span className="eta-value">{formatEta(point.value)}</span>
            </div>
            <div className="eta-bar-track" role="img" aria-label={`${point.label}: ${formatEta(point.value)}`}>
              <div
                className="eta-bar-fill"
                style={{
                  width: `${(point.value / maxVal) * 100}%`,
                  backgroundColor: point.color,
                  opacity: point.opacity || 1,
                }}
              />
            </div>
          </div>
        ))}

        <div className="eta-chart-axis">
          <span>0</span>
          <span>{formatEta(maxVal)}</span>
        </div>
      </div>

      <div className="eta-legend">
        <span className="legend-item">
          <span className="legend-color baseline" />
          Baseline
        </span>
        <span className="legend-item">
          <span className="legend-color scenario" />
          Scenario
        </span>
        <span className="legend-item">
          <span className="legend-color p50" />
          P50 (median)
        </span>
        <span className="legend-item">
          <span className="legend-color p90" style={{ opacity: 0.6 }} />
          P90 (90th percentile)
        </span>
      </div>
    </section>
  );
}