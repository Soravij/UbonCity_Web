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
