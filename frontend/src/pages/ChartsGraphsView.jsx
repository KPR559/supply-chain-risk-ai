import React from "react";
import RootCauseAnalysis from "../components/RootCauseAnalysis.jsx";

export default function ChartsGraphsView({ data }) {
  const { prediction, explanation, critical } = data;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Charts & Graphs</div>
          <div className="view-sub">Delay composition: impact pathway, drivers and mode split</div>
        </div>
      </div>

      <section className="panel">
        <h2>Root Cause Composition</h2>
        <RootCauseAnalysis
          critical={critical}
          explanation={explanation}
          prediction={prediction}
        />
      </section>
    </div>
  );
}
