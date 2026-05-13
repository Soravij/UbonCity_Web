(() => {
  const key = "ubon_theme_preference";
  const allowed = new Set(["light", "dark", "system"]);
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const root = document.documentElement;

  function sanitize(value) {
    return allowed.has(value) ? value : "system";
  }

  function readStoredPreference() {
    try {
      return sanitize(localStorage.getItem(key));
    } catch {
      return "system";
    }
  }

  function resolveTheme(preference) {
    if (preference === "system") {
      return media && media.matches ? "dark" : "light";
    }
    return preference;
  }

  function applyPreference(nextPreference, shouldPersist) {
    const preference = sanitize(nextPreference);
    const resolvedTheme = resolveTheme(preference);
    root.setAttribute("data-theme", resolvedTheme);
    root.setAttribute("data-theme-preference", preference);
    if (shouldPersist) {
      try {
        localStorage.setItem(key, preference);
      } catch {}
    }
    window.dispatchEvent(new CustomEvent("ubon-theme-change", {
      detail: { preference, resolvedTheme },
    }));
    return { preference, resolvedTheme };
  }

  function syncWithSystemTheme() {
    const currentPreference = sanitize(root.getAttribute("data-theme-preference"));
    if (currentPreference === "system") {
      applyPreference("system", false);
    }
  }

  applyPreference(readStoredPreference(), false);

  if (media) {
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncWithSystemTheme);
    } else if (typeof media.addListener === "function") {
      media.addListener(syncWithSystemTheme);
    }
  }

  window.__UBON_THEME__ = {
    key,
    getPreference: function getPreference() {
      return sanitize(root.getAttribute("data-theme-preference"));
    },
    setPreference: function setPreference(preference) {
      return applyPreference(preference, true);
    },
    syncSystem: syncWithSystemTheme,
  };
})();
