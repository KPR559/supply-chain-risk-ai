import React from "react";
import { ArrowRight } from "lucide-react";
import {
  NA,
  fmtDelayDuration,
  fmtPct,
  getCheckpointKind,
  getCheckpointRiskLevel,
  getCheckpointStatus,
  kindLabel,
} from "../../models.js";
import RiskBadge from "../RiskBadge.jsx";

export default function CheckpointRiskCard({ node, selected, onSelect }) {
  const tier = getCheckpointRiskLevel(node?.delay_probability);
  const status = getCheckpointStatus(node);
  const kind = getCheckpointKind(node);
  const name = node?.label || node?.node_id || "Checkpoint";

  return (
    <article
      className={`rk-card tier-${tier.cls}${tier.critical ? " is-critical" : ""}${selected ? " is-selected" : ""}`}
      aria-selected={selected || undefined}
    >
      <div className="rk-head">
        <span className="rk-name" title={name}>{name}</span>
        <RiskBadge tone={status.tone}>{status.label}</RiskBadge>
      </div>
      <div className="rk-kind">{kindLabel(kind)}</div>
      <div className="rk-metric">
        <div className="rk-metric-label">Delay probability</div>
        <div className="rk-value">{fmtPct(node?.delay_probability)}</div>
      </div>
      <div className="rk-sub">
        Expected delay {node?.expected_delay_hours != null ? fmtDelayDuration(node.expected_delay_hours) : NA}
      </div>
      <div className="rk-foot">
        <RiskBadge tone={tier.critical ? "critical" : tier.cls}>{tier.label}</RiskBadge>
        {onSelect && (
          <button
            className="btn ghost mini-btn"
            onClick={() => onSelect(node?.node_id)}
            aria-pressed={selected || undefined}
            title={`Open details for ${name}`}
          >
            View Details <ArrowRight size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}