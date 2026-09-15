import React, { useState } from "react";
import RouteIndicator from "./RouteIndicator.jsx";
import RiskBadge from "./RiskBadge.jsx";
import ResilienceScore from "./ResilienceScore.jsx";
import { formatEta, formatDistance } from "../../utils/formatters.js";
import { ChevronDown, ChevronUp } from "lucide-react";

export default function RouteComparisonRow({ route, isRecommended, isCurrent, onSelect, isSelected }) {
  const [showReasons, setShowReasons] = useState(false);
  const reasons = route.reasons || [];

  return (
    <tr className={`route-row ${isRecommended ? "recommended" : ""} ${isCurrent ? "current" : ""} ${isSelected ? "selected" : ""}`} onClick={onSelect ? () => onSelect(route.id) : undefined}>
      <td className="scenario-cell">
        <div className="scenario-content">
          <span className={`scenario-name ${isRecommended ? "recommended" : ""} ${isCurrent ? "current" : ""}`}>
            {route.scenario}
            {isRecommended && <span className="recommended-badge">Recommended</span>}
            {isCurrent && <span className="current-badge">Current</span>}
          </span>
          {reasons.length > 0 && (
            <button
              className="route-reasons-toggle"
              onClick={(e) => { e.stopPropagation(); setShowReasons((v) => !v); }}
              title="Why this route?"
              type="button"
            >
              {showReasons ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Why this route?
            </button>
          )}
          {showReasons && reasons.length > 0 && (
            <ul className="route-reasons-list">
              {reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
      </td>
      <td className="route-visual-cell">
        <RouteIndicator routeId={route.id} route={route.id} title={route.scenario} />
      </td>
      <td className="eta-cell" title="50% of simulated arrivals occur on or before this duration">
        <span className="mono">{formatEta(route.p50Eta)}</span>
      </td>
      <td className="eta-cell" title="90% of simulated arrivals occur on or before this duration">
        <span className="mono">{formatEta(route.p90Eta)}</span>
      </td>
      <td className="risk-cell">
        <RiskBadge risk={route.delayRisk} />
      </td>
      <td className="distance-cell" title="Total route distance">
        <span className="mono">{formatDistance(route.distance)}</span>
      </td>
      <td className="resilience-cell">
        <ResilienceScore score={route.resilience} />
      </td>
    </tr>
  );
}
