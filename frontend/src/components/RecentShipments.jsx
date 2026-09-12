import React from "react";
import { riskClass, routeDisplayName } from "../utils/helpers.js";

export default function RecentShipments({
  shipments,
  selectedId,
  onSelect,
  prediction,
  routesMeta,
}) {
  const list = shipments || [];
  const routeNames = Object.fromEntries(
    (routesMeta || []).map((r) => [r.route_id, r.name])
  );

  const liveRisk =
    prediction?.node_predictions?.length
      ? prediction.node_predictions.reduce((a, n) => a + n.delay_probability, 0) /
        prediction.node_predictions.length
      : null;

  if (list.length === 0) {
    return <p className="muted">No shipments yet.</p>;
  }

  return (
    <table className="data-table recent-table">
      <thead>
        <tr>
          <th>Shipment ID</th>
          <th>Route</th>
          <th>Delay Risk</th>
        </tr>
      </thead>
      <tbody>
        {list.map((s) => {
          const isCurrent = s.id === selectedId;
          const risk = isCurrent ? liveRisk : null;
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
                {risk == null ? (
                  <span className="muted">—</span>
                ) : (
                  <span className={`risk-pill ${riskClass(risk)}`}>
                    {Math.round(risk * 100)}%
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
