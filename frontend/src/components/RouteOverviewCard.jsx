import React from "react";
import { ArrowRight } from "lucide-react";
import RouteMap from "./RouteMap.jsx";

function shortPlace(s) {
  return (s || "").split(",")[0].trim() || null;
}

export default function RouteOverviewCard({ route, prediction, shipment, onNavigate }) {
  const from = shortPlace(shipment?.origin);
  const to = shortPlace(shipment?.destination);
  return (
    <section className="panel route-overview" aria-label="Route overview">
      <div className="panel-head">
        <div>
          <h2>Route Overview</h2>
          <p className="muted">{from && to ? `${from} → ${to}` : prediction?.route_name || "Corridor route"}</p>
        </div>
        {onNavigate && (
          <button className="btn ghost mini-btn" onClick={() => onNavigate("map")}>
            View Full Map <ArrowRight size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      <RouteMap activeRouteId={route} nodes={prediction?.node_predictions} />
    </section>
  );
}
