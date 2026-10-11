export const SINGLETON_EVIDENCE_FIELDS = new Set([
  "classification", "location", "opening_hours_weekday_text", "user_rating_count",
]);

export function evidenceFieldOf(payload) {
  let p = payload;
  if (typeof p === "string") { try { p = JSON.parse(p); } catch { p = null; } }
  return p && typeof p === "object" ? String(p.field || "") : "";
}

// 1 block ต่อ (record, block_type, field) สำหรับ field ที่ list/ตัวเลขเปลี่ยนได้ตามเส้นทาง normalize
export function singletonEvidenceKey(block = {}, payload) {
  const field = evidenceFieldOf(payload);
  if (!SINGLETON_EVIDENCE_FIELDS.has(field)) return "";
  const parts = [
    String(block.block_type || "").trim().toLowerCase(),
    String(block.source_record_type || "").trim(),
    String(block.source_record_id || "").trim(),
    field,
  ];
  // location: text คือที่อยู่หรือ "Location link available" แยกตามข้อความ เพื่อไม่ให้ block ลิงก์ไปบังที่อยู่ที่เพิ่งได้มา
  if (field === "location") parts.push(String(block.text_value || "").trim());
  return parts.join("|");
}
