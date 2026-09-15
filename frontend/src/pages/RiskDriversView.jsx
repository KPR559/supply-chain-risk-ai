import React from "react";
import { adaptExplanation, adaptDriverTrends } from "../utils/riskDriversAdapter.js";
import FactorAttributionCard from "../components/risk-drivers/FactorAttributionCard.jsx";
import DriverTrendsCard from "../components/risk-drivers/DriverTrendsCard.jsx";
import RootCauseAnalysis from "../components/RootCauseAnalysis.jsx";
import TabState from "../components/TabState.jsx";

export default function RiskDriversView({ data }) {
  const { prediction, explanation, critical, selectedShipment, loading, apiError, onRetry } = data;
  const ready = Boolean(explanation);
  const rootCauseReady = Boolean(
    critical?.critical_nodes?.length || explanation?.top_factors?.length
  );

  // Adapt data with fallbacks
  const { data: adaptedExplanation, isFallback: isExplanationFallback } = adaptExplanation(
    explanation,
    prediction
  );
  const { items: trendItems, isFallback: isTrendsFallback } = adaptDriverTrends(
    explanation,
    adaptedExplanation.top_factors
  );

  // Shipment display info
  const shipmentDisplay = selectedShipment
    ? `${selectedShipment.id} · ${selectedShipment.origin || "Unknown"} → ${selectedShipment.destination || "Unknown"}`
    : "No shipment selected";

  return (
    <div className="view-stack risk-drivers-page">
      <div className="view-head">
        <div>
          <div className="view-title">Risk Drivers</div>
          <div className="view-sub">Which factors push delay risk up or down</div>
          <div className="view-shipment">{shipmentDisplay}</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!ready}
        emptyText="No factor attribution yet — select a shipment to run the engine."
        loadingText="Attributing risk factors…"
      />

      {ready && (
        <>
          <FactorAttributionCard
            explanation={adaptedExplanation}
            isFallback={isExplanationFallback}
          />
          <DriverTrendsCard
            items={trendItems}
            isFallback={isTrendsFallback}
          />
        </>
      )}

      {rootCauseReady && (
        <section className="panel">
          <h2>Root Cause Composition</h2>
          <RootCauseAnalysis
            critical={critical}
            explanation={explanation}
            prediction={prediction}
          />
        </section>
      )}
    </div>
  );
}