import React from "react";
import { ChevronDown } from "lucide-react";

const NA = "Not available";

function fmt(v, digits = 3) {
  if (v == null || Number.isNaN(Number(v))) return NA;
  return Number(v).toFixed(digits);
}

function int(v) {
  if (v == null || Number.isNaN(Number(v))) return NA;
  return Number(v).toLocaleString();
}

function Spec({ label, value, hint }) {
  return (
    <div className="spec-row" title={hint || ""}>
      <span className="spec-label">{label}</span>
      <span className="spec-value mono">{value}</span>
    </div>
  );
}

export default function ModelDataQuality({ metrics, dq, health, prediction, lastUpdated }) {
  const t = metrics?.model_metrics?.training || {};
  const ev = metrics?.model_metrics?.evaluation || {};
  const clf = t.classification || {};
  const clfEval = ev.classification_eval || {};
  const del = ev.delay_eval || {};
  const mc = prediction?.monte_carlo;

  return (
    <details className="panel mq" open aria-label="Model and data quality">
      <summary className="mq-head">
        <h2>Model &amp; Data Quality</h2>
        <ChevronDown size={15} aria-hidden="true" className="mq-chev" />
      </summary>
      <div className="model-grid">
        <div className="model-card">
          <h3>Model Performance</h3>
          <Spec label="ROC AUC" value={clf.roc_auc_test != null ? fmt(clf.roc_auc_test) : fmt(clfEval.roc_auc_test)} hint="Test ROC AUC of the delay classifier — discrimination between delayed and on-time legs." />
          <Spec label="PR AUC" value={clf.aucpr_test != null ? fmt(clf.aucpr_test) : fmt(clfEval.aucpr_test)} hint="Test area under the precision-recall curve." />
          <Spec label="F1 Score" value={clf.f1_test != null ? fmt(clf.f1_test) : NA} hint="Harmonic mean of precision and recall at the decision threshold." />
          <Spec label="Calibration (ECE)" value={fmt(clfEval.ece)} hint="Expected calibration error — lower means predicted probabilities match observed rates." />
          <Spec label="Decision threshold" value={clf.threshold != null ? fmt(clf.threshold) : NA} hint="Probability cutoff used to flag a leg as delayed." />
          <h3>Delay Quantile Models</h3>
          <Spec label="MAE" value={del.mae != null ? `${fmt(del.mae)} days` : NA} hint="Mean absolute error of the delay estimate on the test set." />
          <Spec label="RMSE P50" value={t.delay?.rmse_p50_test != null ? fmt(t.delay.rmse_p50_test) : NA} hint="Root mean squared error of the P50 transit-time model." />
          <Spec label="P50 coverage" value={del.coverage_p50 != null ? fmt(del.coverage_p50) : NA} hint="Fraction of actuals falling inside the P50 interval — ~0.5 is well calibrated." />
          <Spec label="P80 coverage" value={del.coverage_p80 != null ? fmt(del.coverage_p80) : NA} hint="Fraction of actuals falling inside the P80 interval — ~0.8 is well calibrated." />
          <Spec label="P90 coverage" value={del.coverage_p90 != null ? fmt(del.coverage_p90) : NA} hint="Fraction of actuals falling inside the P90 interval — ~0.9 is well calibrated." />
          <Spec label="Test samples" value={ev.n_test ?? clf.n_test ?? NA} hint="Number of test samples behind the evaluation metrics." />
        </div>
        <div className="model-card">
          <h3>Data Quality</h3>
          <Spec label="Raw events" value={int(dq?.raw_records)} hint="Events ingested from the raw tracking feed." />
          <Spec label="Cleaned events" value={int(dq?.cleaned_records)} hint="Events that passed schema validation into the golden dataset." />
          <Spec label="Schema failures" value={int(dq?.removed)} hint="Events rejected for failing schema validation." />
          <Spec label="Removal rate" value={dq?.removal_rate != null ? `${(dq.removal_rate * 100).toFixed(1)}%` : NA} hint="Share of raw events rejected during cleaning." />
        </div>
        <div className="model-card">
          <h3>Simulation Configuration</h3>
          <Spec label="MC simulations" value={mc?.n_simulations?.toLocaleString() ?? NA} hint="Monte Carlo arrival samples behind the ETA distribution." />
          <Spec label="Models" value={Array.isArray(health?.models) ? health.models.join(", ") : NA} hint="Model registry entries reported by the backend health check." />
          <Spec label="Graph backend" value={health?.data?.graph_backend ?? NA} hint="Graph engine backing route layout and network metrics." />
          <Spec label="Last prediction" value={lastUpdated || NA} hint="When this dashboard's prediction was last computed." />
        </div>
      </div>
    </details>
  );
}
