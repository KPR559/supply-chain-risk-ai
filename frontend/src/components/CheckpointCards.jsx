import React from "react";
import { ArrowRight } from "lucide-react";
import { fmtDelayDays, fmtPct, getRiskLevel, getStatusLabel, kindLabel } from "../models.js";
import RiskBadge from "./RiskBadge.jsx";

function statusTone(status) {
  if (status === "Disrupted" || status === "Delayed") return "high";
  return "low";
}

export default function CheckpointCards({ nodes, selectedId, onSelect }) {
  if (!nodes?.length) {
    return <div className="placeholder">No checkpoint data.</div>;
  }

  return (
    <div className="rk-cards">
      {nodes.map((n) => {
        const prob = n.delay_probability ?? 0;
        const tier = getRiskLevel(prob);
        const status = getStatusLabel(n);
        const selected = n.node_id === selectedId;
        return (
          <article
            key={n.node_id}
            className={`rk-card tier-${tier.cls}${tier.critical ? " is-critical" : ""}${selected ? " is-selected" : ""}`}
          >
            <div className="rk-head">
              <span className="rk-name">{n.label || n.node_id}</span>
              <RiskBadge tone={statusTone(status)}>{status}</RiskBadge>
            </div>
            <div className="rk-kind">{kindLabel(n.kind)}</div>
            <div className="rk-value">{fmtPct(prob)}</div>
            <div className="rk-sub">
              Expected delay {n.expected_delay_hours != null ? fmtDelayDays(n.expected_delay_hours) : "-"}
            </div>
            <div className="rk-foot">
              <RiskBadge tone={tier.cls}>{tier.label}</RiskBadge>
              {onSelect && (
                <button
                  className="btn ghost mini-btn"
                  onClick={() => onSelect(n.node_id)}
                  aria-pressed={selected}
                  title={`Show ${n.label || n.node_id} in Checkpoint Detail`}
                >
                  View Details <ArrowRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
