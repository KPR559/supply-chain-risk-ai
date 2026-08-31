import React from "react";
import DataSourcesHealth from "../components/DataSourcesHealth.jsx";
import MetricsPanel from "../components/MetricsPanel.jsx";

export default function DataSourcesView({ data }) {
  const { health, dq, prediction } = data;
  const datasets = health?.data?.datasets || [];

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Data Sources</div>
          <div className="view-sub">Connected feeds, storage layers and model artifacts</div>
        </div>
      </div>

      <div className="view-grid-2">
        <section className="panel">
          <h2>Connected Feeds</h2>
          <DataSourcesHealth health={health} dq={dq} />
        </section>
        <section className="panel">
          <h2>Pipeline & Storage</h2>
          <h3>Analytical datasets</h3>
          {datasets.length ? (
            <div className="sources-list">
              {datasets.map((d, i) => (
                <div className="source-row" key={`${d.layer}-${d.name}`}>
                  <span className="source-dot live" />
                  <span className="source-name">
                    <span className="tag">{d.layer}</span> {d.name}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="placeholder">No datasets reported.</div>
          )}
          <h3>Model artifacts</h3>
          <div className="sources-list">
            {(health?.models || []).map((m) => (
              <div className="source-row" key={m}>
                <span className="source-dot live" />
                <span className="source-name mono">{m}</span>
                <span className="source-status live">loaded</span>
              </div>
            ))}
          </div>
          <h3>Runtime profile</h3>
          <div className="metric-row">
            <span>Graph backend</span>
            <b>{prediction ? health?.data?.graph_backend || "—" : "—"}</b>
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>Data Quality</h2>
        <MetricsPanel metrics={null} dq={dq} />
      </section>
    </div>
  );
}