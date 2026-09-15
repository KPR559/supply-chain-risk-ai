import React, { useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { validateScenarioInputs } from "../../utils/whatIfUtils.js";

const SCOPE_OPTIONS = [
  { id: "single", label: "Single Checkpoint", desc: "Adjust one checkpoint on the route" },
  { id: "segment", label: "Segment", desc: "Adjust a contiguous range of checkpoints" },
  { id: "multi", label: "Multiple Checkpoints", desc: "Adjust several checkpoints at once" },
  { id: "route", label: "Entire Route", desc: "Adjust every checkpoint on the corridor" },
];

export default function StepDefineImpact({
  prediction,
  selectedPreset,
  scenarioType,
  scope,
  setScope,
  nodeId,
  setNodeId,
  nodeIds,
  setNodeIds,
  segmentStart,
  setSegmentStart,
  segmentEnd,
  setSegmentEnd,
  congestion,
  setCongestion,
  weather,
  setWeather,
  close,
  setClose,
  scenarioName,
  setScenarioName,
  canRun,
  running,
  onBack,
  onRun,
}) {
  const routeNodes = prediction?.node_predictions || [];
  const nodeOptions = useMemo(() => routeNodes, [routeNodes]);
  const validation = validateScenarioInputs(congestion, weather);
  const isCustom = scenarioType === "custom" || scenarioType === "route_level";

  useEffect(() => {
    if (nodeId && !nodeOptions.some((n) => n.node_id === nodeId)) {
      setNodeId(nodeOptions[0]?.node_id || null);
    }
  }, [nodeOptions, nodeId, setNodeId]);

  const toggleMultiNode = (nid) => {
    setNodeIds((prev) =>
      prev.includes(nid) ? prev.filter((x) => x !== nid) : [...prev, nid]
    );
  };

  const showClose = ["closure", "custom", "route_level", "multi_checkpoint"].includes(scenarioType);

  return (
    <section className="panel wizard-step-panel">
      <div className="panel-head">
        <h2>Define Impact</h2>
        {!isCustom && (
          <span className="presets-source-badge">{selectedPreset?.name}</span>
        )}
      </div>
      <p className="muted">
        {isCustom
          ? "Choose the scope and tune the disruption parameters."
          : "Preset selected — choose the affected checkpoint and fine-tune if needed."}
      </p>

      {/* Scenario name */}
      <div className="whatif-field-group">
        <label className="whatif-label">
          Scenario name
          <input
            type="text"
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            className="whatif-input"
            placeholder="e.g. Rotterdam congestion stress test"
          />
        </label>
      </div>

      {/* Scope selection - only for custom / route-level */}
      <div className="whatif-field-group">
        <label className="whatif-label">Scope</label>
        <div className="scope-options">
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`scope-option ${scope === opt.id ? "active" : ""}`}
              onClick={() => setScope(opt.id)}
              title={opt.desc}
            >
              <span className={`scope-option-radio ${scope === opt.id ? "on" : ""}`} aria-hidden="true" />
              <span className="scope-option-label">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Scope-specific inputs */}
      {scope === "single" && (
        <div className="whatif-field-group">
          <label className="whatif-label">
            Checkpoint
            <select value={nodeId || ""} onChange={(e) => setNodeId(e.target.value)} className="whatif-select">
              <option value="" disabled>Select a checkpoint…</option>
              {nodeOptions.map((n) => (
                <option key={n.node_id} value={n.node_id}>
                  {n.label} ({n.node_id})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {scope === "segment" && (
        <div className="whatif-fields-row">
          <div className="whatif-field-group">
            <label className="whatif-label">
              Segment start
              <select value={segmentStart || ""} onChange={(e) => setSegmentStart(e.target.value)} className="whatif-select">
                <option value="" disabled>Start…</option>
                {nodeOptions.map((n, i) => (
                  <option key={n.node_id} value={n.node_id}>
                    {i + 1}. {n.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="whatif-field-group">
            <label className="whatif-label">
              Segment end
              <select value={segmentEnd || ""} onChange={(e) => setSegmentEnd(e.target.value)} className="whatif-select">
                <option value="" disabled>End…</option>
                {nodeOptions.map((n, i) => (
                  <option key={n.node_id} value={n.node_id}>
                    {i + 1}. {n.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {scope === "multi" && (
        <div className="whatif-field-group">
          <label className="whatif-label">Affected checkpoints</label>
          <div className="multi-node-grid">
            {nodeOptions.map((n) => (
              <label key={n.node_id} className={`multi-node-chip ${nodeIds.includes(n.node_id) ? "active" : ""}`}>
                <input
                  type="checkbox"
                  checked={nodeIds.includes(n.node_id)}
                  onChange={() => toggleMultiNode(n.node_id)}
                />
                <span>{n.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {scope === "route" && (
        <div className="whatif-hint">
          The disruption below will apply to all {nodeOptions.length} checkpoints on this corridor.
        </div>
      )}

      {/* Adjustment controls */}
      <div className="whatif-fields-row">
        <div className="whatif-field-group">
          <label className="whatif-label">
            Congestion multiplier
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={congestion}
              onChange={(e) => setCongestion(e.target.value)}
              className={`whatif-input ${validation.errors.some((er) => er.includes("Congestion")) ? "error" : ""}`}
            />
          </label>
          <div className="whatif-hint">1.0 = baseline · 1.5 = +50% congestion</div>
        </div>

        <div className="whatif-field-group">
          <label className="whatif-label">
            Weather delay (hours)
            <input
              type="number"
              step="6"
              min="0"
              max="500"
              value={weather}
              onChange={(e) => setWeather(e.target.value)}
              className={`whatif-input ${validation.errors.some((er) => er.includes("Weather")) ? "error" : ""}`}
            />
          </label>
          <div className="whatif-hint">Additional hours of weather delay</div>
        </div>
      </div>

      {showClose && (
        <div className="whatif-field-group">
          <label className="whatif-toggle">
            <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} />
            <span className="toggle-track" aria-hidden="true" />
            <span>Close checkpoint(s) completely</span>
          </label>
          <div className="whatif-hint">A closed checkpoint treats the node as fully blocked.</div>
        </div>
      )}

      {!validation.isValid && (
        <div className="whatif-validation-error">
          <AlertTriangle size={14} aria-hidden="true" />
          <ul>
            {validation.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="wizard-step-actions">
        <button className="btn btn-ghost" onClick={onBack} disabled={running}>
          ← Back
        </button>
        {scope !== "route" && scope !== "multi" && nodeId === null && (
          <span className="wizard-hint-inline">Select a checkpoint to continue.</span>
        )}
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