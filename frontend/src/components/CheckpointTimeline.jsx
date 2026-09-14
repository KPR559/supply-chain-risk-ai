import React from "react";
import { ArrowRight } from "lucide-react";
import { fmtDelayDays, fmtPct, kindLabel } from "../models.js";
import { riskClass } from "../utils/helpers.js";

// Position states follow the shipment's reported current location:
// a node matching it is Current, earlier ones Completed, later ones
// Upcoming; with no match every position reads Unknown (risk styling
// still applies). Disrupted (regime) always wins for the status pill.
function locate(nodes, location) {
  const q = (location || "").trim().toLowerCase();
  if (!q) return -1;
  return nodes.findIndex((n) => (n.label || n.node_id || "").toLowerCase().includes(q));
}

function stateFor(n, idx, currentIdx) {
  if (n.regime === 1) return { key: "disrupted", label: "Disrupted", cls: "high" };
  if (idx === currentIdx) return { key: "current", label: "Current", cls: "" };
  if ((n.delay_probability ?? 0) >= 0.8) return { key: "delayed", label: "Delayed", cls: "high" };
  if (currentIdx < 0) return { key: "monitoring", label: "Monitoring", cls: "" };
  if (idx < currentIdx) return { key: "completed", label: "Completed", cls: "low" };
  return { key: "upcoming", label: "Upcoming", cls: "" };
}

export default function CheckpointTimeline({ nodes, location, onDetails }) {
  const list = nodes || [];
  if (!list.length) {
    return <div className="placeholder">No checkpoint data for this shipment.</div>;
  }
  const currentIdx = locate(list, location);
  const unmatched = currentIdx < 0 && (location || "").trim();

  return (
    <div>
      {unmatched && (
        <div className="banner info">
          Reported current location “{location.trim()}” is not a tracked checkpoint —
          showing all corridor checkpoints monitored by risk.
        </div>
      )}
      <ol className="cp-timeline">
        {list.map((n, idx) => {
          const st = stateFor(n, idx, currentIdx);
          const prob = n.delay_probability ?? 0;
          const critical = prob >= 0.6;
          return (
            <li
              key={n.node_id}
              className={`cp-card state-${st.key}${critical ? " critical" : ""}${idx === currentIdx ? " is-current" : ""}`}
            >
              <div className="cp-dot" aria-hidden="true" />
              <div className="cp-head">
                <span className="cp-name">{n.label || n.node_id}</span>
                <span className={`risk-pill ${st.cls}`}>{st.label}</span>
              </div>
              <div className="cp-sub">
                <span className="tip-kind">{kindLabel(n.kind)}</span>
                {idx === currentIdx && <span className="cp-current-tag">Current checkpoint</span>}
              </div>
              <div className="cp-metrics">
                <span>Delay risk <b className="mono">{fmtPct(prob)}</b></span>
                <span>Expected delay <b className="mono">{n.expected_delay_hours != null ? fmtDelayDays(n.expected_delay_hours) : "Not available"}</b></span>
              </div>
              <div className="cp-foot">
                <span className={`risk-pill ${riskClass(prob)}`}>
                  {prob >= 0.6 ? "Critical" : prob >= 0.35 ? "Medium" : "Low"} risk
                </span>
                {onDetails && (
                  <button className="btn ghost mini-btn" onClick={() => onDetails(n.node_id)}>
                    View Details <ArrowRight size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="muted">
        {currentIdx >= 0
          ? "Position states follow the shipment's reported current location."
          : "Checkpoints are monitored by risk until the reported location matches a tracked checkpoint."}
      </p>
    </div>
  );
}
