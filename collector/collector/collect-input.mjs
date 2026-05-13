import fs from "fs/promises";
import path from "path";

function toStr(value) {
  return String(value ?? "").trim();
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTags(value) {
  if (Array.isArray(value)) return value.map((v) => toStr(v)).filter(Boolean);
  if (!toStr(value)) return [];
  return toStr(value)
    .split("|")
    .map((v) => toStr(v))
    .filter(Boolean);
}

export async function collectInput(baseDir, rawDir) {
  const dir = rawDir || path.join(baseDir, "raw");
  const rawPath = path.join(dir, "input.json");
  await fs.access(rawPath);

  const text = await fs.readFile(rawPath, "utf8");
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  const rows = Array.isArray(parsed) ? parsed : [];

  return rows.map((raw, index) => ({
    row_no: index + 1,
    type: toStr(raw.type).toLowerCase(),
    category: toStr(raw.category).toLowerCase(),
    title: toStr(raw.title),
    description: toStr(raw.description),
    image: toStr(raw.image),
    latitude: toNum(raw.latitude),
    longitude: toNum(raw.longitude),
    google_place_id: toStr(raw.google_place_id),
    map_url: toStr(raw.map_url),
    source_name: toStr(raw.source_name),
    source_url: toStr(raw.source_url),
    tags: toTags(raw.tags),
    lang: toStr(raw.lang).toLowerCase() || "th",
  }));
}
