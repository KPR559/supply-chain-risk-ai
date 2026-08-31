import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { computeResilienceScore, resilienceLabel, routeDisplayName, riskLabel } from "../utils/helpers.js";

const OBJECTIVES = ["fastest", "lowest_risk", "balanced"];

export default function ReportsView({ data }) {
  const { prediction, explanation, critical } = data;
  const [cmp, setCmp] = useState(null);
  const [cmpError, setCmpError] = useState(null);
  const [exported, setExported] = useState(false);
  const [printing, setPrinting] = useState(false);

  const sid = prediction?.shipment_id;

  useEffect(() => {
    if (!sid) return;
    let alive = true;
    api
      .compare(sid, OBJECTIVES)
      .then((c) => alive && setCmp(c))
      .catch((e) => alive && setCmpError(e.message));
    return () => {
      alive = false;
    };
  }, [sid]);

  if (!prediction) return <div className="placeholder">Run a prediction first.</div>;
  const mc = prediction.monte_carlo;
  const nodes = prediction.node_predictions || [];
  const resilience = computeResilienceScore(nodes, mc);
  const rec = cmp?.recommended?.balanced || cmp?.recommended?.lowest_risk;

  const report = () => ({
    generated_at: new Date().toISOString(),
    shipment: {
      id: "FRK-IND-9281",
      corridor: "Frankfurt → India",
      route: prediction.route_id,
      route_name: prediction.route_name,
    },
    eta: {
      expected_days: mc.expected_days,
      p50: mc.percentiles?.p50,
      p90: mc.percentiles?.p90,
      p10: mc.percentiles?.p10,
      expected_delay_hours: mc.expected_delay_hours,
      n_simulations: mc.n_simulations,
    },
    resilience: { score: resilience, label: resilienceLabel(resilience), risk: riskLabel(Math.max(...nodes.map((n) => n.delay_probability))) },
    critical_nodes: critical?.critical_nodes,
    top_factors: explanation?.top_factors,
    recommendation: rec ? { route: rec, label: routeDisplayName(rec) } : null,
    route_comparison: cmp?.options,
  });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(report(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "logix-report-FRK-IND-9281.json";
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  };

  const printReport = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 100);
  };

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Reports</div>
          <div className="view-sub">Exportable insight summary for FRK-IND-9281</div>
        </div>
        <div className="view-actions">
          <button className="btn ghost" onClick={exportJson} disabled={exported}>
            {exported ? "Exported ✓" : "Export JSON"}
          </button>
          <button className="btn" onClick={printReport} disabled={printing}>
            {printing ? "Preparing…" : "Print Report"}
          </button>
        </div>
      </div>

      {cmpError && <div className="banner error">Route comparison unavailable: {cmpError}</div>}

      <section className="panel report-sheet">
        <div className="report-sheet-head">
          <div className="brand-logo">∞</div>
          <div>
            <div className="report-title">LOGIX Resilience Report</div>
            <div className="report-corridor">Frankfurt → India · Shipment FRK-IND-9281</div>
          </div>
        </div>
        <div className="report-grid">
          <div>
            <div className="report-kpi-label">Expected ETA</div>
            <div className="report-kpi-value">{mc.expected_days?.toFixed(1)} d</div>
          </div>
          <div>
            <div className="report-kpi-label">P90</div>
            <div className="report-kpi-value">{mc.percentiles?.p90?.toFixed(1)} d</div>
          </div>
          <div>
            <div className="report-kpi-label">Expected Delay</div>
            <div className="report-kpi-value">+{(mc.expected_delay_hours ?? 0) / 24 > 0 ? ((mc.expected_delay_hours ?? 0) / 24).toFixed(1) : "—"} d</div>
          </div>
          <div>
            <div className="report-kpi-label">Resilience</div>
            <div className="report-kpi-value">
              {resilience}/100 <span className="muted">({resilienceLabel(resilience)})</span>
            </div>
          </div>
        </div>
        <div className="report-section">
          <div className="section-sub">Recommendation</div>
          {rec ? (
            <div>
              Use the <b>{routeDisplayName(rec)}</b> corridor for the best balance of delay risk, ETA and cost.
            </div>
          ) : (
            <span className="muted">Loading route comparison…</span>
          )}
        </div>
        {critical?.critical_nodes?.length > 0 && (
          <div className="report-section">
            <div className="section-sub">Critical checkpoints</div>
            <div className="report-list">
              {critical.critical_nodes.map((c) => (
                <div className="report-list-row" key={c.node_id}>
                  <span>{c.label}</span>
                  <span className="mono">{c.percent.toFixed(1)}% of delay</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {explanation?.top_factors?.length > 0 && (
          <div className="report-section">
            <div className="section-sub">Key risk drivers</div>
            <div className="report-list">
              {explanation.top_factors.map((f) => (
                <div className="report-list-row" key={f.name}>
                  <span>{f.name}</span>
                  <span className="mono">{f.contribution >= 0 ? "+" : ""}{f.contribution.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}