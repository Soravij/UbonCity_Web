// transport-map-viewer.js — shared by collector admin (collector/server/public) and frontend (frontend/lib/transportMapViewer.js).
// Both copies must stay byte-identical (checked by collector/tests/transport-map-viewer.test.mjs). No imports, no CSS classes.
const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_ZOOM = 40;
const LABEL_PX = { s: 11, m: 13, l: 15 };
const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const DRAFT_R = COARSE ? 10 : 6;
// [zoom, widthMultiplier, opacity] — below the first stop the class is hidden.
const BASE_RAMPS = {
  "roads-motorway": [[1, 1, 1], [4, 1.6, 1], [12, 3, 1], [40, 6, 1]],
  "roads-primary": [[1, 1, 1], [4, 1.6, 1], [12, 3, 1], [40, 6, 1]],
  "roads-secondary": [[1, 0.9, 1], [4, 1.6, 1], [12, 3.2, 1], [40, 6.5, 1]],
  "roads-tertiary": [[1, 0.7, 1], [4, 1.5, 1], [12, 3.2, 1], [40, 6, 1]],
  "roads-local": [[2, 0.5, 0.35], [4, 0.9, 0.8], [8, 1.4, 1], [16, 2.4, 1], [40, 4, 1]],
  "roads-service": [[5, 0.5, 0.3], [10, 1, 0.8], [20, 1.8, 1], [40, 3, 1]],
};

export function rampValue(ramp, z) {
  if (z <= ramp[0][0]) return ramp[0].slice(1);
  for (let i = 1; i < ramp.length; i += 1) {
    const [z1, ...a] = ramp[i - 1];
    const [z2, ...b] = ramp[i];
    if (z <= z2) {
      const t = (Math.log2(z) - Math.log2(z1)) / (Math.log2(z2) - Math.log2(z1));
      return a.map((v, k) => v + (b[k] - v) * t);
    }
  }
  return ramp[ramp.length - 1].slice(1);
}

// Route band + chevron geometry (moved from transport-v2-leg-decor.js, which re-exports these).
const LEG_EPS = 1e-9;
const legLen = (v) => Math.hypot(v[0], v[1]);
const legUnit = (v) => { const l = legLen(v); return l > LEG_EPS ? [v[0] / l, v[1] / l] : [0, 0]; };
const legLeftNormal = (t) => [t[1], -t[0]];
function legTangents(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = [points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]];
    out.push(legLen(d) > LEG_EPS ? legUnit(d) : null);
  }
  return out;
}
function legNextNonNull(segs, from, dir) {
  let i = from;
  while (i >= 0 && i < segs.length) { if (segs[i]) return segs[i]; i += dir; }
  return null;
}
export function offsetPolylineLeft(points, offsetUnits) {
  if (!Array.isArray(points) || points.length < 2 || !offsetUnits) return (points || []).map((p) => [p[0], p[1]]);
  const segs = legTangents(points);
  const result = new Array(points.length);
  for (let i = 0; i < points.length; i += 1) {
    const inTan = i > 0 ? legNextNonNull(segs, i - 1, -1) : null;
    const outTan = i < points.length - 1 ? legNextNonNull(segs, i, 1) : null;
    let normal;
    if (inTan && outTan) {
      const nIn = legLeftNormal(inTan), nOut = legLeftNormal(outTan);
      const sum = [nIn[0] + nOut[0], nIn[1] + nOut[1]];
      normal = legLen(sum) > 1e-3 ? legUnit(sum) : nOut;
    } else if (outTan) normal = legLeftNormal(outTan);
    else if (inTan) normal = legLeftNormal(inTan);
    else normal = [0, 0];
    result[i] = [points[i][0] + normal[0] * offsetUnits, points[i][1] + normal[1] * offsetUnits];
  }
  return result;
}
export function chevronPolylinePoints(x, y, angleDeg, widthUnits, depthUnits) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const px = -dy, py = dx;
  const hw = widthUnits / 2, hd = depthUnits / 2;
  const tipX = x + dx * hd, tipY = y + dy * hd;
  const backX = x - dx * hd, backY = y - dy * hd;
  return `${backX + px * hw},${backY + py * hw} ${tipX},${tipY} ${backX - px * hw},${backY - py * hw}`;
}
export function arrowPositionsInRect(points, spacingUnits, rect, maxNodes = 1000) {
  if (!Array.isArray(points) || points.length < 2 || !(spacingUnits > 0) || !rect) return [];
  const x0 = rect.x, x1 = rect.x + rect.w, y0 = rect.y, y1 = rect.y + rect.h;
  const isOutside = (a, b) => Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) > x1
    || Math.max(a[1], b[1]) < y0 || Math.min(a[1], b[1]) > y1;
  let visLen = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    if (!isOutside(a, b)) visLen += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const k = Math.max(1, Math.ceil(visLen / (maxNodes * spacingUnits)));
  const step = spacingUnits * k;
  const out = [];
  let acc = 0;
  let next = spacingUnits / 2;
  for (let i = 1; i < points.length && out.length < maxNodes; i += 1) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const segLen = Math.hypot(dx, dy);
    if (segLen <= LEG_EPS) continue;
    const end = acc + segLen;
    if (isOutside(a, b)) {
      if (next <= end) next += (Math.floor((end - next) / step) + 1) * step;
    } else {
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      while (next <= end && out.length < maxNodes) {
        const t = (next - acc) / segLen;
        const x = a[0] + dx * t, y = a[1] + dy * t;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push({ x, y, angleDeg });
        next += step;
      }
    }
    acc = end;
  }
  return out;
}
export const ROUTE_DECOR = {
  minBandPx: 3, maxBandPx: 8, bandK: 2, gapRatio: 0.25,
  bandOpacity: 0.85, chevronOpacity: 0.6,
  chevronW: 0.7, chevronD: 0.35, chevronStroke: 0.18,
  maxChevronNodes: 300,
};
export function routeBandPx(z) {
  return Math.min(ROUTE_DECOR.maxBandPx, Math.max(ROUTE_DECOR.minBandPx, ROUTE_DECOR.bandK * Math.sqrt(Math.max(1, z))));
}
// segments (out_back): both = centred, no chevrons; out/back = offset left + chevrons.
// no segments (loop, or out_back without segments): route.path centred + chevrons.
export function routeBandSpecs(route) {
  const segs = Array.isArray(route?.segments) ? route.segments.filter((s) => Array.isArray(s?.path) && s.path.length >= 2) : [];
  if (segs.length) return segs.map((s) => ({ path: s.path, offset: s.leg !== "both", chevrons: s.leg !== "both" }));
  return Array.isArray(route?.path) && route.path.length >= 2 ? [{ path: route.path, offset: false, chevrons: true }] : [];
}

// Icons: Font Awesome Free 6 (solid) — https://fontawesome.com — License CC BY 4.0
export const LANDMARK_ICONS = {
  hospital: { w: 640, h: 512, d: 'M192 48c0-26.5 21.5-48 48-48L400 0c26.5 0 48 21.5 48 48l0 464-80 0 0-80c0-26.5-21.5-48-48-48s-48 21.5-48 48l0 80-80 0 0-464zM48 96l112 0 0 416L48 512c-26.5 0-48-21.5-48-48L0 320l80 0c8.8 0 16-7.2 16-16s-7.2-16-16-16L0 288l0-64 80 0c8.8 0 16-7.2 16-16s-7.2-16-16-16L0 192l0-48c0-26.5 21.5-48 48-48zm544 0c26.5 0 48 21.5 48 48l0 48-80 0c-8.8 0-16 7.2-16 16s7.2 16 16 16l80 0 0 64-80 0c-8.8 0-16 7.2-16 16s7.2 16 16 16l80 0 0 144c0 26.5-21.5 48-48 48l-112 0 0-416 112 0zM312 64c-8.8 0-16 7.2-16 16l0 24-24 0c-8.8 0-16 7.2-16 16l0 16c0 8.8 7.2 16 16 16l24 0 0 24c0 8.8 7.2 16 16 16l16 0c8.8 0 16-7.2 16-16l0-24 24 0c8.8 0 16-7.2 16-16l0-16c0-8.8-7.2-16-16-16l-24 0 0-24c0-8.8-7.2-16-16-16l-16 0z', color: '#d32f2f' },
  market: { w: 576, h: 512, d: 'M253.3 35.1c6.1-11.8 1.5-26.3-10.2-32.4s-26.3-1.5-32.4 10.2L117.6 192 32 192c-17.7 0-32 14.3-32 32s14.3 32 32 32L83.9 463.5C91 492 116.6 512 146 512L430 512c29.4 0 55-20 62.1-48.5L544 256c17.7 0 32-14.3 32-32s-14.3-32-32-32l-85.6 0L365.3 12.9C359.2 1.2 344.7-3.4 332.9 2.7s-16.3 20.6-10.2 32.4L404.3 192l-232.6 0L253.3 35.1zM192 304l0 96c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-96c0-8.8 7.2-16 16-16s16 7.2 16 16zm96-16c8.8 0 16 7.2 16 16l0 96c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-96c0-8.8 7.2-16 16-16zm128 16l0 96c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-96c0-8.8 7.2-16 16-16s16 7.2 16 16z', color: '#f57c00' },
  temple: { w: 640, h: 512, d: 'M281 22L305.8 4.7c1.3-.9 2.7-1.8 4.1-2.4C313.1 .7 316.6 0 320 0s6.9 .7 10.1 2.2c1.4 .7 2.8 1.5 4.1 2.4L359 22C393 45.8 430.8 63.5 470.8 74.4l23 6.3c1.8 .5 3.6 1.1 5.2 2c3.2 1.7 5.9 4 8.1 6.8c3.8 4.9 5.6 11.3 4.7 17.8c-.4 2.8-1.2 5.4-2.5 7.8c-1.7 3.2-4 5.9-6.8 8.1c-4.3 3.2-9.6 5.1-15.1 4.9l-7.5 0 0 56.1 6.4 5.1 5.2 4.1c21.1 16.7 45 29.6 70.5 38.1l28.9 9.6c1.6 .5 3.2 1.2 4.6 2c3.1 1.7 5.8 4.1 7.8 6.9s3.5 6.1 4.1 9.6c.5 2.7 .6 5.5 .1 8.3s-1.4 5.4-2.7 7.8c-1.7 3.1-4.1 5.8-6.9 7.8s-6.1 3.5-9.6 4.1c-1.6 .3-3.3 .4-5 .4L544 288l0 65.9c20.5 22.8 47.4 39.2 77.4 46.7C632 403 640 412.6 640 424c0 13.3-10.7 24-24 24l-40 0 0 32c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-32-160 0 0 32c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-32-160 0 0 32c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-32-40 0c-13.3 0-24-10.7-24-24c0-11.4 8-21 18.6-23.4c30-7.6 56.9-23.9 77.4-46.7L96 288l-39.4 0c-1.7 0-3.4-.1-5-.4c-3.5-.7-6.8-2.1-9.6-4.1s-5.2-4.7-7-7.8c-1.3-2.4-2.3-5-2.7-7.8s-.4-5.6 .1-8.3c.7-3.5 2.1-6.8 4.1-9.6s4.7-5.2 7.8-6.9c1.4-.8 3-1.5 4.6-2l28.9-9.6c25.5-8.5 49.4-21.4 70.5-38.1l5.2-4.1 6.4-5.1 0-8.1 0-48-7.5 0c-5.5 .1-10.8-1.7-15.1-4.9c-2.8-2.1-5.1-4.8-6.8-8.1c-1.2-2.4-2.1-5-2.5-7.8c-.9-6.5 .9-12.8 4.7-17.8c2.1-2.8 4.8-5.1 8.1-6.8c1.6-.8 3.4-1.5 5.2-2l23-6.3C209.2 63.5 247 45.8 281 22zM416 128l-96 0-96 0 0 64 72 0 48 0 72 0 0-64zM160 288l0 64 136 0 24 0 24 0 136 0 0-64-136 0-24 0s0 0 0 0l-24 0-136 0z', color: '#b8860b' },
  school: { w: 640, h: 512, d: 'M337.8 5.4C327-1.8 313-1.8 302.2 5.4L166.3 96 48 96C21.5 96 0 117.5 0 144L0 464c0 26.5 21.5 48 48 48l208 0 0-96c0-35.3 28.7-64 64-64s64 28.7 64 64l0 96 208 0c26.5 0 48-21.5 48-48l0-320c0-26.5-21.5-48-48-48L473.7 96 337.8 5.4zM96 192l32 0c8.8 0 16 7.2 16 16l0 64c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-64c0-8.8 7.2-16 16-16zm400 16c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 64c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-64zM96 320l32 0c8.8 0 16 7.2 16 16l0 64c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-64c0-8.8 7.2-16 16-16zm400 16c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 64c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-64zM232 176a88 88 0 1 1 176 0 88 88 0 1 1 -176 0zm88-48c-8.8 0-16 7.2-16 16l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-16 0 0-16c0-8.8-7.2-16-16-16z', color: '#1976d2' },
  transit: { w: 576, h: 512, d: 'M288 0C422.4 0 512 35.2 512 80l0 16 0 32c17.7 0 32 14.3 32 32l0 64c0 17.7-14.3 32-32 32l0 160c0 17.7-14.3 32-32 32l0 32c0 17.7-14.3 32-32 32l-32 0c-17.7 0-32-14.3-32-32l0-32-192 0 0 32c0 17.7-14.3 32-32 32l-32 0c-17.7 0-32-14.3-32-32l0-32c-17.7 0-32-14.3-32-32l0-160c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32c0 0 0 0 0 0l0-32s0 0 0 0l0-16C64 35.2 153.6 0 288 0zM128 160l0 96c0 17.7 14.3 32 32 32l112 0 0-160-112 0c-17.7 0-32 14.3-32 32zM304 288l112 0c17.7 0 32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-112 0 0 160zM144 400a32 32 0 1 0 0-64 32 32 0 1 0 0 64zm288 0a32 32 0 1 0 0-64 32 32 0 1 0 0 64zM384 80c0-8.8-7.2-16-16-16L208 64c-8.8 0-16 7.2-16 16s7.2 16 16 16l160 0c8.8 0 16-7.2 16-16z', color: '#388e3c' },
  airport: { w: 576, h: 512, d: 'M482.3 192c34.2 0 93.7 29 93.7 64c0 36-59.5 64-93.7 64l-116.6 0L265.2 495.9c-5.7 10-16.3 16.1-27.8 16.1l-56.2 0c-10.6 0-18.3-10.2-15.4-20.4l49-171.6L112 320 68.8 377.6c-3 4-7.8 6.4-12.8 6.4l-42 0c-7.8 0-14-6.3-14-14c0-1.3 .2-2.6 .5-3.9L32 256 .5 145.9c-.4-1.3-.5-2.6-.5-3.9c0-7.8 6.3-14 14-14l42 0c5 0 9.8 2.4 12.8 6.4L112 192l102.9 0-49-171.6C162.9 10.2 170.6 0 181.2 0l56.2 0c11.5 0 22.1 6.2 27.8 16.1L365.7 192l116.6 0z', color: '#0288d1' },
  mall: { w: 448, h: 512, d: 'M160 112c0-35.3 28.7-64 64-64s64 28.7 64 64l0 48-128 0 0-48zm-48 48l-64 0c-26.5 0-48 21.5-48 48L0 416c0 53 43 96 96 96l256 0c53 0 96-43 96-96l0-208c0-26.5-21.5-48-48-48l-64 0 0-48C336 50.1 285.9 0 224 0S112 50.1 112 112l0 48zm24 48a24 24 0 1 1 0 48 24 24 0 1 1 0-48zm152 24a24 24 0 1 1 48 0 24 24 0 1 1 -48 0z', color: '#8e24aa' },
  government: { w: 512, h: 512, d: 'M240.1 4.2c9.8-5.6 21.9-5.6 31.8 0l171.8 98.1L448 104l0 .9 47.9 27.4c12.6 7.2 18.8 22 15.1 36s-16.4 23.8-30.9 23.8L32 192c-14.5 0-27.2-9.8-30.9-23.8s2.5-28.8 15.1-36L64 104.9l0-.9 4.4-1.6L240.1 4.2zM64 224l64 0 0 192 40 0 0-192 64 0 0 192 48 0 0-192 64 0 0 192 40 0 0-192 64 0 0 196.3c.6 .3 1.2 .7 1.8 1.1l48 32c11.7 7.8 17 22.4 12.9 35.9S494.1 512 480 512L32 512c-14.1 0-26.5-9.2-30.6-22.7s1.1-28.1 12.9-35.9l48-32c.6-.4 1.2-.7 1.8-1.1L64 224z', color: '#455a64' },
};
export function landmarkScale(z) { return Math.min(2.5, Math.max(1, Math.sqrt(z || 1))); }
export function landmarkLayout(label, u, z) {
  const k = landmarkScale(z) * u;
  const base = LABEL_PX[label.style?.size] || LABEL_PX.m;
  const cat = String(label.category || 'other');
  if (cat === 'area') return { icon: null, r: 0, glyph: 0, tx: label.x, ty: label.y, font: base * 1.2 * k, anchor: 'middle', stroke: 3 * k, ring: 0 };
  const icon = LANDMARK_ICONS[cat] || null;
  const r = (icon ? 9 : 4) * k;
  return { icon, r, glyph: 11 * k, tx: label.x + r + 4 * k, ty: label.y, font: base * k, anchor: 'start', stroke: 3 * k, ring: 1 * k };
}
export function glyphTransform(icon, cx, cy, size) {
  const s = size / Math.max(icon.w, icon.h);
  return `translate(${cx - (icon.w * s) / 2} ${cy - (icon.h * s) / 2}) scale(${s})`;
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
      baseStrokes = [...node.querySelectorAll("path[vector-effect]")].map((n) => {
        const groupId = String(n.parentNode?.getAttribute?.("id") || "").replace(/-casing$/, "");
        return [n, Number(n.getAttribute("stroke-width")) || 1, BASE_RAMPS[groupId] || null];
      });
      render();
    }).catch((err) => options.onError?.(err))
    : Promise.resolve();

  const routesById = new Map();
  const routeBands = [];
  for (const route of bundle.routes || []) {
    routesById.set(Number(route.id), route);
    const points = route.path.map((p) => p.join(",")).join(" ");
    const band = el("g", { "data-route-id": route.id, "data-band": "1", "pointer-events": "none" });
    routeBands.push([band, route.color, routeBandSpecs(route)]);
    const hit = el("polyline", { points, fill: "none", stroke: "transparent", "stroke-width": 18, "vector-effect": "non-scaling-stroke", "data-route-id": route.id, "data-hit": "1" });
    hit.style.cursor = "pointer";
    gRoutes.append(band, hit);
    for (const stop of route.stops || []) {
      gStops.append(el("circle", { cx: stop.x, cy: stop.y, r: 4, fill: "#ffffff", stroke: route.color, "stroke-width": 2, "vector-effect": "non-scaling-stroke", "data-route-id": route.id }));
    }
  }

  function drawRouteBands(u, z) {
    if (!routeBands.length) return;
    const bp = routeBandPx(z);
    const bandU = bp * u;
    const gapU = Math.max(1, bp * ROUTE_DECOR.gapRatio) * u;
    const r = container.getBoundingClientRect();
    const vw = r.width > 0 ? r.width * u : view.w;
    const vh = r.height > 0 ? r.height * u : view.h;
    const cull = { x: view.x + view.w / 2 - vw / 2 - bandU, y: view.y + view.h / 2 - vh / 2 - bandU, w: vw + 2 * bandU, h: vh + 2 * bandU };
    for (const [g, color, specs] of routeBands) {
      g.replaceChildren();
      for (const s of specs) {
        const center = s.offset ? offsetPolylineLeft(s.path, bandU / 2 + gapU / 2) : s.path;
        g.append(el("polyline", { points: center.map((p) => `${p[0]},${p[1]}`).join(" "), fill: "none", stroke: color, "stroke-width": bandU, "stroke-linejoin": "round", "stroke-linecap": "butt", opacity: ROUTE_DECOR.bandOpacity }));
        if (!s.chevrons) continue;
        for (const a of arrowPositionsInRect(center, bandU, cull, ROUTE_DECOR.maxChevronNodes)) {
          g.append(el("polyline", { points: chevronPolylinePoints(a.x, a.y, a.angleDeg, bandU * ROUTE_DECOR.chevronW, bandU * ROUTE_DECOR.chevronD), fill: "none", stroke: "#fff", "stroke-width": bandU * ROUTE_DECOR.chevronStroke, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: ROUTE_DECOR.chevronOpacity }));
        }
      }
    }
  }

  const labelsByKey = new Map();
  let selectedLabelKey = null;
  function buildLabels(list) {
    labelsByKey.clear();
    gLabels.replaceChildren();
    for (const label of list) {
      labelsByKey.set(label.key, label);
      const cat = String(label.category || "other");
      const icon = cat === "area" ? null : LANDMARK_ICONS[cat] || null;
      const g = el("g", { "data-landmark": "1", "data-key": label.key });
      g.append(el("circle", { "data-ring": "1", fill: "none", stroke: "#2563eb", visibility: "hidden" }));
      if (cat !== "area") g.append(el("circle", { fill: icon ? icon.color : "#616161", stroke: "#ffffff" }));
      if (icon) g.append(el("path", { "data-icon": "1", fill: "#ffffff", d: icon.d }));
      g.append(el("text", { "text-anchor": "middle", "dominant-baseline": "middle", fill: cat === "area" ? "#6b7280" : (label.style?.color || "#243041"), stroke: "#ffffff", "paint-order": "stroke", "font-family": "Noto Sans Thai, sans-serif" }));
      gLabels.append(g);
    }
    writeLabelText();
  }
  buildLabels(bundle.labels || []);

  for (const overlay of bundle.overlays || []) {
    if (overlay.url) gOverlays.append(el("image", { href: overlay.url, x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height }));
  }

  function unitsPerPx(v = view) {
    const r = container.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? Math.max(v.w / r.width, v.h / r.height) : 1;
  }

  function writeLabelText() {
    for (const g of gLabels.children) {
      const label = labelsByKey.get(g.getAttribute("data-key"));
      g.querySelector("text").textContent = label.texts?.[lang] || label.texts?.th || "";
    }
  }

  function drawDraft() {
    gDraft.replaceChildren();
    if (!draft) return;
    const color = draft.color || "#ff6600";
    const pointOpacity = String(draft.pointOpacity ?? 1);
    const stopOpacity = String(draft.stopOpacity ?? 1);
    const warnPoints = new Set(draft.warnPoints || []);
    const ghostOpacity = String(draft.ghostOpacity ?? 0.3);
    if ((draft.ghostPath || []).length >= 2) {
      gDraft.append(el("polyline", { points: draft.ghostPath.map((p) => p.join(",")).join(" "), fill: "none", stroke: color, "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke", opacity: ghostOpacity, "pointer-events": "none" }));
    }
    (draft.ghostPoints || []).forEach((p) => gDraft.append(el("circle", { cx: p[0], cy: p[1], r: DRAFT_R, fill: color, stroke: "#ffffff", "stroke-width": 2, "vector-effect": "non-scaling-stroke", opacity: ghostOpacity, "pointer-events": "none" })));
    (draft.ghostStops || []).forEach((p) => gDraft.append(el("circle", { cx: p[0], cy: p[1], r: DRAFT_R, fill: "#1f3a5f", stroke: "#ffffff", "stroke-width": 2.5, "vector-effect": "non-scaling-stroke", opacity: ghostOpacity, "pointer-events": "none" })));
    const addLine = (pts, attrs) => {
      const points = pts.map((p) => p.join(",")).join(" ");
      gDraft.append(el("polyline", { points, fill: "none", stroke: color, "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke", ...attrs }));
      const hit = el("polyline", { points, fill: "none", stroke: "transparent", "stroke-width": COARSE ? 28 : 16, "vector-effect": "non-scaling-stroke", "data-draft-line": "1" });
      hit.style.cursor = "copy";
      gDraft.append(hit);
    };
    if ((draft.path || []).length >= 2) addLine(draft.path, { "stroke-width": 5 });
    if ((draft.points || []).length >= 2 && (draft.path || []).length < 2) addLine(draft.points, { "stroke-width": 2, "stroke-dasharray": "6 6", opacity: pointOpacity });
    (draft.points || []).forEach((p, index) => {
      const c = el("circle", { cx: p[0], cy: p[1], r: DRAFT_R, fill: color, stroke: "#ffffff", "stroke-width": 2, "vector-effect": "non-scaling-stroke", "data-point-index": index, opacity: pointOpacity });
      c.style.cursor = "grab";
      gDraft.append(c);
      if (warnPoints.has(index)) {
        gDraft.append(el("circle", { cx: p[0], cy: p[1], r: DRAFT_R * 2, fill: "none", stroke: "#dc2626", "stroke-width": 4, "vector-effect": "non-scaling-stroke", "pointer-events": "none", "data-warn-ring": "1" }));
      }
    });
    (draft.stops || []).forEach((p, index) => {
      gDraft.append(el("circle", { cx: p[0], cy: p[1], r: DRAFT_R, fill: "#1f3a5f", stroke: "#ffffff", "stroke-width": 2.5, "vector-effect": "non-scaling-stroke", "data-stop-index": index, opacity: stopOpacity }));
    });
  }

  function render() {
    committed = { ...view };
    svg.style.transform = "";
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
    const u = unitsPerPx();
    const z = zoomLevel(view, full);
    drawRouteBands(u, z);
    for (const [n, w, ramp] of baseStrokes) {
      if (!ramp) continue;
      const hidden = z < ramp[0][0];
      n.style.display = hidden ? "none" : "";
      if (hidden) continue;
      const [mul, opacity] = rampValue(ramp, z);
      n.setAttribute("stroke-width", String(w * mul));
      n.style.opacity = String(opacity);
    }
    for (const c of gStops.children) c.setAttribute("r", String(4 * u));
    for (const c of gDraft.querySelectorAll("circle:not([data-warn-ring])")) c.setAttribute("r", String(DRAFT_R * u));
    for (const c of gDraft.querySelectorAll("circle[data-warn-ring]")) c.setAttribute("r", String(DRAFT_R * 2 * u));
    for (const g of gLabels.children) {
      const label = labelsByKey.get(g.getAttribute("data-key"));
      const L = landmarkLayout(label, u, z);
      g.style.display = label.min_zoom == null || z >= label.min_zoom ? "" : "none";
      const circle = g.querySelector("circle:not([data-ring])");
      if (circle) {
        circle.setAttribute("cx", String(label.x));
        circle.setAttribute("cy", String(label.y));
        circle.setAttribute("r", String(L.r));
        circle.setAttribute("stroke-width", String(L.ring));
      }
      const ring = g.querySelector("circle[data-ring]");
      const on = label.key === selectedLabelKey;
      ring.setAttribute("visibility", on ? "visible" : "hidden");
      if (on) {
        ring.setAttribute("cx", String(label.x));
        ring.setAttribute("cy", String(label.y));
        ring.setAttribute("r", String(L.r > 0 ? L.r * 1.6 : L.font * 1.2));
        ring.setAttribute("stroke-width", String(L.stroke));
      }
      const path = g.querySelector("path[data-icon]");
      if (path && L.icon) path.setAttribute("transform", glyphTransform(L.icon, label.x, label.y, L.glyph));
      const text = g.querySelector("text");
      text.setAttribute("x", String(L.tx));
      text.setAttribute("y", String(L.ty));
      text.setAttribute("font-size", String(L.font));
      text.setAttribute("text-anchor", L.anchor);
      text.setAttribute("stroke-width", String(L.stroke));
      text.setAttribute("letter-spacing", String(label.category) === "area" ? String(L.font * 0.15) : "0");
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
  let dragPoint = null;
  let dragLine = null;

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
      const pointAttr = e.target?.getAttribute?.("data-point-index");
      dragPoint = pointAttr != null && options.onPointDragEnd ? { index: Number(pointAttr), node: e.target } : null;
      const lineAttr = e.target?.getAttribute?.("data-draft-line");
      dragLine = !dragPoint && lineAttr != null && options.onLineDragEnd ? { ghost: null } : null;
    } else {
      dragged = true;
      dragPoint = null;
      dragLine = null;
    }
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      if (down && Math.hypot(cur.x - down.x, cur.y - down.y) > 4) dragged = true;
      if (dragged && dragPoint) {
        const [x, y] = toViewbox(cur.x, cur.y);
        dragPoint.node.setAttribute("cx", String(x));
        dragPoint.node.setAttribute("cy", String(y));
      } else if (dragged && dragLine) {
        const [x, y] = toViewbox(cur.x, cur.y);
        if (!dragLine.ghost) {
          dragLine.ghost = el("circle", { r: 6 * unitsPerPx(), fill: draft?.color || "#ff6600", stroke: "#ffffff", "stroke-width": 2, "vector-effect": "non-scaling-stroke" });
          gDraft.append(dragLine.ghost);
        }
        dragLine.ghost.setAttribute("cx", String(x));
        dragLine.ghost.setAttribute("cy", String(y));
      } else if (dragged) {
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
    if (pointers.size === 0 && dragPoint && dragged) {
      const [x, y] = toViewbox(e.clientX, e.clientY);
      const index = dragPoint.index;
      dragPoint = null;
      dragLine = null;
      down = null;
      options.onPointDragEnd(index, { x, y, ...viewboxToLatLng(x, y, bundle.bounds, full) });
      return;
    }
    if (pointers.size === 0 && dragLine && dragged) {
      const [sx, sy] = toViewbox(down.x, down.y);
      const [x, y] = toViewbox(e.clientX, e.clientY);
      dragLine.ghost?.remove();
      dragLine = null;
      down = null;
      options.onLineDragEnd(
        { x: sx, y: sy, ...viewboxToLatLng(sx, sy, bundle.bounds, full) },
        { x, y, ...viewboxToLatLng(x, y, bundle.bounds, full) },
      );
      return;
    }
    if (pointers.size === 0 && dragged) commitView();
    if (pointers.size > 0 || dragged || !down) {
      if (pointers.size === 0) {
        dragPoint = null;
        dragLine = null;
      }
      return;
    }
    const [x, y] = toViewbox(e.clientX, e.clientY);
    const at = { x, y, ...viewboxToLatLng(x, y, bundle.bounds, full) };
    const routeId = down.target?.getAttribute?.("data-route-id");
    const pointIndex = down.target?.getAttribute?.("data-point-index");
    const stopIndex = down.target?.getAttribute?.("data-stop-index");
    const lineHit = down.target?.getAttribute?.("data-draft-line");
    if (pointIndex != null && options.onPointClick) {
      options.onPointClick(Number(pointIndex));
    } else if (stopIndex != null && options.onStopClick) {
      options.onStopClick(Number(stopIndex));
    } else if (lineHit != null && options.onLineClick) {
      options.onLineClick(at);
    } else if (routeId != null && options.onRouteSelect) {
      options.onRouteSelect(Number(routeId));
    } else if (options.onMapClick) {
      options.onMapClick(at);
    } else if (options.onRouteSelect) {
      options.onRouteSelect(null);
    }
    dragPoint = null;
    dragLine = null;
    down = null;
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); down = null; dragPoint = null; dragLine?.ghost?.remove(); dragLine = null; if (pointers.size === 0) commitView(); });

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
    focusPoints(points) {
      if (!Array.isArray(points) || points.length < 2) return;
      view = viewForBounds(pathBounds(points), full);
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
    setLabels(next) { buildLabels(Array.isArray(next) ? next : []); render(); },
    selectLabel(key) { selectedLabelKey = key == null ? null : String(key); render(); },
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
