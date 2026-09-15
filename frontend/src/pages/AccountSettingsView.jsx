import React, { useEffect, useState } from "react";
import { ArrowLeft, Camera, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { getSession } from "../auth.js";

// Downscale the picked image to at most 256px so the avatar stays small enough
// to persist in the DuckDB users table and render instantly.
function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode the image."));
      img.onload = () => {
        const MAX = 256;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function AccountSettingsView({ data }) {
  const { user, avatar, onLogout, onDeleteAccount, onBackToSettings, onUpdateAvatar, onChangeUsername } = data;
  const onBack = onBackToSettings;

  const [avatarPreview, setAvatarPreview] = useState(avatar || null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(null);
  const [avatarSuccess, setAvatarSuccess] = useState(null);

  const [usernameDraft, setUsernameDraft] = useState(user || "");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState(null);
  const [nameSuccess, setNameSuccess] = useState(null);

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changeError, setChangeError] = useState(null);
  const [changeSuccess, setChangeSuccess] = useState(null);
  const [changeBusy, setChangeBusy] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Keep drafts in sync when the parent re-renders us with a renamed user.
  useEffect(() => {
    setAvatarPreview(avatar || null);
  }, [avatar]);
  useEffect(() => {
    setUsernameDraft(user || "");
  }, [user]);

  const handleAvatarChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !onUpdateAvatar) return;
    setAvatarBusy(true);
    setAvatarError(null);
    setAvatarSuccess(null);
    try {
      const avatarUrl = await fileToAvatar(file);
      const err = await onUpdateAvatar(avatarUrl);
      if (err) {
        setAvatarError(err);
      } else {
        setAvatarPreview(avatarUrl);
        setAvatarSuccess("Profile picture updated.");
      }
    } catch (err) {
      setAvatarError(err.message || "Upload failed.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!onUpdateAvatar) return;
    setAvatarBusy(true);
    setAvatarError(null);
    setAvatarSuccess(null);
    try {
      const err = await onUpdateAvatar(null);
      if (err) {
        setAvatarError(err);
      } else {
        setAvatarPreview(null);
        setAvatarSuccess("Profile picture removed.");
      }
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleRename = async (e) => {
    e.preventDefault();
    const next = usernameDraft.trim();
    if (!next || next === user) {
      setNameError("Enter a different username to rename your account.");
      return;
    }
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(next)) {
      setNameError("Username must be 3-32 chars: letters, digits, _ . -");
      return;
    }
    if (!onChangeUsername) return;
    setNameBusy(true);
    setNameError(null);
    setNameSuccess(null);
    try {
      const err = await onChangeUsername(next);
      if (err) {
        setNameError(err);
      } else {
        setUsernameDraft(next);
        setNameSuccess("Username updated.");
      }
    } finally {
      setNameBusy(false);
    }
  };

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
          <div className="view-sub">Profile, password, security, and account management</div>
        </div>
      </div>

      <section className="panel">
        <h2>Profile</h2>
        {avatarError && <div className="banner error login-error">{avatarError}</div>}
        {avatarSuccess && <div className="banner success login-success">{avatarSuccess}</div>}
        <div className="profile-row">
          <div className="profile-avatar-wrap">
            {avatarPreview ? (
              <span className="user-avatar user-avatar-img profile-avatar">
                <img src={avatarPreview} alt={user} />
              </span>
            ) : (
              <span className="user-avatar profile-avatar">
                {(user || "\u2014")[0].toUpperCase()}
              </span>
            )}
            <label className="avatar-upload-btn" title="Upload a profile picture">
              <Camera size={14} aria-hidden="true" />
              <input type="file" accept="image/*" onChange={handleAvatarChange} disabled={avatarBusy} />
            </label>
          </div>
          <div className="profile-actions">
            {avatarPreview ? (
              <button className="btn ghost mini-btn" onClick={handleRemoveAvatar} disabled={avatarBusy} title="Remove profile picture">
                <Trash2 size={13} aria-hidden="true" /> {avatarBusy ? "Saving\u2026" : "Remove"}
              </button>
            ) : (
              <span className="muted">No picture yet — tap the camera to add one.</span>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Username</h2>
        {nameError && <div className="banner error login-error">{nameError}</div>}
        {nameSuccess && <div className="banner success login-success">{nameSuccess}</div>}
        <form className="change-pw-form" onSubmit={handleRename}>
          <label className="login-field">
            <span>Sign-in username</span>
            <input
              type="text"
              value={usernameDraft}
              onChange={(e) => setUsernameDraft(e.target.value)}
              autoComplete="username"
            />
          </label>
          <p className="muted rename-hint">
            Renaming keeps your shipments and settings — your login handle is updated everywhere.
          </p>
          <div className="delete-confirm-actions">
            <button className="btn mini-btn" type="submit" disabled={nameBusy}>
              {nameBusy ? "Saving\u2026" : "Save username"}
            </button>
          </div>
        </form>
      </section>

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