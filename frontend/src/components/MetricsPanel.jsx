import React from "react";

function fmt(v, digits = 3) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toFixed(digits);
}

function Row({ label, value }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export default function MetricsPanel({ metrics, dq }) {
  const t = metrics?.model_metrics?.training || {};
  const ev = metrics?.model_metrics?.evaluation || {};
  const clf = t.classification || {};
  const del = ev.delay_eval || {};
  const clfEval = ev.classification_eval || {};

  return (
    <div>
      <h3>Classification (delay &gt; 24h)</h3>
      <Row label="Test ROC AUC" value={clf.roc_auc_test != null ? fmt(clf.roc_auc_test) : fmt(clfEval.roc_auc_test)} />
      <Row label="Test PR AUC" value={clf.aucpr_test != null ? fmt(clf.aucpr_test) : fmt(clfEval.aucpr_test)} />
      <Row label="Test F1" value={clf.f1_test != null ? fmt(clf.f1_test) : "—"} />
      <Row label="Calibration ECE" value={fmt(clfEval.ece)} />
      <Row label="Decision threshold" value={clf.threshold != null ? fmt(clf.threshold) : "—"} />

      <h3>Delay quantile models (days)</h3>
      <Row label="MAE (test)" value={fmt(del.mae)} />
      <Row label="RMSE P50 (test)" value={t.delay?.rmse_p50_test != null ? fmt(t.delay.rmse_p50_test) : "—"} />
      <Row label="Coverage P50" value={del.coverage_p50 != null ? fmt(del.coverage_p50) : "—"} />
      <Row label="Coverage P80" value={del.coverage_p80 != null ? fmt(del.coverage_p80) : "—"} />
      <Row label="Coverage P90" value={del.coverage_p90 != null ? fmt(del.coverage_p90) : "—"} />
      <Row label="Test samples" value={ev.n_test ?? clf.n_test ?? "—"} />

      <h3>Data quality (Raw → Golden)</h3>
      <Row label="Raw events" value={dq?.raw_records ?? "—"} />
      <Row label="Cleaned events" value={dq?.cleaned_records ?? "—"} />
      <Row label="Removed (schema-fail)" value={dq?.removed ?? "—"} />
      <Row label="Removal rate" value={dq?.removal_rate != null ? `${(dq.removal_rate * 100).toFixed(1)}%` : "—"} />
    </div>
  );
}