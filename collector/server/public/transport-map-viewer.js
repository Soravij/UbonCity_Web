// transport-map-viewer.js — shared by collector admin (collector/server/public) and frontend (frontend/lib/transportMapViewer.js).
// Both copies must stay byte-identical (checked by collector/tests/transport-map-viewer.test.mjs). No imports, no CSS classes.
const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_ZOOM = 40;
const LABEL_PX = { s: 11, m: 13, l: 15 };
const BASE_MIN_ZOOM = [["roads-service", 4], ["roads-local", 2]];

export function baseStrokeScale(z) {
  return Math.pow(Math.min(Math.max(z, 1), 32), 0.6);
}

export function latLngToViewbox(lat, lng, bounds, viewbox) {
  const lngSpan = bounds.max_lng - bounds.min_lng || 1;
  const latSpan = bounds.max_lat - bounds.min_lat || 1;
  return [
    viewbox.x + ((lng - bounds.min_lng) / lngSpan) * viewbox.width,
    viewbox.y + (1 - (lat - bounds.min_lat) / latSpan) * viewbox.height,
  ];
}

export function viewboxToLatLng(x, y, bounds, viewbox) {
  return {
    lat: bounds.min_lat + (1 - (y - viewbox.y) / viewbox.height) * (bounds.max_lat - bounds.min_lat),
    lng: bounds.min_lng + ((x - viewbox.x) / viewbox.width) * (bounds.max_lng - bounds.min_lng),
  };
}

export function clampView(view, full) {
  const w = Math.min(full.width, Math.max(full.width / MAX_ZOOM, view.w));
  const h = w * (full.height / full.width);
  const x = Math.min(full.x + full.width - w, Math.max(full.x, view.x));
  const y = Math.min(full.y + full.height - h, Math.max(full.y, view.y));
  return { x, y, w, h };
}

export function zoomAt(view, full, factor, px, py) {
  const ratio = 1 / factor;
  return clampView({
    x: px - (px - view.x) * ratio,
    y: py - (py - view.y) * ratio,
    w: view.w * ratio,
    h: view.h * ratio,
  }, full);
}

export function zoomLevel(view, full) {
  return full.width / view.w;
}

export function pathBounds(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function viewForBounds(b, full) {
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.15 + 40;
  const aspect = full.height / full.width;
  const rawW = Math.max(b.maxX - b.minX, (b.maxY - b.minY) / aspect) + pad * 2;
  const w = Math.min(full.width, Math.max(full.width / MAX_ZOOM, rawW));
  const h = w * aspect;
  return clampView({ x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w, h }, full);
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  return node;
}

const BASE_TAGS = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const BASE_ATTRS = new Set(["xmlns", "viewBox", "preserveAspectRatio", "role", "id", "d", "x", "y", "width", "height",
  "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "points", "transform", "opacity",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "vector-effect"]);

function sanitizeBaseSvg(root) {
  for (const node of [root, ...root.querySelectorAll("*")]) {
    if (!BASE_TAGS.has(node.localName)) {
      node.remove();
      continue;
    }
    for (const a of [...node.attributes]) {
      if (!BASE_ATTRS.has(a.name) || /url\(|javascript:/i.test(a.value)) node.removeAttribute(a.name);
    }
  }
}

async function loadBaseSvg(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`base map ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "svg" || doc.getElementsByTagName("parsererror").length) throw new Error("base map is not svg");
  sanitizeBaseSvg(root);
  return document.importNode(root, true);
}

export function createTransportMapViewer(container, options = {}) {
  const bundle = options.bundle;
  const full = { ...bundle.viewbox };
  let view = { x: full.x, y: full.y, w: full.width, h: full.height };
  let lang = options.lang === "en" ? "en" : "th";
  let selectedId = null;
  let draft = null;
  let destroyed = false;
  let baseStrokes = [];
  let baseGated = [];
  let committed = { ...view };
  let frame = 0;
  let commitTimer = 0;

  const svg = el("svg", { viewBox: `${full.x} ${full.y} ${full.width} ${full.height}`, preserveAspectRatio: "xMidYMid meet", width: "100%", height: "100%" });
  svg.style.display = "block";
  svg.style.touchAction = "none";
  svg.style.userSelect = "none";
  const gBase = el("g");
  const gRoutes = el("g");
  const gDraft = el("g");
  const gStops = el("g");
  const gLabels = el("g");
  const gOverlays = el("g");
  svg.append(gBase, gRoutes, gDraft, gStops, gLabels, gOverlays);
  container.append(svg);

  const ready = bundle.base_svg_url
    ? loadBaseSvg(bundle.base_svg_url).then((node) => {
      if (destroyed) return;
      node.setAttribute("x", String(full.x));
      node.setAttribute("y", String(full.y));
      node.setAttribute("width", String(full.width));
      node.setAttribute("height", String(full.height));
      gBase.append(node);
      baseStrokes = [...node.querySelectorAll("[vector-effect]")].map((n) => [n, Number(n.getAttribute("stroke-width")) || 1]);
      baseGated = BASE_MIN_ZOOM.flatMap(([prefix, minZoom]) => [...node.querySelectorAll(`[id^="${prefix}"]`)].map((n) => [n, minZoom]));
      render();
    }).catch((err) => options.onError?.(err))
    : Promise.resolve();

  const routesById = new Map();
  for (const route of bundle.routes || []) {
    routesById.set(Number(route.id), route);
    const points = route.path.map((p) => p.join(",")).join(" ");
    const line = el("polyline", { points, fill: "none", stroke: route.color, "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke", "data-route-id": route.id });
    const hit = el("polyline", { points, fill: "none", stroke: "transparent", "stroke-width": 18, "vector-effect": "non-scaling-stroke", "data-route-id": route.id, "data-hit": "1" });
    hit.style.cursor = "pointer";
    gRoutes.append(line, hit);
    for (const stop of route.stops || []) {
      gStops.append(el("circle", { cx: stop.x, cy: stop.y, r: 4, fill: "#ffffff", stroke: route.color, "stroke-width": 2, "vector-effect": "non-scaling-stroke", "data-route-id": route.id }));
    }
  }

  const labelsByKey = new Map();
  for (const label of bundle.labels || []) {
    labelsByKey.set(label.key, label);
    gLabels.append(el("text", { "data-key": label.key, "text-anchor": "middle", "dominant-baseline": "middle", fill: label.style?.color || "#243041", stroke: "#ffffff", "paint-order": "stroke", "font-family": "Noto Sans Thai, sans-serif" }));
  }

  for (const overlay of bundle.overlays || []) {
    if (overlay.url) gOverlays.append(el("image", { href: overlay.url, x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height }));
  }

  function unitsPerPx(v = view) {
    const r = container.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? Math.max(v.w / r.width, v.h / r.height) : 1;
  }

  function writeLabelText() {
    for (const t of gLabels.children) {
      const label = labelsByKey.get(t.getAttribute("data-key"));
      const offset = lang === "en" ? label.offsets?.en : null;
      t.textContent = label.texts?.[lang] || label.texts?.th || "";
      t.setAttribute("x", String(label.x + Number(offset?.dx || 0)));
      t.setAttribute("y", String(label.y + Number(offset?.dy || 0)));
    }
  }

  function drawDraft() {
    gDraft.replaceChildren();
    if (!draft) return;
    const color = draft.color || "#ff6600";
    if ((draft.path || []).length >= 2) {
      gDraft.append(el("polyline", { points: draft.path.map((p) => p.join(",")).join(" "), fill: "none", stroke: color, "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
    }
    if ((draft.points || []).length >= 2) {
      gDraft.append(el("polyline", { points: draft.points.map((p) => p.join(",")).join(" "), fill: "none", stroke: color, "stroke-width": 2, "stroke-dasharray": "6 6", "vector-effect": "non-scaling-stroke" }));
    }
    (draft.points || []).forEach((p, index) => {
      gDraft.append(el("circle", { cx: p[0], cy: p[1], r: 6, fill: color, stroke: "#ffffff", "stroke-width": 2, "vector-effect": "non-scaling-stroke", "data-point-index": index }));
    });
  }

  function render() {
    committed = { ...view };
    svg.style.transform = "";
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
    const u = unitsPerPx();
    const z = zoomLevel(view, full);
    const strokeScale = baseStrokeScale(z);
    for (const [n, w] of baseStrokes) n.setAttribute("stroke-width", String(w * strokeScale));
    for (const [n, minZoom] of baseGated) n.style.display = z >= minZoom ? "" : "none";
    for (const c of gStops.children) c.setAttribute("r", String(4 * u));
    for (const c of gDraft.querySelectorAll("circle")) c.setAttribute("r", String(6 * u));
    for (const t of gLabels.children) {
      const label = labelsByKey.get(t.getAttribute("data-key"));
      t.style.display = label.min_zoom == null || z >= label.min_zoom ? "" : "none";
      t.setAttribute("font-size", String((LABEL_PX[label.style?.size] || LABEL_PX.m) * u));
      t.setAttribute("stroke-width", String(3 * u));
    }
  }

  function applySelection() {
    for (const n of gRoutes.children) {
      if (n.getAttribute("data-hit")) continue;
      n.style.opacity = selectedId == null || Number(n.getAttribute("data-route-id")) === selectedId ? "1" : "0.15";
    }
    for (const n of gStops.children) {
      n.style.display = selectedId == null || Number(n.getAttribute("data-route-id")) === selectedId ? "" : "none";
    }
    if (selectedId != null) {
      for (const n of [...gRoutes.querySelectorAll(`[data-route-id="${selectedId}"]`)]) gRoutes.append(n);
    }
  }

  function toViewbox(clientX, clientY) {
    const r = container.getBoundingClientRect();
    const upp = unitsPerPx(view);
    const offX = (r.width - view.w / upp) / 2;
    const offY = (r.height - view.h / upp) / 2;
    return [view.x + (clientX - r.left - offX) * upp, view.y + (clientY - r.top - offY) * upp];
  }

  function applyGestureTransform() {
    frame = 0;
    const r = container.getBoundingClientRect();
    const upp = unitsPerPx(committed);
    const s = committed.w / view.w;
    const offX = (r.width - committed.w / upp) / 2;
    const offY = (r.height - committed.h / upp) / 2;
    const tx = offX * (1 - s) + ((committed.x - view.x) * s) / upp;
    const ty = offY * (1 - s) + ((committed.y - view.y) * s) / upp;
    svg.style.transformOrigin = "0 0";
    svg.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  function commitView() {
    clearTimeout(commitTimer);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    render();
  }

  function scheduleGesture() {
    if (!frame) frame = requestAnimationFrame(applyGestureTransform);
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitView, 160);
  }

  const pointers = new Map();
  let down = null;
  let dragged = false;

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [px, py] = toViewbox(e.clientX, e.clientY);
    view = zoomAt(view, full, e.deltaY < 0 ? 1.2 : 1 / 1.2, px, py);
    scheduleGesture();
  }, { passive: false });

  svg.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      down = { x: e.clientX, y: e.clientY, target: e.target };
      dragged = false;
    } else {
      dragged = true;
    }
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      if (down && Math.hypot(cur.x - down.x, cur.y - down.y) > 4) dragged = true;
      if (dragged) {
        const u = unitsPerPx();
        view = clampView({ ...view, x: view.x - (cur.x - prev.x) * u, y: view.y - (cur.y - prev.y) * u }, full);
        scheduleGesture();
      }
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(cur.x - other.x, cur.y - other.y);
      const [ax, ay] = toViewbox((prev.x + other.x) / 2, (prev.y + other.y) / 2);
      view = zoomAt(view, full, before > 0 ? after / before : 1, ax, ay);
      const [bx, by] = toViewbox((cur.x + other.x) / 2, (cur.y + other.y) / 2);
      view = clampView({ ...view, x: view.x + ax - bx, y: view.y + ay - by }, full);
      scheduleGesture();
    }
    pointers.set(e.pointerId, cur);
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0 && dragged) commitView();
    if (pointers.size > 0 || dragged || !down) return;
    const routeId = down.target?.getAttribute?.("data-route-id");
    const pointIndex = down.target?.getAttribute?.("data-point-index");
    if (pointIndex != null && options.onPointClick) {
      options.onPointClick(Number(pointIndex));
    } else if (routeId != null && options.onRouteSelect) {
      options.onRouteSelect(Number(routeId));
    } else if (options.onMapClick) {
      const [x, y] = toViewbox(e.clientX, e.clientY);
      options.onMapClick({ x, y, ...viewboxToLatLng(x, y, bundle.bounds, full) });
    } else if (options.onRouteSelect) {
      options.onRouteSelect(null);
    }
    down = null;
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); down = null; if (pointers.size === 0) commitView(); });

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => render()) : null;
  resizeObserver?.observe(container);

  writeLabelText();
  render();

  return {
    ready,
    selectRoute(id) {
      selectedId = id == null ? null : Number(id);
      applySelection();
    },
    focusRoute(id) {
      const route = routesById.get(Number(id));
      if (!route || route.path.length < 2) return;
      view = viewForBounds(pathBounds(route.path), full);
      render();
    },
    setLang(next) {
      lang = next === "en" ? "en" : "th";
      writeLabelText();
    },
    setDraft(next) {
      draft = next || null;
      drawDraft();
      render();
    },
    fitAll() {
      view = { x: full.x, y: full.y, w: full.width, h: full.height };
      render();
    },
    destroy() {
      destroyed = true;
      clearTimeout(commitTimer);
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      svg.remove();
    },
  };
}
