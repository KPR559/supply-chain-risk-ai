import React from "react";
import { fmtDays, formatPercentileLabel } from "../models.js";

const KEYS = ["p10", "p25", "p50", "p80", "p90", "p95"];

export default function PercentileSummary({ mc }) {
  const pcts = mc?.percentiles ?? {};
  return (
    <section className="panel compact">
      <h2>Percentiles (days)</h2>
      <div className="pct-grid">
        {KEYS.map((k) => {
          const v = pcts[k];
          const missing = v == null;
          const tier =
            k === "p50" ? " is-median" : k === "p90" || k === "p95" ? " is-late" : "";
          return (
            <div
              key={k}
              className={`pct-item${tier}${missing ? " is-missing" : ""}`}
              title={missing ? "Not available for this simulation" : undefined}
            >
              <span className="pct-label">{formatPercentileLabel(k)}</span>
              <span className="pct-value mono">{missing ? "-" : fmtDays(v)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}