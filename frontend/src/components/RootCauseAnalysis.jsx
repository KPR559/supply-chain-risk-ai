import React from "react";
import { DONUT_COLORS } from "../utils/helpers.js";

function DonutChart({ items, totalLabel }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let offset = 0;
  const r = 42;
  const c = 2 * Math.PI * r;

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 100 100" className="donut-chart">
        {items.map((item, i) => {
          const pct = item.value / total;
          const dash = pct * c;
          const seg = (
            <circle
              key={item.name}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth="14"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          );
          offset += dash;
          return seg;
        })}
        <text x="50" y="46" textAnchor="middle" className="donut-center-label">Total Impact</text>
        <text x="50" y="58" textAnchor="middle" className="donut-center-val">{totalLabel}</text>
      </svg>
    </div>
  );
}

export default function RootCauseAnalysis({ critical, explanation, prediction }) {
  const critItems = critical?.critical_nodes || [];
  const factors = explanation?.top_factors || [];
  const mc = prediction?.monte_carlo;

  if (!critItems.length && !factors.length) {
    return <div className="placeholder">Loading root cause analysis…</div>;
  }

  const impactDays = mc
    ? `+${((mc.expected_delay_hours ?? 0) / 24).toFixed(1)} days`
    : "+— days";

  const donutItems = critItems.slice(0, 5).map((c) => ({
    name: c.label,
    value: c.percent,
  }));

  // Data-driven impact pathway: the critical checkpoints in route order
  // (fall back to the top contributing factor labels if none are critical).
  const routeNodes = prediction?.node_predictions || [];
  const critIds = new Set(critItems.map((c) => c.node_id));
  const orderedCrit = routeNodes.filter((n) => critIds.has(n.node_id));
  const pathway = (orderedCrit.length ? orderedCrit : factors.slice(0, 5))
    .slice(0, 5)
    .map((x) => x.label || x.name);

  const maxFactor = Math.max(...factors.map((f) => Math.abs(f.contribution)), 0.01);

  return (
    <div className="rca">
      <div className="pathway">
        <div className="pathway-label">Primary Impact Pathway</div>
        <div className="pathway-flow">
          {pathway.map((step, i) => (
            <React.Fragment key={step}>
              <span className="pathway-node">{step}</span>
              {i < pathway.length - 1 && <span className="pathway-arrow">→</span>}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="rca-body">
        <div className="rca-factors">
          <div className="section-sub">Top Contributing Factors</div>
          {factors.slice(0, 5).map((f) => (
            <div className="factor-row" key={f.name}>
              <span className="factor-name">{f.name}</span>
              <div className="factor-track">
                <div
                  className="factor-fill"
                  style={{ width: `${(Math.abs(f.contribution) / maxFactor) * 100}%` }}
                />
              </div>
              <span className="factor-pct">
                {Math.round((Math.abs(f.contribution) / maxFactor) * 100)}%
              </span>
            </div>
          ))}
        </div>
        {donutItems.length > 0 && (
          <DonutChart items={donutItems} totalLabel={impactDays} />
        )}
      </div>
    </div>
  );
}
