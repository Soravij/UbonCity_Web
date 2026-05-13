"use client";

import { useState } from "react";

const PREFERENCES = ["system", "dark", "light"];

function sanitizePreference(value) {
  return PREFERENCES.includes(value) ? value : "system";
}

function readCurrentPreference() {
  if (typeof window === "undefined") return "system";
  const attr = document.documentElement.getAttribute("data-theme-preference");
  if (attr) return sanitizePreference(attr);
  try {
    return sanitizePreference(localStorage.getItem("ubon_theme_preference"));
  } catch {
    return "system";
  }
}

export default function ThemeModeControl() {
  const [preference, setPreference] = useState(() => readCurrentPreference());

  function handleChange(event) {
    const nextPreference = sanitizePreference(event.target.value);
    setPreference(nextPreference);
    const api = window.__UBON_THEME__;
    if (api && typeof api.setPreference === "function") {
      api.setPreference(nextPreference);
    } else {
      document.documentElement.setAttribute("data-theme-preference", nextPreference);
      document.documentElement.setAttribute("data-theme", nextPreference === "system" ? "light" : nextPreference);
    }
  }

  return (
    <div className="theme-mode-control" role="group" aria-label="Theme mode">
      <label htmlFor="theme-mode-select" className="theme-mode-label">
        ธีม
      </label>
      <select
        id="theme-mode-select"
        className="theme-mode-select"
        value={preference}
        onChange={handleChange}
        aria-label="เลือกโหมดธีม"
      >
        <option value="system">System</option>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </div>
  );
}
