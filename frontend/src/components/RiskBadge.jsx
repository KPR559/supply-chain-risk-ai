import React from "react";

// Shared pill badge: tone is a risk-pill class (low/med/high or "").
export default function RiskBadge({ tone, children, title }) {
  return (
    <span className={`risk-pill ${tone || ""}`} title={title || undefined}>
      {children}
    </span>
  );
}
