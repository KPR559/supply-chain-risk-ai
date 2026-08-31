import React from "react";

const ALERT_TEMPLATES = [
  { severity: "critical", icon: "🔴", text: "Red Sea Conflict Activity has escalated", hoursAgo: 2 },
  { severity: "warning", icon: "🟠", text: "Suez Canal Congestion is increasing rapidly", hoursAgo: 5 },
  { severity: "warning", icon: "🟡", text: "Weather Severity at Arabian Sea above seasonal norm", hoursAgo: 8 },
  { severity: "info", icon: "🔵", text: "Mumbai Port dwell time trending upward (+18%)", hoursAgo: 12 },
];

function deriveAlerts(nodes) {
  const alerts = [];
  if (!nodes?.length) return ALERT_TEMPLATES;

  for (const n of nodes) {
    if (n.regime) {
      alerts.push({
        severity: "critical",
        icon: "🔴",
        text: `${n.label}: Disruption regime detected — elevated delay risk`,
        hoursAgo: 1,
      });
    }
    if (n.delay_probability >= 0.7) {
      alerts.push({
        severity: "critical",
        icon: "🔴",
        text: `${n.label}: Delay probability at ${Math.round(n.delay_probability * 100)}%`,
        hoursAgo: 3,
      });
    } else if (n.delay_probability >= 0.45) {
      alerts.push({
        severity: "warning",
        icon: "🟠",
        text: `${n.label}: Congestion is increasing rapidly`,
        hoursAgo: 6,
      });
    }
  }

  return alerts.length ? alerts.slice(0, 4) : ALERT_TEMPLATES;
}

export default function AlertsPanel({ nodes }) {
  const alerts = deriveAlerts(nodes);

  return (
    <div className="alerts-list">
      {alerts.map((a, i) => (
        <div className={`alert-item ${a.severity}`} key={i}>
          <span className="alert-icon">{a.icon}</span>
          <div className="alert-body">
            <div className="alert-text">{a.text}</div>
            <div className="alert-time">{a.hoursAgo}h ago</div>
          </div>
        </div>
      ))}
    </div>
  );
}
