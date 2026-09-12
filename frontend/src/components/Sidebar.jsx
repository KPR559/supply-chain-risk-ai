import React from "react";

export const NAV_ITEMS = [
  { id: "results", label: "Prediction Results", icon: "◉" },
  { id: "map", label: "Route Map", icon: "◎" },
  { id: "checkpoints", label: "Checkpoint Risk", icon: "◈" },
  { id: "shipments", label: "Shipment Status", icon: "▣" },
  { id: "eta", label: "ETA Distribution", icon: "◔" },
  { id: "deadline", label: "Deadline Risk", icon: "⚑" },
  { id: "critical", label: "Critical Checkpoints", icon: "⚠" },
  { id: "contributors", label: "Risk Contributors", icon: "◫" },
  { id: "simulator", label: "What-if Simulator", icon: "⬡" },
  { id: "compare", label: "Route Comparison", icon: "⇄" },
  { id: "charts", label: "Charts & Graphs", icon: "▤" },
];

export default function Sidebar({ active = "results", onSelect, user, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <div className="brand-logo">∞</div>
          <div>
            <div className="brand-name">LOGIX</div>
            <div className="brand-sub">AI Supply Chain Suite</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${active === item.id ? "active" : ""}`}
              title={item.label}
              type="button"
              aria-pressed={active === item.id}
              onClick={() => onSelect && onSelect(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="sidebar-footer">
        {user && (
          <div className="sidebar-user" title={`Signed in as ${user}`}>
            <span className="user-avatar">{user[0].toUpperCase()}</span>
            <span className="user-name">{user}</span>
          </div>
        )}
        {onLogout && (
          <button className="btn ghost logout-btn-full" onClick={onLogout} title="Sign out">
            ⏻ Log out
          </button>
        )}
      </div>
    </aside>
  );
}