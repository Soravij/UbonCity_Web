export const ROUTE_PALETTE = ["#1d4ed8", "#c2410c", "#047857", "#b91c1c", "#6d28d9", "#be185d", "#0e7490", "#a16207", "#4d7c0f", "#334155"];

export function pickLeastUsed(usedColors, pool = ROUTE_PALETTE) {
  const counts = new Map(pool.map((c) => [c, 0]));
  for (const c of usedColors || []) {
    const k = String(c || "").toLowerCase();
    if (counts.has(k)) counts.set(k, counts.get(k) + 1);
  }
  let best = pool[0];
  let bestCount = Infinity;
  for (const c of pool) {
    if (counts.get(c) < bestCount) { bestCount = counts.get(c); best = c; }
  }
  return best;
}

function metersBetween(a, b) {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR;
  const dLng = (b.lng - a.lng) * toR * Math.cos(((a.lat + b.lat) / 2) * toR);
  return R * Math.hypot(dLng, dLat);
}

function sample(path, max = 200) {
  if (path.length <= max) return path;
  const step = Math.ceil(path.length / max);
  return path.filter((_, i) => i % step === 0);
}

export function pathsNear(a, b, nearM = 300) {
  const sa = sample(a);
  const sb = sample(b);
  for (const p of sa) for (const q of sb) if (metersBetween(p, q) <= nearM) return true;
  return false;
}

export function pickForPath(path, others, nearM = 300) {
  const conflicts = new Map(ROUTE_PALETTE.map((c) => [c, 0]));
  for (const o of others || []) {
    const c = String(o?.color || "").toLowerCase();
    if (!conflicts.has(c) || !Array.isArray(o.path) || o.path.length < 2) continue;
    if (pathsNear(path, o.path, nearM)) conflicts.set(c, conflicts.get(c) + 1);
  }
  const minConflict = Math.min(...conflicts.values());
  const pool = ROUTE_PALETTE.filter((c) => conflicts.get(c) === minConflict);
  return pickLeastUsed((others || []).map((o) => o?.color), pool);
}
