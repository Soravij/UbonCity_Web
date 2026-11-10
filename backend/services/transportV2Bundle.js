const MAP_KEY_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FILE_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const LANGS = ["th", "en"];
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const rect = (o) => ["x", "y", "width", "height"].every((k) => finite(o?.[k]));

function texts(v) {
  if (!v || typeof v !== "object") return null;
  const out = {};
  for (const lang of LANGS) if (str(v[lang], 200)) out[lang] = v[lang].trim();
  return out.th ? out : null;
}

export function validateTransportBundle(input) {
  const errors = [];
  const b = input && typeof input === "object" ? input : {};
  if (b.schema_version !== 1) errors.push("schema_version must be 1");
  if (!MAP_KEY_RE.test(String(b.map_key || ""))) errors.push("map_key invalid");
  if (!str(b.title, 200)) errors.push("title required");
  if (!Number.isInteger(b.revision) || b.revision <= 0) errors.push("revision must be positive integer");
  if (!rect(b.viewbox) || b.viewbox.width <= 0 || b.viewbox.height <= 0) errors.push("viewbox invalid");
  if (!FILE_RE.test(String(b.base_svg || "")) || !String(b.base_svg).endsWith(".svg")) errors.push("base_svg invalid");
  const labels = Array.isArray(b.labels) ? b.labels : null;
  if (!labels) errors.push("labels must be array");
  (labels || []).forEach((l, i) => {
    if (!str(l?.key, 120) || !finite(l?.x) || !finite(l?.y) || !texts(l?.texts)) errors.push(`labels[${i}] invalid`);
  });
  const overlays = Array.isArray(b.overlays) ? b.overlays : null;
  if (!overlays) errors.push("overlays must be array");
  (overlays || []).forEach((o, i) => {
    if (!str(o?.id, 80) || !FILE_RE.test(String(o?.file || "")) || o.file === b.base_svg || !rect(o)) errors.push(`overlays[${i}] invalid`);
  });
  const routes = Array.isArray(b.routes) ? b.routes : null;
  if (!routes) errors.push("routes must be array");
  const ids = new Set();
  (routes || []).forEach((r, i) => {
    const okPath = Array.isArray(r?.path) && r.path.length >= 2
      && r.path.every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]));
    const okStops = Array.isArray(r?.stops) && r.stops.every((s) => str(s?.name, 200) && finite(s?.x) && finite(s?.y));
    if (!Number.isInteger(r?.id) || ids.has(r.id) || !str(r?.number, 40) || !str(r?.name, 200)
      || !COLOR_RE.test(String(r?.color || "")) || !str(r?.vehicle_type, 40) || !okPath || !okStops) {
      errors.push(`routes[${i}] invalid`);
    }
    if (Number.isInteger(r?.id)) ids.add(r.id);
  });
  return { ok: errors.length === 0, errors };
}

export function requiredBundleFiles(bundle) {
  return [bundle.base_svg, ...bundle.overlays.map((o) => o.file)];
}

export function attachBundleFileUrls(bundle, toUrl) {
  return {
    ...bundle,
    base_svg_url: toUrl(bundle.base_svg),
    overlays: bundle.overlays.map((o) => ({ ...o, url: toUrl(o.file) })),
  };
}
