import React from "react";

export default function Header({
  shipments,
  selectedId,
  onSelectShipment,
  loading,
  lastUpdated,
  onRefresh,
  prediction,
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
          <button className="refresh-btn" onClick={onRefresh} disabled={loading} title="Refresh">
            ↻
          </button>
        </div>
      </div>
    </header>
  );
}
