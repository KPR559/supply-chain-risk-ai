import React, { useState } from "react";
import { formatEta, formatPercent } from "../../utils/whatIfUtils.js";
import { ChevronDown, ChevronUp, Ban, TriangleAlert } from "lucide-react";

export default function AlternativeRouteComparison({ result, prediction }) {
  const altRoutes = result?.alternative_routes || [];
  if (altRoutes.length === 0) return null;

  const viable = altRoutes.filter((r) => !r.blocked);
  const blocked = altRoutes.filter((r) => r.blocked);
  const noViable = result?.no_viable_alternative === true || viable.length === 0;
  const recommendedRouteId = viable[0]?.route_id;

  const [showDetail, setShowDetail] = useState(false);
  const visible = showDetail ? altRoutes : altRoutes.slice(0, 1);

  return (
    <section className="panel what-if-alt-routes">
      <div className="panel-head">
        <h2>Alternative Routes Under This Scenario</h2>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowDetail((s) => !s)}
          title="Toggle all alternative routes"
        >
          {showDetail ? <>Show top only <ChevronUp size={13} aria-hidden="true" /></> : <>Show alternatives <ChevronDown size={13} aria-hidden="true" /></>}
        </button>
      </div>
      <p className="muted">
        {noViable
          ? "Every corridor for this origin–destination pair passes through the blocked chokepoint(s) below."
          : "The recommended alternative given projected queueing and disruption conditions."}
      </p>

      {noViable && (
        <div className="alt-route-warning">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>No alternative route avoids the closure</strong>
            <span>
              {result?.closed_chokepoints?.length
                ? `${result.closed_chokepoints.join(", ")} is` : "The blocked chokepoint is"}{" "}
              shared by every corridor serving this route. Rerouting is not an option until it reopens —
              see the recommendations for mitigations.
            </span>
          </div>
        </div>
      )}

      <div className="alt-route-card-list">
        {visible.map((r) => {
          const isRecommended = r.blocked ? false : r.route_id === recommendedRouteId;
          return (
            <div
              key={r.route_id}
              className={`alt-route-card ${isRecommended ? "recommended" : ""} ${r.blocked ? "blocked" : ""}`}
            >
              <div className="alt-route-head">
                <div className="alt-route-title">
                  <strong>{r.route_name}</strong>
                  {isRecommended && <span className="recommended-badge">Recommended</span>}
                  {r.blocked && (
                    <span className="blocked-badge"><Ban size={11} aria-hidden="true" /> Blocked</span>
                  )}
                </div>
                <div className="alt-route-tag">{r.route_id}</div>
              </div>

              {r.blocked && (
                <p className="alt-route-blocked-note">
                  {r.blocked_by?.length
                    ? `Also passes through ${r.blocked_by.join(", ")} — not a viable alternative for this scenario.`
                    : "Closed under this scenario — not a viable alternative."}
                </p>
              )}

              <div className="alt-route-metrics">
                <div className="alt-metric">
                  <span className="alt-metric-label">Expected</span>
                  <span className="alt-metric-value">{formatEta(r.expected_days)}</span>
                </div>
                <div className="alt-metric">
                  <span className="alt-metric-label">P90 ETA</span>
                  <span className="alt-metric-value">{formatEta(r.p90_eta_days)}</span>
                </div>
                <div className="alt-metric">
                  <span className="alt-metric-label">Deadline risk</span>
                  <span className="alt-metric-value">{formatPercent(r.deadline_risk)}</span>
                </div>
                <div className="alt-metric">
                  <span className="alt-metric-label">Uncertainty</span>
                  <span className="alt-metric-value">{formatEta(r.uncertainty_days)}</span>
                </div>
                <div className="alt-metric">
                  <span className="alt-metric-label">Resilience</span>
                  <span className="alt-metric-value">{Math.round(r.resilience_score)}/100</span>
                </div>
              </div>
              {r.recommendation && (
                <p className={`alt-route-recommendation ${r.blocked ? "muted" : ""}`}>{r.recommendation}</p>
              )}
            </div>
          );
        })}
      </div>

      {blocked.length > 0 && viable.length > 0 && (
        <p className="muted alt-route-footnote">
          {blocked.length} route{blocked.length > 1 ? "s" : ""} excluded — shares the blocked chokepoint
          ({blocked.map((b) => b.blocked_by.join(", ")).filter(Boolean).join(", ")}).
        </p>
      )}
    </section>
  );
}