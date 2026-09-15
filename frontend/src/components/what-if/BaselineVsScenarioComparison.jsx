import React from "react";
import { formatEta, formatPercent, formatResilience, formatChange, getChangeClass } from "../../utils/whatIfUtils.js";

export default function BaselineVsScenarioComparison({ result }) {
  if (!result) return null;

  const baseline = result.baseline || {};
  const scenario = result.scenario || {};

  const comparisonMetrics = [
    { label: "Expected Transit", base: baseline.expected_days, scen: scenario.expected_days, format: formatEta, unit: "days", inverse: true },
    { label: "P50 ETA", base: baseline.p50_eta_days, scen: scenario.p50_eta_days, format: formatEta, unit: "days", inverse: true },
    { label: "P90 ETA", base: baseline.p90_eta_days, scen: scenario.p90_eta_days, format: formatEta, unit: "days", inverse: true },
    { label: "Deadline Miss Prob.", base: baseline.p_miss_deadline, scen: scenario.p_miss_deadline, format: formatPercent, unit: "pp", inverse: true, isPercent: true },
    { label: "Resilience Score", base: baseline.resilience_score, scen: scenario.resilience_score, format: formatResilience, unit: "pts", inverse: false, higherIsBetter: true },
  ];

  return (
    <section className="panel what-if-comparison">
      <h2>Baseline vs Scenario</h2>
      <p className="muted">Key metrics under normal conditions vs the selected scenario</p>

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
              const base = metric.base;
              const scen = metric.scen;
              const hasValues = base != null && scen != null && !Number.isNaN(base) && !Number.isNaN(scen);

              let change = null;
              let changeClass = "neutral";
              if (hasValues) {
                change = metric.isPercent ? (scen - base) * 100 : scen - base;
                changeClass = getChangeClass(change, metric.inverse);
              }

              return (
                <tr key={idx}>
                  <td className="metric-label">{metric.label}</td>
                  <td className="metric-value numeric">{hasValues ? metric.format(base) : "—"}</td>
                  <td className="metric-value numeric">{hasValues ? metric.format(scen) : "—"}</td>
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
            {(result.delta?.expected_days ?? null) != null && (
              <tr className="delta-row">
                <td className="metric-label">Delta (expected)</td>
                <td className="numeric" colSpan="3">
                  <span className={`change-value ${getChangeClass(result.delta.expected_days, true)}`}>
                    {(result.delta.expected_days > 0 ? "+" : "")}
                    {result.delta.expected_days.toFixed(2)} days · P90 {(result.delta.p90_eta_days > 0 ? "+" : "")}
                    {result.delta.p90_eta_days.toFixed(2)} days · Deadline risk {(result.delta.deadline_risk_change_pct > 0 ? "+" : "")}
                    {result.delta.deadline_risk_change_pct.toFixed(0)} pp
                  </span>
                </td>
              </tr>
            )}
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