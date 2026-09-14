import React from "react";
import RouteComparisonTable from "./RouteComparisonTable.jsx";
import RecommendationPanel from "./RecommendationPanel.jsx";

export default function AlternativeRoutesCard({ routes, recommendation, isFallback, onSelectRoute, selectedRouteId }) {
  return (
    <section className="panel route-comparison-card">
      <div className="panel-head">
        <div>
          <h2>Alternative Routes</h2>
          <p className="muted">Compare corridors by ETA, risk, distance, and resilience</p>
        </div>
        {isFallback && <span className="fallback-badge">Showing demo comparison data</span>}
      </div>
      <RouteComparisonTable
        routes={routes}
        recommendation={recommendation}
        onSelectRoute={onSelectRoute}
        selectedRouteId={selectedRouteId}
      />
      <RecommendationPanel recommendation={recommendation} isFallback={isFallback} />
    </section>
  );
}