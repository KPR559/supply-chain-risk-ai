import React from "react";
import {
  formatHours,
  fmtDelayDuration,
  fmtDelayDays,
  fmtPct,
  getCheckpointDrivers,
  getCheckpointKind,
  getCheckpointMitigation,
  getCheckpointRiskLevel,
  getRegimeLabel,
  kindLabel,
} from "../../models.js";
import RiskBadge from "../RiskBadge.jsx";
import RegimeBadge from "./RegimeBadge.jsx";

const METRICS = [
  { key: "delay", label: "Delay probability" },
  { key: "expected", label: "Expected delay" },
  { key: "p50", label: "P50 delay" },
  { key: "p90", label: "P90 delay" },
];

export default function CheckpointDetailPanel({ node }) {
  if (!node) return null;
  const tier = getCheckpointRiskLevel(node.delay_probability);
  const regime = getRegimeLabel(node.regime);
  const name = node.label || node.node_id || "Checkpoint";

  const metrics = {
    delay: (
      <RiskBadge tone={tier.critical ? "critical" : tier.cls} title={fmtDelayDays(node.expected_delay_hours)}>
        {node.delay_probability != null ? fmtPct(node.delay_probability) : "—"}
      </RiskBadge>
    ),
    expected: node.expected_delay_hours != null ? fmtDelayDuration(node.expected_delay_hours) : "—",
    p50: node.p50 != null ? formatHours(node.p50) : "—",
    p90: node.p90 != null ? formatHours(node.p90) : "—",
  };

  return (
    <div className="detail-panel">
      <div className="detail-ident">
        <div>
          <div className="detail-name">{name}</div>
          <div className="detail-kind">{kindLabel(getCheckpointKind(node))} · Kind “{getCheckpointKind(node)}”</div>
        </div>
        <div className="detail-regime">
          <RegimeBadge regime={node.regime} />
          <span className="muted detail-regime-label">{regime}</span>
        </div>
      </div>

      <div className="detail-metrics">
        {METRICS.map((m) => (
          <div className="detail-metric" key={m.key}>
            <div className="detail-metric-label">{m.label}</div>
            <div className="detail-metric-val">{metrics[m.key]}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="detail-h">Main risk drivers</div>
        <ul className="detail-drivers">
          {getCheckpointDrivers(node).map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>

      <div>
        <div className="detail-h">Suggested mitigation</div>
        <p className="detail-mitigation">{getCheckpointMitigation(node)}</p>
      </div>
    </div>
  );
}