import React from "react";

// Proportional horizontal bar. value 0–100; tone: hot | warn | cool.
export default function ProgressBar({ value, tone, title }) {
  const v = Number(value);
  const w = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuenow={Math.round(w)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={title || "Progress"}
      title={title}
    >
      <div className={`progress-fill ${tone || ""}`} style={{ width: `${w}%` }} />
    </div>
  );
}