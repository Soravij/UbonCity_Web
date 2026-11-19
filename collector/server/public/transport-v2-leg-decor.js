const EPS = 1e-9;

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function len(v) {
  return Math.hypot(v[0], v[1]);
}

function unit(v) {
  const l = len(v);
  if (l < EPS) return null;
  return [v[0] / l, v[1] / l];
}

function leftNormal(dir) {
  return [dir[1], -dir[0]];
}

function segmentTangents(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push(unit(sub(points[i + 1], points[i])));
  }
  return out;
}

function nextNonNull(arr, idx, dir) {
  let i = idx;
  while (i >= 0 && i < arr.length) {
    if (arr[i] != null) return arr[i];
    i += dir;
  }
  return null;
}

export function cumulativeLengths(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + len(sub(points[i], points[i - 1])));
  }
  return out;
}

export function polylineLength(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  return cumulativeLengths(points)[points.length - 1];
}

export function pointAtDistance(points, cum, d) {
  const n = points.length;
  if (n < 2) return null;
  const total = cum[n - 1];
  const clamped = Math.max(0, Math.min(d, total));
  for (let i = 0; i < n - 1; i++) {
    const segLen = cum[i + 1] - cum[i];
    if (clamped <= cum[i + 1] || i === n - 2) {
      const t = segLen < EPS ? 0 : (clamped - cum[i]) / segLen;
      return {
        x: points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        y: points[i][1] + (points[i + 1][1] - points[i][1]) * t,
        segmentIndex: i,
      };
    }
  }
  return null;
}

export function offsetPolylineLeft(points, distance) {
  if (!Array.isArray(points)) return [];
  const n = points.length;
  if (n < 2) return points.map((p) => [p[0], p[1]]);
  const tangents = segmentTangents(points);
  const normals = tangents.map((t) => (t ? leftNormal(t) : null));
  const out = [];
  for (let v = 0; v < n; v++) {
    const prevNormal = v > 0 ? nextNonNull(normals, v - 1, -1) : null;
    const nextNormalV = v < n - 1 ? nextNonNull(normals, v, 1) : null;
    let nx = 0;
    let ny = 0;
    if (prevNormal && nextNormalV) {
      const u = unit([prevNormal[0] + nextNormalV[0], prevNormal[1] + nextNormalV[1]]);
      [nx, ny] = u || prevNormal;
    } else if (prevNormal) {
      [nx, ny] = prevNormal;
    } else if (nextNormalV) {
      [nx, ny] = nextNormalV;
    }
    out.push([points[v][0] + nx * distance, points[v][1] + ny * distance]);
  }
  return out;
}

const MAX_ARROWS = 400;

export function arrowPositions(points, spacing) {
  if (!Array.isArray(points) || points.length < 2 || !(spacing > 0)) return [];
  const cum = cumulativeLengths(points);
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [];
  const tangents = segmentTangents(points);
  const positions = [];
  if (total <= spacing) {
    positions.push(total / 2);
  } else {
    for (let d = spacing / 2; d <= total; d += spacing) positions.push(d);
  }
  const result = [];
  for (const d of positions) {
    if (result.length >= MAX_ARROWS) break;
    const pt = pointAtDistance(points, cum, d);
    if (!pt) continue;
    const tangent = nextNonNull(tangents, pt.segmentIndex, 1) || nextNonNull(tangents, pt.segmentIndex, -1) || [1, 0];
    result.push({ x: pt.x, y: pt.y, angleDeg: (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI });
  }
  return result;
}

export function arrowPolygonPoints(x, y, angleDeg, arrowLen, arrowHalf) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const px = -dy;
  const py = dx;
  const backLen = arrowLen * 0.4;
  const tipX = x + dx * arrowLen;
  const tipY = y + dy * arrowLen;
  const backX = x - dx * backLen;
  const backY = y - dy * backLen;
  const c1x = backX + px * arrowHalf;
  const c1y = backY + py * arrowHalf;
  const c2x = backX - px * arrowHalf;
  const c2y = backY - py * arrowHalf;
  return `${tipX},${tipY} ${c1x},${c1y} ${c2x},${c2y}`;
}
