import React from "react";
import { Info } from "lucide-react";
import AttributionRow from "./AttributionRow.jsx";
import { getShapExplanation } from "../../utils/riskDriversAdapter.js";

export default function FactorAttributionCard({ explanation, isFallback }) {
  const factors = explanation?.top_factors || [];
  const maxAbsValue = Math.max(...factors.map((f) => Math.abs(f.contribution ?? 0)), 1);

  const riskiestNode = explanation?.node_label || "Unknown";
  const delayProbability = explanation?.delay_probability ?? 0;

  return (
    <section className="panel risk-drivers-attribution">
      <div className="panel-head">
        <div>
          <h2>Factor Attribution</h2>
          <p className="muted">
            Positive values increase risk. Negative values reduce risk relative to the baseline.
          </p>
        </div>
        {isFallback && (
          <span className="fallback-badge">Showing demo attribution data</span>
        )}
      </div>

      <div className="attribution-summary">
        <div className="summary-item">
          <span className="summary-label risk-pill high">riskiest node: {riskiestNode}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label note">delay probability {(delayProbability * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="attribution-rows">
        {factors.map((factor) => (
          <AttributionRow key={factor.name} factor={factor} maxAbsValue={maxAbsValue} />
        ))}
      </div>

      <div className="attribution-footer">
        <span className="shap-explanation">
          <Info size={13} aria-hidden="true" />
          <span className="shap-text">
            Local SHAP contributions to the predicted delay probability for the selected
            shipment/checkpoint. Positive values push risk up.
          </span>
          <span className="shap-tooltip">{getShapExplanation()}</span>
        </span>
      </div>
    </section>
  );
}