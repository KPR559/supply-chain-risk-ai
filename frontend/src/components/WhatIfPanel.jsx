import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api.js";
import { buildPresetsForRoute } from "../data/whatIfPresets.js";
import { formatHistoryEntry } from "../utils/whatIfUtils.js";
import WizardStepper from "./what-if/WizardStepper.jsx";
import StepShipmentRoute from "./what-if/StepShipmentRoute.jsx";
import StepChooseScenario from "./what-if/StepChooseScenario.jsx";
import StepDefineImpact from "./what-if/StepDefineImpact.jsx";
import StepRunSimulation from "./what-if/StepRunSimulation.jsx";
import ScenarioResultsSummary from "./what-if/ScenarioResultsSummary.jsx";
import BaselineVsScenarioComparison from "./what-if/BaselineVsScenarioComparison.jsx";
import ETAComparisonChart from "./what-if/ETAComparisonChart.jsx";
import CheckpointImpactTable from "./what-if/CheckpointImpactTable.jsx";
import ScenarioImpactExplanation from "./what-if/ScenarioImpactExplanation.jsx";
import RecommendedActions from "./what-if/RecommendedActions.jsx";
import AlternativeRouteComparison from "./what-if/AlternativeRouteComparison.jsx";
import CriticalCheckpointCard from "./what-if/CriticalCheckpointCard.jsx";
import ScenarioHistory from "./what-if/ScenarioHistory.jsx";

const STORAGE_KEY = "logix.whatif.history.v2";
const MAX_HISTORY = 6;

export default function WhatIfPanel({ prediction, shipments }) {
  const [step, setStep] = useState(1);
  const [presets, setPresets] = useState([]);
  const [presetsSource, setPresetsSource] = useState("backend");
  const [selectedPresetId, setSelectedPresetId] = useState("baseline");
  const [scenarioType, setScenarioType] = useState("baseline");
  const [scope, setScope] = useState("single");
  const [nodeId, setNodeId] = useState(null);
  const [nodeIds, setNodeIds] = useState([]);
  const [segmentStart, setSegmentStart] = useState(null);
  const [segmentEnd, setSegmentEnd] = useState(null);
  const [congestion, setCongestion] = useState(1.0);
  const [weather, setWeather] = useState(0);
  const [close, setClose] = useState(false);
  const [scenarioName, setScenarioName] = useState("Custom scenario");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);

  const route = prediction?.route_id || "asia_europe_suez";
  const sid = prediction?.shipment_id;
  const routeNodes = useMemo(
    () => prediction?.node_predictions || [],
    [prediction]
  );

  // Load presets from backend for the active route
  useEffect(() => {
    let cancelled = false;
    if (!route) return;
    setPresets([]);
    setPresetsSource("backend");
    api
      .whatifPresets(route)
      .then((data) => {
        if (cancelled) return;
        const list = data.presets || [];
        setPresets(list);
        setPresetsSource("backend");
        setSelectedPresetId("baseline");
        if (list.length) {
          setScenarioType(list[0].scenario_type || "baseline");
          setNodeId(list[0].node_id || null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        const labels = {};
        routeNodes.forEach((n) => { labels[n.node_id] = n.label; });
        const fallback = buildPresetsForRoute(routeNodes.map((n) => n.node_id), labels);
        setPresets(fallback);
        setPresetsSource("fallback");
        setSelectedPresetId("baseline");
        if (fallback.length) {
          setScenarioType(fallback[0].scenario_type || "baseline");
          setNodeId(fallback[0].node_id || null);
        }
      });
    return () => { cancelled = true; };
  }, [route, routeNodes]);

  // Load history on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setHistory(JSON.parse(stored).slice(0, MAX_HISTORY));
    } catch (e) {
      console.warn("Failed to load what-if history:", e);
    }
  }, []);

  const selectedPreset = presets.find((p) => p.id === selectedPresetId) || presets[0];

  const selectPreset = useCallback((preset) => {
    setSelectedPresetId(preset.id);
    setScenarioType(preset.scenario_type || "custom");
    setScope(preset.scope || "single");
    setNodeId(preset.node_id || null);
    setNodeIds(preset.node_ids || []);
    setSegmentStart(null);
    setSegmentEnd(null);
    setClose(Boolean(preset.adjustments?.close !== undefined ? preset.adjustments?.close : preset.node_adjustments?.some((a) => a.close)));
    setCongestion(
      preset.adjustments?.congestion_mult ??
        preset.node_adjustments?.[0]?.congestion_mult ??
        1.0
    );
    setWeather(
      preset.adjustments?.weather_shift ??
        preset.node_adjustments?.[0]?.weather_shift ??
        0
    );
    setScenarioName(preset.name);
    if (preset.scenario_type === "baseline" || preset.scenario_type === "closure") {
      setStep(4);
    } else {
      setStep(3);
    }
  }, []);

  const runScenario = useCallback(async () => {
    if (!sid) return;
    setRunning(true);
    setError(null);
    try {
      const payload = {
        name: scenarioName || "Custom scenario",
        scenario_type: scenarioType || "custom",
        scope: scope || "single",
      };
      if (scope === "multi") {
        payload.node_adjustments = nodeIds.map((n) => ({
          node_id: n,
          congestion_mult: Number(congestion),
          weather_shift: Number(weather),
          close: close,
        }));
      } else if (scope === "segment") {
        payload.segment_start = segmentStart;
        payload.segment_end = segmentEnd;
        payload.adjustments = {
          congestion_mult: Number(congestion),
          weather_shift: Number(weather),
          close: close,
        };
      } else if (scope === "route") {
        payload.route_adjustments = {
          congestion_mult: Number(congestion),
          weather_shift: Number(weather),
          close: close,
        };
      } else {
        payload.node_id = nodeId;
        payload.adjustments = {
          congestion_mult: Number(congestion),
          weather_shift: Number(weather),
          close: close,
        };
      }
      const res = await api.whatif(sid, payload);
      setResult(res);

      const entry = formatHistoryEntry(res, payload);
      const stored = localStorage.getItem(STORAGE_KEY);
      const prev = stored ? JSON.parse(stored) : [];
      const updated = [entry, ...prev].slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setHistory(updated);
      setStep(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }, [sid, scenarioName, scenarioType, scope, nodeId, nodeIds, segmentStart, segmentEnd, congestion, weather, close]);

  const handleRerun = useCallback(
    (entry) => {
      const rp = entry.rerun;
      if (rp && sid) {
        setScenarioType(rp.scenario_type || "custom");
        setScope(rp.scope || "single");
        setNodeId(rp.node_id || null);
        setNodeIds(rp.node_ids || []);
        setSegmentStart(rp.segment_start || null);
        setSegmentEnd(rp.segment_end || null);
        setScenarioName(rp.name || entry.name);
        setRunning(true);
        setError(null);
        api
          .whatif(sid, rp)
          .then((res) => setResult(res))
          .catch((e) => setError(e.message))
          .finally(() => setRunning(false));
        return;
      }
      const preset = presets.find((p) => p.name === entry.name);
      if (preset) {
        selectPreset(preset);
        setStep(4);
      }
    },
    [presets, selectPreset, sid]
  );

  const handleReset = () => {
    setResult(null);
    setError(null);
    setSelectedPresetId("baseline");
    setScenarioType("baseline");
    setScope("single");
    setNodeId(null);
    setCongestion(1.0);
    setWeather(0);
    setClose(false);
    setStep(1);
  };

  const canRun = !running && sid && (
    scenarioType === "baseline" ||
    (scope === "single" && nodeId) ||
    (scope === "multi" && nodeIds.length > 0) ||
    (scope === "segment" && segmentStart && segmentEnd) ||
    scope === "route"
  );

  if (!prediction) {
    return <div className="placeholder">Run a prediction first.</div>;
  }

  return (
    <div className="whatif-panel">
      <WizardStepper step={step} />

      <div className="wizard-body">
        {step === 1 && (
          <StepShipmentRoute
            prediction={prediction}
            shipments={shipments}
            routeNodes={routeNodes}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <StepChooseScenario
            presets={presets}
            presetsSource={presetsSource}
            selectedPresetId={selectedPresetId}
            onSelect={selectPreset}
            enabled={!running}
          />
        )}
        {step === 3 && (
          <StepDefineImpact
            prediction={prediction}
            presets={presets}
            selectedPreset={selectedPreset}
            scenarioType={scenarioType}
            scope={scope}
            setScope={setScope}
            nodeId={nodeId}
            setNodeId={setNodeId}
            nodeIds={nodeIds}
            setNodeIds={setNodeIds}
            segmentStart={segmentStart}
            setSegmentStart={setSegmentStart}
            segmentEnd={segmentEnd}
            setSegmentEnd={setSegmentEnd}
            congestion={congestion}
            setCongestion={setCongestion}
            weather={weather}
            setWeather={setWeather}
            close={close}
            setClose={setClose}
            scenarioName={scenarioName}
            setScenarioName={setScenarioName}
            canRun={canRun}
            running={running}
            onBack={() => setStep(2)}
            onRun={runScenario}
          />
        )}
        {step === 4 && (
          <StepRunSimulation
            prediction={prediction}
            selectedPreset={selectedPreset}
            scenarioType={scenarioType}
            scope={scope}
            nodeId={nodeId}
            nodeIds={nodeIds}
            segmentStart={segmentStart}
            segmentEnd={segmentEnd}
            congestion={congestion}
            weather={weather}
            close={close}
            scenarioName={scenarioName}
            canRun={canRun}
            running={running}
            onBack={() => setStep(3)}
            onRun={runScenario}
          />
        )}
      </div>

      {error && (
        <section className="panel what-if-error">
          <div className="banner error">
            <strong>Unable to run the scenario.</strong>
            <details style={{ marginTop: "8px" }}>
              <summary>Error details</summary>
              <pre style={{ marginTop: "8px", fontSize: "11px" }}>{error}</pre>
            </details>
          </div>
        </section>
      )}

      {result && (
        <>
          <ScenarioResultsSummary result={result} prediction={prediction} />
          <CriticalCheckpointCard result={result} />
          <BaselineVsScenarioComparison result={result} />
          <ETAComparisonChart result={result} />
          <CheckpointImpactTable result={result} />
          <ScenarioImpactExplanation result={result} />
          <RecommendedActions result={result} />
          <AlternativeRouteComparison result={result} prediction={prediction} />
        </>
      )}

      {result && (
        <div className="whatif-actions-center">
          <button className="btn btn-ghost" onClick={handleReset}>
            Run another scenario
          </button>
        </div>
      )}

      <ScenarioHistory history={history} onRerun={handleRerun} />
    </div>
  );
}