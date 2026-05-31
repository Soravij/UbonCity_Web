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

function toText(value) {
  return String(value || "").trim();
}

function toList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || "").trim()).filter(Boolean);
}

function buildTypeSpecificFields(itemType, category, approvedContext) {
  const safeType = String(itemType || "").trim().toLowerCase() || "place";
  const safeCategory = String(category || "").trim().toLowerCase();
  const listFromContextType = (contextType) => approvedContext
    .filter((row) => String(row?.context_type || "").trim().toLowerCase() === contextType)
    .map((row) => String(row?.selected_text || "").trim())
    .filter(Boolean);

  const placeFields = { ambience: [], highlights: [], practical_tips: [] };
  const hotelFields = { room_types: [], amenities: [], check_in_out_notes: [] };
  const restaurantFields = { signature_menu: [], dietary_options: [], service_style: [] };
  const eventFields = { event_dates: [], schedule: [], ticketing_notes: [] };

  placeFields.ambience = listFromContextType("ambience");
  placeFields.highlights = listFromContextType("feature");
  placeFields.practical_tips = listFromContextType("tip");

  if (safeType === "event") {
    eventFields.event_dates = listFromContextType("date_time");
    eventFields.schedule = listFromContextType("schedule");
    eventFields.ticketing_notes = listFromContextType("ticketing");
  }

  if (safeType !== "event" && (safeCategory.includes("hotel") || safeCategory.includes("resort"))) {
    hotelFields.room_types = listFromContextType("room_type");
    hotelFields.amenities = listFromContextType("amenity");
    hotelFields.check_in_out_notes = listFromContextType("check_in_out");
  }

  if (safeType !== "event" && (safeCategory.includes("restaurant") || safeCategory.includes("cafe") || safeCategory.includes("food"))) {
    restaurantFields.signature_menu = listFromContextType("menu");
    restaurantFields.dietary_options = listFromContextType("dietary");
    restaurantFields.service_style = listFromContextType("service_style");
  }

  return {
    place_fields: placeFields,
    hotel_fields: hotelFields,
    restaurant_fields: restaurantFields,
    event_fields: eventFields,
  };
}

function uniqueList(values = []) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function flattenApprovedContextTexts(approvedContext = []) {
  const out = [];
  for (const row of approvedContext) {
    const text = String(row?.selected_text || "").trim();
    if (text) out.push(text);
    const list = Array.isArray(row?.selected_list) ? row.selected_list : [];
    for (const item of list) {
      const value = String(item || "").trim();
      if (value) out.push(value);
    }
  }
  return uniqueList(out);
}

function pickApprovedEvidence(approvedContext = [], options = {}) {
  const contextTypes = Array.isArray(options.contextTypes) ? options.contextTypes.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean) : [];
  const keywords = Array.isArray(options.keywords) ? options.keywords.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean) : [];
  const maxItems = Math.max(1, Math.min(12, Number(options.maxItems || 6) || 6));
  const out = [];

  for (const row of approvedContext) {
    const rowType = String(row?.context_type || "").trim().toLowerCase();
    const rowValues = [
      String(row?.selected_text || "").trim(),
      ...(Array.isArray(row?.selected_list) ? row.selected_list.map((x) => String(x || "").trim()) : []),
    ].filter(Boolean);
    if (!rowValues.length) continue;

    const typeMatched = contextTypes.length > 0 && contextTypes.includes(rowType);
    const keywordMatched = keywords.length > 0 && rowValues.some((value) => keywords.some((kw) => value.toLowerCase().includes(kw)));
    const isMatch = contextTypes.length || keywords.length ? (typeMatched || keywordMatched) : false;
    if (!isMatch) continue;

    for (const value of rowValues) {
      out.push(value);
      if (out.length >= maxItems) break;
    }
    if (out.length >= maxItems) break;
  }

  return uniqueList(out).slice(0, maxItems);
}

function hasExplicitApprovedEvidence(approvedContext = [], options = {}) {
  return pickApprovedEvidence(approvedContext, { ...options, maxItems: 1 }).length > 0;
}

function firstOrNull(values = []) {
  const list = uniqueList(values);
  return list.length ? list[0] : null;
}

function hasCategoryHint(category, hints = []) {
  const text = String(category || "").trim().toLowerCase();
  if (!text) return false;
  return hints.some((hint) => text.includes(String(hint || "").trim().toLowerCase()));
}

function extractFactualApprovedFacts(approvedContext = [], options = {}) {
  const category = String(options.category || "").trim().toLowerCase();
  const isHotel = hasCategoryHint(category, ["hotel", "resort"]);
  const isRestaurant = hasCategoryHint(category, ["restaurant", "cafe", "food"]);
  const factualTypes = new Set([
    "fact",
    "identity",
    "location",
    "address",
    "map",
    "contact",
    "phone",
    "website",
    "opening_hours",
    "date_time",
    "ticketing",
    "price",
  ]);
  if (isHotel) factualTypes.add("amenity");
  if (isRestaurant) factualTypes.add("menu");

  const out = [];
  for (const row of approvedContext) {
    const rowType = String(row?.context_type || "").trim().toLowerCase();
    if (!factualTypes.has(rowType)) continue;
    const selectedText = String(row?.selected_text || "").trim();
    if (selectedText) out.push(selectedText);
    const selectedList = Array.isArray(row?.selected_list) ? row.selected_list : [];
    for (const item of selectedList) {
      const text = String(item || "").trim();
      if (text) out.push(text);
    }
  }
  return uniqueList(out);
}

export function buildFieldPackContractFromCleanContext(cleanContext) {
  const context = cleanContext && typeof cleanContext === "object" ? cleanContext : null;
  if (!context) return null;

  const item = context.item && typeof context.item === "object" ? context.item : {};
  const approvedContext = Array.isArray(context.approved_context) ? context.approved_context : [];
  const completeness = context.completeness && typeof context.completeness === "object" ? context.completeness : {};
  const minMissing = toList(completeness.minimum_missing);
  const qualityGaps = toList(completeness.quality_gaps);

  const coreFactualFields = {
    title: toText(item.title) || null,
    type: toText(item.type) || null,
    category: toText(item.category) || null,
    slug: toText(item.slug) || null,
    map_url: toText(item.map_url) || null,
    google_place_id: toText(item.google_place_id) || null,
    source_url: toText(item.source_url) || null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
  };

  const typeSpecific = buildTypeSpecificFields(item.type, item.category, approvedContext);
  const itemType = String(item.type || "").trim().toLowerCase();
  const categoryText = String(item.category || "").trim().toLowerCase();
  const isEventItem = itemType === "event";
  const isHotelCategory = hasCategoryHint(categoryText, ["hotel", "resort"]);
  const isRestaurantCategory = hasCategoryHint(categoryText, ["restaurant", "cafe", "food"]);
  const isPlaceLike = !isEventItem && !isHotelCategory && !isRestaurantCategory;
  const suggestedPageBlocks = ["overview", "highlights", "how_to_go", "cta"].filter(Boolean);
  const priorityCta = coreFactualFields.map_url ? "map" : "none";

  const missingFields = [];
  if (!coreFactualFields.map_url) missingFields.push("map_url");
  if (!coreFactualFields.google_place_id) missingFields.push("google_place_id");
  if (minMissing.includes("approved_context")) missingFields.push("approved_context");

  const verifyRequired = approvedContext
    .filter((row) => !toText(row?.selected_text) && (row?.selected_numeric == null) && (!Array.isArray(row?.selected_list) || row.selected_list.length < 1))
    .map((row) => toText(row?.context_type) || "context_item")
    .filter(Boolean);

  const scopedStrictRules = [];
  if (isEventItem) {
    scopedStrictRules.push(
      { key: "event_date_hints", contextTypes: ["date_time", "schedule"], keywords: ["date", "เวลา", "วันที่", "schedule"] },
      { key: "ticket_hints", contextTypes: ["ticketing"], keywords: ["ticket", "บัตร", "ค่าเข้า"] },
      { key: "venue_notes", contextTypes: ["venue", "location", "address"], keywords: ["venue", "สถานที่", "address"] }
    );
  } else if (isHotelCategory) {
    scopedStrictRules.push(
      { key: "parking", contextTypes: ["parking"], keywords: ["parking", "ที่จอด"] },
      { key: "pet_friendly", contextTypes: ["pet", "pet_policy"], keywords: ["pet", "สัตว์เลี้ยง"] },
      { key: "family_friendly", contextTypes: ["family"], keywords: ["family", "ครอบครัว", "เด็ก"] },
      { key: "accessibility", contextTypes: ["accessibility"], keywords: ["wheelchair", "accessible", "ทางลาด"] },
      { key: "hotel_amenities", contextTypes: ["amenity"], keywords: ["amenity", "wifi", "pool", "spa", "อาหารเช้า"] },
      { key: "room_type_hints", contextTypes: ["room_type"], keywords: ["room", "suite", "villa", "ห้อง"] },
      { key: "checkin_checkout", contextTypes: ["check_in_out"], keywords: ["check-in", "check-out", "เวลาเช็ค"] },
      { key: "booking_channels", contextTypes: ["booking_channel"], keywords: ["booking", "agoda", "expedia", "จอง"] }
    );
  } else if (isRestaurantCategory) {
    scopedStrictRules.push(
      { key: "price_range", contextTypes: ["price", "pricing"], keywords: ["price", "ราคา", "บาท"] },
      { key: "parking", contextTypes: ["parking"], keywords: ["parking", "ที่จอด"] },
      { key: "pet_friendly", contextTypes: ["pet", "pet_policy"], keywords: ["pet", "สัตว์เลี้ยง"] },
      { key: "family_friendly", contextTypes: ["family"], keywords: ["family", "ครอบครัว", "เด็ก"] },
      { key: "accessibility", contextTypes: ["accessibility"], keywords: ["wheelchair", "accessible", "ทางลาด"] },
      { key: "restaurant_features", contextTypes: ["restaurant_feature", "service_style"], keywords: ["menu", "service", "โต๊ะ", "คาเฟ่", "restaurant"] },
      { key: "signature_menu", contextTypes: ["menu"], keywords: ["signature", "recommended menu", "เมนู"] },
      { key: "price_signals", contextTypes: ["price", "pricing"], keywords: ["price", "ราคา", "บาท"] },
      { key: "service_style", contextTypes: ["service_style"], keywords: ["self service", "table service", "บริการ"] }
    );
  } else if (isPlaceLike) {
    scopedStrictRules.push(
      { key: "parking", contextTypes: ["parking"], keywords: ["parking", "ที่จอด"] },
      { key: "accessibility", contextTypes: ["accessibility"], keywords: ["wheelchair", "accessible", "ทางลาด"] },
      { key: "family_friendly", contextTypes: ["family"], keywords: ["family", "ครอบครัว", "เด็ก"] }
    );
    // opening_hours_note is optional; only enforce verify when there are relevant hints.
    if (hasExplicitApprovedEvidence(approvedContext, { contextTypes: ["opening_hours", "schedule"], keywords: ["open", "hour", "เวลาเปิด", "ปิด"] })) {
      scopedStrictRules.push({
        key: "opening_hours_note",
        contextTypes: ["opening_hours", "schedule"],
        keywords: ["open", "hour", "เวลาเปิด", "ปิด"],
      });
    }
  }

  const strictNeedsVerification = [];
  for (const rule of scopedStrictRules) {
    if (!hasExplicitApprovedEvidence(approvedContext, rule)) {
      strictNeedsVerification.push(rule.key);
    }
  }

  const eventDateMissing = isEventItem && strictNeedsVerification.includes("event_date_hints");

  const universalProfile = {
    highlights: pickApprovedEvidence(approvedContext, { contextTypes: ["feature", "highlight"], keywords: ["เด่น", "highlight", "feature"] }),
    good_to_know: pickApprovedEvidence(approvedContext, { contextTypes: ["tip", "fact"], keywords: ["ควรรู้", "note", "tip"] }),
    why_visit: pickApprovedEvidence(approvedContext, { contextTypes: ["feature", "ambience"], keywords: ["บรรยากาศ", "experience", "กิจกรรม"] }),
    recommended_for: pickApprovedEvidence(approvedContext, { contextTypes: ["audience"], keywords: ["เหมาะกับ", "recommended for"] }),
    best_for: pickApprovedEvidence(approvedContext, { contextTypes: ["audience"], keywords: ["best for", "เหมาะ", "สาย"] }),
    nearby: pickApprovedEvidence(approvedContext, { contextTypes: ["nearby_landmark"], keywords: ["nearby", "ใกล้", "landmark"] }),
    local_notes: uniqueList([
      ...pickApprovedEvidence(approvedContext, { contextTypes: ["local_note", "tip"], keywords: ["local", "ชุมชน", "ท้องถิ่น"] }),
      ...approvedContext
        .map((row) => String(row?.editor_note || "").trim())
        .filter(Boolean),
    ]),
  };

  const practicalProfile = {
    price_range: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["price", "pricing"], keywords: ["price", "ราคา", "บาท"] })),
    parking: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["parking"], keywords: ["parking", "ที่จอด"] })) || "unknown",
    pet_friendly: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["pet", "pet_policy"], keywords: ["pet", "สัตว์เลี้ยง"] })) || "unknown",
    family_friendly: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["family"], keywords: ["family", "ครอบครัว", "เด็ก"] })) || "unknown",
    accessibility: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["accessibility"], keywords: ["wheelchair", "accessible", "ทางลาด"] })) || "unknown",
    opening_hours_note: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["opening_hours", "schedule"], keywords: ["open", "hour", "เวลาเปิด", "ปิด"] })),
    reservation_needed: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["reservation"], keywords: ["reserve", "booking", "จอง"] })) || "unknown",
  };

  const placeProfile = {
    view_type: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["view_type"], keywords: ["river", "mountain", "city view", "วิว"] })),
    atmosphere: pickApprovedEvidence(approvedContext, { contextTypes: ["ambience"], keywords: ["บรรยากาศ", "calm", "vibe"] }),
    photo_spots: pickApprovedEvidence(approvedContext, { contextTypes: ["photo_spot"], keywords: ["photo", "spot", "มุมถ่าย"] }),
    visit_duration: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["visit_duration"], keywords: ["hour", "ชม", "ใช้เวลา"] })),
    best_time_to_visit: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["best_time"], keywords: ["morning", "evening", "golden hour", "ช่วงเวลา"] })),
  };

  const restaurantProfile = {
    restaurant_features: pickApprovedEvidence(approvedContext, { contextTypes: ["restaurant_feature", "service_style"], keywords: ["menu", "service", "coffee", "อาหาร"] }),
    signature_menu: pickApprovedEvidence(approvedContext, { contextTypes: ["menu"], keywords: ["signature", "recommended menu", "เมนู"] }),
    cuisine_type: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["cuisine_type"], keywords: ["thai", "fusion", "local", "อาหาร"] })),
    price_signals: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["price", "pricing"], keywords: ["price", "ราคา", "บาท"] })),
    service_style: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["service_style"], keywords: ["self service", "table service", "บริการ"] })),
    seating_vibe: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["seating", "ambience"], keywords: ["indoor", "outdoor", "seat", "ที่นั่ง"] })),
  };

  const hotelProfile = {
    hotel_amenities: pickApprovedEvidence(approvedContext, { contextTypes: ["amenity"], keywords: ["wifi", "pool", "gym", "spa", "amenity"] }),
    room_type_hints: pickApprovedEvidence(approvedContext, { contextTypes: ["room_type"], keywords: ["room", "suite", "villa", "ห้อง"] }),
    checkin_checkout: firstOrNull(pickApprovedEvidence(approvedContext, { contextTypes: ["check_in_out"], keywords: ["check-in", "check-out", "เวลาเช็ค"] })),
    booking_channels: pickApprovedEvidence(approvedContext, { contextTypes: ["booking_channel"], keywords: ["booking", "agoda", "expedia", "จอง"] }),
    nearby_landmarks: pickApprovedEvidence(approvedContext, { contextTypes: ["nearby_landmark"], keywords: ["nearby", "landmark", "ใกล้"] }),
    stay_best_for: pickApprovedEvidence(approvedContext, { contextTypes: ["audience"], keywords: ["stay", "เหมาะกับ", "พัก"] }),
  };

  const eventProfile = {
    event_date_hints: pickApprovedEvidence(approvedContext, { contextTypes: ["date_time", "schedule"], keywords: ["date", "วันที่", "เวลา", "schedule"] }),
    schedule_hints: pickApprovedEvidence(approvedContext, { contextTypes: ["schedule"], keywords: ["schedule", "program", "กิจกรรม"] }),
    ticket_hints: pickApprovedEvidence(approvedContext, { contextTypes: ["ticketing"], keywords: ["ticket", "บัตร", "ค่าเข้า"] }),
    venue_notes: pickApprovedEvidence(approvedContext, { contextTypes: ["venue", "location"], keywords: ["venue", "สถานที่"] }),
    event_best_for: pickApprovedEvidence(approvedContext, { contextTypes: ["audience"], keywords: ["best for", "เหมาะกับ", "ผู้เข้าร่วม"] }),
  };

  const verification = {
    verified_facts: uniqueList([
      ...extractFactualApprovedFacts(approvedContext, { category: item.category }),
      ...Object.entries(coreFactualFields)
        .filter(([, value]) => value != null && String(value).trim() !== "")
        .map(([key, value]) => `${key}: ${String(value)}`),
    ]).slice(0, 20),
    needs_verification: uniqueList([
      ...missingFields,
      ...verifyRequired,
      ...strictNeedsVerification,
    ]),
    publish_blockers: uniqueList([
      ...minMissing,
      ...(eventDateMissing ? ["event_date_hints"] : []),
    ]),
  };

  return {
    taxonomy_version: "page_curation_taxonomy_v1",
    core_factual_fields: coreFactualFields,
    place_fields: typeSpecific.place_fields,
    hotel_fields: typeSpecific.hotel_fields,
    restaurant_fields: typeSpecific.restaurant_fields,
    event_fields: typeSpecific.event_fields,
    curation_signals: {
      recommended_angle: toText(item.category) ? `${toText(item.category)} practical guide` : "local guide",
      suggested_page_blocks: suggestedPageBlocks,
      priority_cta: priorityCta,
      target_audience: [],
      content_risks: qualityGaps,
      missing_fields: missingFields,
      verify_required: verifyRequired,
    },
    checklists: {
      missing_data: missingFields,
      verify_required: verifyRequired,
      quality_gaps: qualityGaps,
    },
    universal_curation_profile: universalProfile,
    practical_profile: practicalProfile,
    place_profile: placeProfile,
    restaurant_profile: restaurantProfile,
    hotel_profile: hotelProfile,
    event_profile: eventProfile,
    verification,
    provenance: {
      contract_version: "field_pack_contract_v1",
      source: "clean_structured_context",
      content_item_id: Number(context.content_item_id || 0) || null,
      approved_context_count: approvedContext.length,
      evidence_blocks_count: Array.isArray(context.evidence_blocks) ? context.evidence_blocks.length : 0,
      generated_at: new Date().toISOString(),
    },
  };
}
