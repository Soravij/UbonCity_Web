(() => {
  const api = window.__UBON_THEME__;
  if (!api || typeof api.setPreference !== "function") return;

  const root = document.documentElement;
  const CONTROL_ID = "theme-mode-control";
  const CHECKBOX_ID = "input";
  const BASE_VIEWPORT_SCALE = 1;
  const BASE_DEVICE_PIXEL_RATIO = Number(window.devicePixelRatio || 1) || 1;

  function currentTheme() {
    return String(root.getAttribute("data-theme") || "light");
  }

  function ensureControl() {
    if (!document.body) return null;

    let wrap = document.getElementById(CONTROL_ID);
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = CONTROL_ID;
      wrap.className = "theme-mode-control theme-switch-control";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "Theme mode");
      wrap.innerHTML = `
        <label class="switch">
          <input id="${CHECKBOX_ID}" type="checkbox" aria-label="Theme mode toggle" />
          <div class="slider round">
            <div class="sun-moon">
              <svg id="moon-dot-1" class="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="moon-dot-2" class="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="moon-dot-3" class="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="light-ray-1" class="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="light-ray-2" class="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="light-ray-3" class="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="cloud-1" class="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="cloud-2" class="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="cloud-3" class="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="cloud-4" class="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="cloud-5" class="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
              <svg id="cloud-6" class="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
            </div>
            <div class="stars">
              <svg id="star-1" class="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"></path></svg>
              <svg id="star-2" class="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"></path></svg>
              <svg id="star-3" class="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"></path></svg>
              <svg id="star-4" class="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"></path></svg>
            </div>
          </div>
        </label>
      `;
      document.body.appendChild(wrap);
    }

    return wrap.querySelector(`#${CHECKBOX_ID}`) || document.getElementById(CHECKBOX_ID);
  }

  function syncToggle(toggle) {
    const isDark = currentTheme() === "dark";
    toggle.checked = isDark;
    toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
  }

  function currentViewportScale() {
    const scale = Number(window.visualViewport?.scale || BASE_VIEWPORT_SCALE);
    return Number.isFinite(scale) && scale > 0 ? scale : BASE_VIEWPORT_SCALE;
  }

  function currentZoomFactor() {
    const currentDpr = Number(window.devicePixelRatio || BASE_DEVICE_PIXEL_RATIO) || BASE_DEVICE_PIXEL_RATIO;
    const dprRatio = currentDpr / BASE_DEVICE_PIXEL_RATIO;
    const viewportScale = currentViewportScale();
    const zoom = Math.max(dprRatio, viewportScale, 1);
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  }

  function lockControlViewportScale() {
    const wrap = document.getElementById(CONTROL_ID);
    if (!wrap) return;
    wrap.style.setProperty("--theme-zoom-factor", String(currentZoomFactor()));
  }

  function bindToggle(toggle) {
    if (toggle.dataset.themeBound === "1") return;
    toggle.dataset.themeBound = "1";
    toggle.addEventListener("change", () => {
      api.setPreference(toggle.checked ? "dark" : "light");
    });
  }

  function mount() {
    const toggle = ensureControl();
    if (!toggle) return;
    bindToggle(toggle);
    syncToggle(toggle);
    lockControlViewportScale();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }

  window.addEventListener("pageshow", mount);
  window.addEventListener("ubon-theme-change", mount);
  window.visualViewport?.addEventListener("resize", lockControlViewportScale);
  window.visualViewport?.addEventListener("scroll", lockControlViewportScale);
  window.addEventListener("resize", lockControlViewportScale);

  const BACK_TO_TOP_THRESHOLD_PX = 300;
  const TOP_BUTTON_ID = "back-to-top-button";
  const TOP_BUTTON_STYLE = [
    "position:fixed", "right:var(--floating-control-right, 12px)", "bottom:12px", "z-index:40",
    "width:var(--floating-control-width, 52.8px)", "height:44px", "padding:0", "border-radius:22px",
    "font-size:20px", "line-height:1", "opacity:0.92",
  ].join(";");

  function ensureTopButton() {
    if (!document.body) return null;
    let btn = document.getElementById(TOP_BUTTON_ID);
    if (!btn) {
      btn = document.createElement("button");
      btn.id = TOP_BUTTON_ID;
      btn.type = "button";
      btn.className = "hidden";
      btn.textContent = "↑";
      btn.setAttribute("aria-label", "กลับขึ้นบนสุดของหน้า");
      btn.style.cssText = TOP_BUTTON_STYLE;
      document.body.appendChild(btn);
    }
    return btn;
  }

  function syncTopButton() {
    const btn = document.getElementById(TOP_BUTTON_ID);
    if (!btn) return;
    const scrolledPastThreshold = Number(window.scrollY || 0) > BACK_TO_TOP_THRESHOLD_PX;
    btn.classList.toggle("hidden", !scrolledPastThreshold);
  }

  function mountTopButton() {
    const btn = ensureTopButton();
    if (!btn) return;
    if (btn.dataset.topBound !== "1") {
      btn.dataset.topBound = "1";
      btn.addEventListener("click", () => {
        const reduce = typeof window.matchMedia === "function"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      });
    }
    syncTopButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountTopButton, { once: true });
  } else {
    mountTopButton();
  }
  window.addEventListener("scroll", syncTopButton, { passive: true });
  window.addEventListener("resize", syncTopButton);
  window.addEventListener("pageshow", mountTopButton);
})();
