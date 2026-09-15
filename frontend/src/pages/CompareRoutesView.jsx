import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { adaptRouteComparison } from "../utils/routeComparisonAdapter.js";
import AlternativeRoutesCard from "../components/route-comparison/AlternativeRoutesCard.jsx";
import TabState from "../components/TabState.jsx";

const OBJECTIVES = ["fastest", "lowest_risk", "balanced"];

export default function CompareRoutesView({ data }) {
  const { prediction, selectedShipment, loading, apiError, onRetry } = data;
  const ready = Boolean(prediction);

  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [cmpError, setCmpError] = useState(null);

  const sid = prediction?.shipment_id;

  useEffect(() => {
    if (!sid) {
      setCompareData(null);
      return;
    }
    let alive = true;
    api
      .compare(sid, OBJECTIVES)
      .then((res) => {
        if (!alive) return;
        setCompareData(res);
        setCmpError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setCompareData(null);
        setCmpError(e.message || "Comparison unavailable");
      });
    return () => {
      alive = false;
    };
  }, [sid]);

  // Adapt data with fallback
  const { routes, isFallback, recommendation } = adaptRouteComparison(
    cmpError ? null : compareData
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
          isFallback={isFallback || Boolean(cmpError)}
          onSelectRoute={setSelectedRouteId}
          selectedRouteId={selectedRouteId}
        />
      )}
    </div>
  );
}