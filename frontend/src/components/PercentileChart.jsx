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

  const etaDates = mc.eta_date || {};
  const markers = [
    { key: "p10", val: p10, label: "P10", color: "#94a3b8" },
    { key: "p50", val: p50, label: "P50", color: "#38bdf8" },
    { key: "p80", val: pcts.p80 ?? p90, label: "P80", color: "#94a3b8" },
    { key: "p90", val: p90, label: "P90", color: "#94a3b8" },
    { key: "p95", val: pcts.p95 ?? p90, label: "P95", color: "#94a3b8" },
  ];

  // Deadline marker: interpolate the deadline date onto the days axis using
  // the known (percentile days → eta date) pairs. Skipped when it falls
  // outside the plotted range or dates are missing.
  const pairs = Object.entries(etaDates)
    .map(([k, d]) => {
      const days = pcts[k];
      const t = d ? new Date(`${d}T00:00:00`).getTime() : NaN;
      return Number.isFinite(days) && Number.isFinite(t) ? { days, t } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.days - b.days);
  let deadlineX = null;
  if (mc.deadline_date && pairs.length >= 2) {
    const t = new Date(`${mc.deadline_date}T00:00:00`).getTime();
    if (Number.isFinite(t)) {
      let lo = pairs[0];
      let hi = pairs[pairs.length - 1];
      for (let i = 0; i < pairs.length - 1; i++) {
        if (t >= pairs[i].t && t <= pairs[i + 1].t) {
          lo = pairs[i];
          hi = pairs[i + 1];
          break;
        }
      }
      const f = hi.t === lo.t ? 0 : (t - lo.t) / (hi.t - lo.t);
      const dd = lo.days + f * (hi.days - lo.days);
      if (dd >= minX && dd <= maxX) deadlineX = toX(dd);
    }
  }

  return (
    <div className="distribution-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="dist-svg">
        <defs>
          <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#distGrad)" />
        <path d={`M ${pathPts.join(" L ")}`} fill="none" stroke="#38bdf8" strokeWidth={2} />

        {deadlineX != null && (
          <g>
            <rect
              x={deadlineX}
              y={padT}
              width={Math.max(0, padL + plotW - deadlineX)}
              height={plotH}
              fill="rgba(239, 68, 68, 0.08)"
            />
            <line
              x1={deadlineX}
              y1={padT}
              x2={deadlineX}
              y2={padT + plotH}
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="5 3"
            >
              <title>Late arrival region — after {formatShortDate(mc.deadline_date)}</title>
            </line>
            <text x={deadlineX} y={padT - 4} textAnchor="middle" className="dist-marker-label" fill="#ef4444">
              Deadline
            </text>
          </g>
        )}

        {markers.map((m) => {
          const x = toX(m.val);
          const dateStr = etaDates[m.key]
            ? formatShortDate(etaDates[m.key])
            : `${m.val.toFixed(0)} d`;
          return (
            <g key={m.key}>
              <title>{`${m.label}: ${dateStr}`}</title>
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
