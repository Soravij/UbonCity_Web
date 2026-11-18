export function bearingOf(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const p1 = r(a.lat), p2 = r(b.lat), dl = r(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.round((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
export function haversineM(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}
export function buildBearings(points, range = 60) {
  if (!Array.isArray(points) || points.length < 2) return "";
  return points.map((p, i) => {
    const last = i === points.length - 1;
    const a = last ? points[i - 1] : p, b = last ? p : points[i + 1];
    return haversineM(a, b) < 1 ? "" : `${bearingOf(a, b)},${range}`;
  }).join(";");
}
export function buildLegBearings(points) {
  const segs = [];
  let start = 0;
  for (let i = 1; i <= points.length; i += 1) {
    if (i === points.length || (points[i].leg || null) !== (points[start].leg || null)) {
      segs.push({ start, end: i, str: buildBearings(points.slice(start, i)) });
      start = i;
    }
  }
  const joined = segs.map((s) => s.str).join(";");
  const parts = joined.split(";");
  if (parts.length !== points.length) return buildBearings(points);
  for (let k = 1; k < segs.length; k += 1) {
    parts[segs[k - 1].end - 1] = "";
    parts[segs[k].start] = "";
  }
  return parts.join(";");
}
export function detourWarnings(legs, waypoints, { ratio = 2.5, minExtraM = 50 } = {}) {
  // legs = OSRM routes[0].legs, waypoints = OSRM waypoints (location = [lng, lat])
  const out = [];
  if (!Array.isArray(legs) || !Array.isArray(waypoints)) return out;
  legs.forEach((leg, i) => {
    const a = waypoints[i]?.location, b = waypoints[i + 1]?.location;
    if (!a || !b || typeof leg?.distance !== "number") return;
    const straight = haversineM({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] });
    const extra = leg.distance - straight;
    if (straight > 0 && leg.distance > straight * ratio && extra > minExtraM) {
      out.push({ from: i, to: i + 1, ratio: Math.round((leg.distance / straight) * 10) / 10, extra_m: Math.round(extra) });
    }
  });
  return out;
}
export function hasBearings(bearings) {
  return typeof bearings === "string" && bearings.split(";").some(Boolean);
}
export async function fetchRouteWithFallback(urlBase, bearings, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const attempt = async (url) => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    let body = null, parseError = false;
    try { body = await res.json(); } catch { parseError = true; }
    return { res, body, parseError, ok: Boolean(res.ok && body && body.code === "Ok") };
  };
  if (hasBearings(bearings)) {
    try {
      const r = await attempt(`${urlBase}&bearings=${bearings}`);
      if (r.ok) return { ...r, bearingsUsed: true };
    } catch { /* timeout/network → fallback */ }
  }
  const r = await attempt(urlBase);   // throw ได้ → error path เดิมของ router
  return { ...r, bearingsUsed: false };
}

function spurDistM(a, b) {
  const toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR;
  const dLng = (b[0] - a[0]) * toR * Math.cos(((a[1] + b[1]) / 2) * toR);
  return 6371000 * Math.hypot(dLng, dLat);
}

export function findSpurWaypoints(coords, waypoints, legs, { maxGapM = 10, minOutM = 8, maxOutM = 300, skip = null } = {}) {
  const fixes = [];
  if (!Array.isArray(coords) || coords.length < 3 || !Array.isArray(waypoints) || waypoints.length < 3) return fixes;
  const at = [];
  let from = 0;
  for (let k = 0; k < waypoints.length; k += 1) {
    const loc = waypoints[k]?.location;
    const limit = k === 0 ? 50 : Number(legs?.[k - 1]?.distance || 0) + 50;
    let best = from;
    let bestD = Infinity;
    let run = 0;
    for (let i = from; i < coords.length && Array.isArray(loc); i += 1) {
      if (i > from) run += spurDistM(coords[i - 1], coords[i]);
      if (run > limit) break;
      const d = spurDistM(coords[i], loc);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    at.push(best);
    from = best;
  }
  for (let k = 1; k < waypoints.length - 1; k += 1) {
    if (skip?.has(k)) continue;
    const name = waypoints[k]?.name || "";
    if (!name || name === (waypoints[k - 1]?.name || "") || name === (waypoints[k + 1]?.name || "")) continue;
    const w = at[k];
    let a = w;
    let b = w;
    while (a > 0 && b < coords.length - 1 && spurDistM(coords[a - 1], coords[b + 1]) <= maxGapM) {
      a -= 1;
      b += 1;
    }
    const out = spurDistM(coords[a], coords[w]);
    if (out >= minOutM && out <= maxOutM) fixes.push({ index: k, lng: coords[a][0], lat: coords[a][1] });
  }
  return fixes;
}
