const INSERT_SQL = `INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
  VALUES (@content_item_id, @source_type, @source_name, @source_url, @source_entity_id, @payload_json)`;
const UPDATE_SQL = `UPDATE source_records
  SET source_type=@source_type, source_name=@source_name, source_entity_id=@source_entity_id,
      payload_json=@payload_json, updated_at=CURRENT_TIMESTAMP
  WHERE id=@id`;

export function upsertSourceRecordForItem(db, p) {
  const insertParams = {
    content_item_id: p.content_item_id, source_type: p.source_type, source_name: p.source_name,
    source_url: p.source_url, source_entity_id: p.source_entity_id, payload_json: p.payload_json,
  };
  if (!p.source_url) {
    db.prepare(INSERT_SQL).run(insertParams);
    return { status: "inserted" };
  }
  const existing = db.prepare("SELECT id, content_item_id FROM source_records WHERE source_url=? LIMIT 1").get(p.source_url);
  if (!existing) {
    db.prepare(INSERT_SQL).run(insertParams);
    return { status: "inserted" };
  }
  if (Number(existing.content_item_id) !== Number(p.content_item_id)) {
    console.warn(`[source_records] skip: source_url owned by item ${existing.content_item_id}; not moving to item ${p.content_item_id}`);
    return { status: "skipped_owned_by_other", owner_item_id: Number(existing.content_item_id), source_record_id: Number(existing.id) };
  }
  db.prepare(UPDATE_SQL).run({
    id: existing.id, source_type: p.source_type, source_name: p.source_name,
    source_entity_id: p.source_entity_id, payload_json: p.payload_json,
  });
  return { status: "updated", source_record_id: Number(existing.id) };
}
