import React from "react";
import RouteMap from "../components/RouteMap.jsx";

export default function RouteMapView({ data }) {
  const { prediction, routesMeta, selectedShipment } = data;
  const route = prediction?.route_id;
  const meta = routesMeta.find((r) => r.route_id === route);

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Route Map</div>
          <div className="view-sub">
            {selectedShipment
              ? `${selectedShipment.id} · ${selectedShipment.origin} → ${selectedShipment.destination}`
              : "Frankfurt → India"}{" "}
            · {meta?.name || route}
            {meta?.distance_km != null && ` · ${Math.round(meta.distance_km).toLocaleString()} km`}
          </div>
        </div>
      </div>

      <section className="panel">
        <RouteMap graph={route} nodes={prediction?.node_predictions} />
      </section>
    </div>
  );
}
