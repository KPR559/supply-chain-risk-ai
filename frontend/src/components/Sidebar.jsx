import React, { useState } from "react";

export const NAV_ITEMS = [
  { id: "results", label: "Prediction Results", icon: "◉" },
  { id: "map", label: "Route Map", icon: "◎" },
  { id: "checkpoints", label: "Checkpoint Risk", icon: "◈" },
  { id: "shipments", label: "Shipment Status", icon: "▣" },
  { id: "eta", label: "ETA Distribution", icon: "◔" },
  { id: "deadline", label: "Deadline Risk", icon: "⚑" },
  { id: "critical", label: "Critical Checkpoints", icon: "⚠" },
  { id: "contributors", label: "Risk Contributors", icon: "◫" },
  { id: "simulator", label: "What-if Simulator", icon: "⬡" },
  { id: "compare", label: "Route Comparison", icon: "⇄" },
];

export default function Sidebar({ active = "results", onSelect, user, onLogout, onDeleteAccount }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [delError, setDelError] = useState(null);

  const doDelete = async () => {
    setBusy(true);
    setDelError(null);
    try {
      const err = await onDeleteAccount();
      if (err) {
        setDelError(err);
        setConfirming(false);
      }
      // on success App signs out, unmounting this sidebar
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <div className="brand-logo">∞</div>
          <div>
            <div className="brand-name">LOGIX</div>
            <div className="brand-sub">AI Supply Chain Suite</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${active === item.id ? "active" : ""}`}
              title={item.label}
              type="button"
              aria-pressed={active === item.id}
              onClick={() => onSelect && onSelect(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="sidebar-footer">
        {user && (
          <div className="sidebar-user" title={`Signed in as ${user}`}>
            <span className="user-avatar">{user[0].toUpperCase()}</span>
            <span className="user-name">{user}</span>
          </div>
        )}
        {onLogout && (
          <button className="btn ghost logout-btn-full" onClick={onLogout} title="Sign out">
            ⏻ Log out
          </button>
        )}
        {onDeleteAccount &&
          (confirming ? (
            <div className="delete-confirm">
              <span>
                Delete <b>{user}</b> forever?
              </span>
              <div className="delete-confirm-actions">
                <button
                  className="btn danger mini-btn"
                  onClick={doDelete}
                  disabled={busy}
                  title="Permanently delete this account"
                >
                  {busy ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  className="btn ghost mini-btn"
                  onClick={() => {
                    setConfirming(false);
                    setDelError(null);
                  }}
                  disabled={busy}
                >
                  Keep
                </button>
              </div>
              {delError && <em className="form-error">{delError}</em>}
            </div>
          ) : (
            <button
              className="delete-account-link"
              onClick={() => setConfirming(true)}
              title="Permanently delete this account"
            >
              <span className="nav-icon">🗑</span>
              <span>Delete account</span>
            </button>
          ))}
      </div>
    </aside>
  );
}