import { initAuthBox, rolePortalUrl } from "./auth-box.js";

function parsePositiveInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function workUrl(itemId, assignmentId) {
  const params = new URLSearchParams();
  params.set("tab", "work");
  const normalizedItemId = parsePositiveInt(itemId);
  const normalizedAssignmentId = parsePositiveInt(assignmentId);
  if (normalizedItemId > 0) params.set("item_id", String(normalizedItemId));
  if (normalizedAssignmentId > 0) params.set("assignment_id", String(normalizedAssignmentId));
  return `/?${params.toString()}`;
}

function landingContextFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    itemId: parsePositiveInt(params.get("item_id")),
    assignmentId: parsePositiveInt(params.get("assignment_id")),
  };
}

async function init() {
  const landingContext = landingContextFromQuery();
  document.getElementById("btn-open-work")?.addEventListener("click", () => {
    window.location.assign(workUrl(landingContext.itemId, landingContext.assignmentId));
  });

  await initAuthBox({ allowRoles: ["freelance"] });
}

init();
