const LANGS = ["th", "en"];
const round1 = (v) => Math.round(Number(v) * 10) / 10;
const extOf = (p) => { const m = /\.([a-z0-9]{2,5})$/i.exec(String(p || "")); return m ? `.${m[1].toLowerCase()}` : ""; };

export function publishMapKey(baseMap) {
  const key = String(baseMap?.map_key || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return key.length >= 2 ? key : `base-map-${Number(baseMap?.id || 0)}`;
}

export function projectToViewbox(lat, lng, bounds, viewbox) {
  const lngSpan = bounds.max_lng - bounds.min_lng || 1;
  const latSpan = bounds.max_lat - bounds.min_lat || 1;
  return [
    round1(viewbox.x + ((lng - bounds.min_lng) / lngSpan) * viewbox.width),
    round1(viewbox.y + (1 - (lat - bounds.min_lat) / latSpan) * viewbox.height),
  ];
}

function pickTexts(texts) {
  const out = {};
  for (const lang of LANGS) {
    const value = String(texts?.[lang] || "").trim();
    if (value) out[lang] = value;
  }
  return out;
}

const validLatLng = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

export function buildTransportBundle({ baseMap, baseSvgStoragePath, labelLayer, overlayLayers, routes, revision }) {
  const problems = [];
  const skipped = [];
  const files = [];
  const { bounds, viewbox } = baseMap;
  if (!baseSvgStoragePath) problems.push("base map has no SVG asset");
  else files.push({ name: "base.svg", storagePath: baseSvgStoragePath });

  const labels = [];
  for (const item of labelLayer?.items || []) {
    const texts = pickTexts(item.texts);
    if (!texts.th || String(item.label_key || "").length > 120 || Object.values(texts).some((t) => t.length > 200)) continue;
    labels.push({
      key: item.label_key,
      category: item.label_category,
      x: round1(item.anchor_x),
      y: round1(item.anchor_y),
      priority: Number(item.priority || 0),
      min_zoom: item.min_zoom_hint == null ? null : Number(item.min_zoom_hint),
      texts,
      offsets: item.locale_offsets?.en ? { en: item.locale_offsets.en } : {},
      style: { size: item.style?.size_preset || "m", color: item.style?.text_color || "#243041" },
    });
  }

  const overlays = [];
  for (const o of overlayLayers || []) {
    if (!o.storagePath) { problems.push(`overlay ${o.overlay_id} has no file`); continue; }
    const file = `overlay-${overlays.length + 1}${extOf(o.storagePath)}`;
    files.push({ name: file, storagePath: o.storagePath });
    overlays.push({
      id: String(o.overlay_id), file,
      x: round1(o.anchor_x), y: round1(o.anchor_y), width: round1(o.width), height: round1(o.height),
      scale_with_zoom: o.scale_with_zoom !== false,
    });
  }

  const outRoutes = [];
  for (const r of routes || []) {
    const ref = { id: r.id, number: r.route_number };
    const number = String(r.route_number || "").trim();
    const name = String(r.route_name || "").trim();
    if (!number || number.length > 40 || !name || name.length > 200) { skipped.push({ ...ref, reason: "invalid number or name" }); continue; }
    if (r.routing_status !== "fresh") { skipped.push({ ...ref, reason: `routing_status=${r.routing_status}` }); continue; }
    const path = (r.resolved_path || []).filter(validLatLng).map((p) => projectToViewbox(p.lat, p.lng, bounds, viewbox));
    if (path.length < 2) { skipped.push({ ...ref, reason: "no resolved path" }); continue; }
    outRoutes.push({
      id: r.id,
      number,
      name,
      vehicle_type: r.vehicle_type,
      color: r.color,
      description: String(r.description || ""),
      distance_km: Number(r.resolved_distance_km || 0),
      path,
      stops: (r.stops || []).filter((s) => validLatLng(s) && String(s?.name || "").trim() && String(s.name).trim().length <= 200).map((s) => {
        const [x, y] = projectToViewbox(s.lat, s.lng, bounds, viewbox);
        return { order: s.order, name: String(s.name).trim(), type: s.stop_type || "stop", x, y, ...(s.leg ? { leg: s.leg } : {}) };
      }),
    });
  }
  if (!outRoutes.length) problems.push("no route ready to publish");

  return {
    bundle: {
      schema_version: 1,
      map_key: publishMapKey(baseMap),
      title: String(baseMap.title || baseMap.map_key || "Transport map"),
      revision,
      bounds,
      viewbox,
      base_svg: "base.svg",
      labels,
      overlays,
      routes: outRoutes,
    },
    files,
    skipped,
    problems,
  };
}
