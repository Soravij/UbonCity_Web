export { offsetPolylineLeft, chevronPolylinePoints, arrowPositionsInRect } from "./transport-map-viewer.js";

const EPS = 1e-9;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
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
export function legEndpointLabels(firstXY, lastXY, isLoop) {
  if (!firstXY) return [];
  const coincident = !lastXY
    || (Math.abs(firstXY[0] - lastXY[0]) < 1e-6 && Math.abs(firstXY[1] - lastXY[1]) < 1e-6);
  if (isLoop || coincident) return [{ x: firstXY[0], y: firstXY[1], text: "เริ่ม" }];
  return [
    { x: firstXY[0], y: firstXY[1], text: "เริ่ม" },
    { x: lastXY[0], y: lastXY[1], text: "สุด" },
  ];
}
