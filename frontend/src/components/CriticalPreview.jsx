import React from "react";
import { ArrowRight } from "lucide-react";
import { fmtPct, kindLabel, riskBand } from "../models.js";

export default function CriticalPreview({ critical, prediction, onNavigate }) {
  const items = (critical?.critical_nodes || []).slice(0, 3);
  const nodes = prediction?.node_predictions || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.node_id, n]));

  return (
    <section className="panel" aria-label="Critical checkpoints preview">
      <div className="panel-head">
        <div>
          <h2>Critical Checkpoints</h2>
          <p className="muted">Ranked by contribution to total expected delay</p>
        </div>
        {onNavigate && (
          <button className="btn ghost mini-btn" onClick={() => onNavigate("checkpoints")}>
            View All <ArrowRight size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      {items.length === 0 && (
        <p className="muted">No checkpoint dominates the delay profile for this shipment.</p>
      )}
      <ol className="crit-preview-list">
        {items.map((c, i) => {
          const n = byId[c.node_id] || {};
          const badge = n.regime === 1
            ? { cls: "high", text: "Disrupted" }
            : (() => {
                const b = riskBand([n], null);
                return { cls: b.band === "critical" ? "high" : b.band, text: b.label };
              })();
          return (
            <li key={c.node_id} className="crit-preview-item">
              <span className="crit-rank">{i + 1}</span>
              <span className="crit-preview-main">
                <span className="crit-preview-head">
                  <span className="crit-preview-name">{c.label || c.node_id}</span>
                  <span className={`risk-pill ${badge.cls}`}>{badge.text}</span>
                </span>
                <span className="crit-preview-sub">
                  <span className="tip-kind">{kindLabel(n.kind)}</span>
                  <span>Delay probability {fmtPct(n.delay_probability)}</span>
                </span>
                <span className="muted" title="Share of total expected shipment delay attributed to this checkpoint (backend delay_share).">
                  Contribution to total expected delay: {fmtPct(c.delay_share)}
                </span>
              </span>
              {onNavigate && (
                <button
                  className="btn ghost mini-btn"
                  onClick={() => onNavigate("checkpoints")}
                  title={`Inspect ${c.label || c.node_id} on the Checkpoint Risk page`}
                >
                  View
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
