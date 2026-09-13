import React, { useState } from "react";
import { api } from "../api.js";
import { getSession } from "../auth.js";

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
  { id: "charts", label: "Charts & Graphs", icon: "▤" },
];

export default function Sidebar({ active = "results", onSelect, user, onLogout, onDeleteAccount }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [delError, setDelError] = useState(null);
  const [showChange, setShowChange] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changeError, setChangeError] = useState(null);
  const [changeSuccess, setChangeSuccess] = useState(null);
  const [changeBusy, setChangeBusy] = useState(false);

  const handleChangePw = async (e) => {
    e.preventDefault();
    if (newPw !== confirmPw) {
      setChangeError("New passwords do not match.");
      return;
    }
    if (newPw.length < 8) {
      setChangeError("New password must be at least 8 characters.");
      return;
    }
    setChangeBusy(true);
    setChangeError(null);
    setChangeSuccess(null);
    try {
      const sess = getSession();
      const token = sess?.token;
      await api.changePassword(oldPw, newPw, token);
      setChangeSuccess("Password changed — please sign in again.");
      setOldPw("");
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => {
        if (onLogout) onLogout();
      }, 1200);
    } catch (err) {
      setChangeError(err.message || "Change failed.");
    } finally {
      setChangeBusy(false);
    }
  };

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
        {user && !showChange && (
          <button
            className="change-password-link"
            onClick={() => setShowChange(true)}
            title="Change your password"
          >
            <span className="nav-icon">🔑</span>
            <span>Change password</span>
          </button>
        )}
        {showChange && (
          <form className="change-pw-form" onSubmit={handleChangePw}>
            <h4 className="change-pw-title">Change password</h4>
            {changeError && <div className="banner error login-error">{changeError}</div>}
            {changeSuccess && <div className="banner success login-success">{changeSuccess}</div>}
            <label className="login-field">
              <span>Current password</span>
              <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="••••••••" />
            </label>
            <label className="login-field">
              <span>New password</span>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="••••••••" />
            </label>
            <label className="login-field">
              <span>Confirm new password</span>
              <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="••••••••" />
            </label>
            <div className="delete-confirm-actions">
              <button className="btn mini-btn" type="submit" disabled={changeBusy}>
                {changeBusy ? "Saving…" : "Save"}
              </button>
              <button
                className="btn ghost mini-btn"
                type="button"
                onClick={() => {
                  setShowChange(false);
                  setChangeError(null);
                  setChangeSuccess(null);
                }}
                disabled={changeBusy}
              >
                Cancel
              </button>
            </div>
          </form>
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