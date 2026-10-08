const PLACE_RE = /places%2F([^%&]+)%2Fphotos/i;
const WINDOW_MS = 5000;

function toMs(ts) {
  const s = String(ts || "").trim();
  if (!s) return NaN;
  return Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
}

export function extractPhotoPlaceId(textValue) {
  const m = PLACE_RE.exec(String(textValue || ""));
  return m ? m[1] : "";
}

export function planGooglePhotoPrune(rows, ownPlaceIds) {
  const own = new Set([...ownPlaceIds].map((s) => String(s || "").trim()).filter(Boolean));
  if (!own.size) return [];
  const byPlace = new Map();
  const deleteIds = [];
  for (const r of rows) {
    const place = extractPhotoPlaceId(r.text_value);
    if (!place) continue;
    if (!own.has(place)) {
      if (!r.protected) deleteIds.push(Number(r.id));
      continue;
    }
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(r);
  }
  for (const list of byPlace.values()) {
    const times = list.map((r) => toMs(r.created_at)).filter(Number.isFinite);
    if (!times.length) continue;
    const latest = Math.max(...times);
    for (const r of list) {
      const t = toMs(r.created_at);
      if (Number.isFinite(t) && latest - t > WINDOW_MS && !r.protected) deleteIds.push(Number(r.id));
    }
  }
  return deleteIds;
}

export function pruneGooglePhotoEvidence(db, contentItemId) {
  const id = Number(contentItemId || 0);
  if (!id) return { deleted: 0 };
  const own = new Set();
  const item = db.prepare("SELECT google_place_id FROM content_items WHERE id = ?").get(id);
  if (item?.google_place_id) own.add(String(item.google_place_id).trim());
  for (const r of db.prepare("SELECT source_entity_id FROM source_records WHERE content_item_id = ?").all(id)) {
    if (r.source_entity_id) own.add(String(r.source_entity_id).trim());
  }
  if (!own.size) return { deleted: 0 };
  const rows = db.prepare(`
    SELECT e.id, e.text_value, e.created_at,
      EXISTS (SELECT 1 FROM approved_context_blocks a WHERE a.evidence_block_id = e.id) AS protected
    FROM evidence_blocks e
    WHERE e.content_item_id = ? AND e.block_type = 'media' AND e.text_value LIKE '%places%2F%'
  `).all(id);
  const ids = planGooglePhotoPrune(rows.map((r) => ({ ...r, protected: Number(r.protected) === 1 })), own);
  if (!ids.length) return { deleted: 0 };
  const del = db.prepare("DELETE FROM evidence_blocks WHERE id = ?");
  let deleted = 0;
  for (const eid of ids) deleted += Number(del.run(eid).changes || 0);
  return { deleted };
}
