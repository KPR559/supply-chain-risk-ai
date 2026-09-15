import React from "react";
import RouteMap from "../components/RouteMap.jsx";
import TabState from "../components/TabState.jsx";

export default function RouteMapView({ data }) {
  const { prediction, health, loading, apiError, onRetry } = data;
  const route = prediction?.route_id;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Route Map</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!prediction}
        emptyText="No route to draw yet — select a shipment to run the engine."
        loadingText="Loading route map…"
      />

      {prediction && (
        <section className="panel">
          <RouteMap
            activeRouteId={route}
            nodes={prediction?.node_predictions}
            prediction={prediction}
            aiAvailable={health?.llm?.available ?? null}
          />
        </section>
      )}
    </div>
  );
}
