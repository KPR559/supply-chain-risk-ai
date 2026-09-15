import React from "react";
import { Star } from "lucide-react";
import { formatDelayRisk, formatEta, formatResilience } from "../../utils/formatters.js";

export default function RecommendationPanel({ recommendation, isFallback }) {
  if (!recommendation?.route) {
    return null;
  }

  const { route, reasons } = recommendation;
  const displayReasons = reasons || route.reasons || [];
  const metrics = [
    route.delayRisk != null && `Delay risk: ${formatDelayRisk(route.delayRisk)}`,
    route.p50Eta != null && `P50 ETA: ${formatEta(route.p50Eta)}`,
    route.resilience != null && `Resilience: ${formatResilience(route.resilience)}`,
  ].filter(Boolean);

  return (
    <div className={`recommendation-panel ${isFallback ? "fallback" : ""}`}>
      <Star className="rec-icon" size={18} aria-hidden="true" />
      <div className="rec-content">
        <div className="rec-header">
          <strong>Recommendation:</strong>
          <span className="rec-route-name">{route.scenario}</span>
        </div>
        {displayReasons.length > 0 ? (
          <ul className="rec-reasons">
            {displayReasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        ) : (
          <p className="rec-text">This route offers the best balance of risk and transit time for this corridor.</p>
        )}
        {metrics.length > 0 && (
          <div className="rec-metrics">
            {metrics.map((m, i) => (
              <span key={i} className="rec-metric">
                {m}
                {i < metrics.length - 1 && <span className="metric-separator">·</span>}
              </span>
            ))}
          </div>
        )}
        {isFallback && (
          <span className="fallback-label">Based on demo data</span>
        )}
      </div>
    </div>
  );
}
