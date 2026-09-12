import React from "react";

// Uniform loading / error / empty state for every tab.
// Rendered by each view when its data isn't ready; renders nothing otherwise.
export default function TabState({
  loading,
  error,
  onRetry,
  empty,
  emptyText,
  loadingText,
}) {
  if (error) {
    return (
      <div className="tab-state">
        <div className="banner error">API error: {error}</div>
        {onRetry && (
          <button className="btn" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="tab-state">
        <div className="spinner" role="status" aria-label="Loading" />
        <div className="muted">{loadingText || "Loading…"}</div>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="tab-state">
        <div className="empty-state">{emptyText || "Nothing to show yet."}</div>
      </div>
    );
  }
  return null;
}
