import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { adaptExplanation, adaptDriverTrends } from "../utils/riskDriversAdapter.js";
import FactorAttributionCard from "../components/risk-drivers/FactorAttributionCard.jsx";
import DriverTrendsCard from "../components/risk-drivers/DriverTrendsCard.jsx";
import AiSection from "../components/llm/AiSection.jsx";
import RootCauseAnalysis from "../components/RootCauseAnalysis.jsx";
import TabState from "../components/TabState.jsx";
import { riskBand } from "../models.js";

const TREND_KEY = "logix.predrisk.v1";

export default function RiskDriversView({ data }) {
  const { prediction, explanation, selectedShipment, loading, apiError, onRetry, health, ai, aiLoading } = data;
  const ready = Boolean(explanation);
  const rootCauseReady = Boolean(
    critical?.critical_nodes?.length || explanation?.top_factors?.length
  );

  // Adapt data with fallbacks (memoized so downstream effects stay stable).
  const { data: adaptedExplanation, isFallback: isExplanationFallback } = useMemo(
    () => adaptExplanation(explanation, prediction),
    [explanation, prediction]
  );
  const { items: trendItems, isFallback: isTrendsFallback } = useMemo(
    () => adaptDriverTrends(explanation, adaptedExplanation.top_factors),
    [explanation, adaptedExplanation]
  );

  // "What changed?" — compare the current risk against the previous recorded
  // run for this route (RiskSummaryCard persists the last two scores).
  const [aiTrend, setAiTrend] = useState(null);
  const [aiTrendLoading, setAiTrendLoading] = useState(false);
  const trendRef = React.useRef({});
  useEffect(() => {
    if (!prediction || !ready || (health?.llm && health.llm.available === false)) return;
    const nodes = prediction?.node_predictions || [];
    const current = riskBand(nodes, prediction?.monte_carlo).score;
    let entry = null;
    try {
      entry = JSON.parse(localStorage.getItem(TREND_KEY) || "{}")?.[prediction?.route_id] || null;
    } catch {
      entry = null;
    }
    const previous =
      entry && entry.score !== current
        ? entry.score
        : entry && typeof entry.prev === "number" && entry.prev !== current
          ? entry.prev
          : null;
    if (previous == null) return;
    // One LLM call per route+score pair (React <StrictMode> double-mounts).
    const reqKey = `${prediction.shipment_id}|${current}->${previous}`;
    let inflight = trendRef.current[reqKey];
    if (inflight?.phase === "done") {
      setAiTrend(inflight.text);
      return;
    }
    let alive = true;
    if (!inflight || inflight.phase !== "inflight") {
      const factors = adaptedExplanation.top_factors || [];
      const trendPayload = {
        current_risk: current,
        previous_risk: previous,
        trend: current > previous ? "increasing" : current < previous ? "decreasing" : "stable",
        drivers_increasing: factors.filter((f) => (f.contribution ?? 0) > 0.01).map((f) => f.name),
        drivers_decreasing: factors.filter((f) => (f.contribution ?? 0) < -0.01).map((f) => f.name),
      };
      const promise = api
        .llmExplain({ prediction, panels: ["trend"], trend: trendPayload })
        .then((res) => res?.panels?.trend || null)
        .catch(() => null);
      inflight = { phase: "inflight", promise };
      trendRef.current[reqKey] = inflight;
      setAiTrendLoading(true);
    }
    inflight.promise
      .then((text) => {
        if (trendRef.current[reqKey]?.phase === "inflight") {
          trendRef.current[reqKey] = { phase: "done", text };
        }
        if (alive) setAiTrend(text);
      })
      .finally(() => {
        if (alive) setAiTrendLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [prediction, ready, adaptedExplanation, health]);

  // Shipment display info
  const shipmentDisplay = selectedShipment
    ? `${selectedShipment.id} · ${selectedShipment.origin || "Unknown"} → ${selectedShipment.destination || "Unknown"}`
    : "No shipment selected";

  return (
    <div className="view-stack risk-drivers-page">
      <div className="view-head">
        <div>
          <div className="view-title">Risk Drivers</div>
          <div className="view-sub">Which factors push delay risk up or down</div>
          <div className="view-shipment">{shipmentDisplay}</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!ready}
        emptyText="No factor attribution yet — select a shipment to run the engine."
        loadingText="Attributing risk factors…"
      />

      {ready && (
        <>
          <FactorAttributionCard
            explanation={adaptedExplanation}
            isFallback={isExplanationFallback}
          />
          <AiSection title="AI Explanation" text={ai?.drivers} loading={aiLoading} />
          <DriverTrendsCard
            items={trendItems}
            isFallback={isTrendsFallback}
          />
          <AiSection title="What Changed?" text={aiTrend} loading={aiTrendLoading} />
        </>
      )}

      {rootCauseReady && (
        <section className="panel">
          <h2>Root Cause Composition</h2>
          <RootCauseAnalysis
            critical={critical}
            explanation={explanation}
            prediction={prediction}
          />
        </section>
      )}
    </div>
  );
}