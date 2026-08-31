import React from "react";
import { routeDisplayName, riskClass } from "../utils/helpers.js";

const DEMO_SHIPMENTS = [
  { id: "FRK-IND-9281", route: "suez", risk: 0.72 },
  { id: "FRK-IND-9104", route: "cape", risk: 0.38 },
  { id: "FRK-IND-8872", route: "dubai", risk: 0.51 },
  { id: "FRK-IND-8650", route: "suez", risk: 0.65 },
];

export default function RecentShipments({ prediction, routesMeta }) {
  const currentId = prediction?.shipment_id;
  const routeNames = Object.fromEntries(
    (routesMeta || []).map((r) => [r.route_id, r.name])
  );

  const rows = DEMO_SHIPMENTS.map((s) =>
    s.id === currentId || s.id.replace(/FRK/g, "frankfurt").includes(currentId?.split("-")[0])
      ? { ...s, risk: prediction?.node_predictions
          ? prediction.node_predictions.reduce((a, n) => a + n.delay_probability, 0) /
            prediction.node_predictions.length
          : s.risk }
      : s
  );

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
        {rows.map((s) => (
          <tr key={s.id} className={s.id.startsWith("FRK-IND-9281") ? "highlight-row" : ""}>
            <td className="mono">{s.id}</td>
            <td>{routeNames[s.route] || routeDisplayName(s.route)}</td>
            <td>
              <span className={`risk-pill ${riskClass(s.risk)}`}>
                {Math.round(s.risk * 100)}%
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
