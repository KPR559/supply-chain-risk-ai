import React from "react";

export default function Sparkline({
  data,
  color = "#38bdf8",
  width = 100,
  height = 30,
  fill = true,
  showTrend = true,
}) {
  if (!data || data.length < 2) {
    return (
      <span className="sparkline-placeholder" title="No trend data">
        No trend data
      </span>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const pts = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * plotWidth;
    const y = padding + plotHeight - ((v - min) / range) * plotHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${pts.join(" L ")}`;
  const fillD = fill
    ? `${pathD} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`
    : null;

  // Calculate trend direction
  const firstHalf = data.slice(0, Math.ceil(data.length / 2));
  const secondHalf = data.slice(Math.floor(data.length / 2));
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const trendUp = secondAvg > firstAvg;
  const trendDown = secondAvg < firstAvg;

  return (
    <div className="sparkline-wrapper" title={data.map((d) => d.toFixed(0)).join(", ")}>
      <svg width={width} height={height} className="sparkline" aria-hidden="true">
        {fillD && <path d={fillD} fill={color} opacity={0.15} />}
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Current value dot */}
        <circle
          cx={width - padding}
          cy={padding + plotHeight - ((data[data.length - 1] - min) / range) * plotHeight}
          r={3}
          fill={color}
        />
      </svg>
      {showTrend && (trendUp || trendDown) && (
        <span className={`sparkline-trend ${trendUp ? "up" : "down"}`}>
          {trendUp ? "↗" : "↘"}
        </span>
      )}
    </div>
  );
}