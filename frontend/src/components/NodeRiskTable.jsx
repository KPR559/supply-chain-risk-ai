import React from "react";

function riskClass(prob) {
  if (prob >= 0.6) return "high";
  if (prob >= 0.35) return "med";
  return "low";
}

export default function NodeRiskTable({ nodes }) {
  if (!nodes || nodes.length === 0) {
    return <div className="placeholder">No node predictions.</div>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Checkpoint</th>
          <th>Kind</th>
          <th>Delay prob</th>
          <th>Exp. delay</th>
          <th>P50</th>
          <th>P90</th>
          <th>Regime</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((n) => (
          <tr key={n.node_id}>
            <td>{n.label}</td>
            <td><span className={`tag ${n.node_id}`}>{n.node_id}</span></td>
            <td>
              <span className={`risk-pill ${riskClass(n.delay_probability)}`}>
                {(n.delay_probability * 100).toFixed(0)}%
              </span>
            </td>
            <td>{n.expected_delay_hours?.toFixed(1)} h</td>
            <td>{n.p50?.toFixed(1)} h</td>
            <td>{n.p90?.toFixed(1)} h</td>
            <td>{n.regime ? "disrupted" : "normal"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}