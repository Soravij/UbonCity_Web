import { initAuthBox, rolePortalUrl } from "./auth-box.js";

function qs(id) {
  return document.getElementById(id);
}

function currentRole(user) {
  return String(user?.role || "").trim().toLowerCase();
}

async function init() {
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-transport-map-manager")?.addEventListener("click", () => {
    window.location.href = "/transport-v2-routes.html";
  });
  qs("btn-open-transport-base-maps")?.addEventListener("click", () => {
    window.location.href = "/transport-v2-base-maps.html";
  });
  qs("btn-open-other-transport-manager")?.addEventListener("click", () => {
    window.location.href = "/other-transport.html";
  });

  const user = await initAuthBox({ allowRoles: ["owner", "admin", "user"] });
  if (!user) return;
  const role = currentRole(user);
  if (role === "owner") {
    qs("btn-open-transport-base-maps")?.classList.remove("hidden");
  }
}

init();
