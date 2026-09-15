import React from "react";
import { Sparkles } from "lucide-react";

/**
 * Small LLM narrative block. Renders nothing when the model is unavailable
 * or produced no text, so AI panels degrade silently instead of erroring.
 * An optional `compact` mode renders inline (recommendation cards).
 */
export default function AiSection({ title, text, loading, compact = false, className = "" }) {
  if (!loading && !text) return null;
  if (compact) {
    return (
      <div className={`ai-inline ${className}`} aria-label={title}>
        <Sparkles size={12} aria-hidden="true" />
        {loading && !text ? <span className="sk sk-inline" /> : <span>{text}</span>}
      </div>
    );
  }
  return (
    <section className={`panel compact ai-panel ${className}`} aria-label={title}>
      <div className="ai-head">
        <Sparkles size={13} aria-hidden="true" />
        <span className="ai-title">{title}</span>
      </div>
      {loading && !text ? (
        <div className="sk sk-ai" aria-label={`${title} is being generated`} />
      ) : (
        <>
          <p className="ai-text">{text}</p>
          <p className="ai-source">Generated from current shipment analytics</p>
        </>
      )}
    </section>
  );
}
