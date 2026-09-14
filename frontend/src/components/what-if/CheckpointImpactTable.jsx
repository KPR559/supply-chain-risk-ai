import React from "react";
import { formatPercent, formatDelay, getChangeClass } from "../../utils/whatIfUtils.js";

export default function CheckpointImpactTable({ impacts, affectedNodeId }) {
  if (!impacts || impacts.length === 0) return null;

  // Sort by absolute risk change descending
  const sortedImpacts = [...impacts].sort(
    (a, b) => Math.abs(b.riskChange) - Math.abs(a.riskChange)
  );

  return (
    <section className="panel what-if-checkpoint-impact">
      <h2>Checkpoint Impact</h2>
      <p className="muted">Per-checkpoint risk and delay changes from the scenario</p>

      <div className="table-container">
        <table className="data-table impact-table">
          <thead>
            <tr>
              <th>Checkpoint</th>
              <th className="numeric">Baseline Risk</th>
              <th className="numeric">Scenario Risk</th>
              <th className="numeric">Risk Change</th>
              <th className="numeric">Baseline Delay</th>
              <th className="numeric">Scenario Delay</th>
              <th className="numeric">Delay Change</th>
              <th>Regime / Status</th>
            </tr>
          </thead>
          <tbody>
            {sortedImpacts.map((impact) => {
              const riskChangeClass = getChangeClass(impact.riskChange, true);
              const delayChangeClass = getChangeClass(impact.delayChange, true);
              const isAffected = impact.isAffected || impact.node_id === affectedNodeId;

              return (
                <tr key={impact.node_id} className={isAffected ? "affected-row" : ""}>
                  <td className="checkpoint-cell">
                    <span className={`checkpoint-name ${isAffected ? "affected" : ""}`}>
                      {impact.label}
                      {isAffected && <span className="affected-badge">Affected</span>}
                    </span>
                  </td>
                  <td className="numeric">{formatPercent(impact.baseRisk / 100)}</td>
                  <td className="numeric">{formatPercent(impact.scenRisk / 100)}</td>
                  <td className="numeric">
                    <span className={`change-value ${riskChangeClass}`}>
                      {impact.riskChange > 0 ? "+" : ""}{impact.riskChange.toFixed(1)}%
                    </span>
                  </td>
                  <td className="numeric">{formatDelay(impact.baseDelay)}</td>
                  <td className="numeric">{formatDelay(impact.scenDelay)}</td>
                  <td className="numeric">
                    <span className={`change-value ${delayChangeClass}`}>
                      {impact.delayChange > 0 ? "+" : ""}{impact.delayChange.toFixed(1)} days
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${impact.statusClass}`}>
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