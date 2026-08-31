import React from "react";
import { riskClass } from "../utils/helpers.js";

function deriveAlerts(nodes) {
  const alerts = [];
  if (!nodes?.length) return alerts;
  for (const n of nodes) {
    if (n.regime) {
      alerts.push({
        severity: "critical",
        icon: "🔴",
        title: "Disruption regime",
        text: `${n.label}: anomaly detection flagged a disrupted regime — elevated delay risk`,
        hoursAgo: 1,
      });
    }
    if (n.delay_probability >= 0.7) {
      alerts.push({
        severity: "critical",
        icon: "🔴",
        title: "High delay probability",
        text: `${n.label}: predicted delay probability ${Math.round(n.delay_probability * 100)}%`,
        hoursAgo: 3,
      });
    } else if (n.delay_probability >= 0.45) {
      alerts.push({
        severity: "warning",
        icon: "🟠",
        title: "Rising congestion",
        text: `${n.label}: congestion index increasing, delay risk ${Math.round(n.delay_probability * 100)}%`,
        hoursAgo: 6,
      });
    }
  }
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

export default function AlertsView({ data }) {
  const { prediction } = data;
  const nodes = prediction?.node_predictions;
  const alerts = deriveAlerts(nodes);

  const worst = nodes?.length ? Math.max(...nodes.map((n) => n.delay_probability)) : 0;
  const status = worst >= 0.6 ? "Disruption likely" : worst >= 0.35 ? "Watch" : "Nominal";

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Alerts</div>
          <div className="view-sub">Early-warning signals derived from the live prediction engine</div>
        </div>
      </div>

      <section className="panel">
        <h2>Corridor Status</h2>
        <div className="corridor-status">
          <span className={`risk-pill ${riskClass(worst)} big`}>{status}</span>
          <span>
            Worst checkpoint delay probability{" "}
            <b className="mono">{(worst * 100).toFixed(0)}%</b>
          </span>
        </div>
      </section>

      <section className="panel">
        <h2>Active Alerts ({alerts.length})</h2>
        {alerts.length ? (
          <div className="alerts-list">
            {alerts.map((a, i) => (
              <div className={`alert-item ${a.severity}`} key={i}>
                <span className="alert-icon">{a.icon}</span>
                <div className="alert-body">
                  <div className="alert-title">{a.title}</div>
                  <div className="alert-text">{a.text}</div>
                  <div className="alert-time">{a.hoursAgo}h ago</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="placeholder">No active alerts for this corridor.</div>
        )}
      </section>
    </div>
  );
}