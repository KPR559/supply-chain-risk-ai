import React from "react";
import { Info } from "lucide-react";
import { generateScenarioImpact } from "../../utils/whatIfUtils.js";

export default function ScenarioImpactExplanation({ baseline, scenario, checkpoint, adjustments }) {
  if (!baseline || !scenario) return null;

  const explanation = generateScenarioImpact(baseline, scenario, checkpoint, adjustments);

  return (
    <section className="panel what-if-impact-explanation">
      <div className="panel-head">
        <h2>Scenario Impact</h2>
        <Info size={16} aria-hidden="true" className="info-icon" />
      </div>
      <div className="explanation-content">
        <p>{explanation}</p>
      </div>
    </section>
  );
}