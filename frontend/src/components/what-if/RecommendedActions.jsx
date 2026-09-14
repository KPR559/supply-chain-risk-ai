import React from "react";
import { AlertTriangle, AlertCircle, CheckCircle, Info } from "lucide-react";
import { generateRecommendations } from "../../utils/whatIfUtils.js";

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

export default function RecommendedActions({ baseline, scenario, checkpoint, adjustments, alternativeRoutes }) {
  if (!baseline || !scenario) return null;

  const recommendations = generateRecommendations(baseline, scenario, checkpoint, adjustments, alternativeRoutes);

  return (
    <section className="panel what-if-recommendations">
      <h2>Recommended Actions</h2>
      <p className="muted">Suggested next steps based on scenario results</p>

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
                  <strong>{rec.title}</strong>
                  <span className={`rec-priority ${rec.priority}`}>{priorityLabels[rec.priority]}</span>
                </div>
                <p className="rec-text">{rec.text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}