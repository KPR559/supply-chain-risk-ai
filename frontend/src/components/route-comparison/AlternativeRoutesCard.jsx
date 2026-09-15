import React from "react";
import RouteComparisonTable from "./RouteComparisonTable.jsx";
import RecommendationPanel from "./RecommendationPanel.jsx";

export default function AlternativeRoutesCard({ routes, recommendation, isFallback, onSelectRoute, selectedRouteId }) {
  const count = routes.length;
  return (
    <section className="panel route-comparison-card">
      <div className="panel-head">
        <div>
          <h2>Alternative Routes</h2>
          <p className="muted">
            {count > 0
              ? `${count} corridor${count !== 1 ? "s" : ""} available for this shipment — compare by ETA, risk, distance, and resilience.`
              : "No alternative corridors found for this shipment's origin and destination."}
          </p>
        </div>
        {isFallback && <span className="fallback-badge">Showing demo comparison data</span>}
      </div>
      {count > 0 && (
        <RouteComparisonTable
          routes={routes}
          recommendation={recommendation}
          onSelectRoute={onSelectRoute}
          selectedRouteId={selectedRouteId}
        />
      )}
      {count === 0 && (
        <div className="empty-state">
          <p>No alternative routes serve this corridor. Try a shipment with a different origin or destination.</p>
        </div>
      )}
      <RecommendationPanel recommendation={recommendation} isFallback={isFallback} />
    </section>
  );
}
