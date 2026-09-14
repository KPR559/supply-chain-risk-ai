import React from "react";
import { Bell, CheckCheck, Settings2, X } from "lucide-react";
import AlertCard from "./AlertCard.jsx";
import { loadPrefs } from "../prefs.js";

export default function AlertDrawer({
  open,
  onClose,
  alerts,
  onNavigate,
  lastUpdated,
  readIds,
  dismissedIds,
  onRead,
  onReadAll,
  onDismiss,
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose ]);

  if (!open) return null;
  const prefs = loadPrefs();
  const pct = (x) => `${Math.round(x * 100)}%`;
  const visible = alerts.filter((a) => !dismissedIds.has(a.id));
  const unread = visible.filter((a) => !readIds.has(a.id)).length;

  const closeAndGo = (target) => {
    if (onClose) onClose();
    if (onNavigate && target) onNavigate(target);
  };

  return (
    <div className="drawer-root">
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Alerts and recommendations">
        <div className="drawer-head">
          <div>
            <h2><Bell size={15} aria-hidden="true" /> Alerts · {unread} unread</h2>
            <p className="muted">
              Observed at last update {lastUpdated || "—"} · thresholds: high-risk ≥ {pct(prefs.highRisk)} · miss ≥ {pct(prefs.missRisk)}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close alerts">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="drawer-body">
          {alerts.length === 0 && (
            <div className="empty-state">
              <div className="empty-title">No active alerts</div>
              <div className="muted">The shipment currently has no unresolved alerts.</div>
            </div>
          )}
          {alerts.length > 0 && visible.length === 0 && (
            <div className="empty-state">
              <div className="empty-title">All alerts dismissed</div>
              <div className="muted">New alerts will appear here after the next prediction run.</div>
            </div>
          )}
          {visible.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              read={readIds.has(a.id)}
              timeLabel={lastUpdated ? `Observed ${lastUpdated}` : null}
              onRead={onRead}
              onDismiss={onDismiss}
              onAction={closeAndGo}
            />
          ))}
        </div>
        <div className="drawer-foot">
          {unread > 0 && (
            <button
              className="btn ghost mini-btn"
              onClick={() => onReadAll && onReadAll(visible.map((a) => a.id))}
            >
              <CheckCheck size={13} aria-hidden="true" /> Mark all as read
            </button>
          )}
          {onNavigate && (
            <button
              className="btn ghost mini-btn"
              onClick={() => {
                onClose && onClose();
                onNavigate("settings");
              }}
            >
              <Settings2 size={13} aria-hidden="true" /> Tune thresholds
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
