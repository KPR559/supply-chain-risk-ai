import React from "react";
import { formatEta, formatEtaDate, formatPercent, formatResilience, getRiskLevelClass } from "../../utils/whatIfUtils.js";

export default function ScenarioResultsSummary({ result, prediction }) {
  if (!result) return null;

  const baseline = result.baseline || {};
  const scenario = result.scenario || {};
  const delta = result.delta || {};
  const mc = result.monte_carlo || {};

  const riskClass = getRiskLevelClass(scenario.p_miss_deadline ?? mc.p_miss_deadline);
  const originDate = mc.origin_date || prediction?.prediction_date;

  const metrics = [
    {
      label: "Scenario",
      value: result.scenario_name || "Custom",
      sub: result.scope ? `Scope: ${result.scope}` : null,
    },
    {
      label: "Affected",
      value: (result.affected_nodes || []).length
        ? (result.per_node_scenario || [])
            .filter((n) => (result.affected_nodes || []).includes(n.node_id))
            .map((n) => n.label)
            .slice(0, 3)
            .join(", ")
        : "None",
      sub: (result.affected_nodes || []).length > 3 ? `+${result.affected_nodes.length - 3} more` : null,
    },
    {
      label: "Expected Transit",
      value: formatEta(scenario.expected_days),
      change: delta.expected_days,
      unit: "days",
    },
    {
      label: "ETA Date",
      value: formatEtaDate(mc.expected_eta_date || mc.eta_date?.p90),
      sub: mc.expected_eta_date && mc.deadline_date ? `Deadline: ${formatEtaDate(mc.deadline_date)}` : null,
    },
    {
      label: "P50 / P90 ETA",
      value: `${formatEta(scenario.p50_eta_days)} / ${formatEta(scenario.p90_eta_days)}`,
    },
    {
      label: "Expected Delay",
      value: scenario.expected_delay_hours != null
        ? `${scenario.expected_delay_hours.toFixed(1)}h (${(scenario.expected_delay_hours / 24).toFixed(1)}d)`
        : "—",
      change: delta.delay_hours_change != null ? delta.delay_hours_change / 24 : null,
      unit: "days",
    },
    {
      label: "Deadline Miss Risk",
      value: formatPercent(scenario.p_miss_deadline),
      change: delta.deadline_risk_change_pct,
      unit: "pp",
      riskClass,
    },
    {
      label: "Resilience Score",
      value: formatResilience(scenario.resilience_score),
      change: delta.resilience_change,
      unit: "pts",
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
              {metric.change != null && (
                <span className={`result-change ${metric.change > 0 ? "increase" : metric.change < 0 ? "decrease" : "neutral"}`}>
                  {metric.change > 0 ? "+" : ""}
                  {metric.change.toFixed(1)} {metric.unit || "days"}
                </span>
              )}
            </div>
            {metric.sub && <div className="result-sub">{metric.sub}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}