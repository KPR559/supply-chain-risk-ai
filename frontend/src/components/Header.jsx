import React from "react";

export default function Header({
  route,
  routesMeta,
  onRouteChange,
  loading,
  lastUpdated,
  onRefresh,
  prediction,
  user,
  onLogout,
}) {
  const shipmentId = prediction?.shipment_id
    ? prediction.shipment_id.replace("frankfurt-final_destination", "FRK-IND-9281").toUpperCase()
    : "FRK-IND-9281";

  return (
    <header className="page-header">
      <div className="page-title-block">
        <h1>AI Shipment Resilience & Counterfactual Digital Twin</h1>
        <p className="sub">
          Supply Chain Intelligence · Frankfurt → India · Per-node risk · Monte Carlo ETA · What-if & route planning
        </p>
      </div>
      <div className="header-controls">
        <label className="shipment-select">
          <span>Shipment ID</span>
          <select value={route} onChange={(e) => onRouteChange(e.target.value)} disabled={loading}>
            {routesMeta.map((r) => (
              <option key={r.route_id} value={r.route_id}>
                {shipmentId} · {r.name}
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
        {user && (
          <div className="user-chip" title={`Signed in as ${user}`}>
            <span className="user-name">{user}</span>
            <button className="btn ghost logout-btn" onClick={onLogout} title="Sign out">
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
