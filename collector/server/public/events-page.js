import { initAuthBox, rolePortalUrl } from "./auth-box.js";

function setBanner(el, message, kind) {
  if (!el) return;
  el.classList.remove("hidden", "fail", "is-loading", "is-success", "is-error");
  if (!message) { el.classList.add("hidden"); return; }
  el.textContent = message;
  if (kind === "loading") el.classList.add("is-loading");
  else if (kind === "error") el.classList.add("is-error");
  else el.classList.add("is-success");
}

async function init() {
  document.getElementById("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  document.getElementById("btn-open-events-manager")?.addEventListener("click", () => {
    window.location.href = "/events-manager.html";
  });

  await initAuthBox({ allowRoles: ["owner", "admin", "user"] });
}

init();
