import React from "react";
import { describeFactor } from "../models.js";

function SignedBar({ name, contribution, max }) {
  const w = (Math.abs(contribution) / max) * 100;
  const push = contribution >= 0;
  const friendly = describeFactor(name);
  return (
    <div className="shap-row">
      <span className="shap-name" title={`Model feature: ${friendly.raw}`}>{friendly.label}</span>
      <div className="shap-track">
        <div
          className={`shap-fill ${push ? "push" : "pull"}`}
          style={{ width: `${Math.max(2, w)}%`, marginLeft: push ? "50%" : `${50 - w}%` }}
        />
      </div>
      <span className="shap-val" title={push ? "Increases delay risk" : "Risk reducing — lowers delay risk relative to the baseline"}>
        {contribution >= 0 ? "+" : ""}{contribution.toFixed(2)}{push ? "" : " · reducing"}
      </span>
    </div>
  );
}

export default function Explanation({ data }) {
  if (!data || data.error) {
    return <div className="placeholder">{data?.error || "No explanation yet."}</div>;
  }
  const top = data.top_factors || [];
  const max = Math.max(...top.map((f) => Math.abs(f.contribution)), 1);
  return (
    <div>
      <div className="explain-head">
        <span className="risk-pill high">riskiest node: {data.node_label}</span>
        <span className="note">delay probability {(data.delay_probability * 100).toFixed(0)}%</span>
      </div>
      <div className="shap-chart">
        {top.map((f) => (
          <SignedBar
            key={f.name}
            name={f.name}
            contribution={f.contribution}
            max={max}
          />
        ))}
      </div>
      <div className="note">
        Local SHAP contributions to the predicted delay probability for {data.node_id}.
        Positive pushes risk up.
      </div>
    </div>
  );
}