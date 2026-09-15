import React from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Diamond,
  FlaskConical,
  Layers,
  LayoutDashboard,
  LogOut,
  Package,
  PieChart,
  Route as RouteIcon,
  Settings as SettingsIcon,
} from "lucide-react";

export const NAV_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "intelligence", label: "Shipment Intelligence" },
  { id: "analysis", label: "Prediction & Analysis" },
  { id: "simulation", label: "Simulation" },
  { id: "system", label: "System" },
];

export const NAV_ITEMS = [
  { id: "results", label: "Dashboard", icon: LayoutDashboard, section: "overview" },
  { id: "shipments", label: "Shipment Status", icon: Package, section: "intelligence" },
  { id: "map", label: "Route Map", icon: RouteIcon, section: "intelligence" },
  { id: "checkpoints", label: "Checkpoint Risk", icon: Diamond, section: "intelligence" },
  { id: "eta", label: "ETA Distribution", icon: BarChart3, section: "analysis" },
  { id: "contributors", label: "Risk Drivers", icon: Layers, section: "analysis" },
  { id: "charts", label: "Root Cause", icon: PieChart, section: "analysis" },
  { id: "compare", label: "Route Comparison", icon: ArrowLeftRight, section: "analysis" },
  { id: "simulator", label: "What-if Simulator", icon: FlaskConical, section: "simulation" },
  { id: "settings", label: "Settings", icon: SettingsIcon, section: "system" },
];



export default function Sidebar({ active = "results", onSelect, user, avatar, onLogout, onOpenAlerts }) {
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
        <nav className="sidebar-nav" aria-label="Primary">
          {NAV_SECTIONS.map((section) => {
            const items = NAV_ITEMS.filter((i) => i.section === section.id);
            if (!items.length) return null;
            return (
              <div key={section.id} className="nav-group">
                <div className="nav-section">{section.label}</div>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className={`nav-item ${active === item.id ? "active" : ""}`}
                      title={item.label}
                      type="button"
                      aria-pressed={active === item.id}
                      onClick={() => onSelect && onSelect(item.id)}
                    >
                      <span className="nav-icon"><Icon size={15} strokeWidth={2} aria-hidden="true" /></span>
                      <span className="nav-label">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </div>
      <div className="sidebar-footer">
        {user && (
          <div className="sidebar-user-row">
            <div className="sidebar-user" title={`Signed in as ${user}`}>
              {avatar ? (
                <span className="user-avatar user-avatar-img">
                  <img src={avatar} alt={user} />
                </span>
              ) : (
                <span className="user-avatar">{user[0].toUpperCase()}</span>
              )}
              <span className="user-name">{user}</span>
            </div>
            <button
              className="icon-btn"
              onClick={() => onOpenAlerts && onOpenAlerts()}
              title="Alerts & Recommendations"
              aria-label="Open alerts"
            >
              <Bell size={15} aria-hidden="true" />
            </button>
          </div>
        )}
        {onLogout && (
          <button className="btn ghost logout-btn-full" onClick={onLogout} title="Sign out">
            <LogOut size={14} aria-hidden="true" /> Log out
          </button>
        )}
      </div>
    </aside>
  );
}