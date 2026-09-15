import React, { useState, useEffect } from "react";
import { AlertTriangle, AlertCircle, CheckCircle } from "lucide-react";
import { SCENARIO_PRESETS, getPresetById } from "../../data/whatIfPresets.js";
import { validateScenarioInputs } from "../../utils/whatIfUtils.js";

export default function ScenarioInputPanel({
  prediction,
  running,
  onRunPreset,
  onRunCustom,
  onReset,
  selectedPresetId,
  congestion,
  setCongestion,
  weather,
  setWeather,
  setSelectedPresetId,
  presetResult,
  customNodeId,
  onCustomNodeChange,
}) {
  const [validationErrors, setValidationErrors] = useState([]);
  const [showCustomInputs, setShowCustomInputs] = useState(false);

  const selectedPreset = getPresetById(selectedPresetId);
  const isCustom = selectedPreset?.isCustom === true;

  // Update inputs when preset changes (unless custom)
  useEffect(() => {
    if (!isCustom && selectedPreset) {
      setCongestion(selectedPreset.adjustments?.congestion_mult ?? 1.0);
      setWeather(selectedPreset.adjustments?.weather_shift ?? 0);
      setValidationErrors([]);
    }
  }, [selectedPresetId, isCustom, selectedPreset, setCongestion, setWeather]);

  const handlePresetChange = (e) => {
    const presetId = e.target.value;
    setSelectedPresetId(presetId);
    setShowCustomInputs(false);
    setValidationErrors([]);
  };

  const handleInputChange = (field, value) => {
    if (field === "congestion") setCongestion(value);
    if (field === "weather") setWeather(value);
    setShowCustomInputs(true);
    // Clear error for this field on input
    setValidationErrors((prev) => prev.filter((e) => !e.includes(field)));
  };

  const handleRunPreset = () => {
    const errors = validateScenarioInputs(congestion, weather);
    if (!errors.isValid) {
      setValidationErrors(errors.errors);
      return;
    }
    setValidationErrors([]);
    onRunPreset();
  };

  const handleRunCustom = () => {
    const errors = validateScenarioInputs(congestion, weather);
    if (!errors.isValid) {
      setValidationErrors(errors.errors);
      return;
    }
    setValidationErrors([]);
    onRunCustom();
  };

  return (
    <section className="panel what-if-input-panel">
      <h2>Custom Scenario</h2>
      <p className="muted">Select a disruption preset or define custom adjustments</p>

      {/* Scenario Selection */}
      <div className="whatif-field-group">
        <label className="whatif-label">
          Scenario
          <select
            value={selectedPresetId}
            onChange={handlePresetChange}
            disabled={running}
            className="whatif-select"
          >
            {SCENARIO_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="preset-description">
          {selectedPreset?.description}
        </div>
      </div>

      {/* Node / Checkpoint */}
      <div className="whatif-field-group">
        <label className="whatif-label">
          Node / Checkpoint
          <select
            value={isCustom ? customNodeId || "" : selectedPreset?.node_id || ""}
            onChange={(e) => {
              const nodeId = e.target.value;
              setSelectedPresetId((prev) =>
                getPresetById(prev)?.isCustom ? prev : "custom"
              );
              setShowCustomInputs(true);
              onCustomNodeChange?.(nodeId);
            }}
            disabled={running}
            className="whatif-select"
          >
            {prediction?.node_predictions?.map((n) => (
              <option key={n.node_id} value={n.node_id}>{n.label}</option>
            ))}
          </select>
        </label>
        {isCustom && (
          <div className="whatif-hint">Pick the checkpoint this scenario affects</div>
        )}
      </div>

      {/* Congestion Multiplier & Weather Delay */}
      <div className="whatif-fields-row">
        <div className="whatif-field-group">
          <label className="whatif-label">
            Congestion Multiplier
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={congestion}
              onChange={(e) => handleInputChange("congestion", e.target.value)}
              disabled={running}
              className={`whatif-input ${validationErrors.some((err) => err.includes("Congestion")) ? "error" : ""}`}
              placeholder="1.0"
            />
          </label>
          <div className="whatif-hint">1.0 = baseline, 1.5 = +50% congestion</div>
        </div>

        <div className="whatif-field-group">
          <label className="whatif-label">
            Additional Weather Delay (hours)
            <input
              type="number"
              step="6"
              min="0"
              max="500"
              value={weather}
              onChange={(e) => handleInputChange("weather", e.target.value)}
              disabled={running}
              className={`whatif-input ${validationErrors.some((err) => err.includes("Weather")) ? "error" : ""}`}
              placeholder="0"
            />
          </label>
          <div className="whatif-hint">Additional hours of weather delay</div>
        </div>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="whatif-validation-error">
          <AlertTriangle size={14} aria-hidden="true" />
          <ul>
            {validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Buttons */}
      <div className="whatif-actions">
        {!isCustom ? (
          <button
            className="btn btn-primary"
            onClick={handleRunPreset}
            disabled={running}
          >
            {running ? (
              <>
                <span className="spinner" aria-hidden="true"></span>
                Running simulation…
              </>
            ) : (
              `Run "${selectedPreset?.name}"`
            )}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleRunCustom}
            disabled={running}
          >
            {running ? (
              <>
                <span className="spinner" aria-hidden="true"></span>
                Running custom scenario…
              </>
            ) : (
              "Run Custom Scenario"
            )}
          </button>
        )}

        {(presetResult || isCustom) && (
          <button
            className="btn btn-ghost"
            onClick={onReset}
            disabled={running}
            title="Clear scenario results and reset inputs"
          >
            Reset to Baseline
          </button>
        )}

        {isCustom && !running && (
          <button
            className="btn btn-ghost"
            onClick={() => setSelectedPresetId("baseline")}
            title="Load baseline conditions"
          >
            Load Baseline
          </button>
        )}
      </div>

      {/* Preset Quick Buttons */}
      <div className="whatif-preset-quick">
        <span className="whatif-preset-label">Quick presets:</span>
        {SCENARIO_PRESETS.filter((p) => !p.isCustom && p.id !== "baseline").map((p) => (
          <button
            key={p.id}
            className={`whatif-preset-btn ${selectedPresetId === p.id ? "active" : ""}`}
            onClick={() => setSelectedPresetId(p.id)}
            disabled={running}
            title={p.description}
          >
            {p.name}
          </button>
        ))}
      </div>
    </section>
  );
}