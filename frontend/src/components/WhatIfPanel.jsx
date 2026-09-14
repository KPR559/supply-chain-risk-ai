import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { SCENARIO_PRESETS, getPresetById } from "../data/whatIfPresets.js";
import { getCheckpointImpacts, formatHistoryEntry } from "../utils/whatIfUtils.js";
import ScenarioInputPanel from "./what-if/ScenarioInputPanel.jsx";
import ScenarioResultsSummary from "./what-if/ScenarioResultsSummary.jsx";
import BaselineVsScenarioComparison from "./what-if/BaselineVsScenarioComparison.jsx";
import ETAComparisonChart from "./what-if/ETAComparisonChart.jsx";
import CheckpointImpactTable from "./what-if/CheckpointImpactTable.jsx";
import ScenarioImpactExplanation from "./what-if/ScenarioImpactExplanation.jsx";
import RecommendedActions from "./what-if/RecommendedActions.jsx";
import ScenarioHistory from "./what-if/ScenarioHistory.jsx";

export default function WhatIfPanel({ prediction }) {
  const [selectedPresetId, setSelectedPresetId] = useState("baseline");
  const [congestion, setCongestion] = useState(1.0);
  const [weather, setWeather] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [baselineResult, setBaselineResult] = useState(null);
  const [error, setError] = useState(null);
  const [checkpointImpacts, setCheckpointImpacts] = useState([]);
  const [history, setHistory] = useState([]);

  if (!prediction) {
    return <div className="placeholder">Run a prediction first.</div>;
  }
  const sid = prediction.shipment_id;

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("logix.whatif.history.v1");
      if (stored) {
        const parsed = JSON.parse(stored);
        setHistory(parsed.slice(0, 5));
      }
    } catch (e) {
      console.warn("Failed to load what-if history:", e);
    }
  }, []);

  // Get selected preset object
  const selectedPreset = getPresetById(selectedPresetId);
  const isCustom = selectedPreset?.isCustom === true;

  // Get affected node from preset or result
  const affectedNodeId = result?.node_id || selectedPreset?.node_id;
  const affectedCheckpoint = prediction?.node_predictions?.find((n) => n.node_id === affectedNodeId);

  // Load baseline on mount (if not already loaded)
  useEffect(() => {
    if (baselineResult) return;
    // Baseline is essentially the current prediction
    setBaselineResult(prediction);
  }, [prediction, baselineResult]);

  const runScenario = useCallback(
    async (presetName, nodeId, adjustments) => {
      setRunning(true);
      setError(null);
      try {
        const res = await api.whatif(sid, presetName, nodeId, adjustments);
        setResult(res);

        // Compute checkpoint impacts
        const impacts = getCheckpointImpacts(prediction, res, prediction);
        setCheckpointImpacts(impacts);

        // Add to history
        const preset = getPresetById(selectedPresetId);
        const historyEntry = formatHistoryEntry(res, preset);
        const STORAGE_KEY = "logix.whatif.history.v1";
        const MAX_HISTORY = 5;
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          const prev = stored ? JSON.parse(stored) : [];
          const updated = [historyEntry, ...prev.filter((e) => e.id !== historyEntry.id)].slice(0, MAX_HISTORY);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          setHistory(updated);
        } catch (e) {
          console.warn("Failed to save what-if history:", e);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setRunning(false);
      }
    },
    [sid, prediction, selectedPresetId]
  );

  const handleRunPreset = () => {
    const preset = getPresetById(selectedPresetId);
    if (!preset || preset.isCustom) return;
    runScenario(preset.name, preset.node_id, preset.adjustments);
  };

  const handleRunCustom = () => {
    const preset = getPresetById(selectedPresetId);
    const nodeId = preset?.node_id || "suez";
    runScenario("Custom scenario", nodeId, {
      congestion_mult: Number(congestion),
      weather_shift: Number(weather),
    });
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setCheckpointImpacts([]);
    setSelectedPresetId("baseline");
    setCongestion(1.0);
    setWeather(0);
  };

  const handleRerun = (entry) => {
    // Find preset by name or use custom
    const preset = SCENARIO_PRESETS.find((p) => p.name === entry.name) || getPresetById("custom");
    if (preset) {
      setSelectedPresetId(preset.id);
      setCongestion(entry.congestion_mult ?? 1.0);
      setWeather(entry.weather_shift ?? 0);
    }
    runScenario(entry.name, entry.checkpoint, {
      congestion_mult: entry.congestion_mult ?? 1.0,
      weather_shift: entry.weather_shift ?? 0,
    });
  };

  const standardPresets = SCENARIO_PRESETS.filter((p) => !p.isCustom);

  return (
    <div className="whatif-panel">
      {/* Input Panel */}
      <ScenarioInputPanel
        prediction={prediction}
        running={running}
        onRunPreset={handleRunPreset}
        onRunCustom={handleRunCustom}
        onReset={handleReset}
        selectedPresetId={selectedPresetId}
        setSelectedPresetId={setSelectedPresetId}
        congestion={congestion}
        setCongestion={setCongestion}
        weather={weather}
        setWeather={setWeather}
        presetResult={result}
      />

      {/* How to Use */}
      <section className="panel what-if-howto">
        <h2>How to Use</h2>
        <div className="howto">
          <ol>
            <li>Select a disruption preset (e.g., "Suez closed") or choose "Custom Scenario" to tune congestion and weather.</li>
            <li>Click <strong>Run scenario</strong> to simulate the impact on the corridor.</li>
            <li>Review the <strong>Scenario Results</strong> summary cards and the <strong>Baseline vs Scenario</strong> comparison.</li>
            <li>Check the <strong>ETA Comparison</strong> chart for visual P50/P90 differences.</li>
            <li>Examine the <strong>Checkpoint Impact</strong> table to see which checkpoints are most affected.</li>
            <li>Read the <strong>Scenario Impact</strong> explanation and <strong>Recommended Actions</strong>.</li>
            <li>Use <strong>Recent Scenarios</strong> to re-run or compare past simulations.</li>
          </ol>
        </div>
      </section>

      {/* Results Section */}
      {result && (
        <>
          <ScenarioResultsSummary
            baseline={baselineResult}
            scenario={result}
            checkpoint={affectedCheckpoint}
            selectedPreset={selectedPreset}
          />

          <BaselineVsScenarioComparison
            baseline={baselineResult}
            scenario={result}
          />

          <ETAComparisonChart
            baseline={baselineResult}
            scenario={result}
          />

          <CheckpointImpactTable
            impacts={checkpointImpacts}
            affectedNodeId={affectedNodeId}
          />

          <ScenarioImpactExplanation
            baseline={baselineResult}
            scenario={result}
            checkpoint={affectedCheckpoint}
            adjustments={selectedPreset?.adjustments}
          />

          <RecommendedActions
            baseline={baselineResult}
            scenario={result}
            checkpoint={affectedCheckpoint}
            adjustments={selectedPreset?.adjustments}
            alternativeRoutes={prediction?.route_comparison?.options}
          />
        </>
      )}

      {/* Error State */}
      {error && !result && (
        <section className="panel what-if-error">
          <div className="banner error">
            <strong>Unable to run the scenario.</strong> Please check the inputs and try again.
            <details style={{ marginTop: "8px" }}>
              <summary>Error details</summary>
              <pre style={{ marginTop: "8px", fontSize: "11px" }}>{error}</pre>
            </details>
          </div>
        </section>
      )}

      {/* Scenario History */}
      <ScenarioHistory onRerun={handleRerun} />
    </div>
  );
}