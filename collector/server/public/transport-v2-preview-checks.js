const VEHICLE = {
  songthaew: { th: "สองแถว", en: "Songthaew" },
  minibus: { th: "มินิบัส", en: "Minibus" },
  van: { th: "รถตู้", en: "Van" },
  bus: { th: "รถเมล์", en: "Bus" },
};

export function routeCardModel(route, lang) {
  const en = lang === "en";
  const outStops = (route.stops || []).filter((s) => s.leg !== "back").sort((a, b) => a.order - b.order);
  const first = outStops[0]?.name || "";
  const last = outStops.length > 1 ? outStops[outStops.length - 1].name : "";
  const v = VEHICLE[route.vehicle_type];
  return {
    title: `${en ? "Route" : "สาย"} ${route.number} · ${route.name}`,
    photo: route.photo_url || "",
    rows: [
      [en ? "Vehicle" : "ประเภทรถ", v ? v[en ? "en" : "th"] : String(route.vehicle_type || "")],
      [en ? "Fare" : "ค่าโดยสาร", route.fare_baht == null ? "" : `${route.fare_baht} ${en ? "THB" : "บาท"}`],
      [en ? "From – To" : "ต้นทาง – ปลายทาง", first && last ? `${first} – ${last}` : first],
      [en ? "Info" : "ข้อมูล", (en ? route.description_en || route.description : route.description) || ""],
    ].filter(([, value]) => value),
  };
}

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

function bbox(path) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of path) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

function pathsNear(a, b, tol) {
  const ba = bbox(a), bb = bbox(b);
  if (ba.x0 - tol > bb.x1 || bb.x0 - tol > ba.x1 || ba.y0 - tol > bb.y1 || bb.y0 - tol > ba.y1) return false;
  const t2 = tol * tol;
  for (const [px, py] of a) {
    for (let i = 1; i < b.length; i++) {
      if (segDist2(px, py, b[i - 1][0], b[i - 1][1], b[i][0], b[i][1]) <= t2) return true;
    }
  }
  return false;
}

export function colorClashes(bundle, tolMeters = 300) {
  const { bounds, viewbox } = bundle || {};
  if (!bounds || !viewbox) return [];
  const mPerUnit = ((bounds.max_lat - bounds.min_lat) * 111320) / viewbox.height;
  if (!(mPerUnit > 0)) return [];
  const tol = tolMeters / mPerUnit;
  const routes = (bundle.routes || []).filter((r) => Array.isArray(r.path) && r.path.length >= 2);
  const out = [];
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i], b = routes[j];
      if (String(a.color).toLowerCase() !== String(b.color).toLowerCase()) continue;
      if (pathsNear(a.path, b.path, tol)) out.push({ a: a.number, b: b.number, color: a.color });
    }
  }
  return out;
}
