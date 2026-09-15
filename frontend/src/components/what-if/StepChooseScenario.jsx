import React from "react";
import { Zap, CloudRain, AlertOctagon, Layers, Sliders } from "lucide-react";

const TYPE_META = {
  baseline: { icon: CheckCircleIcon, label: "Baseline", desc: "Run normal conditions" },
  congestion: { icon: Zap, label: "Congestion", desc: "Increase waiting time at a checkpoint" },
  weather: { icon: CloudRain, label: "Severe Weather", desc: "Weather-driven delays" },
  closure: { icon: AlertOctagon, label: "Closure", desc: "A chokepoint is closed" },
  multi_checkpoint: { icon: Layers, label: "Multi-Checkpoint", desc: "Multiple disruptions at once" },
  route_level: { icon: Layers, label: "Route-Wide", desc: "Disruption across the whole corridor" },
  custom: { icon: Sliders, label: "Custom", desc: "Full control over scope and impact" },
};

function CheckCircleIcon({ size = 18, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export default function StepChooseScenario({ presets, presetsSource, selectedPresetId, onSelect, enabled }) {
  if (!presets.length) {
    return (
      <section className="panel wizard-step-panel">
        <h2>Choose Scenario</h2>
        <p className="muted">Loading scenarios for this corridor…</p>
      </section>
    );
  }

  return (
    <section className="panel wizard-step-panel">
      <div className="panel-head">
        <h2>Choose Scenario</h2>
        {presetsSource === "fallback" && (
          <span className="presets-source-badge">Local presets (offline)</span>
        )}
      </div>
      <p className="muted">
        Scenarios are tailored to this route. Presets that don't apply are hidden automatically.
      </p>

      <div className="scenario-card-grid">
        {presets.map((p) => {
          const meta = TYPE_META[p.scenario_type] || TYPE_META.custom;
          const Icon = meta.icon;
          const active = p.id === selectedPresetId;
          return (
            <button
              key={p.id}
              className={`scenario-card ${active ? "active" : ""} ${p.scenario_type === "baseline" ? "baseline" : ""}`}
              onClick={() => onSelect(p)}
              disabled={!enabled}
              title={p.description}
            >
              <div className="scenario-card-top">
                <span className={`scenario-type-badge type-${p.scenario_type}`}>
                  <Icon size={14} aria-hidden="true" />
                  {meta.label}
                </span>
                {active && <span className="scenario-selected">Selected</span>}
              </div>
              <div className="scenario-card-name">{p.name}</div>
              <div className="scenario-card-desc">{p.description}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}