import React from "react";
import { formatEta, formatDelay, formatPercent, formatResilience, getRiskLevelClass } from "../../utils/whatIfUtils.js";

export default function ScenarioResultsSummary({
  baseline,
  scenario,
  checkpoint,
  selectedPreset,
}) {
  if (!scenario) return null;

  const mc = scenario.monte_carlo || scenario;
  const baselineMc = baseline?.monte_carlo || baseline;

  // Extract values with fallbacks
  const predictedEta = mc?.expected_eta_date || baselineMc?.expected_eta_date || null;
  const p50Eta = mc?.percentiles?.p50 || mc?.expected_eta_days || null;
  const p90Eta = mc?.percentiles?.p90 || null;
  const expectedDelay = mc?.expected_delay_hours ? mc.expected_delay_hours / 24 : null;
  const delayChange = mc?.delta_expected_days || null;
  const missProb = mc?.p_miss_deadline || mc?.delay_probability || 0;
  const resilience = mc?.resilience_score || baselineMc?.resilience_score || null;
  const resilienceChange = mc?.delta_resilience || null;

  const riskClass = getRiskLevelClass(missProb);

  const metrics = [
    {
      label: "Scenario",
      value: selectedPreset?.name || scenario.scenario || "Custom",
      icon: null,
    },
    {
      label: "Selected Checkpoint",
      value: checkpoint?.label || checkpoint?.node_id || "—",
      icon: null,
    },
    {
      label: "Predicted ETA",
      value: predictedEta ? new Date(predictedEta).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—",
      unit: null,
    },
    {
      label: "P50 Arrival",
      value: p50Eta != null ? formatEta(p50Eta) : "—",
      unit: null,
    },
    {
      label: "P90 Arrival",
      value: p90Eta != null ? formatEta(p90Eta) : "—",
      unit: null,
    },
    {
      label: "Expected Delay",
      value: expectedDelay != null ? formatDelay(expectedDelay) : "—",
      unit: null,
    },
    {
      label: "Delay Change",
      value: delayChange != null ? (delayChange > 0 ? `+${delayChange.toFixed(1)}` : delayChange.toFixed(1)) : "—",
      unit: "days",
      change: delayChange,
    },
    {
      label: "Deadline Miss Risk",
      value: formatPercent(missProb),
      unit: null,
      riskClass,
    },
    {
      label: "Resilience Score",
      value: resilience != null ? formatResilience(resilience) : "—",
      unit: null,
      changeUnit: "pts",
      change: resilienceChange,
    },
  ];

  return (
    <section className="panel what-if-results-summary">
      <div className="panel-head">
        <h2>Scenario Results</h2>
        <span className="results-badge">Updated</span>
      </div>
      <div className="results-grid">
        {metrics.map((metric, idx) => (
          <div key={idx} className={`result-card ${metric.riskClass ? `risk-${metric.riskClass}` : ""}`}>
            <div className="result-label">{metric.label}</div>
            <div className="result-value">
              {metric.value}
              {metric.unit && <span className="result-unit">{metric.unit}</span>}
              {metric.change != null && (
                <span className={`result-change ${metric.change > 0 ? "increase" : metric.change < 0 ? "decrease" : "neutral"}`}>
                  {metric.change > 0 ? "+" : ""}{metric.change.toFixed(1)} {metric.changeUnit || metric.unit || "days"}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}