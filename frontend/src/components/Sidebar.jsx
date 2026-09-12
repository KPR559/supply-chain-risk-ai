import React from "react";

export const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: "◉" },
  { id: "map", label: "Route Map", icon: "◎" },
  { id: "radar", label: "Risk Radar", icon: "◈" },
  { id: "sim", label: "What-if Simulator", icon: "⬡" },
  { id: "shipments", label: "Shipments", icon: "▣" },
  { id: "alerts", label: "Alerts", icon: "⚠" },
  { id: "analytics", label: "Analytics", icon: "▤" },
  { id: "reports", label: "Reports", icon: "▥" },
];

export default function Sidebar({ active = "overview", onSelect, user, onLogout }) {
  return (
    <aside className="sidebar">
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
        <div className="sidebar-brand">
          <div className="brand-logo">∞</div>
          <div>
            <div className="brand-name">LOGIX</div>
            <div className="brand-sub">AI Supply Chain Suite</div>
          </div>
        </div>
      </div>
    </aside>
  );
}