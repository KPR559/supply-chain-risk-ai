import React from "react";
import { formatDelayRisk, getRiskLevelClass } from "../../utils/formatters.js";

export default function RiskBadge({ risk }) {
  const formatted = formatDelayRisk(risk);
  const riskClass = getRiskLevelClass(risk);

  if (formatted === "N/A") {
    return <span className="risk-badge na">{formatted}</span>;
  }

  return (
    <span className={`risk-badge ${riskClass}`} title={`${formatted} delay risk`}>
      {formatted}
    </span>
  );
}