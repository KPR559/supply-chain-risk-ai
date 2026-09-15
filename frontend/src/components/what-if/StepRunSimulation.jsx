import React from "react";

function impactSummary({ scenarioType, scope, nodeId, nodeIds, segmentStart, segmentEnd, congestion, weather, close, routeNodes }) {
  const parts = [];
  const scopeLabel = {
    single: "Single checkpoint",
    segment: "Route segment",
    multi: "Multiple checkpoints",
    route: "Entire route",
  }[scope];

  const labels = (ids) =>
    (ids || [])
      .map((n) => routeNodes.find((r) => r.node_id === n)?.label || n)
      .join(", ");

  let target = "—";
  if (scope === "single") target = labels([nodeId]);
  else if (scope === "segment") target = `${labels([segmentStart])} → ${labels([segmentEnd])}`;
  else if (scope === "multi") target = labels(nodeIds) || "—";
  else if (scope === "route") target = `${routeNodes.length} checkpoints`;

  parts.push(`Scope: ${scopeLabel} (${target}).`);

  const changes = [];
  if (close) changes.push("checkpoint(s) closed");
  if (congestion != null && Number(congestion) !== 1) changes.push(`congestion ×${congestion}`);
  if (weather != null && Number(weather) > 0) changes.push(`+${weather}h weather delay`);
  if (changes.length) parts.push(`Impact: ${changes.join(", ")}.`);
  else parts.push("Impact: none (baseline conditions).");

  return parts.join(" ");
}

export default function StepRunSimulation({
  prediction,
  selectedPreset,
  scenarioType,
  scope,
  nodeId,
  nodeIds,
  segmentStart,
  segmentEnd,
  congestion,
  weather,
  close,
  scenarioName,
  canRun,
  running,
  onBack,
  onRun,
}) {
  const routeNodes = prediction?.node_predictions || [];
  const summary = impactSummary({
    scenarioType,
    scope,
    nodeId,
    nodeIds,
    segmentStart,
    segmentEnd,
    congestion,
    weather,
    close,
    routeNodes,
  });

  return (
    <section className="panel wizard-step-panel">
      <h2>Run Simulation</h2>
      <p className="muted">Confirm the scenario configuration and run the Monte Carlo simulation.</p>

      <div className="sim-confirm-card">
        <div className="sim-confirm-row">
          <span className="sim-confirm-label">Scenario name</span>
          <span className="sim-confirm-value">{scenarioName || "Custom scenario"}</span>
        </div>
        <div className="sim-confirm-row">
          <span className="sim-confirm-label">Type</span>
          <span className="sim-confirm-value">{selectedPreset?.name || scenarioType}</span>
        </div>
        <div className="sim-confirm-row">
          <span className="sim-confirm-label">Configuration</span>
          <span className="sim-confirm-value">{summary}</span>
        </div>
        <div className="sim-confirm-row">
          <span className="sim-confirm-label">Engine</span>
          <span className="sim-confirm-value">
            Monte Carlo · 10,000 draws · random seed aligned to baseline for fair comparison
          </span>
        </div>
      </div>

      <div className="wizard-step-actions">
        <button className="btn btn-ghost" onClick={onBack} disabled={running}>
          ← Back
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={onRun} disabled={!canRun || running}>
          {running ? (
            <>
              <span className="spinner" aria-hidden="true"></span>
              Running simulation…
            </>
          ) : (
            "Run Scenario"
          )}
        </button>
      </div>
    </section>
  );
}