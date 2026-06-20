import fsSync from "node:fs";
import { executeBackendAiJson } from "./backend-ai-client.mjs";

const FIELD_PACK_AGENT_KEY = "field_pack_agent";
const DEFAULT_FIELD_PACK_AGENT_PROFILE = [
  "คุณคือ field content producer สำหรับทีม UbonCity ที่ต้องเตรียมชุดสั่งงานให้คนลงพื้นที่จริง",

  "เขียนภาษาไทยกระชับ ตรง ใช้งานได้ทันที ไม่ขายของ ไม่เขียนเหมือนบทความ",

  "เน้นสิ่งที่ต้องไปยืนยัน ภาพหรือวิดีโอที่ต้องเก็บ คำถามที่ต้องถาม และความเสี่ยงของข้อมูลที่ยังไม่ควรฟันธง",

  "UbonCity มี mood แบบ warm cinematic, local premium, nature + culture, calm discovery",

  "ให้ความสำคัญกับ atmosphere, แสง, เวลา, มุมภาพ และ feeling ของสถานที่ มากกว่าการเก็บข้อมูลแบบ directory ทั่วไป",

  "แนะนำช่วงเวลาถ่ายภาพที่เหมาะ เช่น golden hour, sunset, หลังฝนตก หรือช่วงคนไม่เยอะ",

  "หลีกเลี่ยงแนวภาพสีจัด HDR แรง ภาพรก แนวตลาด หรือแนวรีวิวขายของ",

  "เวลาร่าง shot list ให้เน้น establishing shot, atmosphere shot, route feeling, texture, local detail และ vertical reel shot",

  "ทุก output ต้อง practical สำหรับทีมเล็กหรือ solo creator ที่ใช้อุปกรณ์ระดับ DJI Action 4 หรือมือถือทั่วไป",
].join("\n");

function normalizeAgentProfileText(value, fallback = DEFAULT_FIELD_PACK_AGENT_PROFILE) {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function getAgentProfileInputText(item) {
  return item?.agent_profile?.profile_text ?? item?.agent_profile_text;
}

function safeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F\u0E80-\u0EFF\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function parseJsonLike(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function extractResponseText(data) {
  const direct = data?.choices?.[0]?.message?.content;
  if (direct) return String(direct).trim();
  return "";
}

function normalizeAiDraft(input, fallbackTitle) {
  if (!input || typeof input !== "object") return null;
  const rawSlug = String(input.slug || "").trim();
  const normalizedSlug = safeSlug(rawSlug);
  const finalSlug = /^item-\d+$/i.test(normalizedSlug)
    ? safeSlug(fallbackTitle)
    : normalizedSlug || safeSlug(fallbackTitle);
  return {
    slug: finalSlug,
    summary: String(input.summary || "").trim(),
    meta_title: String(input.meta_title || "").trim(),
    meta_description: String(input.meta_description || "").trim(),
    description_clean: String(input.description_clean || "").trim(),
  };
}

function normalizeStringList(value, limit = 12) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(value) ? value : [];
  for (const raw of list) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeChecklistGroup(value, checklistType, limit = 10) {
  return normalizeStringList(value, limit).map((itemText, index) => ({
    checklist_type: checklistType,
    item_text: itemText,
    item_order: index,
    status: "todo",
  }));
}

function normalizeCaptureChecklistGroup(value, limit = 10) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(value) ? value : [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const itemText = String(raw.item_text || "").trim();
    if (!itemText) continue;
    const key = itemText.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const captureType = String(raw.capture_type || "").trim().toLowerCase();
    if (!["photo", "video", "both"].includes(captureType)) {
      throw new Error(`Each must_capture item must have valid capture_type (photo/video/both). Got: ${captureType}`);
    }
    out.push({
      checklist_type: "must_capture",
      item_text: itemText,
      capture_type: captureType,
      item_order: Number.isFinite(Number(raw.item_order)) ? Number(raw.item_order) : out.length,
      status: "todo",
    });
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeAiCtaContactJson(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  if (toText(source.phone)) out.phone = toText(source.phone);
  if (toText(source.line_url)) out.line_url = toText(source.line_url);
  if (toText(source.facebook_url)) out.facebook_url = toText(source.facebook_url);
  if (toText(source.website_url)) out.website_url = toText(source.website_url);
  if (toText(source.primary_cta)) out.primary_cta = toText(source.primary_cta).toLowerCase();
  return out;
}

function normalizeAiTaxonomySuggestedChecks(value, limit = 12) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const taxonomyKey = toText(raw.taxonomy_key).toLowerCase();
    if (!taxonomyKey || seen.has(taxonomyKey)) continue;
    seen.add(taxonomyKey);
    const row = { taxonomy_key: taxonomyKey };
    if (Object.prototype.hasOwnProperty.call(raw, "suggested_value")) row.suggested_value = raw.suggested_value;
    if (toText(raw.condition_note)) row.condition_note = toText(raw.condition_note);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeAiTaxonomyJson(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  if (toText(source.category)) out.category = toText(source.category);
  if (toText(source.subtype)) out.subtype = toText(source.subtype);
  const tags = normalizeStringList(source.tags, 12);
  if (tags.length) out.tags = tags;
  const suggestedChecks = normalizeAiTaxonomySuggestedChecks(source.suggested_checks, 12);
  if (suggestedChecks.length) out.suggested_checks = suggestedChecks;
  return out;
}

function normalizeFieldPack(input) {
  const root = input && typeof input === "object"
    ? (input.field_pack && typeof input.field_pack === "object" ? input.field_pack : input)
    : null;
  if (!root) return null;

  const forbiddenArticleKeys = [
    "description_clean",
    "description_raw",
    "body",
    "article",
    "article_body",
    "meta_title",
    "meta_description",
    "slug",
  ];
  const presentForbidden = forbiddenArticleKeys.filter((key) => {
    if (!Object.prototype.hasOwnProperty.call(root, key)) return false;
    const value = root[key];
    if (value == null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  });
  if (presentForbidden.length > 0) {
    throw new Error(`Agent field pack must not include article/output fields: ${presentForbidden.join(", ")}`);
  }

  const checklists = root.checklists && typeof root.checklists === "object" ? root.checklists : {};
  const requestedStatus = toText(root.status).toLowerCase();
  let normalizedStatus = requestedStatus || "draft";
  if (normalizedStatus === "ready_for_handoff" || normalizedStatus === "ready_for_field") {
    normalizedStatus = "draft";
  }
  const fieldPack = {
    status: ["draft", "field_in_progress", "field_done", "on_hold"].includes(normalizedStatus)
      ? normalizedStatus
      : "draft",
    writer_ready: Boolean(root.writer_ready),
    ai_summary: toText(root.ai_summary || root.summary || root.brief_summary),
    ai_highlights: normalizeStringList(root.ai_highlights || root.highlights, 8),
    ai_unknowns: normalizeStringList(root.ai_unknowns || root.unknowns || root.open_questions, 8),
    editor_summary: toText(root.editor_summary),
    verified_facts: normalizeStringList(root.verified_facts, 10),
    uncertain_facts: normalizeStringList(root.uncertain_facts, 10),
    story_angle: toText(root.story_angle || root.recommended_angle),
    field_notes: toText(root.field_notes || root.notes),
    social_hook: toText(root.social_hook || root.hook || root.recommended_hook),
    social_shot_emphasis: normalizeStringList(root.social_shot_emphasis || root.shot_emphasis, 10),
    social_on_camera_points: normalizeStringList(root.social_on_camera_points || root.on_camera_points, 10),
    social_caption_angle: toText(root.social_caption_angle || root.caption_angle),
    ai_cta_contact_json: normalizeAiCtaContactJson(root.ai_cta_contact_json),
    ai_taxonomy_json: normalizeAiTaxonomyJson(root.ai_taxonomy_json),
    field_pack_checklists: [
      ...normalizeChecklistGroup(root.must_verify_fact || root.must_verify_facts || root.must_verify || checklists.must_verify_fact || checklists.must_verify_facts, "must_verify_fact"),

      ...normalizeCaptureChecklistGroup(root.must_capture || checklists.must_capture),
      ...normalizeChecklistGroup(root.must_ask_question || root.must_ask_questions || root.must_ask || checklists.must_ask_question || checklists.must_ask_questions, "must_ask_question"),
    ],
    field_pack_references: Array.isArray(root.field_pack_references) ? root.field_pack_references : [],
    field_pack_media_hints: Array.isArray(root.field_pack_media_hints) ? root.field_pack_media_hints : [],
  };

  if (
    !fieldPack.ai_summary
    && !fieldPack.story_angle
    && !fieldPack.social_hook
    && fieldPack.field_pack_checklists.length === 0
  ) {
    return null;
  }

  return fieldPack;
}

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((x) => String(x).trim()).filter(Boolean) : [];
}

function toText(value) {
  return String(value || "").trim();
}

function normalizeVisualContext(input) {
  const value = input && typeof input === "object" ? input : {};
  return {
    visual_summary: toText(value.visual_summary),
    setting_cues: toArray(value.setting_cues),
    atmosphere_cues: toArray(value.atmosphere_cues),
    style_cues: toArray(value.style_cues),
    standout_visual_elements: toArray(value.standout_visual_elements),
    confidence_note: toText(value.confidence_note),
  };
}

function hasVisualContext(context) {
  const v = normalizeVisualContext(context);
  return Boolean(
    v.visual_summary
    || v.setting_cues.length
    || v.atmosphere_cues.length
    || v.style_cues.length
    || v.standout_visual_elements.length
    || v.confidence_note
  );
}

function collectVisualImageUrls(item, limit = 5) {
  const max = Math.max(1, Math.min(5, Number(limit || 5)));
  const structuredReferenceMedia = Array.isArray(item?.structured_context?.reference_media_context?.selected_urls)
    ? item.structured_context.reference_media_context.selected_urls
    : [];
  const list = [
    ...structuredReferenceMedia,
    ...(Array.isArray(item?.visual_image_urls) ? item.visual_image_urls : []),
  ];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const url = String(raw || "").trim();
    if (!/^https?:\/\//i.test(url) && !url.startsWith("/api/")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

function resolveCollectorBaseUrl() {
  const explicit = String(
    process.env.COLLECTOR_INTERNAL_BASE_URL
    || process.env.COLLECTOR_PUBLIC_BASE_URL
    || ""
  ).trim().replace(/\/+$/, "");
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit;

  const port = Number(process.env.PORT || 5062) || 5062;
  return `http://127.0.0.1:${port}`;
}

function toCollectorAbsoluteUrl(url) {
  const value = String(url || "").trim();
  if (!value.startsWith("/api/")) return value;
  return new URL(value, `${resolveCollectorBaseUrl()}/`).toString();
}

async function fetchImageUrlToDataUrl(url) {
  const absoluteUrl = toCollectorAbsoluteUrl(url);
  const response = await fetch(absoluteUrl);
  if (!response.ok) {
    throw new Error(`image fetch failed ${response.status}`);
  }

  const contentType = String(response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  if (!contentType.startsWith("image/")) {
    throw new Error(`proxy image returned non-image content-type: ${contentType}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const maxBytes = Number(process.env.COLLECTOR_VISUAL_IMAGE_MAX_BYTES || 8 * 1024 * 1024) || 8 * 1024 * 1024;
  if (bytes.length > maxBytes) {
    throw new Error(`proxy image is too large: ${bytes.length} bytes`);
  }

  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

async function prepareVisualImageInputs(item, limit = 5) {
  const imageUrls = collectVisualImageUrls(item, limit);
  const inputs = [];

  for (const url of imageUrls) {
    try {
      const imageUrl = await fetchImageUrlToDataUrl(url);
      inputs.push({ type: "image_url", image_url: { url: imageUrl, detail: "low" } });
    } catch (error) {
      traceAgentGeneration("visual_image.skip", {
        url: String(url || "").slice(0, 220),
        error: String(error?.message || error || "unknown error"),
      });
    }
  }

  return inputs;
}

function buildPromptInput(item) {
  const context = item?.structured_context && typeof item.structured_context === "object" ? item.structured_context : {};
  const visualContext = normalizeVisualContext(item?.visual_context);
  const approvedContext = Array.isArray(context?.approved_context) ? context.approved_context : [];
  const evidenceBlocks = Array.isArray(context?.evidence_blocks) ? context.evidence_blocks : [];
  const imageContext = context?.image_context && typeof context.image_context === "object" ? context.image_context : {};
  const referenceMediaContext = context?.reference_media_context && typeof context.reference_media_context === "object"
    ? context.reference_media_context
    : {};
  const completeness = context?.completeness && typeof context.completeness === "object" ? context.completeness : {};
  const evidencePolicy = context?.evidence_policy && typeof context.evidence_policy === "object" ? context.evidence_policy : {};
  const task = context?.task && typeof context.task === "object" ? context.task : {};

  return {
    item: {
      id: item?.id ?? null,
      title: toText(context?.item?.title || item?.title),
      type: toText(context?.item?.type || item?.type),
      category: toText(context?.item?.category || item?.category),
      lang: toText(context?.item?.lang || item?.lang || "th"),
      slug: toText(context?.item?.slug),
      description_clean: toText(context?.item?.description_clean),
      tags: Array.isArray(context?.item?.tags) ? context.item.tags : toArray(item?.tags),
      source_name: toText(context?.item?.source_name),
      source_url: toText(context?.item?.source_url),
      latitude: context?.item?.latitude ?? null,
      longitude: context?.item?.longitude ?? null,
      map_url: toText(context?.item?.map_url),
      google_place_id: toText(context?.item?.google_place_id),
    },
    approved_context: approvedContext.map((block) => ({
      id: block?.id ?? null,
      evidence_block_id: block?.evidence_block_id ?? null,
      context_type: toText(block?.context_type),
      selected_text: toText(block?.selected_text),
      selected_numeric: block?.selected_numeric ?? null,
      selected_list: toArray(block?.selected_list),
      note: toText(block?.note),
      editor_note: toText(block?.editor_note),
      confidence: block?.confidence ?? null,
      provenance: block?.provenance || null,
    })),
    evidence_blocks: evidenceBlocks.map((block) => ({
      id: block?.id ?? null,
      block_type: toText(block?.block_type),
      source_type: toText(block?.source_type),
      source_url: toText(block?.source_url),
      source_label: toText(block?.source_label),
      lang: toText(block?.lang),
      attribution_text: toText(block?.attribution_text),
      text_value: toText(block?.text_value),
      numeric_value: block?.numeric_value ?? null,
      list_value: toArray(block?.list_value),
      status: toText(block?.status),
    })),
    image_context: {
      cover_url: toText(imageContext?.cover_url),
      selected_urls: toArray(imageContext?.selected_urls),
      gallery_urls: toArray(imageContext?.gallery_urls),
      inline_urls: toArray(imageContext?.inline_urls),
      selected_count: Number(imageContext?.selected_count || 0) || 0,
      cover_count: Number(imageContext?.cover_count || 0) || 0,
      assets: Array.isArray(imageContext?.assets) ? imageContext.assets : [],
    },
    reference_media_context: {
      selected_urls: toArray(referenceMediaContext?.selected_urls),
      selected_count: Number(referenceMediaContext?.selected_count || 0) || 0,
      assets: Array.isArray(referenceMediaContext?.assets) ? referenceMediaContext.assets : [],
    },
    completeness: {
      has_minimum_required: Boolean(completeness?.has_minimum_required),
      completeness_level: toText(completeness?.completeness_level),
      minimum_missing: toArray(completeness?.minimum_missing),
      quality_gaps: toArray(completeness?.quality_gaps),
      missing_sections: toArray(completeness?.missing_sections),
      blocking_reasons: toArray(completeness?.blocking_reasons),
    },
    evidence_policy: {
      primary_source: toText(evidencePolicy?.primary_source),
      secondary_sources: toArray(evidencePolicy?.secondary_sources),
      supporting_sources: toArray(evidencePolicy?.supporting_sources),
      external_links_policy: toText(evidencePolicy?.external_links_policy),
    },
    task: {
      mode: toText(task?.mode),
      output_contract: toText(task?.output_contract),
      must_ground_in_approved_context: Boolean(task?.must_ground_in_approved_context),
      may_use_evidence_blocks_as_supporting_context: Boolean(task?.may_use_evidence_blocks_as_supporting_context),
      must_flag_uncertainty_when_context_is_thin: Boolean(task?.must_flag_uncertainty_when_context_is_thin),
      thin_context_behavior: toText(task?.thin_context_behavior),
      instructions: toArray(task?.instructions),
    },
    agent_profile: {
      agent_key: toText(item?.agent_profile?.agent_key || FIELD_PACK_AGENT_KEY),
      display_name: toText(item?.agent_profile?.display_name || "Field Pack Agent"),
      profile_text: normalizeAgentProfileText(getAgentProfileInputText(item)),
      scope: "role_tone_only",
      cannot_override_contract: true,
    },
    visual_context: visualContext,
    visual_context_counts: {
      setting_cues: visualContext.setting_cues.length,
      atmosphere_cues: visualContext.atmosphere_cues.length,
      style_cues: visualContext.style_cues.length,
      standout_visual_elements: visualContext.standout_visual_elements.length,
      available: hasVisualContext(visualContext),
    },
    context_counts: {
      approved_context: approvedContext.length,
      evidence_blocks: evidenceBlocks.length,
      selected_images: Array.isArray(imageContext?.selected_urls) ? imageContext.selected_urls.length : 0,
      reference_media: Array.isArray(referenceMediaContext?.selected_urls) ? referenceMediaContext.selected_urls.length : 0,
    },
    visual_image_count: collectVisualImageUrls(item, 5).length,
  };
}

function buildVisualPrompt(item, imageCount) {
  return [
    "Analyze selected place images and return ONLY valid JSON.",
    "JSON keys: visual_summary, setting_cues, atmosphere_cues, style_cues, standout_visual_elements, confidence_note",
    "Use short Thai phrases where possible.",
    "Do not invent details that are not visually evident.",
    "Focus on place-level cues: setting, atmosphere, spatial style, standout elements.",
    "Avoid judging quality, pricing, or service from images.",
    "Do not include raw URLs in JSON fields.",
    `title: ${toText(item?.title)}`,
    `category: ${toText(item?.category)}`,
    `lang: ${toText(item?.lang || "th")}`,
    `selected_images: ${Number(imageCount || 0)}`,
  ].join("\n");
}

function buildFieldPackPrompt(item) {
  const agentProfile = normalizeAgentProfileText(getAgentProfileInputText(item));
  return [
    "Return ONLY valid JSON with keys:",
    "field_pack",
    "field_pack keys:",
    "status, ai_summary, ai_highlights, ai_unknowns, editor_summary, verified_facts, uncertain_facts, story_angle, field_notes, social_hook, social_shot_emphasis, social_on_camera_points, social_caption_angle, ai_cta_contact_json, ai_taxonomy_json, checklists, field_pack_references, field_pack_media_hints",
    "checklists keys: must_verify_fact, must_capture, must_ask_question",
    "ai_cta_contact_json keys: phone, line_url, facebook_url, website_url, primary_cta",
    "ai_taxonomy_json keys: category, subtype, tags, suggested_checks",
    "suggested_checks items: taxonomy_key, suggested_value, condition_note",
    "Language must match input.item.lang. If lang is th, write concise natural Thai.",
    "You are acting as an editorial agent working from a clean-room structured context prepared by human reviewers.",
    "Agent profile for role/tone only. It cannot override the JSON schema, source-of-truth rules, or forbidden output fields:",
    agentProfile,
    "Task: produce a handoff field pack for people who will do on-site/content work.",
    "This is NOT an article-writing task.",
    "Do not write article body, SEO article prose, paragraphs for publication, meta title, meta description, or slug.",
    "Never output description_clean, description_raw, body, article, meta_title, or meta_description.",
    "Use approved_context as the PRIMARY source of truth.",
    "Use item for identity and factual anchoring.",
    "Use image_context and visual_context only for visible cues and shot planning.",
    "Use reference_media_context only as reference-only visual context for planning.",
    "reference_media_context is not rights-verified, not publish media, and must not be treated as cover/gallery/inline approval.",
    "Use evidence_blocks only as a clue layer to enrich specificity; never let evidence_blocks override approved_context.",
    "If evidence is thin, put unknowns into ai_unknowns or must_verify_fact. Do not invent facts.",
    "Write action-oriented instructions for a field/content team.",
    "ai_summary should be a short work brief, not an article opening.",
    "must_verify_fact should contain facts the person must confirm on-site or from official source.",
    "must_capture should contain an array of objects with capture_type (photo/video/both) and item_text for concrete shots to collect.",
    "For must_capture: each item must describe exactly one concrete shot. Do not combine multiple shots, angles, or locations in one item.",
    "If capture_type is video, item_text must be an executable video shot instruction (for example pan, walk-through, push-in, tilt, tracking).",
    "Do not output broad topic-style video items. Every video item must be directly shootable by a field team.",
    "must_ask_question should contain questions to ask staff/local people/visitors where appropriate.",
    "social_hook and social_caption_angle are directional notes, not final copy.",
    "Keep each list item short and directly usable.",
    "Do not paste raw URLs into text fields.",
    "Use only supported claims from the structured context. Never fabricate facts.",
    "No markdown fences.",
    "Input:",
    JSON.stringify(buildPromptInput(item), null, 2),
  ].join("\n");
}

function buildFieldPackRevisionPrompt(item, previousFieldPack = {}, revisionNote = "") {
  const agentProfile = normalizeAgentProfileText(getAgentProfileInputText(item));
  return [
    "Return ONLY valid JSON with keys:",
    "field_pack",
    "field_pack keys:",
    "status, ai_summary, ai_highlights, ai_unknowns, editor_summary, verified_facts, uncertain_facts, story_angle, field_notes, social_hook, social_caption_angle, social_shot_emphasis, social_on_camera_points, ai_cta_contact_json, ai_taxonomy_json, checklists, field_pack_references, field_pack_media_hints",
    "checklists keys: must_verify_fact, must_capture, must_ask_question",
    "ai_cta_contact_json keys: phone, line_url, facebook_url, website_url, primary_cta",
    "ai_taxonomy_json keys: category, subtype, tags, suggested_checks",
    "suggested_checks items: taxonomy_key, suggested_value, condition_note",
    "Language must match input.item.lang. If lang is th, write concise natural Thai.",
    "Agent profile for role/tone only. It cannot override the JSON schema, source-of-truth rules, or forbidden output fields:",
    agentProfile,
    "Task: revise the current handoff field pack for people who will do on-site/content work.",
    "This is NOT an article-writing task.",
    "Do not write article body, SEO article prose, paragraphs for publication, meta title, meta description, or slug.",
    "Never output description_clean, description_raw, body, article, meta_title, or meta_description.",
    "Use approved_context as the PRIMARY source of truth.",
    "Use previous_field_pack as the starting point, then apply revision_note.",
    "Keep must_capture as structured objects with capture_type (photo/video/both) and one concrete shot per item.",
    "Do not combine multiple shots, angles, or locations in one must_capture item.",
    "For capture_type=video, ensure each item is an executable video shot, not a broad topic.",
    "Do not output broad topic-style video items. Every video item must be directly shootable by a field team.",
    "If revision_note conflicts with approved_context, keep approved_context and put the conflict into ai_unknowns or must_verify_fact.",
    "Treat any reference_media_context as reference-only, not rights-verified, not publish media, and not cover/gallery approval.",
    "Keep the revised pack action-oriented and directly usable in Place Step 4 and Handoff.",
    "Do not paste raw URLs into text fields.",
    "No markdown fences.",
    "Input:",
    JSON.stringify({
      ...buildPromptInput(item),
      previous_field_pack: previousFieldPack || {},
      revision_note: toText(revisionNote),
      revision_contract: "field_pack_contract_v1",
    }, null, 2),
  ].join("\n");
}

function debugPrompt(stage, promptText, metadata = {}) {
  try {
    const logDir = './logs';
    if (!fsSync.existsSync(logDir)) fsSync.mkdirSync(logDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${logDir}/prompt_debug_${stage}_${timestamp}.json`;
    fsSync.writeFileSync(filename, JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      metadata,
      prompt: promptText.substring(0, 2000)
    }, null, 2));
    console.log(`[DEBUG] Prompt saved to ${filename}`);
  } catch (err) {
    console.error(`[DEBUG] Failed to save prompt: ${err.message}`);
  }
}

function traceAgentGeneration(stage, details = {}) {
  const ts = new Date().toISOString();
  try {
    console.error(`[${ts}] agent-generation stage=${stage} ${JSON.stringify(details)}`);
  } catch {
    console.error(`[${ts}] agent-generation stage=${stage}`);
  }
}

function resolveFeatureConfig(aiConfig, featureKey) {
  if (!aiConfig || typeof aiConfig !== "object") return {};
  const normalizedFeatureKey = featureKey === "revision" ? "fieldPack" : featureKey;
  const feature = aiConfig?.features?.[normalizedFeatureKey];
  if (feature && typeof feature === "object") {
    return {
      ...aiConfig,
      ...feature,
    };
  }
  return aiConfig;
}

function normalizeExternalAgentUrl(aiConfig) {
  const url = String(aiConfig?.externalAgentUrl || process.env.COLLECTOR_EXTERNAL_AGENT_URL || "").trim();
  return url ? url.replace(/\/+$/, "") : "";
}

function extractDraftPayload(data) {
  const responseText = extractResponseText(data);
  if (responseText) return parseJsonLike(responseText) || responseText;
  if (!data || typeof data !== "object") return null;
  const payload = data.draft || data.output || data.result || data;
  return typeof payload === "string" ? parseJsonLike(payload) || payload : payload;
}

function extractFieldPackPayload(data) {
  const responseText = extractResponseText(data);
  if (responseText) return parseJsonLike(responseText) || responseText;
  if (!data || typeof data !== "object") return null;
  const payload = data.field_pack || data.output || data.result || data;
  return typeof payload === "string" ? parseJsonLike(payload) || payload : payload;
}

function extractVisualPayload(data) {
  const responseText = extractResponseText(data);
  if (responseText) return parseJsonLike(responseText) || responseText;
  if (!data || typeof data !== "object") return null;
  const payload = data.visual_context || data.output || data.result || data;
  return typeof payload === "string" ? parseJsonLike(payload) || payload : payload;
}

async function fetchExternalAgent(aiConfig, payload, traceMeta = {}) {
  const url = normalizeExternalAgentUrl(aiConfig);
  if (!url) {
    throw new Error("COLLECTOR_EXTERNAL_AGENT_URL is missing");
  }

  const timeoutMs = Number(process.env.COLLECTOR_EXTERNAL_AGENT_TIMEOUT_MS || process.env.COLLECTOR_AGENT_TIMEOUT_MS || 90000) || 90000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`external agent timeout after ${timeoutMs}ms`)), timeoutMs);
  const startedAt = Date.now();
  const headers = {
    "Content-Type": "application/json",
  };
  const token = String(aiConfig?.externalAgentToken || process.env.COLLECTOR_EXTERNAL_AGENT_TOKEN || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  traceAgentGeneration("external.request.start", { ...traceMeta, timeout_ms: timeoutMs, url });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    traceAgentGeneration("external.request.response", {
      ...traceMeta,
      status: response.status,
      duration_ms: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    traceAgentGeneration("external.request.error", {
      ...traceMeta,
      duration_ms: Date.now() - startedAt,
      error: String(error?.message || error || "unknown error"),
      cause: String(error?.cause?.message || "").trim() || null,
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildExternalAgentPayload(task, item, extra = {}) {
  return {
    schema_version: "collector_agent_request_v1",
    task,
    content_item_id: Number(item?.id || 0) || null,
    model: String(extra.model || "").trim() || null,
    mcp: {
      server_name: "collector-clean-context",
      tools: ["validate_clean_minimum", "get_clean_context"],
    },
    structured_context: item?.structured_context || null,
    prompt_input: buildPromptInput(item),
    ...extra,
  };
}

function createExternalAgentGenerationEngine(aiConfig) {
  return {
    async generateVisualContext(item) {
      if (!aiConfig?.enabled) {
        throw new Error("external agent is not enabled");
      }
      const featureConfig = resolveFeatureConfig(aiConfig, "visualContext");

      const imageInputs = await prepareVisualImageInputs(item, 5);
      if (!imageInputs.length) {
        return null;
      }

      const response = await fetchExternalAgent(aiConfig, buildExternalAgentPayload("generate_visual_context", item, {
        model: featureConfig?.model || aiConfig?.model || "external",
        images: imageInputs,
      }), {
        kind: "external_visual_context",
        content_item_id: Number(item?.id || 0) || null,
        image_count: imageInputs.length,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`External agent visual-context error ${response.status}: ${body.slice(0, 220)}`);
      }

      const data = await response.json();
      const parsed = normalizeVisualContext(extractVisualPayload(data));
      if (!hasVisualContext(parsed)) {
        return null;
      }
      return parsed;
    },

    async generateFieldPack(item) {
      if (!aiConfig?.enabled) {
        throw new Error("external agent is not enabled");
      }
      const featureConfig = resolveFeatureConfig(aiConfig, "fieldPack");

      const response = await fetchExternalAgent(aiConfig, buildExternalAgentPayload("generate_field_pack", item, {
        model: featureConfig?.model || aiConfig?.model || "external",
        visual_context: normalizeVisualContext(item?.visual_context),
        agent_profile: buildPromptInput(item).agent_profile,
      }), {
        kind: "external_field_pack",
        content_item_id: Number(item?.id || 0) || null,
        title: String(item?.title || "").trim() || null,
        workflow_status: String(item?.workflow_status || "").trim().toLowerCase() || null,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`External agent error ${response.status}: ${body.slice(0, 220)}`);
      }

      const data = await response.json();
      const parsed = normalizeFieldPack(extractFieldPackPayload(data));
      if (!parsed) {
        throw new Error("External agent response is not a valid JSON field pack");
      }
      return parsed;
    },

    async reviseFieldPack(item, previousFieldPack = {}, revisionNote = "") {
      if (!aiConfig?.enabled) {
        throw new Error("external agent is not enabled");
      }
      const featureConfig = resolveFeatureConfig(aiConfig, "revision");

      const response = await fetchExternalAgent(aiConfig, buildExternalAgentPayload("revise_field_pack", item, {
        model: featureConfig?.model || aiConfig?.model || "external",
        visual_context: normalizeVisualContext(item?.visual_context),
        previous_field_pack: previousFieldPack || {},
        revision_note: toText(revisionNote),
        agent_profile: buildPromptInput(item).agent_profile,
        contract: "field_pack_contract_v1",
      }), {
        kind: "external_field_pack_revision",
        content_item_id: Number(item?.id || 0) || null,
        title: String(item?.title || "").trim() || null,
        workflow_status: String(item?.workflow_status || "").trim().toLowerCase() || null,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`External agent revision error ${response.status}: ${body.slice(0, 220)}`);
      }

      const data = await response.json();
      const parsed = normalizeFieldPack(extractFieldPackPayload(data));
      if (!parsed) {
        throw new Error("External agent revision response is not a valid JSON field pack");
      }
      return parsed;
    },
  };
}

export function createAgentGenerationEngine(aiConfig) {
  if (String(aiConfig?.agentEngine || "internal").trim().toLowerCase() === "external") {
    return createExternalAgentGenerationEngine(aiConfig);
  }

  return {
    async generateVisualContext(item) {
      if (!aiConfig?.enabled) {
        throw new Error("backend AI proxy is not enabled");
      }

      const imageInputs = await prepareVisualImageInputs(item, 5);
      if (!imageInputs.length) {
        return null;
      }

      const result = await executeBackendAiJson({
        aiConfig,
        featureKey: "visualContext",
        task: "visual_context",
        prompt: buildVisualPrompt(item, imageInputs.length),
        imageInputs,
      });
      const parsed = normalizeVisualContext(result.parsed || parseJsonLike(result.outputText));
      if (!hasVisualContext(parsed)) {
        return null;
      }
      return parsed;
    },

    async generateFieldPack(item) {
      if (!aiConfig?.enabled) {
        throw new Error("backend AI proxy is not enabled");
      }

      const fullPrompt = buildFieldPackPrompt(item);
      debugPrompt('field_pack', fullPrompt, { itemId: item?.id, title: String(item?.title || '').trim() });

      const result = await executeBackendAiJson({
        aiConfig,
        featureKey: "fieldPack",
        task: "field_pack",
        prompt: fullPrompt,
      });
      const parsed = normalizeFieldPack(result.parsed || parseJsonLike(result.outputText));
      if (!parsed) {
        throw new Error("AI response is not valid JSON field pack");
      }
      return parsed;
    },

    async reviseFieldPack(item, previousFieldPack = {}, revisionNote = "") {
      if (!aiConfig?.enabled) {
        throw new Error("backend AI proxy is not enabled");
      }

      const revisionPrompt = buildFieldPackRevisionPrompt(item, previousFieldPack, revisionNote);
      debugPrompt('field_pack_revision', revisionPrompt, { itemId: item?.id, title: String(item?.title || '').trim() });

      const result = await executeBackendAiJson({
        aiConfig,
        featureKey: "revision",
        task: "field_pack_revision",
        prompt: revisionPrompt,
      });
      const parsed = normalizeFieldPack(result.parsed || parseJsonLike(result.outputText));
      if (!parsed) {
        throw new Error("AI revision response is not valid JSON field pack");
      }
      return parsed;
    },
  };
}

export {
  DEFAULT_FIELD_PACK_AGENT_PROFILE,
  FIELD_PACK_AGENT_KEY,
  buildFieldPackPrompt,
  buildFieldPackRevisionPrompt,
  buildExternalAgentPayload,
  buildPromptInput,
  buildVisualPrompt,
  collectVisualImageUrls,
  createExternalAgentGenerationEngine,
  extractFieldPackPayload,
  extractResponseText,
  normalizeAiDraft,
  normalizeFieldPack,
  normalizeVisualContext,
  parseJsonLike,
  prepareVisualImageInputs,
  fetchImageUrlToDataUrl,
  toCollectorAbsoluteUrl,
};
