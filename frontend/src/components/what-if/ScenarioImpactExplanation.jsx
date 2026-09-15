import React from "react";
import { Info } from "lucide-react";

export default function ScenarioImpactExplanation({ result }) {
  const explanation = result?.impact_explanation;
  if (!explanation) return null;

  const reasons = explanation.reasons || [];

  return (
    <section className="panel what-if-impact-explanation">
      <div className="panel-head">
        <h2>Scenario Impact</h2>
        <Info size={16} aria-hidden="true" className="info-icon" />
      </div>
      <div className="explanation-content">
        <p className="impact-summary">{explanation.summary}</p>
        {reasons.length > 0 && (
          <ul className="impact-reasons">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}