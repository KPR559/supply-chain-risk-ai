import React from "react";
import { fmtPct } from "../models.js";

export default function CriticalNodes({ data, selectedId, onSelect }) {
  const items = data?.critical_nodes || [];
  if (!items.length) {
    return <div className="placeholder">No critical-node data.</div>;
  }
  const maxShare = Math.max(...items.map((c) => c.delay_share ?? 0), 0.0001);

  return (
    <div>
      <ol className="crit-rank">
        {items.map((c, i) => {
          const share = c.delay_share ?? 0;
          const heat = share / maxShare;
          const hot = heat >= 0.5;
          const selected = c.node_id === selectedId;
          return (
            <li
              key={c.node_id}
              className={`crit-rank-item${hot ? " is-hot" : ""}${selected ? " is-selected" : ""}${onSelect ? " clickable" : ""}`}
              onClick={onSelect ? () => onSelect(c.node_id) : undefined}
              title={onSelect ? `Select ${c.label || c.node_id}` : `${c.label || c.node_id}: ${fmtPct(share)} of total delay`}
            >
              <span className="crit-rank-num">{i + 1}</span>
              <span className="crit-rank-main">
                <span className="crit-rank-name">{c.label || c.node_id}</span>
                <span className="crit-rank-bar" aria-hidden="true">
                  <span
                    className={`crit-rank-fill${hot ? " hot" : ""}`}
                    style={{ width: `${Math.max(2, heat * 100)}%` }}
                  />
                </span>
              </span>
              <span className="crit-rank-pct mono">{Number(c.percent ?? share * 100).toFixed(1)}%</span>
            </li>
          );
        })}
      </ol>
      <p className="muted">Share of total shipment delay attributable to each checkpoint.</p>
    </div>
  );
}
