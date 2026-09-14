import React from "react";
import RiskBadge from "../RiskBadge.jsx";

const REGIME_LABEL = { 0: "normal", 1: "disrupted" };
const REGIME_TONE = { 0: "low", 1: "high" };

export default function RegimeBadge({ regime }) {
  const r = Number(regime);
  const label = REGIME_LABEL[r] || "unknown";
  return <RiskBadge tone={REGIME_TONE[r] || ""}>{label}</RiskBadge>;
}