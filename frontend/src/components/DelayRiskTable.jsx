import React from "react";
import { fmtPct, riskBand, statusClass } from "../models.js";
import { routeDisplayName } from "../utils/helpers.js";

// Route-level delay risk (worst checkpoint on the active prediction) per
// shipment. The selected shipment uses its live prediction; every other row
// shows the risk band from its lightweight snapshot prediction when available
// and otherwise honestly reports Not available instead of a fabricated value.
export default function DelayRiskTable({ shipments, selectedId, prediction, routesMeta, onSelect, snapshots = {} }) {
  const list = shipments || [];
  if (!list.length) {
    return <p className="muted">No shipments in the registry.</p>;
  }
  const routeNames = Object.fromEntries((routesMeta || []).map((r) => [r.route_id, r.name]));
  const nodes = prediction?.node_predictions || [];
  const band = nodes.length ? riskBand(nodes, prediction?.monte_carlo) : null;

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Shipment</th>
            <th>Route</th>
            <th title="Route-level delay risk is different from shipment deadline miss risk.">
              Route-level delay risk
            </th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => {
            const isCurrent = s.id === selectedId;
            const snap = snapshots[s.id];
            const rowBand = isCurrent ? band : snap?.band || null;
            const rowScore = isCurrent ? band?.score : snap?.score;
            const rowLabel = isCurrent ? band?.label : snap?.label;
            return (
              <tr
                key={s.id}
                className={isCurrent ? "highlight-row clickable-row" : "clickable-row"}
                onClick={() => onSelect && onSelect(s.id)}
                title={isCurrent ? "Currently viewed" : `View ${s.id}`}
              >
                <td className="mono">{s.id}</td>
                <td>{routeNames[s.routeId] || routeDisplayName(s.routeId)}</td>
                <td>
                  {rowBand ? (
                    <span className="risk-cell">
                      <span className={`risk-pill ${rowBand === "critical" ? "high" : rowBand}`}>
                        {fmtPct(rowScore / 100)} · {rowLabel}
                      </span>
                      <span className="risk-track">
                        <span
                          className={`risk-fill ${rowBand === "critical" ? "high" : rowBand}`}
                          style={{ width: `${Math.max(2, rowScore)}%` }}
                        />
                      </span>
                    </span>
                  ) : (
                    <span className="muted">Not available</span>
                  )}
                </td>
                <td>
                  <span className={`risk-pill ${statusClass(snap?.status || s.status)}`}>
                    {snap?.status || s.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
