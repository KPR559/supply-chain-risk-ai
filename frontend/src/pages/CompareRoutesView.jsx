import React, { useState } from "react";
import { adaptRouteComparison } from "../utils/routeComparisonAdapter.js";
import AlternativeRoutesCard from "../components/route-comparison/AlternativeRoutesCard.jsx";
import TabState from "../components/TabState.jsx";

export default function CompareRoutesView({ data }) {
  const { prediction, selectedShipment, loading, apiError, onRetry } = data;
  const ready = Boolean(prediction);

  const [selectedRouteId, setSelectedRouteId] = useState(null);

  // Adapt data with fallback
  const { routes, isFallback, recommendation } = adaptRouteComparison(
    prediction?.route_comparison
  );

  // Shipment display info
  const shipmentDisplay = selectedShipment
    ? `${selectedShipment.id} · ${selectedShipment.origin || "Unknown"} → ${selectedShipment.destination || "Unknown"}`
    : "No shipment selected";

  return (
    <div className="view-stack route-comparison-page">
      <div className="view-head">
        <div>
          <div className="view-title">Route Comparison</div>
          <div className="view-sub">Which corridor performs best per objective</div>
          <div className="view-shipment">{shipmentDisplay}</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!ready}
        emptyText="Nothing to compare yet — select a shipment to run the engine."
        loadingText="Loading comparison…"
      />

      {ready && (
        <AlternativeRoutesCard
          routes={routes}
          recommendation={recommendation}
          isFallback={isFallback}
          onSelectRoute={setSelectedRouteId}
          selectedRouteId={selectedRouteId}
        />
      )}
    </div>
  );
}