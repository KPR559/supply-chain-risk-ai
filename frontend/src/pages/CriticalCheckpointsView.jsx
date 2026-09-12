import React from "react";
import CriticalNodes from "../components/CriticalNodes.jsx";

export default function CriticalCheckpointsView({ data }) {
  const { critical } = data;
  const count = critical?.critical_nodes?.length || 0;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Critical Checkpoints</div>
          <div className="view-sub">
            {count ? `Ranked by share of total shipment delay · ${count} checkpoints` : "Ranking delays…"}
          </div>
        </div>
      </div>

      <section className="panel">
        <h2>Delay-Share Ranking</h2>
        <CriticalNodes data={critical} />
      </section>
    </div>
  );
}
