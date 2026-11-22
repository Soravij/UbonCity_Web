export function createStage({ stage, collapseBtn = null, fullscreenBtn = null, title = () => "" }) {
  let pseudo = false;
  let collapsed = false;
  let wakeLock = null;
  let flashTimer = null;
  const listeners = new Set();
  const isFull = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement) || pseudo;

  function render() {
    const full = isFull();
    if (!full) collapsed = false;
    stage.classList.toggle("is-full", full);
    stage.classList.toggle("is-pseudo", full && pseudo);
    stage.classList.toggle("is-collapsed", full && collapsed);
    if (collapseBtn) {
      collapseBtn.hidden = !full;
      collapseBtn.textContent = `${collapsed ? "☰" : "–"} ${title()}`.trim();
    }
    if (fullscreenBtn) fullscreenBtn.textContent = full ? "ออกจากเต็มจอ" : "เต็มจอ";
    for (const fn of listeners) fn(full);
  }

  async function toggle() {
    if (isFull()) {
      if (pseudo) pseudo = false;
      else await (document.exitFullscreen?.call(document) || document.webkitExitFullscreen?.call(document));
      try { await wakeLock?.release(); } catch { /* ignore */ }
      wakeLock = null;
    } else {
      const canNative = document.fullscreenEnabled || document.webkitFullscreenEnabled;
      const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
      const enterPseudo = () => { pseudo = true; render(); };
      if (!canNative || !req) enterPseudo();
      else {
        try {
          const p = req.call(stage);
          if (p && typeof p.catch === "function") p.catch(enterPseudo);
        } catch { enterPseudo(); }
      }
      try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; }
    }
    render();
  }

  function flash(el, ms = 2000) {
    if (!el || !isFull() || collapsed) return;
    el.classList.add("is-flash");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove("is-flash"), ms);
  }

  collapseBtn?.addEventListener("click", () => { collapsed = !collapsed; render(); });
  fullscreenBtn?.addEventListener("click", toggle);
  document.addEventListener("fullscreenchange", render);
  document.addEventListener("webkitfullscreenchange", render);

  return { isFull, isCollapsed: () => collapsed, render, toggle, flash, onChange: (fn) => listeners.add(fn) };
}
