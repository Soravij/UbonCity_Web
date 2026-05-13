function parseJson(value, fallback = []) {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeApprovedBlock(row) {
  return {
    id: row.id,
    evidence_block_id: row.evidence_block_id,
    context_type: row.context_type,
    selected_text: row.selected_text || null,
    selected_numeric: row.selected_numeric ?? null,
    selected_list: Array.isArray(row.selected_list_json) ? row.selected_list_json : parseJson(row.selected_list_json, []),
    note: row.note || null,
    editor_note: row.editor_note || null,
    sort_order: Number(row.sort_order || 0),
    confidence: row.confidence ?? null,
    status: row.status || "active",
    provenance: {
      evidence_block_type: row.evidence_block_type || null,
      evidence_source_type: row.evidence_source_type || null,
      evidence_source_url: row.evidence_source_url || null,
      evidence_source_label: row.evidence_source_label || null,
      evidence_source_record_type: row.evidence_source_record_type || null,
      evidence_source_record_id: row.evidence_source_record_id || null,
      evidence_lang: row.evidence_lang || null,
    },
  };
}

function normalizeEvidenceBlock(row) {
  return {
    id: Number(row.id || 0) || null,
    block_type: row.block_type || null,
    source_type: row.source_type || null,
    source_url: row.source_url || null,
    source_label: row.source_label || null,
    lang: row.lang || null,
    attribution_text: row.attribution_text || null,
    text_value: row.text_value || null,
    numeric_value: row.numeric_value ?? null,
    list_value: Array.isArray(row.list_value_json) ? row.list_value_json : parseJson(row.list_value_json, []),
    status: row.status || "active",
  };
}

function hasTraceableReference(item) {
  return Boolean(
    String(item?.source_url || "").trim()
    || String(item?.map_url || "").trim()
    || String(item?.google_place_id || "").trim()
    || ((item?.latitude != null && item?.latitude !== "") && (item?.longitude != null && item?.longitude !== ""))
  );
}

function hasApprovedContextContent(block) {
  const list = Array.isArray(block?.selected_list) ? block.selected_list : [];
  return Boolean(String(block?.selected_text || "").trim()) || block?.selected_numeric != null || list.length > 0;
}

function computeCompleteness(item, approvedBlocks, imageContext) {
  const hasTitle = Boolean(String(item?.title || "").trim());
  const hasReference = hasTraceableReference(item);
  const hasApprovedContext = approvedBlocks.some((row) => hasApprovedContextContent(row));
  const hasImageContext = Array.isArray(imageContext?.selected_urls) && imageContext.selected_urls.length > 0;
  const editorNoteCount = approvedBlocks.filter((row) => String(row?.editor_note || "").trim()).length;

  const minimumMissing = [];
  if (!hasTitle) minimumMissing.push("item_title");
  if (!hasReference) minimumMissing.push("place_reference");
  if (!hasApprovedContext) minimumMissing.push("approved_context");

  const blockingReasons = [];
  if (!hasTitle) blockingReasons.push("ยังส่งเข้า Agent ไม่ได้: กรุณาระบุชื่อสถานที่");
  if (!hasReference) blockingReasons.push("ยังส่งเข้า Agent ไม่ได้: ต้องมีลิงก์อ้างอิง แผนที่ พิกัด หรือ source อย่างน้อย 1 รายการ");
  if (!hasApprovedContext) blockingReasons.push("ยังส่งเข้า Agent ไม่ได้: ต้องมีข้อมูลที่คัดไว้ใน Clean อย่างน้อย 1 รายการ");

  const qualityGaps = [];
  if (!hasImageContext) qualityGaps.push("image_context");
  if (editorNoteCount < 1) qualityGaps.push("editor_note_richness");
  if (approvedBlocks.length < 3) qualityGaps.push("context_depth");

  const missingSections = [...minimumMissing, ...qualityGaps];

  let completenessLevel = "minimal";
  if (hasTitle && hasReference && hasApprovedContext) {
    completenessLevel = "thin";
    if (approvedBlocks.length >= 2 && hasImageContext) completenessLevel = "partial";
    if (approvedBlocks.length >= 4 && hasImageContext && editorNoteCount >= 1) completenessLevel = "full";
  }

  return {
    has_minimum_required: minimumMissing.length === 0,
    completeness_level: completenessLevel,
    minimum_missing: minimumMissing,
    quality_gaps: qualityGaps,
    missing_sections: missingSections,
    blocking_reasons: blockingReasons,
  };
}

export function buildCleanStructuredContext(repo, contentItemId, options = {}) {
  const item = repo.getItem(contentItemId);
  if (!item) return null;

  const evidenceLimit = Math.max(1, Math.min(200, Number(options.evidenceLimit || 200) || 200));
  const approvedBlocks = repo
    .listApprovedContextBlocks(contentItemId, { onlyActive: true })
    .map((row) => normalizeApprovedBlock(row));

  const evidenceBlocks = repo
    .listEvidenceBlocks(contentItemId)
    .filter((row) => String(row?.status || "").trim().toLowerCase() === "active")
    .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))
    .slice(0, evidenceLimit)
    .map((row) => normalizeEvidenceBlock(row));

  const selectedAssets = repo.listContentAssetsByItem(contentItemId, { onlySelected: true });
  const imageContext = repo.listApprovedImageContext(contentItemId);
  const completeness = computeCompleteness(item, approvedBlocks, imageContext);

  return {
    context_version: "v1",
    content_item_id: contentItemId,
    source: "clean_structured_context",
    item: {
      id: Number(item.id || 0) || null,
      title: item.title || "",
      type: item.type || "place",
      category: item.category || "",
      lang: item.lang || "th",
      slug: item.slug || "",
      description_clean: item.description_clean || "",
      tags: Array.isArray(item.tags) ? item.tags : [],
      source_name: item.source_name || "",
      source_url: item.source_url || "",
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      map_url: item.map_url || "",
      google_place_id: item.google_place_id || "",
    },
    approved_context: approvedBlocks,
    evidence_blocks: evidenceBlocks,
    image_context: {
      cover_url: imageContext?.cover_url || null,
      selected_urls: Array.isArray(imageContext?.selected_urls) ? imageContext.selected_urls : [],
      gallery_urls: Array.isArray(imageContext?.gallery_urls) ? imageContext.gallery_urls : [],
      inline_urls: Array.isArray(imageContext?.inline_urls) ? imageContext.inline_urls : [],
      selected_count: Array.isArray(imageContext?.selected_urls) ? imageContext.selected_urls.length : 0,
      cover_count: imageContext?.cover_url ? 1 : 0,
      assets: selectedAssets.map((row) => ({
        asset_id: Number(row.asset_id || 0) || null,
        role: row.role || "gallery",
        selected_in_clean: Number(row.selected_in_clean || 0),
        is_cover: Number(row.is_cover || 0),
        public_url: row.public_url || "",
      })),
    },
    completeness,
    evidence_policy: {
      primary_source: "approved_context",
      secondary_sources: ["item", "image_context"],
      supporting_sources: ["evidence_blocks"],
      external_links_policy: "reference_only",
    },
    task: {
      mode: "agent_generation_from_clean",
      output_contract: "existing",
      must_ground_in_approved_context: true,
      may_use_evidence_blocks_as_supporting_context: true,
      must_flag_uncertainty_when_context_is_thin: true,
      thin_context_behavior: "prefer_angles_questions_fieldwork_over_assertive_summary",
      instructions: [
        "ใช้ approved_context เป็นฐานหลักของการคิด",
        "ใช้ item เพื่อยืนยันตัวตนและข้อมูลตั้งต้นของสถานที่",
        "ใช้ image_context เป็นหลักฐานสนับสนุนเชิงภาพเท่าที่เห็นจริง",
        "ใช้ evidence_blocks เพื่อหา clue เพิ่มเท่านั้น ไม่ใช้ override approved_context",
        "ถ้าข้อมูลยังบาง ให้เสนอ possible angles, open questions, fieldwork suggestions, และ editor handoff",
        "ห้ามสรุปเกินข้อมูลที่มี",
        "หากใช้ลิงก์ต้นทาง ให้ใช้เพื่ออ้างอิงหรือหา lead เพิ่ม ไม่ใช้แทน curated context",
        "ให้เติม output contract เดิม โดยคิดแบบ editor/creator ก่อนกรอก",
      ],
    },
  };
}

export function validateCleanMinimum(repo, contentItemId) {
  const context = buildCleanStructuredContext(repo, contentItemId);
  if (!context) {
    return {
      ok: false,
      blocking_reasons: ["Item not found"],
      missing: ["item"],
      minimum_missing: ["item"],
      quality_gaps: [],
    };
  }

  const minimumMissing = Array.isArray(context?.completeness?.minimum_missing)
    ? context.completeness.minimum_missing
    : [];
  const qualityGaps = Array.isArray(context?.completeness?.quality_gaps)
    ? context.completeness.quality_gaps
    : [];

  return {
    ok: Boolean(context?.completeness?.has_minimum_required),
    blocking_reasons: Array.isArray(context?.completeness?.blocking_reasons) ? context.completeness.blocking_reasons : [],
    missing: minimumMissing,
    minimum_missing: minimumMissing,
    quality_gaps: qualityGaps,
  };
}

export function buildCleanContextSummary(repo, contentItemId) {
  const context = buildCleanStructuredContext(repo, contentItemId);
  if (!context) return null;
  return {
    content_item_id: Number(context.content_item_id || 0) || null,
    title: String(context?.item?.title || "").trim(),
    category: String(context?.item?.category || "").trim(),
    approved_context_count: Array.isArray(context?.approved_context) ? context.approved_context.length : 0,
    evidence_blocks_count: Array.isArray(context?.evidence_blocks) ? context.evidence_blocks.length : 0,
    selected_image_count: Number(context?.image_context?.selected_count || 0) || 0,
    has_minimum_required: Boolean(context?.completeness?.has_minimum_required),
    completeness_level: String(context?.completeness?.completeness_level || "").trim() || "minimal",
    blocking_reasons: Array.isArray(context?.completeness?.blocking_reasons) ? context.completeness.blocking_reasons : [],
    quality_gaps: Array.isArray(context?.completeness?.quality_gaps) ? context.completeness.quality_gaps : [],
  };
}
