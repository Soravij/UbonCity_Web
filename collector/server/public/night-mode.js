(() => {
  if (window.__UBON_NIGHT_MODE_COMPAT__ === true) {
    return;
  }
  window.__UBON_NIGHT_MODE_COMPAT__ = true;

  function applyCompatTheme() {
    const api = window.__UBON_THEME__;
    if (api && typeof api.getPreference === "function" && typeof api.setPreference === "function") {
      const preference = api.getPreference() || "system";
      api.setPreference(preference);
      return;
    }

    const root = document.documentElement;
    if (!root) return;
    if (!root.getAttribute("data-theme")) {
      root.setAttribute("data-theme", "light");
    }
    if (!root.getAttribute("data-theme-preference")) {
      root.setAttribute("data-theme-preference", "system");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyCompatTheme, { once: true });
  } else {
    applyCompatTheme();
  }

  window.addEventListener("pageshow", applyCompatTheme);
})();
