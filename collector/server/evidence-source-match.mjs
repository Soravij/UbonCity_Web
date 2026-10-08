import { normalizeUrlForComparison } from "./evidence-candidates.mjs";

export function findSourceRecordForNormalized(sourceRecords, normalized) {
  const list = Array.isArray(sourceRecords) ? sourceRecords : [];
  const n = normalized && typeof normalized === "object" ? normalized : {};
  const placeId = String(n.google_place_id || "").trim();
  if (placeId) {
    const byPlace = list.find((r) => String(r?.source_entity_id || "").trim() === placeId);
    if (byPlace) return byPlace;
  }
  const url = String(n.source_url || "").trim();
  if (!url) return null;
  const exact = list.find((r) => String(r?.source_url || "").trim() === url);
  if (exact) return exact;
  const key = normalizeUrlForComparison(url);
  if (!key) return null;
  const loose = list.filter(
    (r) => normalizeUrlForComparison(r?.source_url) === key || normalizeUrlForComparison(r?.source_entity_id) === key
  );
  return loose.length === 1 ? loose[0] : null;
}
