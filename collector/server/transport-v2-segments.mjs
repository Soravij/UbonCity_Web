function distPointSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}
export function distPointPolyline(p, line) {
  if (line.length === 1) return Math.hypot(p[0] - line[0][0], p[1] - line[0][1]);
  let m = Infinity;
  for (let i = 1; i < line.length; i++) { const d = distPointSeg(p, line[i - 1], line[i]); if (d < m) m = d; }
  return m;
}
function nearestOnPolyline(p, line) {
  if (line.length === 1) return [line[0][0], line[0][1]];
  let best = [line[0][0], line[0][1]], m = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < m) { m = d; best = q; }
  }
  return best;
}
function runs(pts, flags) {
  const out = []; let s = 0;
  for (let i = 1; i <= pts.length; i++) {
    if (i === pts.length || flags[i] !== flags[s]) {
      const path = pts.slice(s, Math.min(i + 1, pts.length));
      let len = 0;
      for (let k = 1; k < path.length; k++) len += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
      out.push({ shared: flags[s], from: s, to: i - 1, path, len });
      s = i;
    }
  }
  return out;
}
function smooth(pts, flags, minRun) {
  const f = flags.slice();
  const rs = runs(pts, f);
  if (rs.length < 2 || !rs.some(r => r.len >= minRun)) return f;
  for (const r of rs) if (r.len < minRun) for (let i = r.from; i <= r.to; i++) f[i] = !r.shared;
  return f;
}
export function buildLegSegments(outPts, backPts, tol, minRun) {
  if (outPts.length < 2) return [];
  if (backPts.length < 2) return [{ leg: "out", path: outPts }];
  const oF = smooth(outPts, outPts.map((p) => distPointPolyline(p, backPts) <= tol), minRun);
  const bF = smooth(backPts, backPts.map((p) => distPointPolyline(p, outPts) <= tol), minRun);
  const segs = runs(outPts, oF).map((r) => ({ leg: r.shared ? "both" : "out", path: r.path }));
  // back runs: pin both ends onto the out line so they meet the shared band
  for (const r of runs(backPts, bF)) {
    if (r.shared) continue;
    const path = r.path.slice();
    if (r.from > 0) path.unshift(nearestOnPolyline(backPts[r.from - 1], outPts));
    if (r.to + 1 < backPts.length) path[path.length - 1] = nearestOnPolyline(backPts[r.to + 1], outPts);
    segs.push({ leg: "back", path });
  }
  return segs;
}
