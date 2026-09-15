import React from "react";

const LEVEL_CLASS = { CRITICAL: "high", HIGH: "med", MEDIUM: "low", LOW: "low" };

export default function AlertCard({ alert, read, timeLabel, onRead, onDismiss, onAction }) {
  return (
    <article className={`alert-card ${read ? "read" : ""}`}>
      <div className="alert-head">
        <span className={`risk-pill ${LEVEL_CLASS[alert.level] || "med"}`}>{alert.level}</span>
        {alert.checkpoint && <span className="alert-cp">{alert.checkpoint}</span>}
        {timeLabel && <span className="alert-time">{timeLabel}</span>}
      </div>
      <div className="alert-title">{alert.title}</div>
      <p className="alert-detail">{alert.detail}</p>
      <div className="alert-foot">
        {onAction && (
          <button className="btn ghost mini-btn" onClick={() => onAction(alert.target)}>
            {alert.targetLabel}
          </button>
        )}
        {!read && onRead && (
          <button className="btn ghost mini-btn" onClick={() => onRead(alert.id)}>
            Mark as read
          </button>
        )}
        {onDismiss && (
          <button className="link-btn" onClick={() => onDismiss(alert.id)} title="Dismiss this alert">
            Dismiss
          </button>
        )}
      </div>
    </article>
  );
}
