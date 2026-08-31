import React from "react";

export default function CriticalNodes({ data }) {
  const items = data?.critical_nodes || [];
  if (!items.length) {
    return <div className="placeholder">No critical-node data.</div>;
  }
  return (
    <div className="crit-list">
      {items.map((c) => (
        <div className="crit-item" key={c.node_id}>
          <span className="crit-name">{c.label}</span>
          <div className="bar-track">
            <div
              className="bar-fill crit"
              style={{ width: `${Math.max(2, c.percent)}%` }}
              title={`${c.node_id}: ${(c.delay_share * 100).toFixed(1)}% of delay`}
            />
          </div>
          <span className="crit-percent">{c.percent.toFixed(1)}%</span>
        </div>
      ))}
      <div className="note">Share of total shipment delay attributable to each checkpoint.</div>
    </div>
  );
}