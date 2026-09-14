import { initAuthBox, authApi, getAuthUser } from "./auth-box.js";

const state = {
  user: null,
};

function qs(id) {
  return document.getElementById(id);
}

function setStatus(message = "", isError = false) {
  const node = qs("workspace-status");
  if (!node) return;
  node.textContent = String(message || "").trim();
  node.classList.toggle("hidden", !message);
  node.classList.toggle("fail", Boolean(message && isError));
}

function currentRole(user = state.user) {
  return String(user?.role || "").trim().toLowerCase();
}

async function init() {
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-place-raw")?.addEventListener("click", () => {
    window.location.href = "/?tab=raw";
  });
  qs("btn-open-place-assignments")?.addEventListener("click", () => {
    window.location.href = "/?tab=handoff";
  });
  qs("btn-open-place-write")?.addEventListener("click", () => {
    window.location.href = "/article-intake.html?scope=place";
  });

  await initAuthBox({
    allowRoles: ["owner", "admin", "user"],
    onReady: () => {
      state.user = getAuthUser();
    },
  });
}

init();
