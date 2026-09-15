import React from "react";
import {
  AlarmClock,
  CalendarCheck,
  ClipboardList,
  Gauge,
  Hourglass,
  OctagonAlert,
  Timer,
  TrendingUp,
} from "lucide-react";
import { formatDate, formatShortDate } from "../utils/helpers.js";
import { NA, fmtDays, fmtDelayDays, fmtPct, riskBand } from "../models.js";

// Every value below comes from live engine data. No trend sparklines: the
// backend exposes no trend series, so cards carry a supporting fact instead.
function KpiCard({ icon: Icon, label, value, sub, tone, hint }) {
  return (
    <div className={`kpi-card kpi-tone-${tone || "neutral"}`} title={hint || undefined}>
      <div className="kpi-top">
        {Icon && <Icon size={15} aria-hidden="true" className="kpi-icon" />}
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// The four headline metrics for the dashboard. The remaining metrics are
// shown in a compact "Additional metrics" strip below so the KPI row stays
// scannable (see the KpiSecondary row at the bottom of this component).
const PRIMARY_CARDS = (mc, nodes, band, maxProb, miss, hasDeadline, etaDate, toneFor) => [
  {
    icon: Timer,
    label: "P50 / P90 ETA",
    value:
      mc.eta_date?.p50 || mc.eta_date?.p90
        ? `${mc.eta_date?.p50 ? formatShortDate(mc.eta_date.p50) : NA} / ${mc.eta_date?.p90 ? formatShortDate(mc.eta_date.p90) : NA}`
        : `${fmtDays(mc.percentiles?.p50)} / ${fmtDays(mc.percentiles?.p90)}`,
    sub: ``,
    tone: "neutral",
    hint: "P50 ETA: 50% probability of arriving on or before this date. P90 ETA: 90% probability of arriving on or before this date.",
  },
  {
    icon: Gauge,
    label: "Delay Probability",
    value: fmtPct(maxProb),
    sub: `${band.label}`,
    tone: toneFor(maxProb),
    hint: "Highest delay probability across all checkpoints on this route.",
  },
  {
    icon: Hourglass,
    label: "Expected Delay",
    value: fmtDelayDays(mc.expected_delay_hours),
    tone: mc.expected_delay_hours != null && mc.expected_delay_hours / 24 >= 2 ? "warn" : "neutral",
    hint: "Expected additional delay compared with the baseline route estimate.",
  },
  {
    icon: AlarmClock,
    label: "Deadline Miss Risk",
    value: hasDeadline ? fmtPct(miss) : NA,
    sub: hasDeadline ? `Customer deadline ${formatDate(mc.deadline_date)}` : "No deadline set",
    tone: hasDeadline ? toneFor(miss) : "neutral",
    hint: "Estimated probability that the shipment will arrive after the customer deadline.",
  },
];
  

export default function KpiGrid({ prediction, critical }) {
  const mc = prediction?.monte_carlo;
  const nodes = prediction?.node_predictions || [];
  if (!mc) {
    return (
      <div className="kpi-row-grid">
        <KpiCard label="Waiting for engine" value={NA} sub="Run a prediction to populate metrics" />
      </div>
    );
  }

  const band = riskBand(nodes, mc);
  const maxProb = nodes.length ? Math.max(...nodes.map((n) => n.delay_probability ?? 0)) : 0;
  const miss = mc.p_miss_deadline ?? 0;
  const hasDeadline = mc.deadline_date != null;
  const disrupted = nodes.filter((n) => n.regime === 1).length;
  const etaDate = mc.expected_eta_date ? formatDate(mc.expected_eta_date) : NA;

  const toneFor = (prob) => (prob >= 0.6 ? "bad" : prob >= 0.35 ? "warn" : "good");

  return (
    <>
      <div className="kpi-row-grid kpi-grid-4">
        {PRIMARY_CARDS(mc, nodes, band, maxProb, miss, hasDeadline, etaDate, toneFor).map((c) => (
          <KpiCard key={c.label} {...c} />
        ))}
      </div>
    </>
  );
}
