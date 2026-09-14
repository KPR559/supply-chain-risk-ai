import React from "react";
import { formatShortDate } from "../utils/helpers.js";
import { formatPercentileLabel } from "../models.js";

const MARKER_COLOR = {
  p10: "#94a3b8",
  p25: "#94a3b8",
  p50: "#38bdf8",
  p80: "#94a3b8",
  p90: "#f59e0b",
  p95: "#f59e0b",
};

function normalPdf(x, mu, sigma) {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

// Rough text width estimate for the small SVG labels (monospace-ish).
function estW(s, size) {
  return String(s).length * (size * 0.62) + 6;
}

// Assign each item to one of two vertical rows so labels never overlap.
function assignRows(items) {
  const rows = [[], []];
  return items.map((it) => {
    for (let r = 0; r < rows.length; r++) {
      const ok = rows[r].every((o) => Math.abs(it.x - o.x) > (it.w + o.w) / 2 + 5);
      if (ok) {
        rows[r].push(it);
        return { ...it, row: r };
      }
    }
    rows[0].push(it);
    return { ...it, row: 0 };
  });
}

export default function PercentileChart({ mc }) {
  if (!mc?.percentiles) {
    return <div className="placeholder">No simulation data yet.</div>;
  }

  const pcts = mc.percentiles;
  const p10 = pcts.p10 ?? pcts.p25 ?? 0;
  const p50 = pcts.p50 ?? 0;
  const p90 = pcts.p90 ?? pcts.p95 ?? p50 + 1;
  const mu = p50;
  const sigma = Math.max((p90 - p10) / 2.56, 1);
  const minX = p10 - sigma * 0.8;
  const maxX = p90 + sigma * 0.8;
  const W = 680;
  const H = 220;
  const padL = 44;
  const padR = 20;
  const padT = 24;
  const padB = 48;
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
  const markerKeys = ["p10", "p25", "p50", "p80", "p90", "p95"].filter((k) => pcts[k] != null);
  const markers = markerKeys.map((k) => ({
    key: k,
    val: pcts[k],
    label: formatPercentileLabel(k),
    color: MARKER_COLOR[k] || "#94a3b8",
  }));

  const topRows = assignRows(
    markers.map((m) => ({ x: toX(m.val), w: estW(m.label, 9), key: m.key }))
  );
  const bottomRows = assignRows(
    markers.map((m) => {
      const dateStr = etaDates[m.key] ? formatShortDate(etaDates[m.key]) : `${m.val.toFixed(0)} d`;
      return { x: toX(m.val), w: estW(dateStr, 9.5), key: m.key };
    })
  );
  const dateStrOf = (k) => {
    const m = markers.find((x) => x.key === k);
    return etaDates[k] ? formatShortDate(etaDates[k]) : `${m.val.toFixed(0)} d`;
  };

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

  const gridYs = [0, 1, 2, 3, 4].map((i) => padT + (i / 4) * plotH);

  return (
    <div className="distribution-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="dist-svg" role="img" aria-label="Estimated arrival distribution">
        <defs>
          <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <g>
          {gridYs.map((y) => (
            <line key={y} x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="rgba(148,163,184,0.14)" strokeWidth={1} />
          ))}
        </g>

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
            <text x={deadlineX} y={padT - 6} textAnchor="middle" className="dist-marker-label" fill="#ef4444">
              Deadline
            </text>
          </g>
        )}

        {markers.map((m) => {
          const x = toX(m.val);
          const dateStr = dateStrOf(m.key);
          const top = topRows.find((t) => t.key === m.key);
          const bot = bottomRows.find((b) => b.key === m.key);
          const topY = padT - 6 - (top?.row === 1 ? 14 : 0);
          const botY = H - 24 - (bot?.row === 1 ? 14 : 0);
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
              <text x={x} y={topY} textAnchor="middle" className="dist-marker-label" fill={m.color}>
                {m.label}
              </text>
              <text x={x} y={botY} textAnchor="middle" className="dist-marker-date">
                {dateStr}
              </text>
            </g>
          );
        })}

        <text x={padL + plotW / 2} y={H - 6} textAnchor="middle" className="dist-axis-label">
          Estimated Arrival Date
        </text>
      </svg>
      <div className="note">
        {mc.n_simulations != null
          ? `${mc.n_simulations.toLocaleString()} Monte Carlo simulations · graph-propagated node risk`
          : "Estimated arrival distribution from Monte Carlo simulation"}
      </div>
    </div>
  );
}