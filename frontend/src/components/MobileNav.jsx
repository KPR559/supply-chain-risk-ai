import React from "react";
import { NAV_ITEMS } from "./Sidebar.jsx";

// Shown only on small screens where the sidebar is hidden (see styles.css).
// Horizontal scrollable tab chips + logout, sticky at the top.
export default function MobileNav({ active, onSelect, onLogout }) {
  return (
    <nav className="mobile-nav" aria-label="Views">
      <div className="mobile-nav-scroll">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-chip ${active === item.id ? "active" : ""}`}
            aria-pressed={active === item.id}
            onClick={() => onSelect && onSelect(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {onLogout && (
        <button className="btn ghost mobile-logout" onClick={onLogout} title="Sign out">
          ⏻
        </button>
      )}
    </nav>
  );
}
