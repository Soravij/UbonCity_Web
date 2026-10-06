import crypto from "node:crypto";
import { normalizeRawItem } from "../normalize.mjs";

export const JSON_PLACES_SCHEMA = "uboncity.places.v1";
const MAX_ROWS = 500;

function str(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function isUsableHttpUrl(value) {
  return /^https?:\/\//i.test(value) && !value.includes("/api/google-maps/photo");
}

export function extractJsonPlaceRows(payload) {
  let data = payload;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error("JSON ไม่ถูกต้อง: แปลงข้อความไม่ได้");
    }
  }
  if (data && !Array.isArray(data) && typeof data === "object") {
    if (data.schema && data.schema !== JSON_PLACES_SCHEMA) {
      throw new Error(`schema ไม่รองรับ: ${data.schema}`);
    }
    data = data.places;
  }
  if (!Array.isArray(data)) {
    throw new Error('JSON ต้องเป็น array ของสถานที่ หรือ { "places": [...] }');
  }
  if (data.length > MAX_ROWS) {
    throw new Error(`รายการเกิน ${MAX_ROWS} แถวต่อครั้ง`);
  }
  return data;
}

function normalizeSpace(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeKey({ name, address, lat, lng, placeId }) {
  if (placeId) return `pid:${placeId}`;
  if (lat != null && lng != null) return `geo:${normalizeSpace(name)}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
  return `addr:${normalizeSpace(name)}|${normalizeSpace(address)}`;
}

export async function collectFromJsonPayload(payload = []) {
  const rows = extractJsonPlaceRows(payload);
  const seen = new Set();
  const out = [];
  const stats = { rows: rows.length, kept: 0, no_name: 0, duplicate: 0, coords_dropped: 0 };

  for (const input of rows) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      stats.no_name += 1;
      continue;
    }
    const name = str(input.name ?? input.title, 300);
    if (!name) {
      stats.no_name += 1;
      continue;
    }

    let lat = num(input.latitude ?? input.lat);
    let lng = num(input.longitude ?? input.lng);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      if (lat != null || lng != null) stats.coords_dropped += 1;
      lat = null;
      lng = null;
    }

    const address = str(input.address, 500);
    const phone = str(input.phone, 50);
    const placeId = str(input.google_place_id, 200);
    const website = str(input.website_url ?? input.website, 1000);
    const category = str(input.category, 100);
    const description = str(input.description, 4000);
    const foundAtInput = Array.isArray(input.found_at) ? input.found_at : [input.found_at ?? input.source_url];
    const foundAt = foundAtInput.map((u) => str(u, 1000)).filter(isUsableHttpUrl).slice(0, 10);
    const tags = (Array.isArray(input.tags) ? input.tags : []).map((t) => str(t, 50)).filter(Boolean).slice(0, 10);
    const confidenceRaw = str(input.confidence, 10).toLowerCase();
    const confidence = ["high", "medium", "low"].includes(confidenceRaw) ? confidenceRaw : null;

    const key = dedupeKey({ name, address, lat, lng, placeId });
    if (seen.has(key)) {
      stats.duplicate += 1;
      continue;
    }
    seen.add(key);

    const ref = placeId || `json-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
    const mapsQuery = `${name} ${address}`.trim();
    const sourceUrl =
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` +
      (placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : "");

    out.push(
      normalizeRawItem(
        {
          id: ref,
          source_ref: ref,
          source_url: sourceUrl,
          website_url: website,
          name,
          title: name,
          description: description || address,
          address,
          lat,
          lng,
          google_place_id: placeId,
          type: "place",
          lang: "th",
          ...(category ? { category } : {}),
          national_phone_number: phone,
          source_name: "json-import",
          tags,
          media: [],
          payload_json: {
            input_schema: JSON_PLACES_SCHEMA,
            found_at: foundAt,
            confidence,
            notes: str(input.notes, 2000) || null,
            extracted_metadata: {
              title: name,
              description: description || null,
              address: address || null,
              phone: phone || null,
              national_phone_number: phone || null,
              latitude: lat,
              longitude: lng,
              google_place_id: placeId || null,
              website_url: website || null,
              source_name: "json-import",
              types: tags,
            },
          },
        },
        "json"
      )
    );
  }

  stats.kept = out.length;
  console.info("[json-adapter]", JSON.stringify(stats));
  if (!out.length) {
    throw new Error(`ไม่มีรายการที่ใช้ได้ (ไม่มีชื่อ ${stats.no_name}, ซ้ำ ${stats.duplicate})`);
  }
  return out;
}
