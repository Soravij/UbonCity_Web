// R4 — pure helpers for out/back leg editing (no DOM)
export function normalizeLegPoints(points, kind) {
  if (kind !== "out_back") return points.map(({ leg, ...p }) => p);
  const out = [];
  const back = [];
  for (const p of points) (p.leg === "back" ? back : out).push({ ...p, leg: p.leg === "back" ? "back" : "out" });
  return [...out, ...back];
}

export function legRange(points, kind, leg) {
  if (kind !== "out_back") return { start: 0, end: points.length };
  let outEnd = 0;
  while (outEnd < points.length && points[outEnd].leg !== "back") outEnd += 1;
  return leg === "back" ? { start: outEnd, end: points.length } : { start: 0, end: outEnd };
}

export function nearestIndex(pathPts, p, from = 0) {
  let best = from;
  let bestDist = Infinity;
  for (let i = from; i < pathPts.length; i += 1) {
    const d = Math.hypot(pathPts[i][0] - p[0], pathPts[i][1] - p[1]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function splitPathAtTurn(pathXY, turnXY) {
  if (!turnXY || pathXY.length < 2) return { out: pathXY, back: [] };
  const cut = nearestIndex(pathXY, turnXY, 0);
  return { out: pathXY.slice(0, cut + 1), back: pathXY.slice(cut) };
}

export function buildBackFromOut(points) {
  const out = points.filter((p) => p.leg !== "back");
  return out.slice(0, -1).reverse().map((p) => ({ lat: p.lat, lng: p.lng, leg: "back" }));
}

export function activeStopIndexes(stops, kind, leg) {
  const idx = [];
  stops.forEach((s, i) => {
    if (kind !== "out_back" || !s.leg || s.leg === leg) idx.push(i);
  });
  return idx;
}
