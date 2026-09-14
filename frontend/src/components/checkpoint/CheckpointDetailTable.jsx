import React from "react";
import { Eye } from "lucide-react";
import {
  formatHours,
  fmtPct,
  getCheckpointKind,
  getCheckpointRiskLevel,
  getRegimeLabel,
  kindLabel,
} from "../../models.js";
import RiskBadge from "../RiskBadge.jsx";
import RegimeBadge from "./RegimeBadge.jsx";

export default function CheckpointDetailTable({ nodes, selectedId, onSelect, onDetail, topId }) {
  if (!nodes || nodes.length === 0) {
    return <div className="placeholder">No checkpoint detail available.</div>;
  }

  return (
    <div className="table-scroll detail-scroll">
      <table className="data-table detail-table">
        <thead>
          <tr>
            <th>Checkpoint</th>
            <th>Kind</th>
            <th className="num">Delay Prob</th>
            <th className="num">Expected Delay</th>
            <th className="num">P50</th>
            <th className="num">P90</th>
            <th>Regime</th>
            <th className="num" aria-label="Open details">Details</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => {
            const tier = getCheckpointRiskLevel(n.delay_probability);
            const selected = n.node_id === selectedId;
            const name = n.label || n.node_id || "Checkpoint";
            return (
              <tr
                key={n.node_id}
                className={`${selected ? "highlight-row" : ""}${n.node_id === topId ? " top-risk-row" : ""} ${onSelect ? "clickable-row" : ""}`}
                onClick={onSelect ? () => onSelect(n.node_id) : undefined}
                title={onSelect ? `Select ${name}` : undefined}
              >
                <td><b>{name}</b></td>
                <td title={`Checkpoint kind: ${getCheckpointKind(n)}`}>
                  <span className="mono muted">{getCheckpointKind(n)}</span>
                  <span className="kind-full"> · {kindLabel(getCheckpointKind(n))}</span>
                </td>
                <td className="num">
                  <RiskBadge tone={tier.critical ? "critical" : tier.cls} title={tier.label}>
                    {n.delay_probability != null ? fmtPct(n.delay_probability) : "—"}
                  </RiskBadge>
                </td>
                <td className="num mono">{n.expected_delay_hours != null ? formatHours(n.expected_delay_hours) : "—"}</td>
                <td className="num mono">{n.p50 != null ? formatHours(n.p50) : "—"}</td>
                <td className="num mono">{n.p90 != null ? formatHours(n.p90) : "—"}</td>
                <td>
                  <span className="regime-value" role="text" title={getRegimeLabel(n.regime)}>
                    <RegimeBadge regime={n.regime} />
                  </span>
                </td>
                <td className="num">
                  {onDetail && (
                    <button
                      className="btn ghost mini-btn row-detail-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDetail(n.node_id);
                      }}
                      aria-label={`Open details for ${name}`}
                      title={`Open details for ${name}`}
                    >
                      <Eye size={13} aria-hidden="true" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}