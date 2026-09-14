import React from "react";
import { describeFactor } from "../../models.js";

export default function AttributionRow({ factor, maxAbsValue }) {
  const { name, value = 0, status } = factor;
  const friendly = describeFactor(name);
  const numValue = Number(value);
  const isPositive = numValue >= 0;
  const absValue = Math.abs(numValue);
  const widthPercent = maxAbsValue > 0 ? (absValue / maxAbsValue) * 100 : 0;
  const displayWidth = Math.max(4, widthPercent);

  return (
    <div className="attribution-row" title={`${friendly.label}: ${isPositive ? "+" : ""}${numValue.toFixed(2)}`}>
      <div className="attribution-name">
        <span className="attribution-label">{friendly.label}</span>
        <span className="attribution-hint">{friendly.hint}</span>
      </div>
      <div className="attribution-bar-container">
        <div className="attribution-track">
          <div
            className={`attribution-fill ${isPositive ? "positive" : "negative"}`}
            style={{
              width: `${displayWidth}%`,
              transform: isPositive ? "translateX(0)" : "translateX(-100%)",
            }}
          />
        </div>
        <div className="attribution-center-line" />
      </div>
      <div className="attribution-value-group">
        <span className={`attribution-value mono ${isPositive ? "positive" : "negative"}`}>
          {isPositive ? "+" : ""}{numValue.toFixed(2)}
        </span>
        {status && (
          <span className={`attribution-status ${isPositive ? "" : "reducing"}`}>
            {isPositive ? "increasing" : "reducing"}
          </span>
        )}
      </div>
    </div>
  );
}