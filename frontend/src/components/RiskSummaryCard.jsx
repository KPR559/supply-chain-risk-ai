import React, { useEffect } from "react";
import { NA, overallReason, riskBand, riskHeadline } from "../models.js";
import AiSection from "./llm/AiSection.jsx";

const BAND_COLOR = { low: "#22c55e", medium: "#f59e0b", high: "#ef4444", critical: "#ef4444" };

const TREND_KEY = "logix.predrisk.v1";

// Local risk-trend snapshots keyed by route id. Each prediction run compares
// against the previous recorded score for the same route and records the new
// one, so the trend is honest and persists across sessions.
function readTrendStore() {
  try {
    return JSON.parse(localStorage.getItem(TREND_KEY) || "{}");
  } catch {
    return {};
  }
}

function describeTrend(routeId, score) {
  const store = readTrendStore();
  const prev = store[routeId];
  if (!prev) {
    return { text: "First run — baseline recorded", cls: "neutral" };
  }
  const diff = score - prev.score;
  const ageMin = Math.max(0, Math.round((Date.now() - new Date(prev.ts).getTime()) / 60000));
  const era = ageMin >= 60 ? `${Math.round(ageMin / 60)}h ago` : `${ageMin}m ago`;
  if (Math.abs(diff) < 3) {
    return { text: `Stable · ${prev.score} pts (${era})`, cls: "neutral" };
  }
  if (diff > 0) {
    return { text: `Rising · +${diff} pts vs ${era}`, cls: "up" };
  }
  return { text: `Falling · ${diff} pts vs ${era}`, cls: "down" };
}

function Gauge({ score, band, label }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, Math.max(0, score / 100));
  return (
    <div className="gauge-wrap" role="img" aria-label={`Overall risk ${score} out of 100, ${label}`}>
      <svg viewBox="0 0 110 110" className="gauge-svg" aria-hidden="true">
        <circle cx="55" cy="55" r={R} fill="none" stroke="rgba(148,163,184,0.16)" strokeWidth="10" />
        <circle
          cx="55"
          cy="55"
          r={R}
          fill="none"
          stroke={BAND_COLOR[band] || "#38bdf8"}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(frac * C).toFixed(1)} ${C.toFixed(1)}`}
          transform="rotate(-90 55 55)"
        />
      </svg>
      <div className="gauge-center">
        <div className="gauge-score">{score}</div>
        <div className="gauge-den">/100</div>
      </div>
      <div className="gauge-band">
        <span className={`risk-pill big ${band === "critical" ? "high" : band}`}>{label.toUpperCase()}</span>
      </div>
    </div>
  );
}

export default function RiskSummaryCard({ prediction, explanation, critical, lastUpdated, aiRisk, aiLoading }) {
  const nodes = prediction?.node_predictions || [];
  const band = riskBand(nodes, prediction?.monte_carlo);
  const mainReason = overallReason({ prediction, explanation, critical });
  const confidence = prediction?.prediction_confidence;
  const hasConfidence =
    typeof confidence === "number" && isFinite(confidence);
  const confidenceText = hasConfidence
    ? `${Math.round(confidence)}%`
    : "Not available for this prediction";

  const routeId = prediction?.route_id;
  const trend = routeId
    ? describeTrend(routeId, band.score)
    : { text: "Trend unavailable", cls: "muted" };

  // Persist the snapshot after first paint so the recorded timestamps match
  // when the trend is rendered. Keep the previous score so the Risk Drivers
  // "What changed?" panel can compare the last two runs for a route.
  useEffect(() => {
    if (!routeId) return;
    const store = readTrendStore();
    const prior = store[routeId];
    store[routeId] = {
      score: band.score,
      prev: prior && typeof prior.score === "number" ? prior.score : null,
      ts: new Date().toISOString(),
    };
    try { localStorage.setItem(TREND_KEY, JSON.stringify(store)); } catch { /* ignore */ }
  }, [routeId, band.score]);

  return (
    <section className="panel risk-card" aria-label="Risk summary">
      <h2>Risk Summary</h2>
      <p className="risk-headline"> <br/><br/>
       </p>
      <div className="summary-label risk-title">Overall Shipment Risk</div>
      <p className="risk-headline"> <br/><br/>
       </p>
      <Gauge score={band.score} band={band.band} label={band.label} />
      <p className="risk-headline"> <br/><br/>
       </p>
      <AiSection title="AI Risk Explanation" text={aiRisk} loading={aiLoading} />

      <p className="risk-headline"> <br/>
       </p>

      <dl className="risk-facts">
        <div className="risk-fact">
          <dt>Prediction confidence</dt>
          <dd className={hasConfidence ? "" : "muted"} title="Confidence from arrival spread: 100 × (1 − (P95 − P50) / expected ETA).">
            {confidenceText}
          </dd>
        </div>
        <div className="risk-fact">
          <dt>Risk trend</dt>
          <dd className={trend.cls === "muted" ? "muted" : "trend-" + trend.cls} title="Compared against the last prediction for this route.">
            {trend.text}
          </dd>
        </div>
        <div className="risk-fact">
          <dt>Last updated</dt>
          <dd>{lastUpdated || NA}</dd>
        </div>
      </dl>

    </section>
  );
}
