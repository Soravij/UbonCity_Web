export function findLiveItemByGooglePlaceId(db, placeId) {
  const id = String(placeId || "").trim();
  if (!id) return null;
  return db
    .prepare("SELECT id, title FROM content_items WHERE google_place_id = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 1")
    .get(id) || null;
}
