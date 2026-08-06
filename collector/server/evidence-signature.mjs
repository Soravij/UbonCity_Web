export function makeEvidenceSignature(block = {}) {
  const listValue = Array.isArray(block.list_value)
    ? block.list_value.map((x) => String(x)).filter(Boolean)
    : [];
  return [
    String(block.block_type || "").trim().toLowerCase(),
    String(block.source_type || "").trim().toLowerCase(),
    String(block.source_url || "").trim(),
    String(block.text_value || "").trim(),
    block.numeric_value == null ? "" : String(block.numeric_value),
    JSON.stringify(listValue),
    String(block.source_record_id || "").trim(),
  ].join("|");
}
