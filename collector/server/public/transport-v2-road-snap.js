// Road snap for the path editor: index the base-map road strokes and find the nearest point on them.
export const SNAP_ROAD_GROUPS = ["roads-motorway", "roads-primary", "roads-secondary", "roads-tertiary", "roads-local"];

export function parsePathD(d) {
  const tokens = String(d || "").match(/[MmLlHhVvZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const lines = [];
  let cur = null, cmd = "", x = 0, y = 0, sx = 0, sy = 0, i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t; i += 1;
      if (cmd === "Z" || cmd === "z") { if (cur) cur.push([sx, sy]); x = sx; y = sy; cur = null; }
      continue;
    }
    if (cmd === "M" || cmd === "m") {
      const nx = num(), ny = num();
      x = cmd === "m" ? x + nx : nx; y = cmd === "m" ? y + ny : ny;
      sx = x; sy = y; cur = [[x, y]]; lines.push(cur);
      cmd = cmd === "m" ? "l" : "L";
    } else if (cmd === "L" || cmd === "l") {
      const nx = num(), ny = num();
      x = cmd === "l" ? x + nx : nx; y = cmd === "l" ? y + ny : ny;
      cur?.push([x, y]);
    } else if (cmd === "H" || cmd === "h") {
      const n = num(); x = cmd === "h" ? x + n : n; cur?.push([x, y]);
    } else if (cmd === "V" || cmd === "v") {
      const n = num(); y = cmd === "v" ? y + n : n; cur?.push([x, y]);
    } else {
      i += 1;
    }
  }
  return lines.filter((l) => l.length >= 2);
}

export function buildRoadIndex(lines, cellUnits) {
  const segs = [];
  const cells = new Map();
  for (const pts of lines) {
    for (let k = 1; k < pts.length; k += 1) {
      const [ax, ay] = pts[k - 1];
      const [bx, by] = pts[k];
      const id = segs.length;
      segs.push([ax, ay, bx, by]);
      const x0 = Math.floor(Math.min(ax, bx) / cellUnits), x1 = Math.floor(Math.max(ax, bx) / cellUnits);
      const y0 = Math.floor(Math.min(ay, by) / cellUnits), y1 = Math.floor(Math.max(ay, by) / cellUnits);
      for (let cx = x0; cx <= x1; cx += 1) {
        for (let cy = y0; cy <= y1; cy += 1) {
          const key = `${cx},${cy}`;
          let list = cells.get(key);
          if (!list) cells.set(key, (list = []));
          list.push(id);
        }
      }
    }
  }
  return { segs, cells, cellUnits };
}

export function nearestOnRoads(index, x, y, maxDist) {
  if (!index || !(maxDist > 0)) return null;
  const c = index.cellUnits;
  const r = Math.ceil(maxDist / c);
  const cx = Math.floor(x / c), cy = Math.floor(y / c);
  const seen = new Set();
  let best = null, bestD = maxDist;
  for (let i = cx - r; i <= cx + r; i += 1) {
    for (let j = cy - r; j <= cy + r; j += 1) {
      for (const id of index.cells.get(`${i},${j}`) || []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const [ax, ay, bx, by] = index.segs[id];
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        const px = ax + t * dx, py = ay + t * dy;
        const d = Math.hypot(x - px, y - py);
        if (d <= bestD) { bestD = d; best = { x: px, y: py, dist: d }; }
      }
    }
  }
  return best;
}
