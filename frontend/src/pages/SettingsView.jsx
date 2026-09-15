import React from "react";
import { Settings, Shield } from "lucide-react";

export default function SettingsView({ data }) {
  const { onNavigateSettings } = data;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Settings</div>
          <div className="view-sub">Manage application and account preferences</div>
        </div>
      </div>

      <div className="settings-landing-grid">
        <button
          type="button"
          className="settings-card"
          onClick={() => onNavigateSettings && onNavigateSettings("system")}
          aria-label="Open System Settings"
        >
          <span className="settings-card-icon">
            <Settings size={22} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="settings-card-title">System Settings</span>
          <span className="settings-card-desc">
            Configure LOGIX application behavior, simulation, display, and alert preferences.
          </span>
        </button>

        <button
          type="button"
          className="settings-card"
          onClick={() => onNavigateSettings && onNavigateSettings("account")}
          aria-label="Open Account Settings"
        >
          <span className="settings-card-icon">
            <Shield size={22} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="settings-card-title">Account Settings</span>
          <span className="settings-card-desc">
            Manage your password, account security, and account-related actions.
          </span>
        </button>
      </div>
    </div>
  );
}
