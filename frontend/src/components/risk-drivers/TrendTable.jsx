import React from "react";
import Sparkline from "./Sparkline.jsx";

export default function TrendTable({ items, isFallback }) {
  const driverLabels = {
    base: "Baseline route risk",
    regime: "Active disruption regime",
    conflict: "Geopolitical disruption risk",
    weather: "Weather conditions",
    congestion: "Port congestion",
    customs: "Customs clearance risk",
  };

  return (
    <div className="trend-table-container">
      <table className="data-table drivers-trend-table">
        <thead>
          <tr>
            <th>Driver</th>
            <th className="mono">Index</th>
            <th>7-Day Trend</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.driver}>
              <td>
                <span className="driver-name">{driverLabels[item.driver] || item.driver}</span>
                <span className="driver-key mono">{item.driver}</span>
              </td>
              <td className="mono">{item.index.toLocaleString()}</td>
              <td>
                <Sparkline
                  data={item.trend}
                  color="#f59e0b"
                  width={120}
                  height={32}
                  fill={true}
                  showTrend={true}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {isFallback && (
        <p className="fallback-note">Showing demo driver trend data</p>
      )}
    </div>
  );
}