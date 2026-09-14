import React from "react";
import Sparkline from "./Sparkline.jsx";

const TREND_SEEDS = {
  congestion: [62, 65, 68, 71, 74, 78, 82],
  weather: [28, 30, 32, 35, 38, 40, 42],
  conflict: [45, 48, 52, 55, 58, 60, 63],
  customs: [35, 36, 38, 39, 41, 43, 45],
  port: [50, 52, 54, 57, 59, 62, 65],
};

function trendFor(name) {
  const key = Object.keys(TREND_SEEDS).find((k) => name.toLowerCase().includes(k));
  if (key) return TREND_SEEDS[key];
  const base = name.length * 7;
  return [base, base + 2, base + 4, base + 3, base + 6, base + 8, base + 10];
}

export default function KeyDriversTrend({ explanation, nodes }) {
  const factors = explanation?.top_factors?.slice(0, 4) || [];
  const items = factors.length
    ? factors.map((f) => ({
        name: f.name,
        index: Math.round(Math.abs(f.contribution) * 100),
        trend: trendFor(f.name),
      }))
    : (nodes || []).slice(0, 4).map((n) => ({
        name: n.label,
        index: Math.round(n.delay_probability * 100),
        trend: trendFor(n.node_id),
      }));

  if (!items.length) {
    return <div className="placeholder">No driver trends.</div>;
  }

  return (
    <table className="data-table drivers-table">
      <thead>
        <tr>
          <th>Driver</th>
          <th>Index</th>
          <th>7-Day Trend</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.name}>
            <td>{item.name}</td>
            <td className="mono">{item.index}</td>
            <td>
              <Sparkline data={item.trend} color="#f59e0b" width={72} height={22} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
