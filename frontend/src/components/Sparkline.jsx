import React from "react";

export default function Sparkline({ data, color = "#4cc2ff", width = 80, height = 28, fill = false }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const pathD = `M ${pts.join(" L ")}`;
  const fillD = fill ? `${pathD} L ${width},${height} L 0,${height} Z` : null;

  return (
    <svg width={width} height={height} className="sparkline">
      {fill && <path d={fillD} fill={color} opacity={0.15} />}
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
