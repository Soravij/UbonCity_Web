import fs from "fs/promises";
import path from "path";
import { cleanReviewsAndContent } from "../cleaner/review-cleaner.mjs";
import { generateContentDrafts } from "../ai/generate-content.mjs";
import { runQualityChecks } from "../quality/checks.mjs";
import { writeCsv, writeJson, writeMarkdown } from "../publisher/exporters.mjs";

const GOVERNANCE_REASON_CODES = Object.freeze({
  review_approve: "review_approved",
  review_reject: "review_rejected",
  review_request_changes: "review_changes_requested",
  workflow_reopen: "workflow_reopened",
  publish_success: "publish_success",
  publish_prerequisite_conflict: "publish_prerequisite_conflict",
});
import { FIELD_PACK_AGENT_KEY, createAgentGenerationEngine } from "./agent-generation.mjs";
import { createTranslationGenerator } from "../translation/service.mjs";
import { runAutomaticTranslationChecks } from "../quality/translation-checks.mjs";
import { buildCleanStructuredContext, buildFieldPackContractFromCleanContext, validateCleanMinimum } from "./clean-context.mjs";

function traceAiDraft(stage, details = {}) {
  const ts = new Date().toISOString();
  try {
    console.error(`[${ts}] ai-draft stage=${stage} ${JSON.stringify(details)}`);
  } catch {
    console.error(`[${ts}] ai-draft stage=${stage}`);
  }
}

function traceTranslationDiagnostics(stage, details = {}) {
  const ts = new Date().toISOString();
  try {
    console.error(`[${ts}] translation-debug stage=${stage} ${JSON.stringify(details)}`);
  } catch {
    console.error(`[${ts}] translation-debug stage=${stage}`);
  }
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    const next = line[i + 1];
    if (c === '"' && quoted && next === '"') {
      cur += '"';
      i += 1;
      continue;
    }
    if (c === '"') {
      quoted = !quoted;
      continue;
    }
    if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function slugify(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return text || "item";
}

function dedupeSlug(baseSlug, usedSet) {
  let candidate = baseSlug || "item";
  let idx = 2;
  while (usedSet.has(candidate)) {
    candidate = `${baseSlug}-${idx}`;
    idx += 1;
  }
  usedSet.add(candidate);
  return candidate;
}

function normalizePublishSlug(rawValue, fallbackKey = "item") {
  const candidate = slugify(rawValue);
  if (candidate && candidate !== "item" && candidate.length >= 3 && !/^\d+$/.test(candidate)) return candidate;
  return slugify(fallbackKey);
}

function normalizeScopedItemIds(options = {}) {
  const ids = [];
  const singleId = Number(options?.contentItemId || options?.content_item_id || 0) || 0;
  if (singleId) ids.push(singleId);

  const multi = Array.isArray(options?.contentItemIds)
    ? options.contentItemIds
    : Array.isArray(options?.content_item_ids)
      ? options.content_item_ids
      : [];

  for (const value of multi) {
    const id = Number(value || 0) || 0;
    if (id) ids.push(id);
  }

  return [...new Set(ids)];
}

function filterRowsByScopedItemIds(rows, options = {}, key = "id") {
  const scopedIds = normalizeScopedItemIds(options);
  if (!scopedIds.length) {
    return Array.isArray(rows) ? rows : [];
  }
  const scopedSet = new Set(scopedIds);
  return (Array.isArray(rows) ? rows : []).filter((row) => scopedSet.has(Number(row?.[key] || 0)));
}

function resolveScopedExportDirs(dirs, options = {}) {
  const scopedIds = normalizeScopedItemIds(options);
  if (scopedIds.length !== 1) {
    return {
      stagingDir: dirs.stagingDir,
      exportDir: dirs.exportDir,
    };
  }

  const scopedKey = String(scopedIds[0]);
  return {
    stagingDir: path.join(dirs.stagingDir, "items", scopedKey),
    exportDir: path.join(dirs.exportDir, "items", scopedKey),
  };
}

export function parseImportText(format, text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  if (format === "json") {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    return Array.isArray(parsed) ? parsed : [];
  }

  if (format === "csv") {
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return [];
    const headers = splitCsvLine(lines[0]).map((h) => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i += 1) {
      const cols = splitCsvLine(lines[i]);
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = cols[idx] ?? "";
      });
      rows.push(row);
    }
    return rows;
  }

  throw new Error("Unsupported import format");
}

function mapFromDb(item, rowNo) {
  return {
    row_no: rowNo,
    id: item.id,
    type: item.type,
    category: item.category || "",
    lang: item.lang || "th",
    title: item.title || "",
    description: item.description_clean || item.description_raw || "",
    image: item.image_url || "",
    latitude: item.latitude,
    longitude: item.longitude,
    google_place_id: item.google_place_id || "",
    map_url: item.map_url || "",
    source_name: item.source_name || "manual",
    source_url: item.source_url || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    slug: item.slug || "",
    meta_title: item.meta_title || "",
    meta_description: item.meta_description || "",
    summary: item.summary || "",
  };
}

function mapToStagingPayload(item, imageContext = null, officialReference = null) {
  const cover = imageContext?.cover_url || item.image_url || "";
  return {
    type: item.type,
    category: item.category || "",
    lang: item.lang || "th",
    title: item.title || "",
    summary: item.summary || "",
    description: item.description_clean || item.description_raw || "",
    image: cover,
    image_context: {
      cover,
      inline: Array.isArray(imageContext?.inline_urls) ? imageContext.inline_urls : [],
      gallery: Array.isArray(imageContext?.gallery_urls) ? imageContext.gallery_urls : [],
      selected: Array.isArray(imageContext?.selected_urls) ? imageContext.selected_urls : [],
    },
    slug: item.slug || "",
    meta_title: item.meta_title || "",
    meta_description: item.meta_description || "",
    latitude: item.latitude,
    longitude: item.longitude,
    google_place_id: item.google_place_id || "",
    map_url: item.map_url || "",
    source_name: item.source_name || "",
    source_url: item.source_url || "",
    official_reference: officialReference || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
  };
}

function buildInternalLinkSuggestions(currentItem, candidates) {
  const MAX_LINKS_PER_ARTICLE = 5;
  const currentTags = new Set((Array.isArray(currentItem.tags) ? currentItem.tags : []).map((t) => String(t).toLowerCase()));
  const currentSlug = slugify(currentItem.slug || currentItem.title || "");

  const scored = candidates
    .filter((target) => target.id !== currentItem.id)
    .map((target) => {
      const targetSlug = slugify(target.slug || target.title || "");
      const targetTags = new Set((Array.isArray(target.tags) ? target.tags : []).map((t) => String(t).toLowerCase()));
      let relevance = 0;

      if (currentItem.category && target.category && currentItem.category === target.category) relevance += 30;

      for (const t of currentTags) {
        if (targetTags.has(t)) relevance += 15;
      }

      const currentTokens = String(currentItem.title || "").toLowerCase().split(/\s+/).filter(Boolean);
      const targetTokens = new Set(String(target.title || "").toLowerCase().split(/\s+/).filter(Boolean));
      for (const token of currentTokens) {
        if (token && targetTokens.has(token)) relevance += 5;
      }

      return {
        target_content_item_id: target.id,
        target_slug: targetSlug,
        target_title: target.title,
        relevance_score: Math.max(0, Math.min(100, relevance)),
        reason: relevance >= 45 ? "shared category/tags" : "title similarity",
      };
    })
    .filter((s) => s.relevance_score >= 35)
    .filter((s) => s.target_slug && s.target_slug !== currentSlug)
    .sort((a, b) => b.relevance_score - a.relevance_score);

  const usedTargets = new Set();
  const usedAnchors = new Set();
  const suggestions = [];

  for (const s of scored) {
    if (suggestions.length >= MAX_LINKS_PER_ARTICLE) break;
    if (usedTargets.has(s.target_slug)) continue;

    const anchorCandidates = [
      String(s.target_title || "").trim(),
      `อ่านเพิ่มเติม: ${String(s.target_title || "").trim()}`,
      `${String(currentItem.category || "").trim()} - ${String(s.target_title || "").trim()}`,
    ].filter(Boolean);

    const anchorText = anchorCandidates.find((a) => {
      const key = a.toLowerCase();
      return key && !usedAnchors.has(key);
    });

    if (!anchorText) continue;

    usedTargets.add(s.target_slug);
    usedAnchors.add(anchorText.toLowerCase());

    suggestions.push({
      target_content_item_id: s.target_content_item_id,
      anchor_text: anchorText,
      relevance_score: s.relevance_score,
      reason: s.reason,
      status: "suggested",
    });
  }

  return suggestions;
}

function buildSourceFingerprint(article) {
  return [
    Number(article?.content_item_id || 0),
    Number(article?.draft_id || 0),
    Number(article?.review_report_id || 0),
  ].join(":");
}

function validateImageWorkflowReady(repo, itemId) {
  const status = repo.getImageWorkflowStatus(itemId);
  return {
    ok: Boolean(status?.is_ready_for_ai_draft),
    status,
  };
}
function dedupeAndLimit(values, limit = 4) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(values) ? values : [];

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

const DRAFT_BRIEF_SECTION_LIMITS = Object.freeze({
  place_identity: 3,
  standout_points: 6,
  atmosphere: 4,
  food_and_drink: 4,
  social_proof: 5,
  caveats: 1,
  practical_info: 4,
  description_rollup: 14,
});

function buildDraftBriefFromApprovedContext(preview) {
  const blocks = Array.isArray(preview?.approved_context) ? preview.approved_context : [];
  const brief = {
    place_identity: [],
    standout_points: [],
    atmosphere: [],
    food_and_drink: [],
    social_proof: [],
    caveats: [],
    practical_info: [],
  };

  for (const block of blocks) {
    const contextType = String(block?.context_type || "").trim().toLowerCase();
    const selectedText = String(block?.selected_text || "").trim();
    const selectedNumeric = block?.selected_numeric;
    const selectedList = Array.isArray(block?.selected_list) ? block.selected_list : [];
    const lower = selectedText.toLowerCase();

    if (contextType === "media") continue;
    if (!selectedText && selectedNumeric == null && selectedList.length === 0) continue;

    const hasPhoneHint = /(^|\b)(phone|tel|โทร)\b/i.test(lower);
    const hasAddressHint = /(address|ที่อยู่|ตำบล|อำเภอ|จังหวัด|road|rd\.|soi|tambon|amphoe|chang wat)/i.test(lower);
    const hasBusinessStatusHint = /(business status|open|operational|closed|ย้าย|เปิด|ปิด)/i.test(lower);
    const hasFoodHint = /(coffee|cafe|bakery|dessert|เมนู|อาหาร|เครื่องดื่ม|ขนม|sushi|ramen|tempura|restaurant)/i.test(lower);
    const hasAtmosphereHint = /(atmosphere|บรรยากาศ|สวน|ชิลล์|วิว|นั่ง|cozy|garden)/i.test(lower);
    const hasCaveatHint = /(but|however|wait|long|delay|ช้า|รอ|crowded|คนเยอะ|ไม่ค่อย|ปัญหา|ควรระวัง)/i.test(lower);

    if (contextType === "social_proof") {
      if (/rating/i.test(lower) && selectedNumeric != null && Number.isFinite(Number(selectedNumeric))) {
        brief.social_proof.push(`คะแนนรีวิวเฉลี่ยประมาณ ${Number(selectedNumeric)} คะแนน`);
        continue;
      }
      if (/review count/i.test(lower) && selectedNumeric != null && Number.isFinite(Number(selectedNumeric))) {
        brief.social_proof.push(`มีรีวิวประมาณ ${Number(selectedNumeric)} รายการ`);
        continue;
      }
      if (selectedText) {
        brief.social_proof.push(selectedText);
        continue;
      }
    }

    if (hasPhoneHint || hasAddressHint || hasBusinessStatusHint) {
      if (selectedText) brief.practical_info.push(selectedText);
      continue;
    }

    if (contextType === "review_snippet") {
      if (hasCaveatHint) {
        const caution = toSoftCaution(selectedText || `ข้อสังเกตจากรีวิว: ${Number(selectedNumeric || 0)}`);
        if (caution) brief.caveats.push(caution);
      } else if (hasAtmosphereHint) {
        brief.atmosphere.push(selectedText || "รีวิวเชิงบรรยากาศเชิงบวก");
      } else {
        brief.standout_points.push(selectedText || "รีวิวเชิงประสบการณ์ผู้ใช้");
      }
      continue;
    }

    if (contextType === "fact" && /^name\s*:/i.test(lower)) {
      brief.place_identity.push(selectedText);
      continue;
    }

    if (contextType === "mention" && hasFoodHint) {
      brief.food_and_drink.push(selectedText);
      continue;
    }

    if (hasFoodHint) {
      brief.food_and_drink.push(selectedText);
      continue;
    }

    if (hasAtmosphereHint) {
      brief.atmosphere.push(selectedText);
      continue;
    }

    if (hasCaveatHint) {
      const caution = toSoftCaution(selectedText);
      if (caution) brief.caveats.push(caution);
      continue;
    }

    if (selectedText) {
      if (contextType === "fact") {
        brief.place_identity.push(selectedText);
      } else {
        brief.standout_points.push(selectedText);
      }
    } else if (selectedNumeric != null && Number.isFinite(Number(selectedNumeric))) {
      brief.social_proof.push(`${contextType || "signal"}: ${Number(selectedNumeric)}`);
    } else if (selectedList.length > 0) {
      brief.standout_points.push(selectedList.map((x) => String(x)).filter(Boolean).join(", "));
    }
  }

  return {
    place_identity: dedupeAndLimit(brief.place_identity, DRAFT_BRIEF_SECTION_LIMITS.place_identity),
    standout_points: dedupeAndLimit(brief.standout_points, DRAFT_BRIEF_SECTION_LIMITS.standout_points),
    atmosphere: dedupeAndLimit(brief.atmosphere, DRAFT_BRIEF_SECTION_LIMITS.atmosphere),
    food_and_drink: dedupeAndLimit(brief.food_and_drink, DRAFT_BRIEF_SECTION_LIMITS.food_and_drink),
    social_proof: dedupeAndLimit(brief.social_proof, DRAFT_BRIEF_SECTION_LIMITS.social_proof),
    caveats: dedupeAndLimit(brief.caveats, DRAFT_BRIEF_SECTION_LIMITS.caveats),
    practical_info: dedupeAndLimit(brief.practical_info, DRAFT_BRIEF_SECTION_LIMITS.practical_info),
  };
}

function buildDescriptionFromDraftBrief(draftBrief) {
  const sections = [
    ...(Array.isArray(draftBrief?.place_identity) ? draftBrief.place_identity : []),
    ...(Array.isArray(draftBrief?.standout_points) ? draftBrief.standout_points : []),
    ...(Array.isArray(draftBrief?.atmosphere) ? draftBrief.atmosphere : []),
    ...(Array.isArray(draftBrief?.food_and_drink) ? draftBrief.food_and_drink : []),
    ...(Array.isArray(draftBrief?.social_proof) ? draftBrief.social_proof : []),
    ...(Array.isArray(draftBrief?.caveats) ? draftBrief.caveats.slice(0, 1) : []),
    ...(Array.isArray(draftBrief?.practical_info) ? draftBrief.practical_info : []),
  ];
  return dedupeAndLimit(sections, DRAFT_BRIEF_SECTION_LIMITS.description_rollup).join("\n").trim();
}
function firstNonEmpty(values) {
  const list = Array.isArray(values) ? values : [];
  for (const value of list) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function summarizeSignals(values, limit = 2) {
  const picked = dedupeAndLimit(values, limit);
  if (!picked.length) return "";
  if (picked.length === 1) return picked[0];
  return `${picked.slice(0, -1).join("; ")}; ${picked[picked.length - 1]}`;
}

function isLikelyNegativeText(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return false;
  return /(however|but|wait|delay|long wait|crowded|too noisy|not good|bad|ช้า|รอ|คนเยอะ|ไม่ค่อย|ปัญหา|ควรระวัง)/i.test(text);
}

function toSoftCaution(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!isLikelyNegativeText(text)) return text;
  if (/(wait|delay|long wait|ช้า|รอ)/i.test(text)) return "ช่วงคนเยอะอาจต้องเผื่อเวลารอเล็กน้อย";
  if (/(crowded|คนเยอะ)/i.test(text)) return "แนะนำเลือกช่วงเวลาที่คนไม่หนาแน่นเพื่อบรรยากาศที่สบายขึ้น";
  return "ควรเผื่อเวลาและเลือกช่วงที่เหมาะกับสไตล์การเที่ยวของคุณ";
}

function keepPositiveFirst(values, limit = 4) {
  const list = Array.isArray(values) ? values : [];
  const positive = [];
  const fallback = [];
  for (const raw of list) {
    const text = String(raw || "").trim();
    if (!text) continue;
    if (isLikelyNegativeText(text)) {
      fallback.push(toSoftCaution(text));
    } else {
      positive.push(text);
    }
  }
  return dedupeAndLimit([...positive, ...fallback], limit);
}


const FIRST_PERSON_PATTERNS = [
  /\b(i|i'm|ive|i’ve|me|my|we|we're|weve|we’ve|our|us)\b/gi,
  /\b(i think|i feel|i found|we found|we think)\b/gi,
  /(ผม|ฉัน|ดิฉัน|หนู|เรา|พวกเรา)\s*(คิดว่า|รู้สึกว่า|ไปมา|แวะมา|มา|เจอ|ลอง|สั่ง|ชอบ|ไม่ชอบ)/gi,
];

function sanitizeMaterialText(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let text = raw
    .replace(/^\[[a-z_]+\]\s*/i, "")
    .replace(/^name\s*:\s*/i, "")
    .replace(/\|\s*numeric\s*=\s*[-+]?\d+(\.\d+)?/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  for (const pattern of FIRST_PERSON_PATTERNS) {
    text = text.replace(pattern, "");
  }

  text = text
    .replace(/\s{2,}/g, " ")
    .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, "")
    .trim();

  if (text.length < 12) return "";
  return text;
}

function normalizeNarrativeReviewLine(value) {
  let text = sanitizeMaterialText(value);
  if (!text) return "";
  text = text
    .replace(/^(but|however|though|although)\b[\s,:-]*/i, "")
    .replace(/^(แต่|อย่างไรก็ตาม|ทว่า|แม้ว่า)\s*/i, "")
    .trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function materialFromApprovedContext(preview, contextType) {
  const blocks = Array.isArray(preview?.approved_context) ? preview.approved_context : [];
  return blocks
    .filter((block) => String(block?.context_type || "").toLowerCase() === String(contextType || "").toLowerCase())
    .map((block) => sanitizeMaterialText(block?.selected_text || ""))
    .filter(Boolean);
}

function buildSourceMaterialPack(preview, draftBrief, editorialBrief, storyFrame, supportingEvidencePack) {
  const reviewMaterialRaw = materialFromApprovedContext(preview, "review_snippet");
  const reviewMaterial = keepPositiveFirst(
    reviewMaterialRaw.map((x) => normalizeNarrativeReviewLine(x)).filter(Boolean),
    8
  );

  const experienceMaterial = keepPositiveFirst([
    ...reviewMaterial,
    ...(Array.isArray(supportingEvidencePack?.experience_details) ? supportingEvidencePack.experience_details : []),
    ...(Array.isArray(storyFrame?.supporting_details) ? storyFrame.supporting_details : []),
    ...(Array.isArray(draftBrief?.standout_points) ? draftBrief.standout_points : []),
    ...(Array.isArray(draftBrief?.atmosphere) ? draftBrief.atmosphere : []),
  ].map((x) => sanitizeMaterialText(x)).filter(Boolean), 10);

  const offerMaterial = keepPositiveFirst([
    ...(Array.isArray(draftBrief?.food_and_drink) ? draftBrief.food_and_drink : []),
    ...(Array.isArray(supportingEvidencePack?.offer_details) ? supportingEvidencePack.offer_details : []),
    editorialBrief?.offer_summary,
  ].map((x) => sanitizeMaterialText(x)).filter(Boolean), 8);

  const socialMaterial = dedupeAndLimit([
    ...(Array.isArray(supportingEvidencePack?.social_proof_points) ? supportingEvidencePack.social_proof_points : []),
    ...(Array.isArray(draftBrief?.social_proof) ? draftBrief.social_proof : []),
    editorialBrief?.social_signal_summary,
  ].map((x) => sanitizeMaterialText(x)).filter(Boolean), 8);

  const tailMaterial = dedupeAndLimit([
    ...(Array.isArray(draftBrief?.practical_info) ? draftBrief.practical_info : []),
    ...(Array.isArray(storyFrame?.tail_only_details) ? storyFrame.tail_only_details : []),
    ...(Array.isArray(draftBrief?.caveats) ? draftBrief.caveats : []),
  ].map((x) => sanitizeMaterialText(toSoftCaution(x))).filter(Boolean), 8);

  return {
    review_material: reviewMaterial,
    experience_material: experienceMaterial,
    offer_material: offerMaterial,
    social_material: socialMaterial,
    tail_material: tailMaterial,
  };
}
function buildAudienceHint(item, draftBrief) {
  const atmosphere = Array.isArray(draftBrief?.atmosphere) ? draftBrief.atmosphere : [];
  const foodAndDrink = Array.isArray(draftBrief?.food_and_drink) ? draftBrief.food_and_drink : [];
  const standoutPoints = Array.isArray(draftBrief?.standout_points) ? draftBrief.standout_points : [];
  const merged = [...atmosphere, ...foodAndDrink, ...standoutPoints].join(" ").toLowerCase();

  if (/(coffee|cafe|ขนม|เบเกอรี่|bakery|dessert)/i.test(merged)) {
    return "เหมาะกับคนที่อยากหาร้านนั่งชิลล์พร้อมกาแฟหรือขนม";
  }
  if (/(restaurant|อาหาร|เมนู|ramen|sushi|tempura)/i.test(merged)) {
    return "เหมาะกับคนที่อยากแวะกินมื้อสบายๆ พร้อมบรรยากาศที่มีเอกลักษณ์";
  }
  if (item?.category) {
    return `เหมาะกับคนที่กำลังมองหาสถานที่แนว ${String(item.category).trim()}`;
  }
  return "";
}

function buildSupportingEvidencePack(draftBrief, editorialBrief, storyFrame) {
  const reviewSnippets = keepPositiveFirst([
    ...(Array.isArray(draftBrief?.standout_points) ? draftBrief.standout_points : []),
    ...(Array.isArray(draftBrief?.atmosphere) ? draftBrief.atmosphere : []),
    ...(Array.isArray(draftBrief?.food_and_drink) ? draftBrief.food_and_drink : []),
  ], 4);

  const experienceDetails = keepPositiveFirst([
    ...(Array.isArray(editorialBrief?.experience_signals) ? editorialBrief.experience_signals : []),
    ...(Array.isArray(editorialBrief?.top_highlights) ? editorialBrief.top_highlights : []),
    ...(Array.isArray(storyFrame?.supporting_details) ? storyFrame.supporting_details : []),
  ], 5);

  const offerDetails = keepPositiveFirst([
    ...(Array.isArray(draftBrief?.food_and_drink) ? draftBrief.food_and_drink : []),
    editorialBrief?.offer_summary,
  ], 3);

  const socialProofPoints = keepPositiveFirst([
    ...(Array.isArray(draftBrief?.social_proof) ? draftBrief.social_proof : []),
    editorialBrief?.social_signal_summary,
    ...(Array.isArray(editorialBrief?.proof_points) ? editorialBrief.proof_points : []),
  ], 3);

  const tailFacts = dedupeAndLimit([
    ...(Array.isArray(storyFrame?.tail_only_details) ? storyFrame.tail_only_details : []),
    ...(Array.isArray(editorialBrief?.practical_tail) ? editorialBrief.practical_tail : []),
  ].map((x) => toSoftCaution(x)).filter(Boolean), 3);

  return {
    review_snippets: reviewSnippets,
    experience_details: experienceDetails,
    offer_details: offerDetails,
    social_proof_points: socialProofPoints,
    tail_facts: tailFacts,
  };
}
function buildStoryFrame(item, draftBrief, editorialBrief) {
  const atmosphere = Array.isArray(draftBrief?.atmosphere) ? draftBrief.atmosphere : [];
  const foodAndDrink = Array.isArray(draftBrief?.food_and_drink) ? draftBrief.food_and_drink : [];
  const socialProof = Array.isArray(draftBrief?.social_proof) ? draftBrief.social_proof : [];
  const caveats = Array.isArray(draftBrief?.caveats) ? draftBrief.caveats : [];
  const standoutPoints = Array.isArray(draftBrief?.standout_points) ? draftBrief.standout_points : [];

  let frameType = "hybrid-experience";
  if (foodAndDrink.length >= 2 && atmosphere.length >= 1) {
    frameType = "food-first";
  } else if (atmosphere.length >= 2) {
    frameType = "atmosphere-first";
  } else if (socialProof.length >= 2) {
    frameType = "social-proof-first";
  } else if (standoutPoints.length >= 2) {
    frameType = "worth-a-stop";
  }

  return {
    frame_type: frameType,
    opening_focus: firstNonEmpty([
      editorialBrief?.editorial_hook,
      editorialBrief?.primary_angle,
      standoutPoints[0],
      item?.title,
    ]),
    core_reason_to_feature: firstNonEmpty([
      editorialBrief?.why_it_matters,
      editorialBrief?.primary_angle,
      standoutPoints[0],
    ]),
    supporting_details: keepPositiveFirst([
      ...(Array.isArray(editorialBrief?.top_highlights) ? editorialBrief.top_highlights : []),
      ...(Array.isArray(editorialBrief?.experience_signals) ? editorialBrief.experience_signals : []),
      ...socialProof,
    ], 5),
    tail_only_details: dedupeAndLimit([
      ...(Array.isArray(editorialBrief?.practical_tail) ? editorialBrief.practical_tail : []),
      ...caveats,
    ], 3),
  };
}
function buildEditorialBrief(item, draftBrief) {
  const placeIdentity = Array.isArray(draftBrief?.place_identity) ? draftBrief.place_identity : [];
  const standoutPoints = Array.isArray(draftBrief?.standout_points) ? draftBrief.standout_points : [];
  const atmosphere = Array.isArray(draftBrief?.atmosphere) ? draftBrief.atmosphere : [];
  const foodAndDrink = Array.isArray(draftBrief?.food_and_drink) ? draftBrief.food_and_drink : [];
  const socialProof = Array.isArray(draftBrief?.social_proof) ? draftBrief.social_proof : [];
  const caveats = Array.isArray(draftBrief?.caveats) ? draftBrief.caveats : [];
  const practicalInfo = Array.isArray(draftBrief?.practical_info) ? draftBrief.practical_info : [];

  const primaryAngle = firstNonEmpty([
    standoutPoints[0],
    atmosphere[0],
    foodAndDrink[0],
    socialProof[0],
    placeIdentity[0],
    item?.title,
  ]);

  const topHighlights = keepPositiveFirst([
    ...standoutPoints,
    ...atmosphere,
    ...foodAndDrink,
  ], 4);

  const proofPoints = keepPositiveFirst([
    ...socialProof,
    ...standoutPoints.slice(0, 2),
    ...foodAndDrink.slice(0, 1),
  ], 4);

  const editorialHook = firstNonEmpty([
    summarizeSignals([atmosphere[0], standoutPoints[0], foodAndDrink[0]], 2),
    primaryAngle,
    item?.title,
  ]);

  const experienceSignals = keepPositiveFirst([
    ...atmosphere,
    ...foodAndDrink,
    ...standoutPoints,
  ], 5);

  return {
    place_label: firstNonEmpty([item?.title, placeIdentity[0], ""]),
    editorial_hook: editorialHook,
    primary_angle: primaryAngle,
    why_it_matters: summarizeSignals([
      standoutPoints[1],
      atmosphere[0],
      foodAndDrink[0],
      socialProof[0],
    ], 2),
    top_highlights: topHighlights,
    experience_signals: experienceSignals,
    atmosphere_summary: summarizeSignals(atmosphere, 2),
    offer_summary: summarizeSignals(foodAndDrink, 2),
    social_signal_summary: summarizeSignals(socialProof, 3),
    proof_points: proofPoints,
    who_it_is_for: buildAudienceHint(item, draftBrief),
    caveat_summary: summarizeSignals(caveats, 1),
    practical_tail: dedupeAndLimit(practicalInfo, 2),
  };
}

function parseTargetLangs() {
  const raw = String(process.env.TRANSLATION_TARGET_LANGS || "en,zh,lo").trim();
  return raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function sourceToTranslationInput(article) {
  return {
    title: article.title || "",
    excerpt: article.excerpt || "",
    body: article.body || "",
    meta_title: article.meta_title || article.title || "",
    meta_description: article.meta_description || article.excerpt || "",
    source_lang: article.source_lang || "th",
    slug: article.slug || "",
    category: article.category || "",
  };
}

function normalizeTranslationSource(source) {
  return {
    id: Number(source?.id || 0) || 0,
    content_item_id: Number(source?.content_item_id || 0) || 0,
    draft_id: Number(source?.draft_id || 0) || 0,
    review_report_id: Number(source?.review_report_id || 0) || 0,
    source_kind: String(source?.source_kind || "").trim().toLowerCase() || null,
    assignment_id: Number(source?.assignment_id || 0) || 0,
    submission_id: Number(source?.submission_id || 0) || 0,
    article_draft_deliverable_id: Number(source?.article_draft_deliverable_id || 0) || 0,
    title: String(source?.title || "").trim(),
    excerpt: String(source?.excerpt || "").trim(),
    body: String(source?.body || "").trim(),
    meta_title: String(source?.meta_title || source?.title || "").trim(),
    meta_description: String(source?.meta_description || source?.excerpt || "").trim(),
    source_lang: String(source?.source_lang || source?.lang || "th").trim().toLowerCase() || "th",
    slug: String(source?.slug || "").trim(),
    category: String(source?.category || "").trim(),
  };
}

function normalizeFailureReason(value, fallback = "translation_failed") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || fallback;
}

function buildTranslationDiagnostics(article, lang, provider, model) {
  return {
    item_id: Number(article?.content_item_id || 0) || null,
    source_kind: String(article?.source_kind || "").trim().toLowerCase() || null,
    source_title: String(article?.title || "").trim() || null,
    source_body_length: String(article?.body || "").trim().length,
    article_draft_deliverable_id: Number(article?.article_draft_deliverable_id || 0) || null,
    target_language: String(lang || "").trim().toLowerCase() || null,
    provider: String(provider || "").trim() || null,
    model: String(model || "").trim() || null,
    requested_lang_code: String(lang || "").trim().toLowerCase() || null,
  };
}

const TRANSLATION_PROVIDER_TIMEOUT_MS = 55_000;

function createTranslationProviderTimeoutError(durationMs) {
  const error = new Error(`translation provider timed out after ${durationMs}ms`);
  error.code = "translation_provider_timeout";
  error.duration_ms = Number(durationMs || 0) || TRANSLATION_PROVIDER_TIMEOUT_MS;
  return error;
}

async function withTranslationProviderTimeout(promise, timeoutMs = TRANSLATION_PROVIDER_TIMEOUT_MS) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(createTranslationProviderTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildDraftTranslationSource(repo, contentItemId) {
  const itemId = Number(contentItemId || 0);
  if (!itemId) {
    throw new Error("content_item_id is required");
  }

  const item = repo.getItem(itemId);
  if (!item) {
    throw new Error("item not found");
  }

  const publishableSource = typeof repo.buildPublishableSourceByItem === "function"
    ? repo.buildPublishableSourceByItem(itemId)
    : null;
  if (publishableSource?.ready_for_publish_source && publishableSource?.resolved_article) {
    const resolved = publishableSource.resolved_article;
    return normalizeTranslationSource({
      id: 0,
      content_item_id: itemId,
      draft_id: 0,
      review_report_id: 0,
      source_kind: publishableSource?.source?.source_kind || "assignment_submission_article_draft",
      assignment_id: publishableSource?.source?.assignment_id || 0,
      submission_id: publishableSource?.source?.latest_submission_id || 0,
      article_draft_deliverable_id: publishableSource?.source?.article_draft_deliverable_id || 0,
      title: resolved?.title || item.title || "",
      excerpt: resolved?.excerpt || item.summary || "",
      body: resolved?.body || item.description_clean || item.description_raw || "",
      meta_title: resolved?.meta_title || item.meta_title || resolved?.title || item.title || "",
      meta_description: resolved?.meta_description || item.meta_description || resolved?.excerpt || item.summary || "",
      source_lang: item.lang || "th",
      slug: item.slug || "",
      category: item.category || "",
    });
  }

  const latestDraft = repo.latestDraftByItem(itemId);
  const approvedReview = typeof repo.latestApprovedReviewByItem === "function"
    ? repo.latestApprovedReviewByItem(itemId)
    : null;

  return normalizeTranslationSource({
    id: 0,
    content_item_id: itemId,
    draft_id: latestDraft?.id || 0,
    review_report_id: approvedReview?.id || 0,
    title: latestDraft?.draft_title || item.title || "",
    excerpt: latestDraft?.excerpt || latestDraft?.summary || item.summary || "",
    body: latestDraft?.body || item.description_clean || item.description_raw || "",
    meta_title: latestDraft?.meta_title || item.meta_title || latestDraft?.draft_title || item.title || "",
    meta_description: latestDraft?.meta_description || item.meta_description || latestDraft?.excerpt || latestDraft?.summary || item.summary || "",
    source_lang: item.lang || "th",
    slug: latestDraft?.slug || item.slug || "",
    category: item.category || "",
  });
}

async function runTranslationStageForSources(repo, translationSources, aiConfig, actorEmail = "system@local", stage = "final-prefrontend", options = {}) {
  const normalizedSources = translationSources.map((source) => normalizeTranslationSource(source)).filter((source) => source.content_item_id);
  const targets = parseTargetLangs();
  const translator = createTranslationGenerator(aiConfig);
  const runUid = repo.startTranslationRun(stage, normalizedSources.length, "Translation started");
  const forceRegenerate = options?.forceRegenerate === true;

  let generatedCount = 0;
  let failedCount = 0;
  const languageResults = [];

  for (const article of normalizedSources) {
    const sourceLang = String(article.source_lang || "th").trim().toLowerCase();
    const sourceFingerprint = buildSourceFingerprint(article);

    repo.markStaleTranslations(article.content_item_id, sourceFingerprint);

    for (const lang of targets) {
      if (lang === sourceLang) continue;

      const existing = repo.getTranslation(article.content_item_id, lang);
      if (
        !forceRegenerate &&
        existing &&
        existing.source_fingerprint === sourceFingerprint &&
        Number(existing.stale_flag || 0) === 0 &&
        existing.automatic_check_status === "passed" &&
        existing.translation_status === "ready"
      ) {
        continue;
      }

      const translationConfig = aiConfig?.features?.translation || aiConfig || {};
      const preferredProvider = String(translationConfig?.provider || aiConfig?.translationProvider || aiConfig?.provider || "").trim().toLowerCase();
      const hasProviderConfig = Boolean(aiConfig?.enabled);
      const defaultTranslatorEngine = hasProviderConfig ? preferredProvider : "deterministic";
      const defaultTranslatorModel = String(translationConfig?.model || aiConfig?.translationModel || aiConfig?.model || "deterministic").trim() || "deterministic";
      const diagnostics = buildTranslationDiagnostics(article, lang, defaultTranslatorEngine, defaultTranslatorModel);
      const sourceBody = String(article.body || "").trim();
      traceTranslationDiagnostics("translation_attempt_start", diagnostics);

      try {
        if (!sourceBody.length) {
          throw Object.assign(new Error("missing_article_draft_body"), { code: "missing_article_draft_body" });
        }

        const translated = await withTranslationProviderTimeout(
          translator.translate(sourceToTranslationInput(article), lang),
          TRANSLATION_PROVIDER_TIMEOUT_MS
        );
        const translatorEngine = String(translated?._engine || defaultTranslatorEngine).trim();
        const translatorModel = String(translated?._model || defaultTranslatorModel).trim();
        const targetLanguageLabel = String(translated?._target_lang_label || "").trim() || null;
        const promptLanguageInstructionPreview = String(translated?._prompt_language_instruction_preview || "").trim() || null;

        const check = runAutomaticTranslationChecks({
          target_lang: lang,
          source_fingerprint: sourceFingerprint,
          expected_source_fingerprint: sourceFingerprint,
          translated_title: translated.translated_title,
          translated_excerpt: translated.translated_excerpt,
          translated_body: translated.translated_body,
          translated_meta_title: translated.translated_meta_title,
          translated_meta_description: translated.translated_meta_description,
        });

        repo.upsertTranslation({
          source_content_item_id: article.content_item_id,
          source_published_article_id: article.id || null,
          source_draft_id: article.draft_id || null,
          source_review_report_id: article.review_report_id || null,
          source_fingerprint: sourceFingerprint,
          lang,
          translated_title: translated.translated_title,
          translated_excerpt: translated.translated_excerpt,
          translated_body: translated.translated_body,
          translated_meta_title: translated.translated_meta_title,
          translated_meta_description: translated.translated_meta_description,
          translation_status: check.status === "passed" ? "ready" : "check_failed",
          automatic_check_status: check.status,
          automatic_check_report: check,
          stale_flag: 0,
          translator_engine: translatorEngine,
          translator_model: translatorModel,
        });

        if (check.status === "passed") {
          generatedCount += 1;
          languageResults.push({ lang, status: "generated", failure_reason: null });
          traceTranslationDiagnostics("translation_attempt_success", {
            ...diagnostics,
            requested_lang_code: String(translated?._target_lang || lang || "").trim().toLowerCase() || diagnostics.requested_lang_code,
            resolved_target_language_label: targetLanguageLabel,
            prompt_language_instruction_preview: promptLanguageInstructionPreview,
            provider: translatorEngine || diagnostics.provider,
            model: translatorModel || diagnostics.model,
            translation_status: "ready",
            automatic_check_status: check.status,
          });
        } else {
          failedCount += 1;
          const debugDetails = String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production"
            && check?.debug
            && typeof check.debug === "object"
            ? {
              ...check.debug,
              requested_lang_code: String(translated?._target_lang || lang || "").trim().toLowerCase() || diagnostics.requested_lang_code,
              resolved_target_language_label: targetLanguageLabel,
              prompt_language_instruction_preview: promptLanguageInstructionPreview,
              provider: translatorEngine || diagnostics.provider,
              model: translatorModel || diagnostics.model,
            }
            : null;
          languageResults.push({
            lang,
            status: "failed",
            failure_reason: "automatic_check_failed",
            ...(debugDetails || {}),
          });
          traceTranslationDiagnostics("translation_attempt_check_failed", {
            ...diagnostics,
            requested_lang_code: String(translated?._target_lang || lang || "").trim().toLowerCase() || diagnostics.requested_lang_code,
            resolved_target_language_label: targetLanguageLabel,
            prompt_language_instruction_preview: promptLanguageInstructionPreview,
            provider: translatorEngine || diagnostics.provider,
            model: translatorModel || diagnostics.model,
            failure_reason: "automatic_check_failed",
            issues: Array.isArray(check?.issues) ? check.issues : [],
            automatic_check_debug: debugDetails,
          });
        }
      } catch (err) {
        failedCount += 1;
        const failureReason = normalizeFailureReason(err?.code || err?.message, "translation_failed");
        const failureMessage = String(err?.message || "translation failed");
        const debugDetails = {};
        if (Number.isFinite(Number(err?.duration_ms))) {
          debugDetails.duration_ms = Number(err.duration_ms);
        }
        if (failureReason === "invalid_translation_json_payload" && String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
          if (typeof err?.parse_error === "string" || err?.parse_error === null) {
            debugDetails.parse_error = err.parse_error ?? null;
          }
          if (Array.isArray(err?.validation_errors)) {
            debugDetails.validation_errors = err.validation_errors;
          }
          if (typeof err?.raw_response_preview === "string") {
            debugDetails.raw_response_preview = err.raw_response_preview;
          }
          if (Number.isFinite(Number(err?.raw_response_length))) {
            debugDetails.raw_response_length = Number(err.raw_response_length);
          }
          if (typeof err?.raw_response_ends_with === "string") {
            debugDetails.raw_response_ends_with = err.raw_response_ends_with;
          }
          if (typeof err?.raw_response_starts_with_brace === "boolean") {
            debugDetails.raw_response_starts_with_brace = err.raw_response_starts_with_brace;
          }
          if (typeof err?.raw_response_ends_with_brace === "boolean") {
            debugDetails.raw_response_ends_with_brace = err.raw_response_ends_with_brace;
          }
        }
        repo.upsertTranslation({
          source_content_item_id: article.content_item_id,
          source_published_article_id: article.id || null,
          source_draft_id: article.draft_id || null,
          source_review_report_id: article.review_report_id || null,
          source_fingerprint: sourceFingerprint,
          lang,
          translated_title: null,
          translated_excerpt: null,
          translated_body: null,
          translated_meta_title: null,
          translated_meta_description: null,
          translation_status: "failed",
          automatic_check_status: "failed",
          automatic_check_report: { status: "failed", issues: [failureMessage], failure_reason: failureReason, ...debugDetails },
          stale_flag: 0,
          translator_engine: defaultTranslatorEngine,
          translator_model: defaultTranslatorModel,
        });
        languageResults.push({ lang, status: "failed", failure_reason: failureReason, ...debugDetails });
        traceTranslationDiagnostics("translation_attempt_failed", {
          ...diagnostics,
          failure_reason: failureReason,
          error_message: failureMessage,
          ...debugDetails,
        });
      }
    }
  }

  repo.finishTranslationRun(
    runUid,
    "done",
    generatedCount,
    failedCount,
    "Translation ready=" + generatedCount + " failed=" + failedCount
  );
  repo.logAudit(actorEmail, "translation.final_stage", "translation_run", runUid, { generatedCount, failedCount });

  return { run_uid: runUid, generated_count: generatedCount, failed_count: failedCount, languages: languageResults };
}

async function runFinalTranslationStage(repo, publishedArticles, aiConfig, actorEmail = "system@local") {
  return runTranslationStageForSources(repo, publishedArticles, aiConfig, actorEmail, "final-prefrontend");
}

export async function rerunProblemTranslations(repo, actorEmail, options = {}) {
  const contentItemId = Number(options.contentItemId || options.content_item_id || 0) || null;
  let translationSources = [];
  let stage = "final-prefrontend";

  if (contentItemId) {
    const publishedArticle = typeof repo.getPublishedArticleByItem === "function"
      ? repo.getPublishedArticleByItem(contentItemId)
      : null;
    if (publishedArticle) {
      translationSources = [publishedArticle];
    } else {
      translationSources = [buildDraftTranslationSource(repo, contentItemId)];
      stage = "pre-sync-item";
    }
  } else {
    translationSources = repo.listPublishedArticles();
  }

  if (!translationSources.length) {
    throw new Error("ไม่พบ source content สำหรับสร้าง translation");
  }

  const summary = await runTranslationStageForSources(
    repo,
    translationSources,
    options.aiConfig || null,
    actorEmail,
    stage,
    { forceRegenerate: options.forceRegenerate === true }
  );
  const rows = contentItemId ? repo.listTranslations(contentItemId) : repo.listTranslations();

  const pass = rows.filter((row) => row.translation_status === "ready" && row.automatic_check_status === "passed" && Number(row.stale_flag || 0) === 0).length;
  const failed = rows.filter((row) => row.translation_status === "failed" || row.automatic_check_status === "failed" || row.translation_status === "check_failed").length;
  const stale = rows.filter((row) => Number(row.stale_flag || 0) === 1 || row.translation_status === "stale").length;
  const pending = Math.max(0, rows.length - pass - failed - stale);

  return {
    content_item_id: contentItemId,
    translation_run: summary,
    generated_count: Number(summary?.generated_count || 0) || 0,
    failed_count: Number(summary?.failed_count || 0) || 0,
    languages: Array.isArray(summary?.languages) ? summary.languages : [],
    totals: {
      passed: pass,
      failed,
      stale,
      pending,
      total: rows.length,
    },
  };
}

export async function runCleanStage(repo, actorEmail) {
  const runUid = repo.createPipelineRun("clean", "running", 0, 0, "Cleaner started");
  const rawItems = repo.listItemsByWorkflowHead({ production_states: ["collected"] });
  const normalized = rawItems.map((item, idx) => mapFromDb(item, idx + 1));
  const cleaned = cleanReviewsAndContent(normalized);

  for (const item of cleaned) {
    repo.saveItem(
      {
        id: item.id,
        type: item.type,
        category: item.category,
        lang: item.lang,
        title: item.title,
        normalized_title: item.title,
        description_raw: item.description,
        description_clean: item.description,
        latitude: item.latitude,
        longitude: item.longitude,
        map_url: item.map_url,
        google_place_id: item.google_place_id,
      image_url: item.image,
      tags: item.tags,
      source_name: item.source_name,
      source_url: item.source_url,
      source_type: "manual",
    },
    actorEmail
  );
    try {
      repo.upsertWorkflowModel(
        item.id,
        {
          production_state: "analyzed",
          last_transition_note: "clean stage completed",
        },
        actorEmail,
        { actor_role: "system", reason_code: "clean_stage_completed", bump_state_version: true }
      );
    } catch (err) {
      repo.logAudit(actorEmail, "workflow.sync.skipped", "content_item", String(item.id), {
        stage: "clean",
        target_production_state: "analyzed",
        reason: String(err?.message || "state sync failed"),
      });
    }
  }

  repo.finishPipelineRun(runUid, "done", cleaned.length, "Cleaner completed");
  return { count: cleaned.length };
}

function mergeDraft(baseItem, draft) {
  return {
    ...baseItem,
    slug: normalizePublishSlug(draft.slug || baseItem.slug, `item-${Number(baseItem?.id || 0) || "draft"}`),
    summary: draft.summary || draft.excerpt || baseItem.summary,
    meta_title: draft.meta_title || baseItem.meta_title,
    meta_description: draft.meta_description || baseItem.meta_description,
    description: draft.body || draft.description_clean || draft.description || baseItem.description,
    draft_title: draft.draft_title || baseItem.title,
    excerpt: draft.excerpt || draft.summary || "",
    body: draft.body || draft.description_clean || draft.description || baseItem.description,
    suggested_related: Array.isArray(draft.suggested_related) ? draft.suggested_related : [],
    ai_quality_score: draft.ai_quality_score ?? 0,
  };
}

function selectVisualImageUrls(imageContext, limit = 5) {
  const max = Math.max(1, Math.min(5, Number(limit || 5)));
  const cover = String(imageContext?.cover_url || "").trim();
  const selected = Array.isArray(imageContext?.selected_urls) ? imageContext.selected_urls : [];
  const gallery = Array.isArray(imageContext?.gallery_urls) ? imageContext.gallery_urls : [];
  const inline = Array.isArray(imageContext?.inline_urls) ? imageContext.inline_urls : [];
  const merged = [cover, ...selected, ...gallery, ...inline].map((x) => String(x || "").trim()).filter(Boolean);
  const out = [];
  const seen = new Set();

  for (const url of merged) {
    if (!/^https?:\/\//i.test(url) && !url.startsWith("/api/")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }

  return out;
}

function buildDescriptionFromStructuredContext(preview) {
  const approved = Array.isArray(preview?.approved_context) ? preview.approved_context : [];
  const lines = [];
  const seen = new Set();

  for (const block of approved) {
    const text = String(block?.selected_text || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(text);
    if (lines.length >= 8) break;
  }

  return lines.join("\n").trim();
}

const FIELD_PACK_REFERENCE_SCOPES = new Set(["general", "writer"]);
const FIELD_PACK_REFERENCE_SOURCE_FAMILIES = new Set(["official", "institutional", "google_maps", "wongnai", "manual", "system"]);
const FIELD_PACK_MEDIA_HINT_KINDS = new Set(["cover", "gallery", "raw", "reference"]);

function normalizeAgentHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function normalizeAgentFieldPackReferences(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row, index) => {
    if (typeof row === "string") {
      const url = normalizeAgentHttpUrl(row);
      if (!url) return null;
      return {
        reference_scope: "general",
        label: url,
        url,
        source_family: "manual",
        item_order: index,
      };
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const url = normalizeAgentHttpUrl(row.url || row.href || row.link);
    if (!url) return null;
    const scope = String(row.reference_scope || "general").trim().toLowerCase();
    const sourceFamily = String(row.source_family || "manual").trim().toLowerCase();
    return {
      reference_scope: FIELD_PACK_REFERENCE_SCOPES.has(scope) ? scope : "general",
      label: String(row.label || row.title || url).trim() || url,
      url,
      source_family: FIELD_PACK_REFERENCE_SOURCE_FAMILIES.has(sourceFamily) ? sourceFamily : "manual",
      note: row.note == null ? null : String(row.note || "").trim() || null,
      item_order: Number.isFinite(Number(row.item_order)) ? Number(row.item_order) : index,
    };
  }).filter(Boolean);
}

function normalizeAgentFieldPackMediaHints(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row, index) => {
    if (typeof row === "string") {
      const url = normalizeAgentHttpUrl(row);
      if (!url) return null;
      return {
        content_asset_id: null,
        url,
        kind: "reference",
        caption: null,
        selected: 0,
        item_order: index,
      };
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const url = normalizeAgentHttpUrl(row.url || row.href || row.link);
    if (!url) return null;
    const kind = String(row.kind || "reference").trim().toLowerCase();
    const contentAssetId = Number(row.content_asset_id || 0) || null;
    return {
      content_asset_id: contentAssetId && contentAssetId > 0 ? contentAssetId : null,
      url,
      kind: FIELD_PACK_MEDIA_HINT_KINDS.has(kind) ? kind : "reference",
      caption: row.caption == null ? (row.label == null ? null : String(row.label || "").trim() || null) : String(row.caption || "").trim() || null,
      selected: row.selected ? 1 : 0,
      item_order: Number.isFinite(Number(row.item_order)) ? Number(row.item_order) : index,
    };
  }).filter(Boolean);
}

function buildFieldPackPayloadFromAgent(fieldPack, existingFieldPack = null) {
  const source = fieldPack && typeof fieldPack === "object" ? fieldPack : {};
  const existingId = Number(existingFieldPack?.id || 0) || 0;
  const requestedStatus = String(source.status || "").trim().toLowerCase();
  let normalizedStatus = requestedStatus || "draft";
  if (normalizedStatus === "ready_for_handoff" || normalizedStatus === "ready_for_field") {
    normalizedStatus = "draft";
  }
  if (!["draft", "field_in_progress", "field_done", "on_hold"].includes(normalizedStatus)) {
    normalizedStatus = "draft";
  }
  return {
    ...(existingId ? { id: existingId } : {}),
    status: normalizedStatus,
    writer_ready: Boolean(source.writer_ready),
    ai_summary: String(source.ai_summary || "").trim(),
    ai_highlights: Array.isArray(source.ai_highlights) ? source.ai_highlights : [],
    ai_unknowns: Array.isArray(source.ai_unknowns) ? source.ai_unknowns : [],
    editor_summary: String(existingFieldPack?.editor_summary || source.editor_summary || "").trim(),
    verified_facts: Array.isArray(source.verified_facts) ? source.verified_facts : [],
    uncertain_facts: Array.isArray(source.uncertain_facts) ? source.uncertain_facts : [],
    story_angle: String(source.story_angle || "").trim(),
    field_notes: String(source.field_notes || "").trim(),
    social_hook: String(source.social_hook || "").trim(),
    social_shot_emphasis: Array.isArray(source.social_shot_emphasis) ? source.social_shot_emphasis : [],
    social_on_camera_points: Array.isArray(source.social_on_camera_points) ? source.social_on_camera_points : [],
    social_caption_angle: String(source.social_caption_angle || "").trim(),
    field_pack_checklists: Array.isArray(source.field_pack_checklists) ? source.field_pack_checklists : [],
    field_pack_references: normalizeAgentFieldPackReferences(source.field_pack_references),
    field_pack_media_hints: normalizeAgentFieldPackMediaHints(source.field_pack_media_hints),
  };
}

function toFieldPackFactList(contract) {
  if (!contract || typeof contract !== "object") return [];
  const verificationFacts = Array.isArray(contract?.verification?.verified_facts)
    ? contract.verification.verified_facts
    : [];
  const normalizedVerificationFacts = verificationFacts
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (normalizedVerificationFacts.length > 0) {
    return normalizedVerificationFacts;
  }

  const core = contract.core_factual_fields && typeof contract.core_factual_fields === "object"
    ? contract.core_factual_fields
    : {};
  const out = [];
  const title = String(core.title || "").trim();
  const category = String(core.category || "").trim();
  const mapUrl = String(core.map_url || "").trim();
  if (title) out.push(`title: ${title}`);
  if (category) out.push(`category: ${category}`);
  if (mapUrl) out.push(`map_url: ${mapUrl}`);
  return out;
}

function toFieldPackUnknownList(contract) {
  const verificationNeeds = Array.isArray(contract?.verification?.needs_verification)
    ? contract.verification.needs_verification
    : [];
  const verificationBlockers = Array.isArray(contract?.verification?.publish_blockers)
    ? contract.verification.publish_blockers
    : [];
  const normalizedVerification = [...verificationNeeds, ...verificationBlockers]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (normalizedVerification.length > 0) {
    return normalizedVerification;
  }

  const missing = Array.isArray(contract?.curation_signals?.missing_fields)
    ? contract.curation_signals.missing_fields
    : [];
  const verifyRequired = Array.isArray(contract?.curation_signals?.verify_required)
    ? contract.curation_signals.verify_required
    : [];
  return [...missing, ...verifyRequired]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function buildFieldPackPayloadFromCleanContract(contract) {
  if (!contract || typeof contract !== "object") {
    return {
      ai_highlights: [],
      verified_facts: [],
      uncertain_facts: [],
      writer_key_points: [],
      writer_notes: "",
    };
  }
  const suggestedBlocks = Array.isArray(contract?.curation_signals?.suggested_page_blocks)
    ? contract.curation_signals.suggested_page_blocks.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const contentRisks = Array.isArray(contract?.curation_signals?.content_risks)
    ? contract.curation_signals.content_risks.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const missingData = Array.isArray(contract?.checklists?.missing_data)
    ? contract.checklists.missing_data.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  return {
    ai_highlights: suggestedBlocks,
    verified_facts: toFieldPackFactList(contract),
    uncertain_facts: toFieldPackUnknownList(contract),
    writer_key_points: missingData,
    writer_notes: JSON.stringify(contract),
    field_notes: contentRisks.join("\n").trim(),
  };
}

function countFieldPackChecklist(fieldPack, checklistType) {
  const rows = Array.isArray(fieldPack?.field_pack_checklists) ? fieldPack.field_pack_checklists : [];
  return rows.filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === checklistType && String(row?.item_text || "").trim()).length;
}

function assertAgentFieldPackContract(fieldPack) {
  if (!fieldPack || typeof fieldPack !== "object") {
    throw new Error("Agent field pack is missing");
  }
  if (!String(fieldPack.ai_summary || fieldPack.story_angle || fieldPack.social_hook || "").trim()) {
    throw new Error("Agent field pack must include ai_summary, story_angle, or social_hook");
  }
  const mustVerifyCount = countFieldPackChecklist(fieldPack, "must_verify_fact");
  const mustCaptureCount = countFieldPackChecklist(fieldPack, "must_capture");
  const mustAskCount = countFieldPackChecklist(fieldPack, "must_ask_question");
  if (mustVerifyCount < 1) throw new Error("Agent field pack must include at least one must_verify_fact checklist item");
  if (mustCaptureCount < 1) throw new Error("Agent field pack must include at least one must_capture checklist item");
  if (mustAskCount < 1) throw new Error("Agent field pack must include at least one must_ask_question checklist item");

  // Validate capture_type on each must_capture item
  if (Array.isArray(fieldPack?.field_pack_checklists)) {
    for (const row of fieldPack.field_pack_checklists) {
      if (String(row?.checklist_type || "").trim().toLowerCase() === "must_capture") {
        const captureType = String(row?.capture_type || "").trim().toLowerCase();
        if (!["photo", "video", "both"].includes(captureType)) {
          throw new Error(`Each must_capture item must have valid capture_type (photo/video/both). Got: ${captureType}`);
        }
      }
    }
  }
}

function saveAgentFieldPack(repo, item, fieldPack, actorEmail, options = {}) {
  const currentItem = repo.getItem(item.id);
  if (!currentItem) throw new Error(`item ${item.id} not found while saving field pack`);
  const existingFieldPack = repo.getCurrentFieldPackByItem(item.id);
  const cleanContract = options.cleanContract || null;
  const contractPayload = buildFieldPackPayloadFromCleanContract(cleanContract);
  const sourceDraftInputSnapshotId = Number(options.sourceDraftInputSnapshotId || 0) || null;
  const basePayload = buildFieldPackPayloadFromAgent(fieldPack, existingFieldPack);
  const payload = {
    ...basePayload,
    ai_highlights: Array.isArray(basePayload.ai_highlights) && basePayload.ai_highlights.length
      ? basePayload.ai_highlights
      : contractPayload.ai_highlights,
    verified_facts: Array.isArray(basePayload.verified_facts) && basePayload.verified_facts.length
      ? basePayload.verified_facts
      : contractPayload.verified_facts,
    uncertain_facts: Array.isArray(basePayload.uncertain_facts) && basePayload.uncertain_facts.length
      ? basePayload.uncertain_facts
      : contractPayload.uncertain_facts,
    writer_key_points: Array.isArray(basePayload.writer_key_points) && basePayload.writer_key_points.length
      ? basePayload.writer_key_points
      : contractPayload.writer_key_points,
    writer_notes: String(basePayload.writer_notes || "").trim() || contractPayload.writer_notes,
    field_notes: String(basePayload.field_notes || "").trim() || contractPayload.field_notes,
    source_draft_input_snapshot_id: sourceDraftInputSnapshotId,
    content_item_id: item.id,
    updated_by: actorEmail,
  };
  const savedFieldPack = existingFieldPack?.id
    ? repo.updateFieldPack(existingFieldPack.id, payload)
    : repo.createFieldPack(payload);

  return savedFieldPack;
}
export async function runAiDraftStage(repo, actorEmail, options = {}) {
  const mode = String(options.mode || "deterministic").toLowerCase();
  const allowFallback = mode === "ai" ? false : options.allowFallback !== false;
  const aiConfig = options.aiConfig || null;
  const modelName = aiConfig?.model || "deterministic";
  const contentItemId = Number(options.contentItemId || options.content_item_id || 0) || null;
  const candidateStates = ["analyzed", "generated", "needs_revision", "content_in_progress"];

  const runUid = repo.createPipelineRun("ai-draft", "running", 0, 0, `Agent generation started (${mode})`);
  const generationRunUid = repo.startGenerationRun(mode, modelName);

  const allCandidates = contentItemId
    ? repo.listItemsByWorkflowHead({ production_states: candidateStates }).filter((x) => Number(x.id) === Number(contentItemId))
    : repo.listItemsByWorkflowHead({ production_states: candidateStates });

  if (contentItemId && allCandidates.length === 0) {
    const head = repo.ensureWorkflowModel(contentItemId);
    const productionState = String(head?.production_state || "").trim().toLowerCase() || "unknown";
    throw new Error(`item ${contentItemId} is not eligible for ai-draft yet: production_state=${productionState} allowed_states=${candidateStates.join(",")}`);
  }

  const blockedItems = [];
  const contextBlockedItems = [];
  const candidates = [];
  for (const item of allCandidates) {
    const ready = validateImageWorkflowReady(repo, item.id);
    if (!ready.ok) {
      blockedItems.push({ id: item.id, title: item.title || "", ...ready.status });
      continue;
    }
    candidates.push(item);
  }

  if (contentItemId && blockedItems.length > 0) {
    throw new Error(blockedItems[0]?.missing_requirements?.join(" | ") || "ต้องเลือกรูปและรูปปกก่อนส่งเข้า Agent");
  }

  const normalized = candidates.flatMap((item, idx) => {
    const preview = buildCleanStructuredContext(repo, item.id);
    const approvedContext = Array.isArray(preview?.approved_context) ? preview.approved_context : [];
    const minimum = validateCleanMinimum(repo, item.id);
    if (!minimum.ok) {
      contextBlockedItems.push({
        id: item.id,
        title: item.title || "",
        missing_requirements: Array.isArray(minimum?.blocking_reasons) && minimum.blocking_reasons.length
          ? minimum.blocking_reasons
          : ["minimum clean context requirements are missing"],
      });
      return [];
    }

    const contextDescription = buildDescriptionFromStructuredContext(preview);
    const mapped = mapFromDb(item, idx + 1);
    const imageContext = preview?.image_context || repo.listApprovedImageContext(item.id);
    const cleanFieldPackContract = buildFieldPackContractFromCleanContext(preview);
    let draftInputSnapshot = null;
    try {
      draftInputSnapshot = repo.createDraftInputSnapshot(
        item.id,
        {
          clean_context: preview,
          field_pack_contract: cleanFieldPackContract,
        },
        actorEmail,
        "approved_context_preview"
      );
    } catch {
      draftInputSnapshot = null;
    }

    return [{
      ...mapped,
      description: mode === "ai" ? mapped.description : contextDescription || mapped.description,
      map_url: preview?.item?.map_url || mapped.map_url,
      structured_context: preview,
      clean_field_pack_contract: cleanFieldPackContract,
      source_draft_input_snapshot_id: Number(draftInputSnapshot?.id || 0) || null,
      approved_context: approvedContext,
      image: imageContext?.cover_url || mapped.image,
      image_context_cover: imageContext?.cover_url || "",
      image_context_urls: imageContext?.selected_urls || [],
      image_context_gallery_urls: imageContext?.gallery_urls || [],
      image_context_inline_urls: imageContext?.inline_urls || [],
      visual_image_urls: selectVisualImageUrls(imageContext, 5),
    }];
  });

  if (contentItemId && contextBlockedItems.length > 0) {
    throw new Error(contextBlockedItems[0]?.missing_requirements?.join(" | ") || "ยังส่งเข้า Agent ไม่ได้");
  }

  const agentEngine = mode === "ai" ? createAgentGenerationEngine(aiConfig) : null;
  const fieldPackAgentProfile = agentEngine && typeof repo.getAgentProfile === "function"
    ? repo.getAgentProfile(FIELD_PACK_AGENT_KEY)
    : null;
  const generationInput = agentEngine ? normalized : generateContentDrafts(normalized);
  traceAiDraft("input.ready", {
    mode,
    content_item_id: contentItemId,
    candidates: candidates.length,
    normalized: normalized.length,
    generation_input: generationInput.length,
  });

  let count = 0;
  let fallbackCount = 0;
  let aiSuccessCount = 0;
  let errorCount = 0;
  let visualContextSuccessCount = 0;
  let visualContextSkippedCount = 0;
  let visualContextErrorCount = 0;

  for (const item of generationInput) {
    let finalItem = item;
    let finalFieldPack = null;
    let generatedBy = agentEngine ? "structured-context-ai" : "deterministic-ai";
    traceAiDraft("item.start", {
      item_id: Number(item?.id || 0) || null,
      title: String(item?.title || "").trim() || null,
      workflow_status: String(item?.workflow_status || "").trim().toLowerCase() || null,
      visual_image_count: Array.isArray(item?.visual_image_urls) ? item.visual_image_urls.length : 0,
    });

    if (agentEngine) {
      try {
        const visualImageUrls = Array.isArray(item.visual_image_urls) ? item.visual_image_urls : [];
        let visualContext = null;

        if (visualImageUrls.length > 0 && typeof agentEngine.generateVisualContext === "function") {
          try {
            traceAiDraft("visual_context.start", { item_id: Number(item?.id || 0) || null, image_count: visualImageUrls.length });
            visualContext = await agentEngine.generateVisualContext(item);
            if (visualContext) {
              visualContextSuccessCount += 1;
              traceAiDraft("visual_context.ok", { item_id: Number(item?.id || 0) || null });
            } else {
              visualContextSkippedCount += 1;
              traceAiDraft("visual_context.empty", { item_id: Number(item?.id || 0) || null });
            }
          } catch (err) {
            visualContextErrorCount += 1;
            traceAiDraft("visual_context.error", {
              item_id: Number(item?.id || 0) || null,
              error: String(err?.message || err || "unknown error"),
            });
          }
        } else {
          visualContextSkippedCount += 1;
          traceAiDraft("visual_context.skip", { item_id: Number(item?.id || 0) || null, reason: "no_visual_images" });
        }

        traceAiDraft("field_pack.generate.start", { item_id: Number(item?.id || 0) || null });
        finalFieldPack = await agentEngine.generateFieldPack({
          ...item,
          agent_profile: fieldPackAgentProfile,
          visual_context: visualContext,
        });
        assertAgentFieldPackContract(finalFieldPack);
        traceAiDraft("field_pack.generate.ok", { item_id: Number(item?.id || 0) || null });
        finalItem = { ...item, visual_context: visualContext };
        const fieldPackProvider = String(
          aiConfig?.features?.fieldPack?.provider
          || aiConfig?.fieldPackProvider
          || aiConfig?.provider
          || "openai"
        ).trim().toLowerCase();
        const fieldPackModel = String(
          aiConfig?.features?.fieldPack?.model
          || aiConfig?.fieldPackModel
          || aiConfig?.model
          || "unknown"
        ).trim();
        generatedBy = `${String(aiConfig?.agentEngine || "internal").toLowerCase() === "external" ? "external-agent" : fieldPackProvider}:${fieldPackModel || "unknown"}`;
        aiSuccessCount += 1;
      } catch (err) {
        errorCount += 1;
        traceAiDraft("field_pack.generate.error", {
          item_id: Number(item?.id || 0) || null,
          error: String(err?.message || err || "unknown error"),
          allow_fallback: Boolean(allowFallback),
        });
        if (!allowFallback) {
          throw err;
        }
        fallbackCount += 1;
        generatedBy = "deterministic-fallback";
      }
    }

    traceAiDraft("item.save.start", { item_id: Number(finalItem?.id || 0) || null, generated_by: generatedBy });
    if (agentEngine) {
      const savedFieldPack = saveAgentFieldPack(repo, finalItem, finalFieldPack, actorEmail, {
        cleanContract: finalItem?.clean_field_pack_contract || null,
        sourceDraftInputSnapshotId: finalItem?.source_draft_input_snapshot_id || null,
      });
      traceAiDraft("field_pack.save.ok", {
        item_id: Number(finalItem?.id || 0) || null,
        field_pack_id: Number(savedFieldPack?.id || 0) || null,
        status: String(savedFieldPack?.status || "").trim() || null,
      });
      try {
        repo.upsertWorkflowModel(
          finalItem.id,
          {
            production_state: "analyzed",
            current_field_pack_id: Number(savedFieldPack?.id || 0) || null,
            last_transition_note: "agent field pack generated",
          },
          actorEmail,
          {
            actor_role: "system",
            reason_code: "agent_field_pack_generated",
            bump_state_version: true,
            bump_content_version: true,
          }
        );
      } catch (err) {
        repo.logAudit(actorEmail, "workflow.sync.skipped", "content_item", String(finalItem.id), {
          stage: "ai_draft",
          target_production_state: "analyzed",
          reason: String(err?.message || "state sync failed"),
        });
      }
    } else {
      const savedFieldPack = saveAgentFieldPack(repo, finalItem, null, actorEmail, {
        cleanContract: finalItem?.clean_field_pack_contract || null,
        sourceDraftInputSnapshotId: finalItem?.source_draft_input_snapshot_id || null,
      });
      traceAiDraft("field_pack.save.ok", {
        item_id: Number(finalItem?.id || 0) || null,
        field_pack_id: Number(savedFieldPack?.id || 0) || null,
        status: String(savedFieldPack?.status || "").trim() || null,
      });
      repo.saveItem(
        {
          id: finalItem.id,
          type: finalItem.type,
          category: finalItem.category,
          lang: finalItem.lang,
          title: finalItem.draft_title || finalItem.title,
          normalized_title: finalItem.title,
          slug: finalItem.slug,
          description_raw: finalItem.description,
          description_clean: finalItem.description,
          summary: finalItem.summary,
          meta_title: finalItem.meta_title,
          meta_description: finalItem.meta_description,
          latitude: finalItem.latitude,
          longitude: finalItem.longitude,
          map_url: finalItem.map_url,
          google_place_id: finalItem.google_place_id,
          image_url: finalItem.image,
          tags: finalItem.tags,
          source_name: finalItem.source_name,
          source_url: finalItem.source_url,
          source_type: "manual",
        },
        actorEmail
      );
      traceAiDraft("item.save.ok", { item_id: Number(finalItem?.id || 0) || null });
      repo.saveDraft(finalItem.id, generationRunUid, {
        draft_title: finalItem.draft_title || finalItem.title,
        excerpt: finalItem.excerpt || finalItem.summary || "",
        body: finalItem.body || finalItem.description,
        meta_title: finalItem.meta_title,
        meta_description: finalItem.meta_description,
        suggested_related: finalItem.suggested_related || [],
        ai_quality_score: finalItem.ai_quality_score || 0,
        status: "generated",
      });
      traceAiDraft("draft.save.ok", { item_id: Number(finalItem?.id || 0) || null });
      const latestDraft = repo.latestDraftByItem(finalItem.id);
      repo.upsertWorkflowModel(
        finalItem.id,
        {
          production_state: "generated",
          current_field_pack_id: Number(savedFieldPack?.id || 0) || null,
          current_draft_id: Number(latestDraft?.id || 0) || null,
          last_transition_note: "draft generated",
        },
        actorEmail,
        {
          actor_role: "system",
          reason_code: "draft_generated",
          bump_state_version: true,
          bump_content_version: true,
        }
      );
      repo.addVersion(finalItem.id, generatedBy, {
        title: finalItem.draft_title || finalItem.title,
        description_clean: finalItem.body || finalItem.description,
        summary: finalItem.summary,
        meta_title: finalItem.meta_title,
        meta_description: finalItem.meta_description,
      });
    }

    count += 1;
    traceAiDraft("item.done", { item_id: Number(finalItem?.id || 0) || null, count });
  }

  const modeUsed = agentEngine ? (fallbackCount > 0 ? "ai+fallback" : "ai") : "deterministic";
  repo.finishPipelineRun(
    runUid,
    "done",
    count,
    `Agent generation completed (${modeUsed}) success=${aiSuccessCount} fallback=${fallbackCount} errors=${errorCount}`
  );
  repo.finishGenerationRun(
    generationRunUid,
    "done",
    count,
    errorCount,
    `Generation completed (${modeUsed})`
  );

  return {
    count,
    mode: modeUsed,
    aiSuccessCount,
    fallbackCount,
    errorCount,
    visualContextSuccessCount,
    visualContextSkippedCount,
    visualContextErrorCount,
    generationRunUid,
    blocked_items: [...blockedItems, ...contextBlockedItems],
  };
}

export async function runQualityStage(repo, actorEmail, options = {}) {
  const runUid = repo.createPipelineRun("quality", "running", 0, 0, "Quality check started");
  const candidates = filterRowsByScopedItemIds(
    repo.listItemsByWorkflowHead({ production_states: ["generated", "in_review", "needs_revision"] }),
    options
  );
  const normalized = candidates.map((item, idx) => {
    const mapped = mapFromDb(item, idx + 1);
    const draft = repo.latestDraftByItem(item.id);
    return {
      ...mapped,
      body: draft?.body || mapped.description,
      excerpt: draft?.excerpt || mapped.summary,
      suggested_related: draft?.suggested_related || [],
    };
  });

  const { accepted_reports: acceptedReports, rejected_reports: rejectedReports } = runQualityChecks(normalized);

  for (const row of acceptedReports) {
    const item = row.item;
    const report = row.report;
    const draft = repo.latestDraftByItem(item.id);

    repo.replaceQualityChecks(item.id, [{ check_name: "review_gate", status: "passed", reason: null }]);
    const reportId = repo.addReviewReport(item.id, draft?.id || null, { ...report, status: "pending" });
    repo.addReviewAction(item.id, reportId, "queued", actorEmail, "Queued for admin review");
    repo.upsertWorkflowModel(
      item.id,
      {
        production_state: "in_review",
        current_review_report_id: Number(reportId || 0) || null,
        last_transition_note: "quality reviewed and queued",
      },
      actorEmail,
      {
        actor_role: "system",
        reason_code: "quality_review_passed",
        bump_state_version: true,
        bump_content_version: true,
      }
    );
    repo.logAudit(actorEmail, "quality.reviewed", "content_item", String(item.id), report);

    const suggestions = buildInternalLinkSuggestions(item, normalized);
    repo.saveInternalLinkSuggestions(item.id, suggestions);
  }

  for (const row of rejectedReports) {
    const item = row.item;
    const report = row.report;
    const draft = repo.latestDraftByItem(item.id);

    repo.replaceQualityChecks(item.id, [{ check_name: "review_gate", status: "failed", reason: report.issues.join("; ") }]);
    const reportId = repo.addReviewReport(item.id, draft?.id || null, { ...report, status: "needs_revision" });
    repo.addReviewAction(item.id, reportId, "needs_revision", actorEmail, report.issues.join("; "));
    repo.upsertWorkflowModel(
      item.id,
      {
        production_state: "needs_revision",
        current_review_report_id: Number(reportId || 0) || null,
        last_transition_note: "quality failed",
      },
      actorEmail,
      {
        actor_role: "system",
        reason_code: "quality_review_failed",
        bump_state_version: true,
        bump_content_version: true,
      }
    );
    repo.logAudit(actorEmail, "quality.failed", "content_item", String(item.id), report);
  }

  repo.finishPipelineRun(runUid, "done", acceptedReports.length, `Reviewed: ${acceptedReports.length}, Needs revision: ${rejectedReports.length}`);
  return { reviewed: acceptedReports.length, needs_revision: rejectedReports.length };
}

export function applyReviewAction(repo, actorEmail, payload) {
  const contentItemId = Number(payload?.content_item_id || 0);
  const action = String(payload?.action || "").trim().toLowerCase();
  const notes = String(payload?.notes || "").trim() || null;

  if (!contentItemId || !["approve", "reject", "request_changes"].includes(action)) {
    throw new Error("Invalid review action payload");
  }

  const latestReport = repo.latestReviewByItem(contentItemId);
  const reportId = latestReport?.id || null;
  if (!reportId) {
    throw new Error("review prerequisite missing: latest review report is required");
  }
  const workflowBefore = repo.getWorkflowModelByItem(contentItemId) || null;
  const currentProductionState = String(workflowBefore?.production_state || "").toLowerCase();
  if (action === "reject" && currentProductionState === "rejected") {
    throw new Error("review governance conflict: item is already rejected");
  }
  if (action === "request_changes" && currentProductionState === "needs_revision") {
    throw new Error("review governance conflict: item is already in needs_revision");
  }
  const reasonCode = action === "approve"
    ? GOVERNANCE_REASON_CODES.review_approve
    : action === "reject"
      ? GOVERNANCE_REASON_CODES.review_reject
      : GOVERNANCE_REASON_CODES.review_request_changes;
  let workflowAfter = workflowBefore;
  let nextReviewStatus = latestReport?.status || null;

  if (action === "approve") {
    if (reportId) repo.setReviewStatus(reportId, "approved");
    workflowAfter = repo.upsertWorkflowModel(
      contentItemId,
      {
        production_state: "ready_for_publish",
        publication_state: "approved",
        current_review_report_id: Number(reportId || 0) || null,
        last_transition_note: notes || "approved by admin",
      },
      actorEmail,
      { actor_role: "admin", reason_code: reasonCode, bump_state_version: true }
    );
    nextReviewStatus = "approved";
  } else if (action === "reject") {
    if (reportId) repo.setReviewStatus(reportId, "rejected");
    workflowAfter = repo.upsertWorkflowModel(
      contentItemId,
      {
        production_state: "rejected",
        publication_state: "draft",
        current_review_report_id: Number(reportId || 0) || null,
        last_transition_note: notes || "rejected by admin",
      },
      actorEmail,
      { actor_role: "admin", reason_code: reasonCode, bump_state_version: true }
    );
    nextReviewStatus = "rejected";
  } else {
    if (reportId) repo.setReviewStatus(reportId, "needs_revision");
    workflowAfter = repo.upsertWorkflowModel(
      contentItemId,
      {
        production_state: "needs_revision",
        publication_state: "draft",
        current_review_report_id: Number(reportId || 0) || null,
        last_transition_note: notes || "changes requested",
      },
      actorEmail,
      { actor_role: "admin", reason_code: reasonCode, bump_state_version: true }
    );
    nextReviewStatus = "needs_revision";
  }

  repo.addReviewAction(contentItemId, reportId, action, actorEmail, notes);
  repo.logAudit(actorEmail, `review.${action}`, "content_item", String(contentItemId), {
    actor: actorEmail,
    content_item_id: contentItemId,
    notes,
    reason_code: reasonCode,
    report_id: reportId,
    previous_review_status: latestReport?.status || null,
    next_review_status: nextReviewStatus,
    from_production_state: workflowBefore?.production_state || null,
    to_production_state: workflowAfter?.production_state || null,
    from_publication_state: workflowBefore?.publication_state || null,
    to_publication_state: workflowAfter?.publication_state || null,
  });

  return { ok: true, content_item_id: contentItemId, action };
}

export function returnFieldPackToClean(repo, actorEmail, payload) {
  const contentItemId = Number(payload?.content_item_id || 0);
  const notes = String(payload?.notes || "").trim() || null;
  const actorRole = String(payload?.actor_role || "admin").trim().toLowerCase() || "admin";
  if (!contentItemId) {
    throw new Error("content_item_id is required");
  }
  if (!notes) {
    throw new Error("notes/reason is required");
  }
  return repo.returnFieldPackToCleanAtomic(contentItemId, notes, actorEmail, {
    actor_role: actorRole,
  });
}

export function reopenReviewDecision(repo, actorEmail, payload) {
  const contentItemId = Number(payload?.content_item_id || 0);
  const notes = String(payload?.notes || "").trim() || null;
  if (!contentItemId) {
    throw new Error("Invalid reopen payload");
  }

  const workflowBefore = repo.ensureWorkflowModel(contentItemId);
  const currentProductionState = String(workflowBefore?.production_state || "").toLowerCase();
  if (currentProductionState !== "rejected") {
    throw new Error("workflow reopen conflict: only rejected items can be reopened");
  }

  const latestReport = repo.latestReviewByItem(contentItemId);
  const reportId = latestReport?.id || null;
  const reasonCode = String(payload?.reason_code || "").trim().toLowerCase() || GOVERNANCE_REASON_CODES.workflow_reopen;

  const workflowAfter = repo.upsertWorkflowModel(
    contentItemId,
    {
      production_state: "analyzed",
      publication_state: "draft",
      last_transition_note: notes || "reopened from rejected decision",
    },
    actorEmail,
    {
      actor_role: "admin",
      reason_code: reasonCode,
      bump_state_version: true,
    }
  );
  repo.logAudit(actorEmail, "workflow.reopen", "content_item", String(contentItemId), {
    actor: actorEmail,
    notes,
    reason_code: reasonCode,
    report_id: reportId,
    content_item_id: contentItemId,
    from_production_state: workflowBefore?.production_state || null,
    to_production_state: workflowAfter?.production_state || null,
    from_publication_state: workflowBefore?.publication_state || null,
    to_publication_state: workflowAfter?.publication_state || null,
  });

  return { ok: true, content_item_id: contentItemId, action: "reopen" };
}

export async function publishApproved(repo, actorEmail, options = {}) {
  const actorRole = String(options?.actor_role || "admin").trim().toLowerCase() || "admin";
  const runUid = repo.startPublishRun("Publish approved items");
  const approved = filterRowsByScopedItemIds(
    repo.listItemsByWorkflowHead({ publication_states: ["approved"] }),
    options
  );
  const published = repo.listPublishedArticles();
  const usedSlugs = new Set(published.map((p) => String(p.slug || "").trim()).filter(Boolean));

  let count = 0;
  const skipped = [];
  let prerequisiteConflictCount = 0;

  for (const item of approved) {
    const draft = repo.latestDraftByItem(item.id);
    const latestReview = repo.latestReviewByItem(item.id);
    const latestApprovedReview = repo.latestApprovedReviewByItem(item.id);
    const publishableSource = repo.buildPublishableSourceByItem(item.id);
    const workflowBefore = repo.getWorkflowModelByItem(item.id) || null;
    const useFieldFlowPublishSource = Boolean(publishableSource?.ready_for_publish_source);
    const baseSkipDetails = {
      content_item_id: item.id,
      reason_code: GOVERNANCE_REASON_CODES.publish_prerequisite_conflict,
      draft_id: draft?.id || null,
      review_report_id: latestApprovedReview?.id || null,
      publish_source_kind: useFieldFlowPublishSource ? publishableSource?.source?.source_kind || "assignment_submission_article_draft" : "legacy_draft_review",
      latest_review_id: latestReview?.id || null,
      from_production_state: workflowBefore?.production_state || null,
      to_production_state: workflowBefore?.production_state || null,
      from_publication_state: workflowBefore?.publication_state || null,
      to_publication_state: workflowBefore?.publication_state || null,
    };

    if (!useFieldFlowPublishSource && !draft) {
      skipped.push({ id: item.id, reason: "missing_latest_draft" });
      prerequisiteConflictCount += 1;
      repo.logAudit(actorEmail, "publish.skip", "content_item", String(item.id), {
        ...baseSkipDetails,
        reason: "missing_latest_draft",
      });
      continue;
    }

    if (!useFieldFlowPublishSource && !latestReview) {
      skipped.push({ id: item.id, reason: "missing_quality_report" });
      prerequisiteConflictCount += 1;
      repo.logAudit(actorEmail, "publish.skip", "content_item", String(item.id), {
        ...baseSkipDetails,
        reason: "missing_quality_report",
      });
      continue;
    }

    if (!useFieldFlowPublishSource && !latestApprovedReview) {
      skipped.push({ id: item.id, reason: "missing_approved_review" });
      prerequisiteConflictCount += 1;
      repo.logAudit(actorEmail, "publish.skip", "content_item", String(item.id), {
        ...baseSkipDetails,
        reason: "missing_approved_review",
      });
      continue;
    }

    if (!useFieldFlowPublishSource && latestReview.id !== latestApprovedReview.id) {
      skipped.push({ id: item.id, reason: "stale_approved_review" });
      prerequisiteConflictCount += 1;
      repo.logAudit(actorEmail, "publish.skip", "content_item", String(item.id), {
        ...baseSkipDetails,
        reason: "stale_approved_review",
        approved_review_id: latestApprovedReview.id,
      });
      continue;
    }

    if (!useFieldFlowPublishSource && Number(latestApprovedReview.draft_id || 0) !== Number(draft.id)) {
      skipped.push({ id: item.id, reason: "approved_review_not_for_latest_draft" });
      prerequisiteConflictCount += 1;
      repo.logAudit(actorEmail, "publish.skip", "content_item", String(item.id), {
        ...baseSkipDetails,
        reason: "approved_review_not_for_latest_draft",
        approved_review_draft_id: latestApprovedReview.draft_id,
      });
      continue;
    }

    if (!useFieldFlowPublishSource && String(workflowBefore?.production_state || "").trim().toLowerCase() !== "ready_for_publish") {
      skipped.push({ id: item.id, reason: "production_state_not_ready_for_publish" });
      prerequisiteConflictCount += 1;
      repo.logAudit(actorEmail, "publish.skip", "content_item", String(item.id), {
        ...baseSkipDetails,
        reason: "production_state_not_ready_for_publish",
      });
      continue;
    }

    const links = repo
      .listInternalLinkSuggestions(item.id, "accepted")
      .map((x) => ({ target_content_item_id: x.target_content_item_id, anchor_text: x.anchor_text, target_slug: x.target_slug }));

    const resolvedArticle = publishableSource?.resolved_article || null;
    const publishTitle = useFieldFlowPublishSource
      ? String(resolvedArticle?.title || item.title || "").trim() || item.title
      : draft?.draft_title || item.title;
    const publishExcerpt = useFieldFlowPublishSource
      ? String(resolvedArticle?.excerpt || item.summary || "").trim()
      : draft?.excerpt || item.summary || "";
    const publishBody = useFieldFlowPublishSource
      ? String(resolvedArticle?.body || item.description_clean || item.description_raw || "").trim()
      : draft?.body || item.description_clean || item.description_raw || "";
    const publishMetaTitle = useFieldFlowPublishSource
      ? String(resolvedArticle?.meta_title || item.meta_title || publishTitle || item.title || "").trim()
      : draft?.meta_title || item.meta_title || item.title;
    const publishMetaDescription = useFieldFlowPublishSource
      ? String(resolvedArticle?.meta_description || item.meta_description || publishExcerpt || item.summary || "").trim()
      : draft?.meta_description || item.meta_description || item.summary || "";

    const baseSlug = normalizePublishSlug(
      useFieldFlowPublishSource
        ? publishTitle || item.slug || item.title
        : draft?.slug || draft?.draft_title || item.slug || item.title,
      `item-${Number(item.id || 0) || "published"}`
    );
    const slug = dedupeSlug(baseSlug, usedSlugs);

    repo.savePublishedArticle({
      content_item_id: item.id,
      draft_id: useFieldFlowPublishSource ? null : draft.id,
      review_report_id: useFieldFlowPublishSource ? null : latestApprovedReview.id,
      slug,
      title: publishTitle,
      excerpt: publishExcerpt,
      body: publishBody,
      meta_title: publishMetaTitle,
      meta_description: publishMetaDescription,
      event_period_text: item.event_period_text || "",
      location_text: item.location_text || "",
      latitude: item.latitude,
      longitude: item.longitude,
      map_url: item.map_url || "",
      google_place_id: item.google_place_id || "",
      related: useFieldFlowPublishSource ? [] : draft?.suggested_related || [],
      internal_links: links,
      status: "published",
    });

    const workflowAfter = repo.upsertWorkflowModel(
      item.id,
      {
        production_state: "completed",
        publication_state: "published",
        last_transition_note: `published slug=${slug}`,
      },
      actorEmail,
      {
        actor_role: actorRole,
        reason_code: GOVERNANCE_REASON_CODES.publish_success,
        bump_state_version: true,
      }
    );
    repo.logAudit(actorEmail, "publish.success", "content_item", String(item.id), {
      content_item_id: item.id,
      slug,
      links: links.length,
      draft_id: useFieldFlowPublishSource ? null : draft.id,
      review_report_id: useFieldFlowPublishSource ? null : latestApprovedReview?.id || null,
      publish_source_kind: useFieldFlowPublishSource ? publishableSource?.source?.source_kind || "assignment_submission_article_draft" : "legacy_draft_review",
      assignment_id: useFieldFlowPublishSource ? publishableSource?.source?.assignment_id || null : null,
      submission_id: useFieldFlowPublishSource ? publishableSource?.source?.latest_submission_id || null : null,
      reason_code: GOVERNANCE_REASON_CODES.publish_success,
      from_production_state: workflowBefore?.production_state || null,
      to_production_state: workflowAfter?.production_state || null,
      from_publication_state: workflowBefore?.publication_state || null,
      to_publication_state: workflowAfter?.publication_state || null,
    });
    count += 1;
  }

  if (prerequisiteConflictCount > 0) {
    const summary = {
      published_count: count,
      skipped_count: skipped.length,
      conflicted_count: prerequisiteConflictCount,
      skipped,
      run_uid: runUid,
    };
    const runStatus = count > 0 ? "done_with_conflict" : "failed";
    repo.finishPublishRun(
      runUid,
      runStatus,
      count,
      `Publish prerequisite conflict for ${prerequisiteConflictCount} item(s); published ${count}`
    );
    const err = new Error(`publish prerequisite conflict: ${prerequisiteConflictCount} item(s)`);
    err.code = "publish_prerequisite_conflict";
    err.summary = summary;
    throw err;
  }
  repo.finishPublishRun(runUid, "done", count, `Published ${count} items, skipped ${skipped.length}`);
  return { count, skipped, run_uid: runUid };
}

export function reviewInternalLink(repo, actorEmail, suggestionId, action) {
  const id = Number(suggestionId || 0);
  const normalizedAction = String(action || "").trim().toLowerCase();

  if (!id || !["accept", "reject"].includes(normalizedAction)) {
    throw new Error("Invalid internal link review payload");
  }

  const nextStatus = normalizedAction === "accept" ? "accepted" : "rejected";
  repo.reviewInternalLinkSuggestion(id, nextStatus, actorEmail);
  repo.logAudit(actorEmail, `internal_link.${nextStatus}`, "internal_link_suggestion", String(id), null);

  return { ok: true, id, status: nextStatus };
}

export async function approveToStaging(repo, actorEmail, options = {}) {
  const runUid = repo.createPipelineRun("staging", "running", 0, 0, "Staging approval started");
  const items = filterRowsByScopedItemIds(
    repo.listItemsByWorkflowHead({ publication_states: ["approved", "published"] }),
    options
  );

  for (const item of items) {
    const imageContext = repo.listApprovedImageContext(item.id);
    const officialReference = repo.getOfficialReferenceByItem(item.id);
    repo.stageItem(item.id, mapToStagingPayload(item, imageContext, officialReference));
    repo.logAudit(actorEmail, "staging.approve", "content_item", String(item.id), null);
  }

  repo.finishPipelineRun(runUid, "done", items.length, "Staging approval done");
  return { count: items.length };
}

export async function exportStaging(repo, dirs, options = {}) {
  const scopedIds = normalizeScopedItemIds(options);
  const exportDirs = resolveScopedExportDirs(dirs, options);
  const items = filterRowsByScopedItemIds(repo.listStaging(), options).map((item) => {
    if (item.staged_payload) return item.staged_payload;
    const imageContext = repo.listApprovedImageContext(item.id);
    const officialReference = repo.getOfficialReferenceByItem(item.id);
    return mapToStagingPayload(item, imageContext, officialReference);
  });
  const publishedArticles = filterRowsByScopedItemIds(repo.listPublishedArticles(), options, "content_item_id");
  const translationSummary = options.skipTranslationStage === true
    ? { run_uid: null, generated_count: 0, failed_count: 0, skipped: true }
    : await runFinalTranslationStage(
      repo,
      publishedArticles,
      options.aiConfig || null,
      options.actorEmail || "system@local"
    );

  const validTranslations = repo
    .listTranslations()
    .filter((row) => {
      if (!scopedIds.length) return true;
      return scopedIds.includes(Number(row.source_content_item_id || 0));
    })
    .filter((row) => row.translation_status === "ready" && row.automatic_check_status === "passed" && Number(row.stale_flag || 0) === 0)
    .map((row) => ({
      source_content_item_id: row.source_content_item_id,
      source_published_article_id: row.source_published_article_id,
      source_draft_id: row.source_draft_id,
      source_review_report_id: row.source_review_report_id,
      source_fingerprint: row.source_fingerprint,
      source_lang: row.source_lang || "th",
      lang: row.lang,
      title: row.translated_title,
      excerpt: row.translated_excerpt,
      body: row.translated_body,
      meta_title: row.translated_meta_title,
      meta_description: row.translated_meta_description,
      translation_status: row.translation_status,
      automatic_check_status: row.automatic_check_status,
      stale_flag: row.stale_flag,
      updated_at: row.updated_at,
    }));

  await fs.mkdir(exportDirs.stagingDir, { recursive: true });
  await fs.mkdir(exportDirs.exportDir, { recursive: true });

  const rejectedPath = path.join(exportDirs.stagingDir, "rejected-items.json");
  await fs.writeFile(rejectedPath, "[]", "utf8");

  const jsonJobUid = repo.createExportJob("json", path.join(exportDirs.exportDir, "content-import.json"), items.length, "running");
  const jsonPath = await writeJson(exportDirs.exportDir, items);
  repo.finishExportJob(jsonJobUid, "done");

  const csvJobUid = repo.createExportJob("csv", path.join(exportDirs.exportDir, "content-import.csv"), items.length, "running");
  const csvPath = await writeCsv(exportDirs.exportDir, items);
  repo.finishExportJob(csvJobUid, "done");

  const mdJobUid = repo.createExportJob("markdown", path.join(exportDirs.exportDir, "content-import.md"), items.length, "running");
  const mdPath = await writeMarkdown(exportDirs.exportDir, items);
  repo.finishExportJob(mdJobUid, "done");

  const publishedPath = path.join(exportDirs.exportDir, "published-articles.json");
  await fs.writeFile(publishedPath, JSON.stringify(publishedArticles, null, 2), "utf8");

  const translationsPath = path.join(exportDirs.exportDir, "published-articles-translations.json");
  await fs.writeFile(translationsPath, JSON.stringify(validTranslations, null, 2), "utf8");

  return {
    itemCount: items.length,
    publishedCount: publishedArticles.length,
    translationCount: validTranslations.length,
    translationSummary,
    jsonPath,
    csvPath,
    mdPath,
    publishedPath,
    translationsPath,
    rejectedPath,
  };
}

export async function releaseItemToMainSite(repo, dirs, actorEmail, options = {}) {
  const contentItemId = Number(options?.contentItemId || options?.content_item_id || 0) || 0;
  if (!contentItemId) {
    throw new Error("content_item_id is required");
  }

  const item = repo.getItem(contentItemId);
  if (!item) {
    throw new Error("item not found");
  }

  const actorRole = String(options?.actor_role || "admin").trim().toLowerCase() || "admin";
  const autoApproveNotes = String(options?.approval_notes || "อนุมัติจากขั้นตอนส่งออกไปเว็บไซต์หลัก").trim();
  const alreadyPublished = repo.getPublishedArticleByItem(contentItemId);
  const publishableSource = repo.buildPublishableSourceByItem(contentItemId);
  let quality = { reviewed: 0, needs_revision: 0 };
  let review = null;
  let publish = { count: 0, skipped: [], run_uid: null, already_published: Boolean(alreadyPublished) };

  if (!alreadyPublished) {
    if (publishableSource?.ready_for_publish_source) {
      quality = {
        reviewed: 0,
        needs_revision: 0,
        skipped: true,
        mode: "field_flow_publish_source",
      };
      review = {
        ok: true,
        content_item_id: contentItemId,
        action: "approve",
        skipped: true,
        mode: "field_flow_publish_source",
      };
    } else {
      quality = await runQualityStage(repo, actorEmail, { contentItemId });

      const latestReview = repo.latestReviewByItem(contentItemId);
      const latestApprovedReview = repo.latestApprovedReviewByItem(contentItemId);
      const latestDraft = repo.latestDraftByItem(contentItemId);
      const needsApproval =
        !latestApprovedReview
        || Number(latestApprovedReview?.id || 0) !== Number(latestReview?.id || 0)
        || Number(latestApprovedReview?.draft_id || 0) !== Number(latestDraft?.id || 0);

      if (needsApproval) {
        review = applyReviewAction(repo, actorEmail, {
          content_item_id: contentItemId,
          action: "approve",
          notes: autoApproveNotes,
        });
      } else {
        review = { ok: true, content_item_id: contentItemId, action: "approve", skipped: true };
      }
    }

    publish = await publishApproved(repo, actorEmail, {
      actor_role: actorRole,
      contentItemId,
    });
  }

  const staging = await approveToStaging(repo, actorEmail, { contentItemId });
  const exported = await exportStaging(repo, dirs, {
    ...options,
    actorEmail,
    contentItemId,
  });

  return {
    content_item_id: contentItemId,
    quality,
    review,
    publish,
    staging,
    export: exported,
    item: repo.getItem(contentItemId),
    published_article: repo.getPublishedArticleByItem(contentItemId),
  };
}

export function compensateReleaseAfterSyncFailure(repo, actorEmail, options = {}) {
  const contentItemId = Number(options?.contentItemId || options?.content_item_id || 0) || 0;
  if (!contentItemId) {
    throw new Error("content_item_id is required for compensation");
  }
  const workflowBefore = options?.workflowBefore || options?.workflow_before || null;
  if (!workflowBefore || typeof workflowBefore !== "object") {
    throw new Error("workflow_before snapshot is required for compensation");
  }
  const actor = String(actorEmail || "").trim() || "system@local";
  const actorRole = String(options?.actor_role || "admin").trim().toLowerCase() || "admin";
  const reasonCode = String(options?.reason_code || "").trim().toLowerCase() || "publish_sync_compensation";
  const note = String(options?.note || "compensate publish after backend sync failure").trim();
  const publishedArticleBefore = options?.publishedArticleBefore || options?.published_article_before || null;

  const patch = {
    production_state: String(workflowBefore?.production_state || "").trim().toLowerCase() || "ready_for_publish",
    publication_state: String(workflowBefore?.publication_state || "").trim().toLowerCase() || "approved",
    last_transition_note: note,
  };
  const workflowAfter = repo.upsertWorkflowModel(contentItemId, patch, actor, {
    actor_role: actorRole,
    reason_code: reasonCode,
    bump_state_version: true,
    skip_production_transition_validation: true,
    skip_publication_transition_validation: true,
  });

  const publishedArticle = repo.getPublishedArticleByItem(contentItemId);
  let articleStatusAfter = null;
  if (publishedArticle) {
    if (publishedArticleBefore && typeof publishedArticleBefore === "object") {
      const restored = repo.restorePublishedArticleByItem(publishedArticleBefore);
      articleStatusAfter = String(restored?.status || "").trim().toLowerCase() || null;
    } else {
      repo.deletePublishedArticleByItem(contentItemId);
      articleStatusAfter = null;
    }
  }

  return {
    ok: true,
    content_item_id: contentItemId,
    workflow_after: workflowAfter,
    published_article_status: articleStatusAfter,
  };
}






































