import React, { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { buildRecommendations } from "../recommendations.js";
import AiSection from "./llm/AiSection.jsx";

const PILL = { high: "high", medium: "med", low: "low" };

export default function RecommendationList({ prediction, explanation, critical, onNavigate, onExport, aiRecs, aiLoading }) {
  const recs = useMemo(
    () => buildRecommendations({ prediction, explanation, critical }),
    [prediction, explanation, critical]
  );

  return (
    <section className="panel recs-panel" aria-label="Recommendations">
      <h2>Immediate Recommendations</h2>
      <div className="rec-list">
        {recs.map((r, i) => (
          <article key={i} className={`rec-item rec-${r.priority}`}>
            <div className="rec-head">
              <span className="rec-title">{r.title}</span>
              <span className={`risk-pill ${PILL[r.priority]}`}>{r.priority} priority</span>
            </div>
            <p className="rec-why">{r.why}</p>
            <AiSection
              compact
              title={`AI explanation: ${r.title}`}
              text={aiRecs?.[i] || null}
              loading={aiLoading}
            />
            <div className="rec-foot">
              {r.action === "export" && onExport ? (
                <button className="btn ghost mini-btn" onClick={onExport}>
                  {r.actionLabel} <ArrowRight size={13} aria-hidden="true" />
                </button>
              ) : (
                onNavigate && r.target && (
                  <button className="btn ghost mini-btn" onClick={() => onNavigate(r.target)}>
                    {r.actionLabel} <ArrowRight size={13} aria-hidden="true" />
                  </button>
                )
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
