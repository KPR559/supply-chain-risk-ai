import React from "react";
import { getBufferStatus } from "../models.js";
import { formatDate } from "../utils/helpers.js";

export default function DatesSummary({ deadline, expectedEta, p90Date, buffer }) {
  const buf = getBufferStatus(buffer);
  const items = [
    { label: "Required delivery", value: deadline ? formatDate(deadline) : "-" },
    { label: "Expected ETA", value: expectedEta ? formatDate(expectedEta) : "-" },
    { label: "P90 arrival", value: p90Date ? formatDate(p90Date) : "-" },
  ];

  return (
    <section className="panel compact">
      <h2>Dates</h2>
      <div className="dates-grid">
        {items.map((it) => (
          <div key={it.label} className="date-item" title={it.label}>
            <span className="date-label">{it.label}</span>
            <span className="date-value mono">{it.value}</span>
          </div>
        ))}
        <div
          className={`date-item${buf.cls ? ` buffer-${buf.cls}` : ""}`}
          title={buf.label === "—" ? "Buffer cannot be computed" : buf.label}
        >
          <span className="date-label">Buffer</span>
          <span className="date-value mono">{buf.label}</span>
        </div>
      </div>
    </section>
  );
}