import React, { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "../api.js";
import { getSession } from "../auth.js";

export default function AccountSettingsView({ data }) {
  const { user, onLogout, onDeleteAccount, onBackToSettings } = data;
  const onBack = onBackToSettings;

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changeError, setChangeError] = useState(null);
  const [changeSuccess, setChangeSuccess] = useState(null);
  const [changeBusy, setChangeBusy] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

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
      const token = getSession()?.token;
      await api.changePassword(oldPw, newPw, token);
      setChangeSuccess("Password changed \u2014 please sign in again.");
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
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const err = await onDeleteAccount();
      if (err) {
        setDeleteError(err);
        setConfirmingDelete(false);
      }
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <button className="back-link" onClick={onBack} type="button">
            <ArrowLeft size={14} aria-hidden="true" /> Back to Settings
          </button>
          <div className="view-title">Account Settings</div>
          <div className="view-sub">Password, security, and account management</div>
        </div>
      </div>

      <section className="panel">
        <h2>Password &amp; Security</h2>
        <p className="muted">
          Signed in as <b>{user || "\u2014"}</b>
        </p>
        <form className="change-pw-form" onSubmit={handleChangePw}>
          {changeError && <div className="banner error login-error">{changeError}</div>}
          {changeSuccess && <div className="banner success login-success">{changeSuccess}</div>}
          <label className="login-field">
            <span>Current password</span>
            <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)}  />
          </label>
          <label className="login-field">
            <span>New password</span>
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}  />
          </label>
          <label className="login-field">
            <span>Confirm new password</span>
            <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}  />
          </label>
          <div className="delete-confirm-actions">
            <button className="btn mini-btn" type="submit" disabled={changeBusy}>
              {changeBusy ? "Saving\u2026" : "Change password"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel danger-panel">
        <h2>Danger Zone</h2>
        <p className="muted">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
        {onDeleteAccount &&
          (confirmingDelete ? (
            <div className="delete-confirm">
              <span>
                Delete <b>{user}</b> forever? This will remove all shipments and settings.
              </span>
              <div className="delete-confirm-actions">
                <button
                  className="btn danger mini-btn"
                  onClick={doDelete}
                  disabled={deleteBusy}
                  title="Permanently delete this account"
                >
                  {deleteBusy ? "Deleting\u2026" : "Yes, delete"}
                </button>
                <button
                  className="btn ghost mini-btn"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteError(null);
                  }}
                  disabled={deleteBusy}
                >
                  Keep
                </button>
              </div>
              {deleteError && <em className="form-error">{deleteError}</em>}
            </div>
          ) : (
            <div>
              <button
                className="btn danger mini-btn"
                onClick={() => setConfirmingDelete(true)}
                title="Permanently delete this account"
              >
                Delete account
              </button>
              {deleteError && <em className="form-error">{deleteError}</em>}
            </div>
          ))}
      </section>
    </div>
  );
}
