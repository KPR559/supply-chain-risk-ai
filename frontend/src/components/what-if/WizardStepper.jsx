import React from "react";

const STEPS = [
  { id: 1, label: "Shipment & Route" },
  { id: 2, label: "Choose Scenario" },
  { id: 3, label: "Define Impact" },
  { id: 4, label: "Run Simulation" },
];

export default function WizardStepper({ step }) {
  return (
    <div className="wizard-stepper" role="navigation" aria-label="Scenario wizard">
      {STEPS.map((s, i) => {
        const active = s.id === step;
        const done = s.id < step;
        return (
          <React.Fragment key={s.id}>
            {i > 0 && <div className={`wizard-connector ${done ? "done" : ""}`} aria-hidden="true" />}
            <div className={`wizard-step ${active ? "active" : ""} ${done ? "done" : ""}`}>
              <div className="wizard-step-num" aria-hidden="true">
                {done ? "✓" : s.id}
              </div>
              <div className="wizard-step-label">{s.label}</div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}