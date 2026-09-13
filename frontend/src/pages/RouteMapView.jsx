import React from "react";
import RouteMap from "../components/RouteMap.jsx";
import TabState from "../components/TabState.jsx";

export default function RouteMapView({ data }) {
  const { prediction, routesMeta, selectedShipment, loading, apiError, onRetry } = data;
  const route = prediction?.route_id;
  const meta = routesMeta.find((r) => r.route_id === route);

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Route Map</div>
          <div className="view-sub">
            {selectedShipment && `${selectedShipment.id} · ${selectedShipment.origin} → ${selectedShipment.destination} · `}
            {meta?.name || route}
            {meta?.distance_km != null && ` · ${Math.round(meta.distance_km).toLocaleString()} km`}
          </div>
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
          <RouteMap activeRouteId={route} nodes={prediction?.node_predictions} />
        </section>
      )}
    </div>
  );
}
