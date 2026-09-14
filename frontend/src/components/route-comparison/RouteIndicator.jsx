import React from "react";
import { getRoutePath } from "../../utils/formatters.js";

export default function RouteIndicator({ routeId, route, title }) {
  const path = getRoutePath(routeId);

  return (
    <div className="route-indicator" title={title || route}>
      <svg width={48} height={20} className="mini-route-svg" aria-hidden="true">
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}