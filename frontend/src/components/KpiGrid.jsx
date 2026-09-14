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
  const critCount = critical?.critical_nodes?.length ?? 0;
  const etaDate = mc.expected_eta_date ? formatDate(mc.expected_eta_date) : NA;

  const toneFor = (prob) => (prob >= 0.6 ? "bad" : prob >= 0.35 ? "warn" : "good");

  return (
    <div className="kpi-row-grid kpi-grid-4">
      <KpiCard
        icon={CalendarCheck}
        label="Predicted ETA"
        value={etaDate}
        sub={mc.expected_days != null ? `${fmtDays(mc.expected_days)} transit` : "Transit estimate unavailable"}
        tone="neutral"
        hint="Most likely ETA: the arrival date with the highest probability in the simulated distribution. This can differ from the P50 (median) date."
      />
      <KpiCard
        icon={Gauge}
        label="Delay Probability"
        value={fmtPct(maxProb)}
        sub={`${band.label} · worst checkpoint`}
        tone={toneFor(maxProb)}
        hint="Highest delay probability across all checkpoints on this route."
      />
      <KpiCard
        icon={Hourglass}
        label="Expected Delay"
        value={fmtDelayDays(mc.expected_delay_hours)}
        sub="Risk-adjusted vs baseline"
        tone={mc.expected_delay_hours != null && mc.expected_delay_hours / 24 >= 2 ? "warn" : "neutral"}
        hint="Expected additional delay compared with the baseline route estimate."
      />
      <KpiCard
        icon={Timer}
        label="P50 / P90 ETA"
        value={
          mc.eta_date?.p50 || mc.eta_date?.p90
            ? `${mc.eta_date?.p50 ? formatShortDate(mc.eta_date.p50) : NA} / ${mc.eta_date?.p90 ? formatShortDate(mc.eta_date.p90) : NA}`
            : `${fmtDays(mc.percentiles?.p50)} / ${fmtDays(mc.percentiles?.p90)}`
        }
        sub={`P50 ${fmtDays(mc.percentiles?.p50)} · P90 ${fmtDays(mc.percentiles?.p90)}`}
        tone="neutral"
        hint="P50 ETA: 50% probability of arriving on or before this date. P90 ETA: 90% probability of arriving on or before this date."
      />
      <KpiCard
        icon={AlarmClock}
        label="Deadline Miss Risk"
        value={hasDeadline ? fmtPct(miss) : NA}
        sub={hasDeadline ? `Customer deadline ${formatDate(mc.deadline_date)}` : "No deadline set"}
        tone={hasDeadline ? toneFor(miss) : "neutral"}
        hint="Estimated probability that the shipment will arrive after the customer deadline."
      />
      <KpiCard
        icon={ClipboardList}
        label="Critical Checkpoints"
        value={String(critCount)}
        sub={critCount === 1 ? "checkpoint drives delay" : "checkpoints drive delay"}
        tone={critCount > 0 ? "warn" : "good"}
        hint="Checkpoints contributing most to the expected shipment delay."
      />
      <KpiCard
        icon={OctagonAlert}
        label="Active Disruptions"
        value={String(disrupted)}
        sub={disrupted > 0 ? "regime disruption live" : "No disrupted regime"}
        tone={disrupted > 0 ? "bad" : "good"}
        hint="Checkpoints currently in a disrupted regime."
      />
      <KpiCard
        icon={TrendingUp}
        label="Simulations"
        value={mc.n_simulations?.toLocaleString() ?? NA}
        sub="Monte Carlo runs"
        tone="neutral"
        hint="Number of simulated shipment outcomes used to estimate arrival uncertainty."
      />
    </div>
  );
}
