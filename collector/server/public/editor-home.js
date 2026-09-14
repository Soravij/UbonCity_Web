import { initAuthBox, rolePortalUrl } from "./auth-box.js";

function parsePositiveInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function workspaceUrl(pathname, id) {
  const itemId = parsePositiveInt(id);
  return itemId > 0 ? `${pathname}?id=${itemId}` : pathname;
}

function landingItemIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return parsePositiveInt(params.get("item_id"));
}

async function init() {
  const landingItemId = landingItemIdFromQuery();
  document.getElementById("btn-open-article-workspace")?.addEventListener("click", () => {
    window.location.assign(workspaceUrl("/article-workspace.html", landingItemId));
  });
  document.getElementById("btn-open-event-workspace")?.addEventListener("click", () => {
    window.location.assign(workspaceUrl("/event-workspace.html", landingItemId));
  });

  await initAuthBox({ allowRoles: ["editor"] });
}

init();
