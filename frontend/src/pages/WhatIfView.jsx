import React from "react";
import WhatIfPanel from "../components/WhatIfPanel.jsx";
import TabState from "../components/TabState.jsx";

export default function WhatIfView({ data }) {
  const { prediction, selectedShipment, loading, apiError, onRetry } = data;
  const ready = Boolean(prediction);

  const shipmentDisplay = selectedShipment
    ? `${selectedShipment.id} · ${selectedShipment.origin || "Unknown"} → ${selectedShipment.destination || "Unknown"}`
    : "No shipment selected";

  return (
    <div className="view-stack what-if-page">
      <div className="view-head">
        <div>
          <div className="view-title">What-if Simulator</div>
          <div className="view-sub">Stress-test the corridor — congestion, weather, closures</div>
          <div className="view-shipment">{shipmentDisplay}</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!ready}
        emptyText="No baseline yet — select a shipment to run the engine."
        loadingText="Loading baseline…"
      />

      {ready && <WhatIfPanel prediction={prediction} />}
    </div>
  );
}