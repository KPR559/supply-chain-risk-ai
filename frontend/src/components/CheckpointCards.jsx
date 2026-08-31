import React from "react";
import { riskClass, riskLabel, delayDaysFromHours } from "../utils/helpers.js";

export default function CheckpointCards({ nodes }) {
  if (!nodes?.length) {
    return <div className="placeholder">No checkpoint data.</div>;
  }

  return (
    <div className="checkpoint-row">
      {nodes.map((n) => {
        const prob = n.delay_probability ?? 0;
        const delayH = n.expected_delay_hours ?? 0;
        const status = delayH > 24 ? delayDaysFromHours(delayH) : "On Time";
        const isLate = delayH > 24;
        return (
          <div className={`checkpoint-card ${riskClass(prob)}`} key={n.node_id}>
            <div className="cp-name">{n.label}</div>
            <div className="cp-risk">Risk {Math.round(prob * 100)}%</div>
            <div className={`cp-status ${isLate ? "late" : "ontime"}`}>{status}</div>
            <div className="cp-tag">{riskLabel(prob)}</div>
          </div>
        );
      })}
    </div>
  );
}
