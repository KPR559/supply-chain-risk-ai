import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { routeDisplayName, riskClass } from "../utils/helpers.js";

const OBJECTIVES = ["fastest", "lowest_risk", "balanced"];

function MiniRoute({ routeId }) {
  const paths = {
    suez: "M2,12 L8,10 L14,8 L20,10 L26,12 L32,10",
    cape: "M2,12 L8,10 L14,14 L20,12 L26,10 L32,8",
    dubai: "M2,12 L8,10 L14,6 L20,8 L26,10 L32,12",
  };
  return (
    <svg width={36} height={18} className="mini-route">
      <path d={paths[routeId] || paths.suez} fill="none" stroke="#4cc2ff" strokeWidth={1.5} />
    </svg>
  );
}

export default function ComparePanel({ prediction }) {
  const [cmp, setCmp] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const sid = prediction?.shipment_id;

  const run = async () => {
    if (!sid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.compare(sid, OBJECTIVES);
      setCmp(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sid) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  if (!prediction) return <div className="placeholder">Run a prediction first.</div>;

  const rows = cmp?.options || [];
  const recs = cmp?.recommended || {};
  const bestRoute = recs.balanced || recs.lowest_risk || rows[0]?.route_id;

  return (
    <div className="whatif-sim">
      {loading && !cmp && <div className="placeholder">Simulating routes…</div>}
      {error && <div className="banner error">{error}</div>}
      {cmp && (
        <>
          <table className="data-table sim-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Route</th>
                <th>ETA (P50)</th>
                <th>P90 ETA</th>
                <th>Delay Risk</th>
                <th>Est. Cost</th>
                <th>Resilience</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isBest = r.route_id === bestRoute;
                const resilience = Math.round(
                  Math.max(0, 100 - r.delay_probability * 55 - (r.uncertainty_days / 20) * 25)
                );
                const cost = Math.round(r.distance_km * 0.85 + r.expected_eta_days * 1200);
                return (
                  <tr key={r.route_id} className={isBest ? "best-row" : ""}>
                    <td>{routeDisplayName(r.route_id)}</td>
                    <td><MiniRoute routeId={r.route_id} /></td>
                    <td className="mono">{r.expected_eta_days?.toFixed(0)} Sep</td>
                    <td className="mono">{r.p90_eta_days?.toFixed(0)} Sep</td>
                    <td>
                      <span className={`risk-pill ${riskClass(r.delay_probability)}`}>
                        {Math.round(r.delay_probability * 100)}%
                      </span>
                    </td>
                    <td className="mono">${(cost / 1000).toFixed(0)}k</td>
                    <td className="mono">{resilience}/100</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {bestRoute && (
            <div className="recommendation-banner">
              <span className="rec-icon">★</span>
              <div>
                <strong>Recommendation:</strong>{" "}
                {routeDisplayName(bestRoute)} offers the best balance of risk, time, and cost
                for this shipment corridor.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
