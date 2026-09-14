import React from "react";
import { Star } from "lucide-react";
import { formatDelayRisk, formatEta, formatResilience } from "../../utils/formatters.js";

export default function RecommendationPanel({ recommendation, isFallback }) {
  if (!recommendation?.route) {
    return (
      <div className="recommendation-panel fallback">
        <Star className="rec-icon" size={18} aria-hidden="true" />
        <div className="rec-content">
          <strong>Recommendation:</strong> Unable to determine a recommended route with available data.
        </div>
      </div>
    );
  }

  const { route, text } = recommendation;
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
        <p className="rec-text">{text}</p>
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