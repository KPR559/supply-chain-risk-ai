import React from "react";
import RouteComparisonRow from "./RouteComparisonRow.jsx";

export default function RouteComparisonTable({ routes, recommendation, onSelectRoute, selectedRouteId }) {
  const recommendedRouteId = recommendation?.route?.id;

  return (
    <div className="route-comparison-table-container">
      <table className="data-table route-comparison-table">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Route</th>
            <th className="numeric">ETA (P50)</th>
            <th className="numeric">P90 ETA</th>
            <th>Delay Risk</th>
            <th className="numeric">Distance</th>
            <th className="numeric">Resilience</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((route) => (
            <RouteComparisonRow
              key={route.id}
              route={route}
              isRecommended={route.id === recommendedRouteId}
              isCurrent={route.id === "current" || route.id === "suez"}
              onSelect={onSelectRoute}
              isSelected={route.id === selectedRouteId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}