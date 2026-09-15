import React, { useState } from "react";
import { api } from "../api.js";

const PRESETS = [
  { name: "Suez +30% congestion", node_id: "suez", adjustments: { congestion_mult: 1.3 } },
  { name: "Suez closed", node_id: "suez", adjustments: { close: true } },
  { name: "Malacca +50% congestion", node_id: "strait_of_malacca", adjustments: { congestion_mult: 1.5 } },
  { name: "Heavy weather (Suez +12h)", node_id: "suez", adjustments: { weather_shift: 12 } },
];

export default function WhatIfPanel({ prediction }) {
  const [preset, setPreset] = useState(PRESETS[0]);
  const [congestion, setCongestion] = useState(1.0);
  const [weather, setWeather] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  if (!prediction) {
    return <div className="placeholder">Run a prediction first.</div>;
  }
  const sid = prediction.shipment_id;

  const applyPreset = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await api.whatif(sid, preset.name, preset.node_id, preset.adjustments);
      setResult(res);
      if (res.scenario) {
        setCongestion(preset.adjustments.congestion_mult ?? 1);
        setWeather(preset.adjustments.weather_shift ?? 0);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const applyCustom = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await api.whatif(sid, "Custom scenario", preset.node_id, {
        congestion_mult: Number(congestion),
        weather_shift: Number(weather),
      });
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const baselineP90 = prediction.monte_carlo?.percentiles?.p90;

  return (
    <div>
      <div className="whatif-row">
        <label>Scenario
          <select value={preset.name} onChange={(e) => setPreset(PRESETS.find((p) => p.name === e.target.value))}>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={applyPreset} disabled={running}>
          {running ? "Running…" : "Run scenario"}
        </button>
      </div>
      <div className="whatif-row">
        <label>Node
          <select value={preset.node_id} onChange={(e) => setPreset({ ...preset, node_id: e.target.value })}>
            {prediction.node_predictions?.map((n) => (
              <option key={n.node_id} value={n.node_id}>{n.label}</option>
            ))}
          </select>
        </label>
        <label>Congestion ×
          <input type="number" step="0.1" min="0.5" max="3" value={congestion} onChange={(e) => setCongestion(e.target.value)} />
        </label>
        <label>Weather +h
          <input type="number" step="6" min="0" max="96" value={weather} onChange={(e) => setWeather(e.target.value)} />
        </label>
        <button className="btn ghost" onClick={applyCustom} disabled={running}>Apply</button>
        {(result || error) && (
          <button
            className="btn ghost"
            onClick={() => {
              setResult(null);
              setError(null);
            }}
            disabled={running}
            title="Clear the scenario result"
          >
            Reset
          </button>
        )}
      </div>
      {error && <div className="banner error">What-if failed: {error}</div>}
      {result && (
        <div className="whatif-result">
          <div className="cmp-row">
            <span className="cmp-label">Baseline</span>
            <span className="cmp-val">P90 {baselineP90 != null ? `${baselineP90.toFixed(2)} days` : "Not available"}</span>
            <span className="cmp-val">P50 {result.baseline?.percentiles?.p50 != null ? `${result.baseline.percentiles.p50.toFixed(2)} days` : "Not available"}</span>
          </div>
          <div className="cmp-row highlight">
            <span className="cmp-label">{result.scenario}</span>
            <span className="cmp-val">P90 {result.monte_carlo?.percentiles?.p90 != null ? `${result.monte_carlo.percentiles.p90.toFixed(2)} days` : "Not available"}</span>
            <span className="cmp-val">P50 {result.monte_carlo?.percentiles?.p50 != null ? `${result.monte_carlo.percentiles.p50.toFixed(2)} days` : "Not available"}</span>
          </div>
          <div className="delta-row">
            Δ expected <b>{result.delta_expected_days != null ? `${result.delta_expected_days > 0 ? "+" : ""}${result.delta_expected_days} days` : "Not available"}</b>
            &nbsp;· Δ P90 <b className={result.delta_p90_days > 0 ? "up" : "down"}>
            {result.delta_p90_days != null ? `${result.delta_p90_days > 0 ? "+" : ""}${result.delta_p90_days} days` : "Not available"}</b>
          </div>
        </div>
      )}
    </div>
  );
}