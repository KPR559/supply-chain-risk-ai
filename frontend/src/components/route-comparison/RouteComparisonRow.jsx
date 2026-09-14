import React from "react";
import RouteIndicator from "./RouteIndicator.jsx";
import RiskBadge from "./RiskBadge.jsx";
import ResilienceScore from "./ResilienceScore.jsx";
import { formatEta, formatDistance } from "../../utils/formatters.js";

export default function RouteComparisonRow({ route, isRecommended, isCurrent, onSelect, isSelected }) {
  return (
    <tr className={`route-row ${isRecommended ? "recommended" : ""} ${isCurrent ? "current" : ""} ${isSelected ? "selected" : ""}`} onClick={onSelect ? () => onSelect(route.id) : undefined}>
      <td className="scenario-cell">
        <div className="scenario-content">
          <span className={`scenario-name ${isRecommended ? "recommended" : ""} ${isCurrent ? "current" : ""}`}>
            {route.scenario}
            {isRecommended && <span className="recommended-badge">Recommended</span>}
            {isCurrent && <span className="current-badge">Current</span>}
          </span>
          <span className="route-path">{route.route}</span>
        </div>
      </td>
      <td className="route-visual-cell">
        <RouteIndicator routeId={route.id} route={route.route} title={route.route} />
      </td>
      <td className="eta-cell mono" title="50% of simulated arrivals occur on or before this duration">
        {formatEta(route.p50Eta)}
      </td>
      <td className="eta-cell mono" title="90% of simulated arrivals occur on or before this duration">
        {formatEta(route.p90Eta)}
      </td>
      <td className="risk-cell">
        <RiskBadge risk={route.delayRisk} />
      </td>
      <td className="distance-cell mono" title="Total route distance">
        {formatDistance(route.distance)}
      </td>
      <td className="resilience-cell">
        <ResilienceScore score={route.resilience} />
      </td>
    </tr>
  );
}