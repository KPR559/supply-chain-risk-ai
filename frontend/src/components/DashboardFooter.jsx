import React from "react";
import { RotateCcw } from "lucide-react";
import { NA } from "../models.js";

export default function DashboardFooter({ health, prediction, lastUpdated, apiError, onRetry }) {
  const mc = prediction?.monte_carlo;
  const connected = health?.status === "ok" && !apiError;
  const models = Array.isArray(health?.models) ? health.models.join(", ") : null;
  const stale = !connected && prediction;

  return (
    <footer className="dash-footer" aria-label="System status">
      <span className="dash-footer-item">
        <span className={`status-dot ${connected ? "on" : "off"}`} aria-hidden="true" />
        {connected ? "Backend connected" : "Backend unavailable"}
      </span>
      {stale && (
        <span className="dash-footer-item warn-text">
          Showing last loaded data — it may be stale.
        </span>
      )}
      <span className="dash-footer-item">Simulations {mc?.n_simulations?.toLocaleString() ?? NA}</span>
      <span className="dash-footer-item">Models {models || NA}</span>
      <span className="dash-footer-item">Graph {health?.data?.graph_backend || NA}</span>
      <span className="dash-footer-item" title="Backend responses in this build come from a temporary demo dataset.">
        Source Demo data
      </span>
      <span className="dash-footer-item">Last synchronized {lastUpdated || NA}</span>
      {stale && onRetry && (
        <button className="btn ghost mini-btn" onClick={onRetry} title="Retry the prediction request">
          <RotateCcw size={13} aria-hidden="true" /> Retry
        </button>
      )}
    </footer>
  );
}
