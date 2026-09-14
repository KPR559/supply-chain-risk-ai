import React from "react";
import { ArrowRight } from "lucide-react";
import { describeFactor } from "../models.js";

export default function RiskDriversCard({ explanation, onNavigate }) {
  const drivers = (explanation?.top_factors || []).slice(0, 6);
  const maxC = Math.max(...drivers.map((f) => Math.abs(f.contribution ?? 0)), 1);

  return (
    <section className="panel" aria-label="Risk drivers">
      <div className="panel-head">
        <div>
          <h2>Risk Drivers</h2>
          <p className="muted">
            What pushes delay risk up or down{explanation?.node_label ? ` at ${explanation.node_label}` : ""}
          </p>
        </div>
        {onNavigate && (
          <button className="btn ghost mini-btn" onClick={() => onNavigate("contributors")}>
            Full Analysis <ArrowRight size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      {drivers.length === 0 && (
        <p className="muted">No factor attribution available for this shipment.</p>
      )}
      <div className="driver-list">
        {drivers.map((f) => {
          const d = describeFactor(f.name);
          const push = (f.contribution ?? 0) >= 0;
          return (
            <div key={f.name} className="driver-row">
              <span className="driver-main">
                <span className="driver-name" title={`Model feature: ${d.raw}`}>{d.label}</span>
                <span className="driver-hint">{d.hint}</span>
              </span>
              <span className="driver-track">
                <span
                  className={`driver-fill ${push ? "push" : "pull"}`}
                  style={{ width: `${Math.max(3, (Math.abs(f.contribution ?? 0) / maxC) * 100)}%` }}
                />
              </span>
              <span className="driver-val mono">
                {push ? "+" : ""}{Number(f.contribution ?? 0).toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
