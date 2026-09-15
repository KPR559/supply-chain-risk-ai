import React from "react";
import { formatPercent, formatChange, getChangeClass } from "../../utils/whatIfUtils.js";

export default function CheckpointImpactTable({ result }) {
  const impacts = result?.checkpoint_impact || [];
  if (impacts.length === 0) return null;

  // Sorted by ascending sequence (route order) — affected rows marked
  const sorted = [...impacts].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

  return (
    <section className="panel what-if-checkpoint-impact">
      <h2>Checkpoint Impact</h2>
      <p className="muted">Per-checkpoint risk and delay changes from the scenario (route order)</p>

      <div className="table-container">
        <table className="data-table impact-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Checkpoint</th>
              <th className="numeric">Baseline Risk</th>
              <th className="numeric">Scenario Risk</th>
              <th className="numeric">Risk Δ</th>
              <th className="numeric">Baseline Delay</th>
              <th className="numeric">Scenario Delay</th>
              <th className="numeric">Delay Δ</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((impact) => {
              const riskChangeClass = getChangeClass(impact.risk_change_pct, true);
              const delayChangeClass = getChangeClass(impact.delay_change_hours, true);
              return (
                <tr key={impact.node_id} className={impact.is_affected ? "affected-row" : ""}>
                  <td className="numeric muted">{impact.sequence}</td>
                  <td className="checkpoint-cell">
                    <span className={`checkpoint-name ${impact.is_affected ? "affected" : ""}`}>
                      {impact.label}
                      {impact.is_affected && <span className="affected-badge">Affected</span>}
                    </span>
                  </td>
                  <td className="numeric">{formatPercent(impact.baseline_risk)}</td>
                  <td className="numeric">{formatPercent(impact.scenario_risk)}</td>
                  <td className="numeric">
                    <span className={`change-value ${riskChangeClass}`}>
                      {impact.risk_change_pct > 0 ? "+" : ""}
                      {impact.risk_change_pct.toFixed(1)}pp
                    </span>
                  </td>
                  <td className="numeric">{impact.baseline_delay_hours.toFixed(1)}h</td>
                  <td className="numeric">{impact.scenario_delay_hours.toFixed(1)}h</td>
                  <td className="numeric">
                    <span className={`change-value ${delayChangeClass}`}>
                      {formatChange(impact.delay_change_hours, "h")}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${impact.status_class}`}>
                      {impact.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}