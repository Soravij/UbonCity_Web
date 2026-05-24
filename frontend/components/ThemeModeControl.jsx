"use client";

import { useEffect, useId, useState } from "react";

const MODES = new Set(["dark", "light"]);

function sanitizeMode(value) {
  const text = String(value || "").trim().toLowerCase();
  return MODES.has(text) ? text : null;
}

function readInitialMode() {
  if (typeof window === "undefined") return "light";

  const root = document.documentElement;
  const preference = root.getAttribute("data-theme-preference");
  const theme = root.getAttribute("data-theme");

  const fromPreference = sanitizeMode(preference);
  if (fromPreference) return fromPreference;

  const fromTheme = sanitizeMode(theme);
  if (fromTheme) return fromTheme;

  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

export default function ThemeModeControl() {
  const toggleId = useId();
  const [mode, setMode] = useState(() => readInitialMode());

  useEffect(() => {
    function handleThemeChange(event) {
      const nextMode = sanitizeMode(event?.detail?.resolvedTheme) || readInitialMode();
      setMode(nextMode);
    }

    window.addEventListener("ubon-theme-change", handleThemeChange);
    return () => window.removeEventListener("ubon-theme-change", handleThemeChange);
  }, []);

  function handleChange(event) {
    const nextMode = event.target.checked ? "dark" : "light";
    setMode(nextMode);

    const api = window.__UBON_THEME__;
    if (api && typeof api.setPreference === "function") {
      api.setPreference(nextMode);
      return;
    }

    document.documentElement.setAttribute("data-theme-preference", nextMode);
    document.documentElement.setAttribute("data-theme", nextMode);
  }

  return (
    <div className="theme-mode-control theme-switch-control" role="group" aria-label="Theme mode">
      <label className="switch" htmlFor={toggleId}>
        <input
          id={toggleId}
          type="checkbox"
          checked={mode === "dark"}
          onChange={handleChange}
          aria-label="Theme mode toggle"
        />
        <div className="slider round">
          <div className="sun-moon">
            <svg id="moon-dot-1" className="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="moon-dot-2" className="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="moon-dot-3" className="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="light-ray-1" className="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="light-ray-2" className="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="light-ray-3" className="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-1" className="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-2" className="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-3" className="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-4" className="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-5" className="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-6" className="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
          </div>
          <div className="stars">
            <svg id="star-1" className="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z" /></svg>
            <svg id="star-2" className="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z" /></svg>
            <svg id="star-3" className="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z" /></svg>
            <svg id="star-4" className="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z" /></svg>
          </div>
        </div>
      </label>
    </div>
  );
}
