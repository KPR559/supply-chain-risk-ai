import React from "react";
import { AlertTriangle } from "lucide-react";

export default function CriticalCheckpointCard({ result }) {
  const cc = result?.critical_checkpoint;
  if (!cc) return null;

  const riskClass = cc.risk >= 0.8 ? "critical" : cc.risk >= 0.6 ? "high" : cc.risk >= 0.35 ? "medium" : "low";

  return (
    <section className={`panel critical-checkpoint-card risk-${riskClass}`}>
      <div className="critical-checkpoint-icon">
        <AlertTriangle size={22} aria-hidden="true" />
      </div>
      <div className="critical-checkpoint-body">
        <div className="critical-checkpoint-title">Most Affected Checkpoint</div>
        <div className="critical-checkpoint-name">{cc.label}</div>
        <p className="critical-checkpoint-explanation">{cc.explanation}</p>
      </div>
      <div className="critical-checkpoint-stats">
        <div className="cc-stat">
          <span className="cc-stat-label">Risk</span>
          <span className="cc-stat-value">{(cc.risk * 100).toFixed(0)}%</span>
        </div>
        <div className="cc-stat">
          <span className="cc-stat-label">Risk increase</span>
          <span className="cc-stat-value">+{cc.risk_increase_pct}%</span>
        </div>
        <div className="cc-stat">
          <span className="cc-stat-label">Added delay</span>
          <span className="cc-stat-value">{cc.delay_contribution_hours}h</span>
        </div>
        <div className="cc-stat">
          <span className="cc-stat-label">Downstream hit</span>
          <span className="cc-stat-value">{cc.downstream_affected} nodes</span>
        </div>
      </div>
    </section>
  );
}