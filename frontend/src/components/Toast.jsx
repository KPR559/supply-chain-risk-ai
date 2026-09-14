import React from "react";
import { CheckCircle2 } from "lucide-react";

export default function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <CheckCircle2 size={15} aria-hidden="true" />
      <span>{toast.msg}</span>
    </div>
  );
}
