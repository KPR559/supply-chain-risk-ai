import React from "react";
import { formatEta, formatDelay, formatPercent, formatResilience, formatChange, getChangeClass } from "../../utils/whatIfUtils.js";

export default function BaselineVsScenarioComparison({ baseline, scenario }) {
  if (!baseline || !scenario) return null;

  const baselineMc = baseline.monte_carlo || baseline;
  const scenarioMc = scenario.monte_carlo || scenario;

  // Helper to safely get values
  const getBase = (path) => {
    const keys = path.split(".");
    let val = baselineMc;
    for (const k of keys) {
      val = val?.[k];
    }
    return val;
  };

  const getScen = (path) => {
    const keys = path.split(".");
    let val = scenarioMc;
    for (const k of keys) {
      val = val?.[k];
    }
    return val;
  };

  const comparisonMetrics = [
    {
      label: "Expected Transit Duration",
      baseVal: getBase("expected_eta_days") ?? getBase("expected_days"),
      scenVal: getScen("expected_eta_days") ?? getScen("expected_days"),
      format: formatEta,
      unit: "days",
      inverse: false, // lower is better
    },
    {
      label: "Expected Delay",
      baseVal: getBase("expected_delay_hours") ? getBase("expected_delay_hours") / 24 : null,
      scenVal: getScen("expected_delay_hours") ? getScen("expected_delay_hours") / 24 : null,
      format: formatDelay,
      unit: "days",
      inverse: true, // lower is better
    },
    {
      label: "P50 ETA",
      baseVal: getBase("percentiles.p50") || getBase("expected_eta_days"),
      scenVal: getScen("percentiles.p50") || getScen("expected_eta_days"),
      format: formatEta,
      unit: "days",
      inverse: true,
    },
    {
      label: "P90 ETA",
      baseVal: getBase("percentiles.p90"),
      scenVal: getScen("percentiles.p90"),
      format: formatEta,
      unit: "days",
      inverse: true,
    },
    {
      label: "Deadline Miss Probability",
      baseVal: getBase("p_miss_deadline"),
      scenVal: getScen("p_miss_deadline"),
      format: formatPercent,
      unit: "",
      inverse: true,
      isPercent: true,
    },
    {
      label: "Resilience Score",
      baseVal: getBase("resilience_score"),
      scenVal: getScen("resilience_score"),
      format: formatResilience,
      unit: "",
      inverse: false, // higher is better
    },
  ];

  return (
    <section className="panel what-if-comparison">
      <h2>Baseline vs Scenario</h2>
      <p className="muted">Comparison of key metrics between baseline and selected scenario</p>

      <div className="comparison-table-container">
        <table className="data-table comparison-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th className="numeric">Baseline</th>
              <th className="numeric">Scenario</th>
              <th className="numeric">Change</th>
            </tr>
          </thead>
          <tbody>
            {comparisonMetrics.map((metric, idx) => {
              const base = metric.baseVal;
              const scen = metric.scenVal;
              const hasValues = base != null && scen != null && !Number.isNaN(base) && !Number.isNaN(scen);

              let change = null;
              let changeClass = "neutral";

              if (hasValues) {
                if (metric.isPercent) {
                  change = (scen - base) * 100; // percentage points
                } else {
                  change = scen - base;
                }
                changeClass = getChangeClass(change, metric.inverse);
              }

              return (
                <tr key={idx} className={metric.inverse ? "inverse-metric" : ""}>
                  <td className="metric-label">{metric.label}</td>
                  <td className="metric-value numeric">
                    {hasValues ? metric.format(base) : "—"}
                  </td>
                  <td className="metric-value numeric">
                    {hasValues ? metric.format(scen) : "—"}
                  </td>
                  <td className="metric-change numeric">
                    {hasValues ? (
                      <span className={`change-value ${changeClass}`}>
                        {formatChange(change, metric.unit)}
                      </span>
                    ) : (
                      <span className="na">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="comparison-legend">
        <span className="legend-item">
          <span className="legend-dot positive" />
          Improved (lower risk/delay)
        </span>
        <span className="legend-item">
          <span className="legend-dot negative" />
          Worsened (higher risk/delay)
        </span>
        <span className="legend-item">
          <span className="legend-dot neutral" />
          No meaningful change
        </span>
      </div>
    </section>
  );
}