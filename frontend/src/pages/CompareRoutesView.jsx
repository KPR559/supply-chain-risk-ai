import React from "react";
import ComparePanel from "../components/ComparePanel.jsx";

export default function CompareRoutesView({ data }) {
  const { prediction } = data;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Route Comparison</div>
          <div className="view-sub">Which corridor performs best per objective</div>
        </div>
      </div>

      <section className="panel">
        <h2>Alternative Routes</h2>
        <ComparePanel prediction={prediction} />
      </section>
    </div>
  );
}
