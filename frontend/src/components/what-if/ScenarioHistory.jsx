import React, { useState, useEffect } from "react";
import { formatEta, formatPercent, formatResilience } from "../../utils/whatIfUtils.js";
import { ArrowRight, Trash2, Clock } from "lucide-react";

export default function ScenarioHistory({ history, onRerun }) {
  const [items, setItems] = useState(history || []);

  useEffect(() => {
    setItems(history || []);
  }, [history]);

  const saveHistory = (newHistory) => {
    try {
      localStorage.setItem("logix.whatif.history.v2", JSON.stringify(newHistory));
    } catch (e) {
      console.warn("Failed to save what-if history:", e);
    }
  };

  const removeFromHistory = (id) => {
    const updated = items.filter((e) => e.id !== id);
    setItems(updated);
    saveHistory(updated);
  };

  const clearHistory = () => {
    setItems([]);
    saveHistory([]);
  };

  if (items.length === 0) return null;

  return (
    <section className="panel what-if-history">
      <div className="panel-head">
        <h2>Recent Scenarios</h2>
        <button className="btn btn-ghost btn-sm" onClick={clearHistory} title="Clear scenario history">
          <Trash2 size={13} aria-hidden="true" /> Clear
        </button>
      </div>

      <div className="history-list">
        {items.map((entry) => (
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
                  <span className="label">Expected:</span>
                  <span className="value mono">{formatEta(entry.expectedDays)}</span>
                </span>
                {entry.deltaDays != null && (
                  <span className={`history-delta ${getDeltaClass(entry.deltaDays)}`}>
                    <span className="label">Δ:</span>
                    <span className="value">{(entry.deltaDays > 0 ? "+" : "")}{entry.deltaDays.toFixed(1)}d</span>
                  </span>
                )}
                <span className="history-risk">
                  <span className="label">Risk:</span>
                  <span className="value">{formatPercent(entry.delayRisk)}</span>
                </span>
                <span className="history-resilience">
                  <span className="label">Resilience:</span>
                  <span className="value">{entry.resilience != null ? formatResilience(entry.resilience) : "—"}</span>
                </span>
              </div>
            </div>
            <div className="history-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onRerun?.(entry)}
                title="Re-run this scenario"
              >
                <ArrowRight size={13} aria-hidden="true" /> Re-run
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

function getDeltaClass(delta) {
  if (delta == null || Math.abs(delta) < 0.5) return "neutral";
  return delta > 0 ? "negative" : "positive";
}