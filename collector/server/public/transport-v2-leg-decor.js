const EPS = 1e-9;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => { const l = len(v); return l > EPS ? [v[0] / l, v[1] / l] : [0, 0]; };
function leftNormal(t) { return [t[1], -t[0]]; }
function segmentTangents(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = sub(points[i + 1], points[i]);
    out.push(len(d) > EPS ? unit(d) : null);
  }
  return out;
}
function nextNonNull(segs, from, dir) {
  let i = from;
  while (i >= 0 && i < segs.length) { if (segs[i]) return segs[i]; i += dir; }
  return null;
}
export function offsetPolylineLeft(points, offsetUnits) {
  if (!Array.isArray(points) || points.length < 2 || !offsetUnits) return (points || []).map((p) => [p[0], p[1]]);
  const segs = segmentTangents(points);
  const result = new Array(points.length);
  for (let i = 0; i < points.length; i += 1) {
    const inTan = i > 0 ? nextNonNull(segs, i - 1, -1) : null;
    const outTan = i < points.length - 1 ? nextNonNull(segs, i, 1) : null;
    let normal;
    if (inTan && outTan) {
      const nIn = leftNormal(inTan), nOut = leftNormal(outTan);
      const sum = [nIn[0] + nOut[0], nIn[1] + nOut[1]];
      normal = len(sum) > 1e-3 ? unit(sum) : nOut;
    } else if (outTan) normal = leftNormal(outTan);
    else if (inTan) normal = leftNormal(inTan);
    else normal = [0, 0];
    result[i] = [points[i][0] + normal[0] * offsetUnits, points[i][1] + normal[1] * offsetUnits];
  }
  return result;
}
function cumulativeLengths(points) {
  const lens = [0];
  for (let i = 1; i < points.length; i += 1) lens.push(lens[i - 1] + len(sub(points[i], points[i - 1])));
  return lens;
}
export function polylineLength(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  const lens = cumulativeLengths(points);
  return lens[lens.length - 1];
}
export function pointAtDistance(points, lens, dist) {
  const total = lens[lens.length - 1];
  const d = Math.max(0, Math.min(total, dist));
  let i = 1;
  while (i < lens.length - 1 && lens[i] < d) i += 1;
  const segLen = lens[i] - lens[i - 1];
  const t = segLen > EPS ? (d - lens[i - 1]) / segLen : 0;
  const a = points[i - 1], b = points[i];
  const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
  const angleDeg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return { x, y, angleDeg };
}
export function arrowPositions(points, spacingUnits, maxArrows = 400) {
  if (!Array.isArray(points) || points.length < 2 || !(spacingUnits > 0)) return [];
  const lens = cumulativeLengths(points);
  const total = lens[lens.length - 1];
  if (total <= EPS) return [];
  const step = Math.max(spacingUnits, total / maxArrows);
  const out = [];
  for (let d = step / 2; d <= total; d += step) out.push(pointAtDistance(points, lens, d));
  return out;
}
export function arrowPolygonPoints(x, y, angleDeg, lengthUnits, halfWidthUnits) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const local = [[lengthUnits, 0], [-lengthUnits * 0.4, halfWidthUnits], [-lengthUnits * 0.4, -halfWidthUnits]];
  return local.map(([lx, ly]) => `${x + lx * cos - ly * sin},${y + lx * sin + ly * cos}`).join(" ");
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
  const out = [];
  let acc = 0;
  let next = spacingUnits / 2;
  for (let i = 1; i < points.length && out.length < maxNodes; i += 1) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const segLen = Math.hypot(dx, dy);
    if (segLen <= EPS) continue;
    const end = acc + segLen;
    const outside = Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) > x1
      || Math.max(a[1], b[1]) < y0 || Math.min(a[1], b[1]) > y1;
    if (outside) {
      if (next <= end) next += (Math.floor((end - next) / spacingUnits) + 1) * spacingUnits;
    } else {
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      while (next <= end && out.length < maxNodes) {
        const t = (next - acc) / segLen;
        const x = a[0] + dx * t, y = a[1] + dy * t;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push({ x, y, angleDeg });
        next += spacingUnits;
      }
    }
    acc = end;
  }
  return out;
}
