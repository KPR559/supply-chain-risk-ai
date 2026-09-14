import React from "react";
import { Moon, RefreshCw, Sun } from "lucide-react";

export default function Header({
  shipments,
  selectedId,
  onSelectShipment,
  loading,
  lastUpdated,
  onRefresh,
  prediction,
  theme,
  onToggleTheme,
}) {
  const list = shipments || [];

  return (
    <header className="page-header">
      <div className="page-title-block">
        <h1>AI Shipment Resilience & Counterfactual Digital Twin</h1>
      </div>
      <div className="header-controls">
        <label className="shipment-select">
          <span>Shipment ID</span>
          <select
            value={selectedId || ""}
            onChange={(e) => onSelectShipment(e.target.value)}
            disabled={loading || list.length === 0}
          >
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.origin} → {s.destination}
              </option>
            ))}
          </select>
        </label>
        <div className="last-updated">
          <span>Last Updated</span>
          <time>{lastUpdated || "—"}</time>
          <button
            className="refresh-btn"
            onClick={onRefresh}
            disabled={loading}
            title={loading ? "Refreshing…" : "Refresh shipment intelligence"}
            aria-label={loading ? "Refreshing" : "Refresh"}
          >
            <RefreshCw size={15} aria-hidden="true" className={loading ? "spin" : ""} />
          </button>
          {onToggleTheme && (
            <button
              className="refresh-btn"
              onClick={onToggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun size={15} aria-hidden="true" />
              ) : (
                <Moon size={15} aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}