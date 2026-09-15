import React from "react";
import { AlertTriangle, AlertCircle, Info, ArrowRight } from "lucide-react";

const priorityIcons = {
  critical: AlertTriangle,
  high: AlertCircle,
  medium: AlertTriangle,
  low: Info,
};

const priorityLabels = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export default function RecommendedActions({ result }) {
  const recommendations = result?.recommendations || null;
  const altRoutes = result?.alternative_routes || [];
  if (!recommendations && altRoutes.length === 0) return null;

  const topAlt = altRoutes[0];

  return (
    <section className="panel what-if-recommendations">
      <h2>Recommended Actions</h2>
      <p className="muted">Suggested next steps based on the scenario simulation</p>

      <div className="recommendations-list">
        {recommendations.map((rec, idx) => {
          const Icon = priorityIcons[rec.priority] || Info;
          return (
            <div key={idx} className={`recommendation-item priority-${rec.priority}`}>
              <div className="rec-icon">
                <Icon size={18} aria-hidden="true" />
              </div>
              <div className="rec-content">
                <div className="rec-header">
                  <strong>{rec.action}</strong>
                  <span className={`rec-priority ${rec.priority}`}>{priorityLabels[rec.priority]}</span>
                </div>
                <p className="rec-text">{rec.reason}</p>
                {rec.expected_benefit && (
                  <p className="rec-benefit">
                    <ArrowRight size={12} aria-hidden="true" />
                    {rec.expected_benefit}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}