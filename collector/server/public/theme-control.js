(() => {
  const api = window.__UBON_THEME__;
  if (!api || typeof api.getPreference !== "function" || typeof api.setPreference !== "function") {
    return;
  }

  const CONTROL_ID = "theme-mode-control";
  const SELECT_ID = "theme-mode-select";

  function ensureControl() {
    if (!document.body) return null;

    let wrap = document.getElementById(CONTROL_ID);
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = CONTROL_ID;
      wrap.className = "theme-mode-control";
      wrap.innerHTML = `
        <label class="theme-mode-label" for="${SELECT_ID}">ธีม</label>
        <select id="${SELECT_ID}" class="theme-mode-select" aria-label="เลือกโหมดธีม">
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      `;
      document.body.appendChild(wrap);
    }

    return wrap.querySelector(`#${SELECT_ID}`) || document.getElementById(SELECT_ID);
  }

  function bindSelect(select) {
    if (!select || select.dataset.themeBound === "1") return;
    select.dataset.themeBound = "1";
    select.addEventListener("change", () => {
      api.setPreference(select.value || "system");
    });
  }

  function syncSelectFromTheme() {
    const select = ensureControl();
    if (!select) return;
    bindSelect(select);
    select.value = api.getPreference();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncSelectFromTheme, { once: true });
  } else {
    syncSelectFromTheme();
  }

  window.addEventListener("pageshow", syncSelectFromTheme);
  window.addEventListener("ubon-theme-change", syncSelectFromTheme);
})();
