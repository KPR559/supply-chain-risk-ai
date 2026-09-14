import React from "react";
import { fmtPct, formatHours, getRegimeLabel, getRiskLevel, kindLabel } from "../models.js";
import RiskBadge from "./RiskBadge.jsx";

function regimeTone(regime) {
  if (regime === 1) return "high";
  if (regime === 0) return "low";
  return "";
}

export default function NodeRiskTable({ nodes, selectedId, onSelect, topId }) {
  if (!nodes || nodes.length === 0) {
    return <div className="placeholder">No node predictions.</div>;
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
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => {
            const tier = getRiskLevel(n.delay_probability);
            const regime = getRegimeLabel(n.regime);
            const selected = n.node_id === selectedId;
            return (
              <tr
                key={n.node_id}
                className={`${selected ? "highlight-row" : ""}${n.node_id === topId ? " top-risk-row" : ""} ${onSelect ? "clickable-row" : ""}`}
                onClick={onSelect ? () => onSelect(n.node_id) : undefined}
                title={onSelect ? `Select ${n.label || n.node_id}` : undefined}
              >
                <td><b>{n.label || n.node_id}</b></td>
                <td title={n.kind ? `Checkpoint kind: ${n.kind}` : "Kind not reported"}>
                  <span className="mono muted">{n.kind || "-"}</span>
                  {n.kind && <span className="kind-full"> · {kindLabel(n.kind)}</span>}
                </td>
                <td className="num">
                  <RiskBadge tone={tier.cls} title={tier.label}>
                    {n.delay_probability != null ? fmtPct(n.delay_probability) : "-"}
                  </RiskBadge>
                </td>
                <td className="num mono">{n.expected_delay_hours != null ? formatHours(n.expected_delay_hours) : "-"}</td>
                <td className="num mono">{n.p50 != null ? formatHours(n.p50) : "-"}</td>
                <td className="num mono">{n.p90 != null ? formatHours(n.p90) : "-"}</td>
                <td>
                  <RiskBadge tone={regimeTone(n.regime)}>{regime}</RiskBadge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
