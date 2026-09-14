import React, { useState, useEffect } from "react";
import { formatEta, formatPercent } from "../../utils/whatIfUtils.js";
import { ArrowLeft, Trash2, Clock } from "lucide-react";

const STORAGE_KEY = "logix.whatif.history.v1";
const MAX_HISTORY = 5;

export default function ScenarioHistory({ onRerun }) {
  const [history, setHistory] = useState([]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setHistory(parsed.slice(0, MAX_HISTORY));
      }
    } catch (e) {
      console.warn("Failed to load what-if history:", e);
    }
  }, []);

  const saveHistory = (newHistory) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    } catch (e) {
      console.warn("Failed to save what-if history:", e);
    }
  };

  const addToHistory = (entry) => {
    setHistory((prev) => {
      const updated = [entry, ...prev.filter((e) => e.id !== entry.id)].slice(0, MAX_HISTORY);
      saveHistory(updated);
      return updated;
    });
  };

  const removeFromHistory = (id) => {
    setHistory((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      saveHistory(updated);
      return updated;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  if (history.length === 0) return null;

  return (
    <section className="panel what-if-history">
      <div className="panel-head">
        <h2>Recent Scenarios</h2>
        {history.length > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={clearHistory}
            title="Clear all scenario history"
          >
            <Trash2 size={13} aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      <div className="history-list">
        {history.map((entry) => (
          <div key={entry.id} className="history-item">
            <div className="history-main">
              <div className="history-name">
                <span className="history-scenario">{entry.name}</span>
                <span className="history-checkpoint">{entry.checkpoint}</span>
              </div>
              <div className="history-meta">
                <span className="history-time">
                  <Clock size={12} aria-hidden="true" />
                  {entry.time}
                </span>
                <span className="history-p90">
                  <span className="label">P90:</span>
                  <span className="value mono">{formatEta(entry.p90Eta)}</span>
                </span>
                <span className="history-risk">
                  <span className="label">Risk:</span>
                  <span className="value">{formatPercent(entry.delayRisk)}</span>
                </span>
              </div>
            </div>
            <div className="history-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onRerun?.(entry)}
                title="Re-run this scenario"
              >
                <ArrowLeft size={13} aria-hidden="true" /> Re-run
              </button>
              <button
                className="btn btn-ghost btn-sm btn-danger"
                onClick={() => removeFromHistory(entry.id)}
                title="Remove from history"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}