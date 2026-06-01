const params = new URLSearchParams(window.location.search || "");
const routeId = params.get("id");
window.location.replace(`/transport-v2-path-editor.html${routeId ? `?id=${encodeURIComponent(routeId)}` : ""}`);
