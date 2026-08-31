import React from "react";
import Sparkline from "./Sparkline.jsx";
import {
  computeResilienceScore,
  formatDate,
  resilienceLabel,
  riskClass,
  riskLabel,
} from "../utils/helpers.js";

function KpiCard({ label, value, sub, sparkData, sparkColor, variant }) {
  return (
    <div className={`kpi-card ${variant || ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-row">
        <div className="kpi-value">{value}</div>
        {sparkData && <Sparkline data={sparkData} color={sparkColor} width={72} height={26} fill />}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export default function SummaryCards({ prediction }) {
  const mc = prediction?.monte_carlo;
  const nodes = prediction?.node_predictions || [];

  if (!mc) {
    return (
      <div className="kpi-row-grid">
        <KpiCard label="Loading…" value="—" sub="Connecting to prediction engine" />
      </div>
    );
  }

  const avgRisk = nodes.length
    ? nodes.reduce((a, n) => a + n.delay_probability, 0) / nodes.length
    : 0;
  const maxRisk = nodes.length ? Math.max(...nodes.map((n) => n.delay_probability)) : avgRisk;
  const delayDays = (mc.expected_delay_hours ?? 0) / 24;
  const resilience = computeResilienceScore(nodes, mc);
  const etaDate = mc.expected_eta_date ? formatDate(mc.expected_eta_date) : `${mc.expected_days?.toFixed(0)} d`;

  const riskTrend = [58, 61, 64, 67, 69, 71, Math.round(maxRisk * 100)];
  const delayTrend = [3.2, 3.8, 4.5, 5.1, 5.6, 6.0, delayDays];
  const etaTrend = [42, 41, 40, 39.5, 39, 38.5, mc.expected_days];
  const resTrend = [72, 70, 68, 66, 65, 64, resilience];

  return (
    <div className="kpi-row-grid">
      <KpiCard
        label="Overall Delay Risk"
        value={`${Math.round(maxRisk * 100)}%`}
        sub={riskLabel(maxRisk)}
        sparkData={riskTrend}
        sparkColor="#f44336"
        variant={riskClass(maxRisk)}
      />
      <KpiCard
        label="Expected Delay"
        value={`+${delayDays.toFixed(1)} days`}
        sub="vs baseline transit"
        sparkData={delayTrend}
        sparkColor="#26a69a"
      />
      <KpiCard
        label="Current ETA"
        value={etaDate}
        sub={`P50 ${mc.percentiles?.p50?.toFixed(1)} d · P90 ${mc.percentiles?.p90?.toFixed(1)} d`}
        sparkData={etaTrend}
        sparkColor="#4cc2ff"
      />
      <KpiCard
        label="Route Resilience Score"
        value={`${resilience}/100`}
        sub={resilienceLabel(resilience)}
        sparkData={resTrend}
        sparkColor="#ffb300"
        variant={resilience >= 75 ? "low" : resilience >= 50 ? "med" : "high"}
      />
      <KpiCard
        label="Total Shipments"
        value="1,248"
        sub="Active shipments"
        sparkData={[980, 1020, 1080, 1120, 1160, 1200, 1248]}
        sparkColor="#78909c"
      />
    </div>
  );
}
