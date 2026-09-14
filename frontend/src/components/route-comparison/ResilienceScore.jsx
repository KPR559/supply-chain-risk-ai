import React from "react";
import { formatResilience, getResilienceLevel } from "../../utils/formatters.js";

export default function ResilienceScore({ score }) {
  const formatted = formatResilience(score);
  const level = getResilienceLevel(score);
  const percent = score != null && !Number.isNaN(Number(score)) ? Math.round(Number(score)) : 0;

  if (formatted === "N/A") {
    return <span className="resilience-score na">{formatted}</span>;
  }

  let levelClass = "low";
  if (percent >= 70) levelClass = "high";
  else if (percent >= 40) levelClass = "medium";

  return (
    <div className="resilience-score" title={`${level} (${formatted})`}>
      <div className="resilience-bar">
        <div className={`resilience-fill ${levelClass}`} style={{ width: `${percent}%` }} />
      </div>
      <span className={`resilience-value ${levelClass}`}>{formatted}</span>
    </div>
  );
}