import React from "react";
import { formatShortDate } from "../utils/helpers.js";

function normalPdf(x, mu, sigma) {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

export default function PercentileChart({ mc }) {
  if (!mc?.percentiles) {
    return <div className="placeholder">No simulation data yet.</div>;
  }

  const pcts = mc.percentiles;
  const p10 = pcts.p10 ?? 0;
  const p50 = pcts.p50 ?? 0;
  const p90 = pcts.p90 ?? 0;
  const mu = p50;
  const sigma = Math.max((p90 - p10) / 2.56, 1);
  const minX = p10 - sigma * 0.8;
  const maxX = p90 + sigma * 0.8;
  const W = 680;
  const H = 180;
  const padL = 40;
  const padR = 20;
  const padT = 20;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const toX = (v) => padL + ((v - minX) / (maxX - minX)) * plotW;
  const samples = 80;
  const ys = [];
  for (let i = 0; i <= samples; i++) {
    const x = minX + (i / samples) * (maxX - minX);
    ys.push(normalPdf(x, mu, sigma));
  }
  const maxY = Math.max(...ys);
  const toY = (y) => padT + plotH - (y / maxY) * plotH;

  const pathPts = ys.map((y, i) => {
    const x = minX + (i / samples) * (maxX - minX);
    return `${toX(x)},${toY(y)}`;
  });
  const areaD = `M ${padL},${padT + plotH} L ${pathPts.join(" L ")} L ${padL + plotW},${padT + plotH} Z`;

  const markers = [
    { key: "p10", val: p10, label: "P10", color: "#78909c" },
    { key: "p50", val: p50, label: "P50", color: "#4cc2ff" },
    { key: "p90", val: p90, label: "P90", color: "#ffb300" },
  ];

  const etaDates = mc.eta_date || {};

  return (
    <div className="distribution-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="dist-svg">
        <defs>
          <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4cc2ff" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#4cc2ff" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#distGrad)" />
        <path d={`M ${pathPts.join(" L ")}`} fill="none" stroke="#4cc2ff" strokeWidth={2} />

        {markers.map((m) => {
          const x = toX(m.val);
          const dateStr = etaDates[m.key]
            ? formatShortDate(etaDates[m.key])
            : `${m.val.toFixed(0)} d`;
          return (
            <g key={m.key}>
              <line
                x1={x}
                y1={padT}
                x2={x}
                y2={padT + plotH}
                stroke={m.color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.8}
              />
              <text x={x} y={padT - 4} textAnchor="middle" className="dist-marker-label">
                {m.label}
              </text>
              <text x={x} y={H - 8} textAnchor="middle" className="dist-marker-date">
                {dateStr}
              </text>
            </g>
          );
        })}

        <text x={padL + plotW / 2} y={H - 2} textAnchor="middle" className="dist-axis-label">
          Estimated Arrival Date
        </text>
      </svg>
      <div className="note">
        {mc.n_simulations?.toLocaleString()} Monte Carlo simulations · graph-propagated node risk
      </div>
    </div>
  );
}
