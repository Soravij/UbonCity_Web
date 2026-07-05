import { createHash, randomUUID } from "crypto";
import path from "path";

import { buildCleanStructuredContext as buildCleanStructuredContextFromRepo } from "../services/clean-context.mjs";

function parseTags(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function parseJson(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseGoogleMapsPhotoProxyPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, "http://collector.local");
    if (parsed.pathname !== "/api/google-maps/photo") return "";
    const name = String(parsed.searchParams.get("name") || "").trim();
    if (!/^places\/[^/?#]+\/photos\/[^/?#]+$/i.test(name)) return "";
    return `/api/google-maps/photo?${parsed.searchParams.toString()}`;
  } catch {
    return "";
  }
}

function parseAssetPublicUrl(storagePath) {
  const value = String(storagePath || "").trim();
  if (!value) return "";
  const googleProxy = parseGoogleMapsPhotoProxyPath(value);
  if (googleProxy) return googleProxy;
  if (/^https?:\/\//i.test(value)) return value;
  return `/media/${value.replace(/\\/g, "/")}`;
}

function normalizeImportedMediaUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/api\//i.test(text)) return text;
  return "";
}

function normalizeReferenceMediaUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const parsed = new URL(text, "http://collector.local");
    if (parsed.pathname === "/api/google-maps/photo") {
      const name = String(parsed.searchParams.get("name") || "").trim();
      if (!/^places\/[^/?#]+\/photos\/[^/?#]+$/i.test(name)) return "";
      return `/api/google-maps/photo?name=${encodeURIComponent(name)}`;
    }

    if (!/^https?:$/i.test(parsed.protocol)) return "";
    parsed.hash = "";
    const params = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    parsed.search = "";
    for (const [key, val] of params) {
      parsed.searchParams.append(key, val);
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function getReferenceMediaIdFromUrl(value) {
  const normalized = normalizeReferenceMediaUrl(value);
  if (!normalized) return "";
  const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 16);
  return `rm:${hash}`;
}

function inferReferenceMediaMimeType(url) {
  const normalizedUrl = normalizeReferenceMediaUrl(url);
  if (!normalizedUrl) return null;
  if (/^\/api\/google-maps\/photo\?name=/i.test(normalizedUrl)) return "image/jpeg";
  const lowerUrl = normalizedUrl.toLowerCase().split("?")[0];
  if (lowerUrl.endsWith(".jpg") || lowerUrl.endsWith(".jpeg")) return "image/jpeg";
  if (lowerUrl.endsWith(".png")) return "image/png";
  if (lowerUrl.endsWith(".webp")) return "image/webp";
  if (lowerUrl.endsWith(".gif")) return "image/gif";
  if (lowerUrl.endsWith(".svg")) return "image/svg+xml";
  if (lowerUrl.endsWith(".avif")) return "image/avif";
  return null;
}

function looksLikeReferenceImageUrl(value, options = {}) {
  const normalized = normalizeReferenceMediaUrl(value);
  if (!normalized) return false;

  const mimeType = String(options.mime_type || "").trim().toLowerCase();
  const mediaType = String(options.media_type || "").trim().toLowerCase();
  const assetType = String(options.asset_type || "").trim().toLowerCase();

  if (mimeType.startsWith("image/")) return true;
  if (mediaType === "image") return true;
  if (assetType === "image") return true;
  if (/^\/api\/google-maps\/photo\?name=/i.test(normalized)) return true;
  return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(normalized.split("?")[0]);
}

function toGoogleMapsPhotoProxyUrl(photoName) {
  const name = String(photoName || "").trim();
  if (!name) return "";
  return `/api/google-maps/photo?name=${encodeURIComponent(name)}&maxWidthPx=1400&maxHeightPx=1400`;
}

function collectImportedMediaCandidate(list, seen, url, options = {}) {
  const normalizedUrl = normalizeImportedMediaUrl(url);
  if (!normalizedUrl) return false;
  const key = normalizedUrl.toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  list.push({
    url: normalizedUrl,
    mime_type: String(options.mime_type || "").trim().toLowerCase() || null,
    width: Number.isFinite(Number(options.width)) ? Number(options.width) : null,
    height: Number.isFinite(Number(options.height)) ? Number(options.height) : null,
    checksum: String(options.checksum || "").trim() || null,
    role_hint: String(options.role_hint || "").trim().toLowerCase() || null,
    source_kind: String(options.source_kind || "").trim().toLowerCase() || null,
    source_name: String(options.source_name || "").trim() || null,
  });
  return true;
}

function extractImportedMediaCandidatesFromPayload(payload, options = {}) {
  const out = [];
  const seen = new Set();
  const sourceKind = String(options.source_kind || "source_record").trim().toLowerCase() || "source_record";
  const sourceName = String(options.source_name || "").trim() || null;
  const pushCandidate = (url, extra = {}) => collectImportedMediaCandidate(out, seen, url, {
    ...extra,
    source_kind: sourceKind,
    source_name: sourceName,
  });

  const payloadObject = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  if (!payloadObject) return out;

  const collectPhotoArray = (rows = []) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row === "string") {
        pushCandidate(row);
        continue;
      }
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      pushCandidate(row.photo_url || row.url || row.uri || row.image_url || row.src || toGoogleMapsPhotoProxyUrl(row.photo_name), {
        mime_type: row.mime_type,
        width: row.width ?? row.width_px,
        height: row.height ?? row.height_px,
        role_hint: row.role,
      });
    }
  };

  const collectImageObject = (value) => {
    if (typeof value === "string") {
      pushCandidate(value);
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    pushCandidate(value.image_url || value.media_url || value.url || value.uri || value.src, {
      mime_type: value.mime_type,
      width: value.width ?? value.width_px,
      height: value.height ?? value.height_px,
      role_hint: value.role,
    });
  };

  const normalized = payloadObject.normalized_json && typeof payloadObject.normalized_json === "object"
    ? payloadObject.normalized_json
    : payloadObject.payload_json?.normalized_json && typeof payloadObject.payload_json.normalized_json === "object"
      ? payloadObject.payload_json.normalized_json
      : null;

  if (normalized) {
    pushCandidate(normalized.image, { role_hint: "cover" });
    collectPhotoArray(normalized.photos);
    collectPhotoArray(normalized.images);
  }

  collectPhotoArray(payloadObject.extracted_metadata_photos);
  collectImageObject(payloadObject.extracted_metadata_image);
  collectPhotoArray(payloadObject.extracted_metadata?.photos);
  collectImageObject(payloadObject.extracted_metadata?.image);

  return out;
}

const EVIDENCE_BLOCK_TYPES = new Set(["fact", "social_proof", "review_snippet", "media", "mention", "editor_note"]);
const EVIDENCE_SOURCE_TYPES = new Set(["manual", "google_maps", "google_search", "editor", "import", "future_social"]);
const APPROVED_CONTEXT_STATUSES = new Set(["active", "inactive"]);
const EVIDENCE_STATUSES = new Set(["active", "inactive", "archived"]);
const SNAPSHOT_SOURCES = new Set(["approved_context_preview", "ai_draft_run", "manual_debug"]);
const SEARCH_ENRICHMENT_PROVIDERS = new Set(["manual", "future_provider", "google_search"]);
const ENRICHMENT_INGESTION_MODES = new Set(["manual", "future_provider"]);
const RECOMMENDED_ACTIONS = new Set(["collect_now", "monitor", "hold", "skip"]);
const SOCIAL_PLATFORMS = new Set(["facebook", "tiktok"]);
const SOCIAL_INGESTION_MODES = new Set(["manual", "future_provider"]);
const DIRECTION_PRIORITY_BANDS = new Set(["high", "medium", "low"]);
const DIRECTION_STATUSES = new Set(["ready", "monitor", "needs_more_data", "weak_signal"]);
const REFERENCE_CLEANUP_CANDIDATE_DEFS = Object.freeze([
  { key: "source_records", label_th: "แหล่งข้อมูลต้นทาง", table: "source_records", where: "content_item_id=?" },
  { key: "content_assets", label_th: "ไฟล์หรือรูปที่ผูกกับรายการนี้", table: "content_assets", where: "content_item_id=?" },
  { key: "reviews_raw", label_th: "รีวิวดิบ", table: "reviews_raw", where: "content_item_id=?" },
  { key: "drafts", label_th: "AI drafts", table: "content_drafts", where: "content_item_id=?" },
  { key: "quality_checks", label_th: "ผลตรวจคุณภาพ", table: "quality_checks", where: "content_item_id=?" },
  { key: "review_reports", label_th: "review reports", table: "review_reports", where: "content_item_id=?" },
  { key: "staging_items", label_th: "staging/export", table: "staging_items", where: "content_item_id=?" },
  { key: "content_versions", label_th: "ประวัติเวอร์ชันคอนเทนต์", table: "content_versions", where: "content_item_id=?" },
  { key: "evidence_blocks", label_th: "evidence blocks", table: "evidence_blocks", where: "content_item_id=?" },
  { key: "approved_context_blocks", label_th: "approved context", table: "approved_context_blocks", where: "content_item_id=?" },
  { key: "draft_input_snapshots", label_th: "draft input snapshots", table: "draft_input_snapshots", where: "content_item_id=?" },
  { key: "field_packs", label_th: "field packs", table: "field_packs", where: "content_item_id=?" },
  { key: "content_workflow_models", label_th: "workflow models", table: "content_workflow_models", where: "content_item_id=?" },
  { key: "content_workflow_transitions", label_th: "workflow transitions", table: "content_workflow_transitions", where: "content_item_id=?" },
  { key: "content_readiness_briefs", label_th: "readiness briefs", table: "content_readiness_briefs", where: "content_item_id=?" },
  { key: "content_execution_controls", label_th: "execution controls", table: "content_execution_controls", where: "content_item_id=?" },
  { key: "content_execution_channels", label_th: "execution channels", table: "content_execution_channels", where: "content_item_id=?" },
  { key: "search_enrichment_records", label_th: "search enrichment", table: "search_enrichment_records", where: "content_item_id=?" },
  { key: "place_intelligence_scores", label_th: "place intelligence", table: "place_intelligence_scores", where: "content_item_id=?" },
  { key: "social_signal_sources", label_th: "social signals", table: "social_signal_sources", where: "content_item_id=?" },
  { key: "social_momentum_snapshots", label_th: "social momentum snapshots", table: "social_momentum_snapshots", where: "content_item_id=?" },
  { key: "content_direction_reports", label_th: "content direction reports", table: "content_direction_reports", where: "content_item_id=?" },
  { key: "content_intelligence_models", label_th: "intelligence models", table: "content_intelligence_models", where: "content_item_id=?" },
  { key: "internal_link_sources", label_th: "internal link ต้นทาง", table: "internal_link_suggestions", where: "content_item_id=?" },
  { key: "internal_link_targets", label_th: "internal link ปลายทาง", table: "internal_link_suggestions", where: "target_content_item_id=?" },
]);
const REFERENCE_CLEANUP_CANDIDATE_KEYS = new Set(REFERENCE_CLEANUP_CANDIDATE_DEFS.map((entry) => entry.key));
const RAW_ONLY_HARD_DELETE_ALLOWED_REFERENCE_KEYS = new Set([
  "source_records",
  "evidence_blocks",
  "content_workflow_models",
  "content_workflow_transitions",
  "content_assets",
]);
const REFERENCE_HARD_BLOCKER_DEFS = Object.freeze([
  { key: "assignments", label_th: "มี assignment งานอยู่", sql: "SELECT COUNT(*) AS c FROM content_assignments WHERE content_item_id=?", hint: "ต้องปิด assignment ก่อนผ่านหน้าส่งงาน" },
  { key: "published_articles", label_th: "เผยแพร่ขึ้นเว็บแล้ว", sql: "SELECT COUNT(*) AS c FROM published_articles WHERE content_item_id=?", hint: "ต้อง unpublish จาก backend ก่อน" },
  { key: "content_assignment_submissions", label_th: "มีงานส่งกลับจาก assignment อยู่", sql: "SELECT COUNT(*) AS c FROM content_assignment_submissions WHERE content_item_id=?", hint: "ต้องปิดการตรวจงานก่อน" },
  { key: "content_assignment_submission_deliverables", label_th: "มีไฟล์หรือข้อมูลส่งงานจาก assignment อยู่", sql: "SELECT COUNT(*) AS c FROM content_assignment_submission_deliverables WHERE content_item_id=?", hint: "ต้องปิดการตรวจงานก่อน" },
  { key: "content_assignment_handoff_snapshots", label_th: "มี snapshot การส่งงานอยู่", sql: "SELECT COUNT(*) AS c FROM content_assignment_handoff_snapshots WHERE content_item_id=?", hint: "ผูกกับวงจร assignment" },
  { key: "review_actions", label_th: "มีประวัติ action จาก review อยู่", sql: "SELECT COUNT(*) AS c FROM review_actions WHERE content_item_id=?", hint: "ประวัติ audit ห้ามลบ" },
  { key: "translations", label_th: "มีงานแปลที่ผูกอยู่", sql: "SELECT COUNT(*) AS c FROM content_translations WHERE source_content_item_id=?", hint: "มีงานแปลผูกข้ามรายการ" },
]);
const REFERENCE_ALL_GROUP_KEYS = new Set([
  ...REFERENCE_CLEANUP_CANDIDATE_DEFS.map((entry) => entry.key),
  ...REFERENCE_HARD_BLOCKER_DEFS.map((entry) => entry.key),
]);
const DIRECTION_NEXT_ACTIONS = new Set(["collect_now", "enrich_search", "watch_social", "hold", "skip"]);
const PRODUCTION_STATES = new Set([
  "collected",
  "analyzed",
  "brief_generated",
  "ready_for_content",
  "content_in_progress",
  "generated",
  "in_review",
  "needs_revision",
  "ready_for_publish",
  "submitted_for_admin_review",
  "rejected",
  "completed",
]);
const PUBLICATION_STATES = new Set(["draft", "approved", "published", "unpublished", "archived", "deleted"]);
const ASSIGNMENT_STATES = new Set(["assigned", "in_progress", "submitted", "revision_requested", "resubmitted", "accepted", "closed"]);
const ASSIGNMENT_SUBMISSION_STATES = new Set(["submitted", "resubmitted"]);
const ASSIGNMENT_DELIVERABLE_TYPES = new Set(["photos", "videos", "raw_notes", "caption_draft", "script_draft", "article_draft"]);
const ASSIGNMENT_DELIVERABLE_STATUSES = new Set(["draft", "submitted", "reviewed", "accepted", "rejected"]);
const ASSIGNMENT_FULFILLED_DELIVERABLE_STATUSES = new Set(["submitted", "reviewed", "accepted"]);
const ASSIGNMENT_TEXT_LIKE_DELIVERABLE_TYPES = new Set(["raw_notes", "caption_draft", "script_draft", "article_draft"]);
const ASSIGNMENT_ASSET_BACKED_DELIVERABLE_TYPES = new Set(["photos", "videos"]);
const ASSIGNMENT_KINDS = new Set(["field", "editorial"]);
const STATE_GROUPS = new Set(["production", "publication", "assignment"]);
const WORKFLOW_ACTOR_ROLES = new Set(["owner", "admin", "editor", "user", "freelance", "system"]);
const EXECUTION_CHANNELS = new Set(["facebook", "tiktok"]);
const EXECUTION_STATUSES = new Set(["draft", "generated", "validated", "ready", "blocked", "superseded"]);
const WORKFLOW_REASON_CODES = Object.freeze({
  ASSIGNMENT_CREATED_SYNC: "assignment_created_sync",
  ASSIGNMENT_CREATED_SYNC_FROM_READINESS: "assignment_created_sync_from_readiness",
  ASSIGNMENT_CREATED_SYNC_FROM_FIELD_PACK: "assignment_created_sync_from_field_pack",
  ASSIGNMENT_STATE_SYNC: "assignment_state_sync",
  ASSIGNMENT_STATE_RECONCILE_SYNC: "assignment_state_reconcile_sync",
});
const TRANSITION_RULES = Object.freeze({
  production: Object.freeze({
    collected: new Set(["analyzed", "content_in_progress", "generated", "in_review", "needs_revision", "ready_for_publish", "rejected"]),
    analyzed: new Set(["brief_generated", "content_in_progress", "generated", "in_review", "needs_revision", "ready_for_publish", "rejected"]),
    brief_generated: new Set(["analyzed", "ready_for_content", "content_in_progress", "generated", "in_review", "needs_revision", "ready_for_publish", "rejected"]),
    ready_for_content: new Set(["content_in_progress", "generated", "rejected"]),
    content_in_progress: new Set(["generated", "in_review", "needs_revision", "rejected"]),
    generated: new Set(["content_in_progress", "in_review", "needs_revision", "rejected"]),
    in_review: new Set(["needs_revision", "ready_for_publish", "rejected"]),
    needs_revision: new Set(["content_in_progress", "generated", "in_review", "rejected"]),
    ready_for_publish: new Set(["submitted_for_admin_review", "completed", "needs_revision", "rejected"]),
    submitted_for_admin_review: new Set(["needs_revision", "rejected", "completed"]),
    rejected: new Set(["analyzed", "brief_generated", "ready_for_content"]),
    completed: new Set(["needs_revision"]),
  }),
  publication: Object.freeze({
    draft: new Set(["approved", "archived"]),
    approved: new Set(["published", "draft", "archived"]),
    published: new Set(["unpublished", "archived"]),
    unpublished: new Set(["approved", "archived"]),
    archived: new Set(["approved"]),
    deleted: new Set([]),
  }),
  assignment: Object.freeze({
    assigned: new Set(["in_progress", "submitted", "closed"]),
    in_progress: new Set(["submitted", "revision_requested", "closed"]),
    submitted: new Set(["revision_requested", "accepted", "closed"]),
    revision_requested: new Set(["resubmitted", "in_progress", "closed"]),
    resubmitted: new Set(["accepted", "revision_requested", "closed"]),
    accepted: new Set(["closed", "revision_requested"]),
    closed: new Set([]),
  }),
});

function parseJsonInputStrict(value, fieldName, expected = "any") {
  if (value == null || value === "") return null;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`${fieldName} must be valid JSON`);
    }
  }

  if (expected === "array" && !Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON array`);
  }
  if (expected === "object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new Error(`${fieldName} must be a JSON object`);
  }
  if (expected === "any" && (typeof parsed !== "object" || parsed == null)) {
    throw new Error(`${fieldName} must be a JSON object or array`);
  }

  return parsed;
}

function toNullableScore(value, fieldName, min = 0, max = 10) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
  if (n < min || n > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }
  return n;
}

function toNullableDateIso(value, fieldName) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const t = Date.parse(text);
  if (!Number.isFinite(t)) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return new Date(t).toISOString();
}

function toBangkokSqlTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid date for Bangkok timestamp");
  }
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return formatter.format(date).replace("T", " ");
}

function clampScore(value, min = 0, max = 10) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function mapWorkflowStatusToModelStates(workflowStatus) {
  const status = String(workflowStatus || "").trim().toLowerCase();
  if (status === "published") return { production_state: "completed", publication_state: "published" };
  if (status === "approved") return { production_state: "ready_for_publish", publication_state: "approved" };
  if (status === "rejected") return { production_state: "rejected", publication_state: "draft" };
  if (status === "needs_revision") return { production_state: "needs_revision", publication_state: "draft" };
  if (status === "in_review") return { production_state: "in_review", publication_state: "draft" };
  if (status === "generated") return { production_state: "generated", publication_state: "draft" };
  if (status === "content_in_progress") return { production_state: "content_in_progress", publication_state: "draft" };
  if (status === "ready_for_content") return { production_state: "ready_for_content", publication_state: "draft" };
  if (status === "brief_generated") return { production_state: "brief_generated", publication_state: "draft" };
  if (status === "analyzed") return { production_state: "analyzed", publication_state: "draft" };
  return { production_state: "collected", publication_state: "draft" };
}

function deriveWorkflowStatusFromModel(model) {
  const productionState = String(model?.production_state || "").trim().toLowerCase();
  const publicationState = String(model?.publication_state || "").trim().toLowerCase();
  if (publicationState === "published") return "published";
  if (productionState === "rejected") return "rejected";
  if (productionState === "needs_revision") return "needs_revision";
  if (
    publicationState === "approved"
    || publicationState === "unpublished"
    || productionState === "ready_for_publish"
    || productionState === "submitted_for_admin_review"
  ) return "approved";
  if (productionState === "in_review") return "in_review";
  if (productionState === "generated") return "generated";
  if (productionState === "content_in_progress") return "content_in_progress";
  if (productionState === "ready_for_content") return "ready_for_content";
  if (productionState === "brief_generated") return "brief_generated";
  if (productionState === "analyzed") return "analyzed";
  return "raw";
}

function deriveWorkflowStatusSeedFromPatch(workflowPatch = {}) {
  const productionState = String(workflowPatch?.production_state || "").trim().toLowerCase();
  const publicationState = String(workflowPatch?.publication_state || "draft").trim().toLowerCase() || "draft";
  if (!productionState && !publicationState) return "";
  return deriveWorkflowStatusFromModel({
    production_state: productionState || "collected",
    publication_state: publicationState,
  });
}

function deriveWorkflowStatusFromRowStates(row = {}, fallback = "raw") {
  const productionState = String(row?.production_state || "").trim().toLowerCase();
  const publicationState = String(row?.publication_state || "").trim().toLowerCase();
  if (!productionState && !publicationState) {
    return String(fallback || "raw").trim().toLowerCase() || "raw";
  }
  return deriveWorkflowStatusFromModel({
    production_state: productionState || "collected",
    publication_state: publicationState || "draft",
  });
}

function normalizeHttpUrl(raw, fieldName) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${fieldName} must be http/https`);
  }
  parsed.hash = "";
  const serialized = parsed.toString();
  if (!parsed.search && serialized.endsWith("/")) {
    return serialized.slice(0, -1);
  }
  return serialized;
}

function deriveDomainFromUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const NON_OFFICIAL_REFERENCE_HOSTS = [
  "wongnai.com",
  "google.com",
  "google.co.th",
  "googleapis.com",
  "googleusercontent.com",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "youtu.be",
  "line.me",
  "lin.ee",
  "tripadvisor.com",
  "agoda.com",
  "booking.com",
  "traveloka.com",
];

const OFFICIAL_REFERENCE_HINT_SEGMENTS = new Set([
  "about",
  "about-us",
  "aboutus",
  "contact",
  "contact-us",
  "contactus",
  "visit",
  "location",
  "history",
  "museum",
  "travel",
  "tourism",
]);

const LOW_CONFIDENCE_REFERENCE_SEGMENTS = new Set([
  "article",
  "articles",
  "blog",
  "blogs",
  "news",
  "post",
  "posts",
  "detail",
  "details",
  "category",
  "categorie",
  "tag",
  "tags",
  "archive",
  "archives",
]);

const GENERIC_SOURCE_NAME_VALUES = new Set([
  "",
  "manual",
  "manual-url",
]);

const MIN_OFFICIAL_REFERENCE_SCORE = 2;

function hostMatchesDomain(hostname, domain) {
  const host = String(hostname || "").trim().toLowerCase();
  const needle = String(domain || "").trim().toLowerCase();
  if (!host || !needle) return false;
  return host === needle || host.endsWith(`.${needle}`);
}

function isLikelyOfficialReferenceRecord(row) {
  const sourceType = String(row?.source_type || "").trim().toLowerCase();
  if (sourceType && sourceType !== "manual") return false;
  const sourceUrl = String(row?.source_url || "").trim();
  const domain = deriveDomainFromUrl(sourceUrl);
  if (!domain) return false;
  if (NON_OFFICIAL_REFERENCE_HOSTS.some((entry) => hostMatchesDomain(domain, entry))) {
    return false;
  }
  return true;
}

function mapOfficialReferenceRow(row) {
  if (!row) return null;
  const sourceUrl = String(row.source_url || "").trim();
  if (!sourceUrl) return null;
  const domain = deriveDomainFromUrl(sourceUrl);
  return {
    label: String(row.source_name || domain || sourceUrl).trim() || sourceUrl,
    url: sourceUrl,
    domain: domain || null,
    source_type: String(row.source_type || "manual").trim() || "manual",
    captured_at: row.updated_at || row.created_at || null,
  };
}

function isInstitutionalReferenceDomain(domain) {
  const value = String(domain || "").trim().toLowerCase();
  if (!value) return false;
  return (
    value.endsWith(".go.th") ||
    value.endsWith(".ac.th") ||
    value.endsWith(".or.th") ||
    value.endsWith(".gov") ||
    value.endsWith(".edu")
  );
}

function scoreOfficialReferenceRecord(row) {
  if (!isLikelyOfficialReferenceRecord(row)) return Number.NEGATIVE_INFINITY;
  const sourceUrl = String(row?.source_url || "").trim();
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return Number.NEGATIVE_INFINITY;
  }

  const domain = deriveDomainFromUrl(sourceUrl);
  const pathname = String(parsed.pathname || "/").trim() || "/";
  const segments = pathname
    .split("/")
    .map((segment) => String(segment || "").trim().toLowerCase())
    .filter(Boolean);

  let score = 0;

  if (isInstitutionalReferenceDomain(domain)) {
    score += 4;
  }

  if (pathname === "/" || pathname === "") {
    score += 4;
  }

  if (segments.length > 0 && segments.some((segment) => OFFICIAL_REFERENCE_HINT_SEGMENTS.has(segment))) {
    score += 2;
  }

  if (segments.length <= 1 && pathname !== "/" && pathname !== "") {
    score += 1;
  }

  if (!parsed.search) {
    score += 1;
  } else {
    score -= 1;
  }

  if (segments.length >= 3) {
    score -= 2;
  }

  if (segments.some((segment) => LOW_CONFIDENCE_REFERENCE_SEGMENTS.has(segment))) {
    score -= 2;
  }

  if (segments.some((segment) => segment.length >= 48 || /\d{4}[-_/]?\d{1,2}[-_/]?\d{1,2}/.test(segment))) {
    score -= 1;
  }

  const sourceName = String(row?.source_name || "").trim().toLowerCase();
  if (sourceName && !GENERIC_SOURCE_NAME_VALUES.has(sourceName) && sourceName !== String(domain || "").trim().toLowerCase()) {
    score += 1;
  }

  return score;
}

function classifyEvidenceSourceFamily(row) {
  const sourceType = String(row?.source_type || "").trim().toLowerCase();
  const sourceUrl = String(row?.source_url || "").trim();
  const domain = deriveDomainFromUrl(sourceUrl);

  if (
    sourceType === "google_maps" ||
    (domain && (
      hostMatchesDomain(domain, "google.com") ||
      hostMatchesDomain(domain, "google.co.th") ||
      hostMatchesDomain(domain, "googleapis.com") ||
      hostMatchesDomain(domain, "googleusercontent.com")
    ))
  ) {
    return "google_maps";
  }

  if (sourceType === "wongnai" || (domain && hostMatchesDomain(domain, "wongnai.com"))) {
    return "wongnai";
  }

  if (sourceType === "system" || sourceType === "collector" || sourceType === "import") {
    return "system";
  }

  if (domain && isInstitutionalReferenceDomain(domain)) {
    return "institutional";
  }

  if (sourceType === "official" || sourceType === "official_site") {
    return "official";
  }

  if (scoreOfficialReferenceRecord({
    source_type: sourceType || "manual",
    source_url: sourceUrl,
    source_name: row?.source_label || row?.source_name || "",
  }) >= MIN_OFFICIAL_REFERENCE_SCORE) {
    return "official";
  }

  return "manual";
}

function normalizeTopResultsInput(value, fieldName = "top_results_json") {
  const arr = parseJsonInputStrict(value, fieldName, "array") || [];
  const seen = new Set();
  const out = [];

  for (let i = 0; i < arr.length; i += 1) {
    const row = arr[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${fieldName}[${i}] must be an object`);
    }

    const url = row.url == null || row.url === "" ? null : normalizeHttpUrl(row.url, `${fieldName}[${i}].url`);
    const title = row.title == null || row.title === "" ? null : String(row.title).trim();
    const snippet = row.snippet == null || row.snippet === "" ? null : String(row.snippet).trim();
    const resultType = row.result_type == null || row.result_type === "" ? null : String(row.result_type).trim().toLowerCase();
    const domain = row.domain == null || row.domain === "" ? deriveDomainFromUrl(url) : String(row.domain).trim().toLowerCase();

    let rank = null;
    if (row.rank != null && row.rank !== "") {
      const n = Number(row.rank);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`${fieldName}[${i}].rank must be a positive integer`);
      }
      rank = n;
    }

    let isOfficial = null;
    if (row.is_official != null && row.is_official !== "") {
      if (typeof row.is_official !== "boolean") {
        throw new Error(`${fieldName}[${i}].is_official must be a boolean`);
      }
      isOfficial = row.is_official;
    }

    if (!title && !url && !snippet) {
      throw new Error(`${fieldName}[${i}] requires at least one of title/url/snippet`);
    }

    const dedupeKey = url || `${title || ""}|${snippet || ""}|${domain || ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      title,
      url,
      domain: domain || null,
      snippet,
      rank,
      is_official: isOfficial,
      result_type: resultType,
    });
  }

  return out;
}

function normalizeUrlStringListInput(value, fieldName) {
  const arr = parseJsonInputStrict(value, fieldName, "array") || [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < arr.length; i += 1) {
    const normalized = normalizeHttpUrl(arr[i], `${fieldName}[${i}]`);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeStringListInput(value, fieldName) {
  const arr = parseJsonInputStrict(value, fieldName, "array") || [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < arr.length; i += 1) {
    const text = String(arr[i] || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

const CTA_CONTACT_KEYS = Object.freeze(["phone", "line_url", "facebook_url", "website_url"]);
const TAXONOMY_KEYS = Object.freeze(["category", "subtype"]);
const CONFIDENCE_VALUES = new Set(["unknown", "low", "medium", "high", "verified"]);
const CURATION_STATUS_VALUES = new Set(["not_started", "in_review", "curated"]);
const CONFIRMED_META_STATUS_VALUES = new Set(["not_started", "in_review", "confirmed"]);
const PRIMARY_CTA_VALUES = new Set(["map", "phone", "line"]);

function defaultAiCtaContact() {
  return {
    phone: null,
    line_url: null,
    facebook_url: null,
    website_url: null,
    primary_cta: null,
    source: [],
    confidence: "unknown",
    note: null,
  };
}

function defaultAiTaxonomy() {
  return {
    category: null,
    subtype: null,
    tags: [],
    source: [],
    confidence: "unknown",
    note: null,
  };
}

function defaultCuratedCtaContact() {
  return {
    phone: { checked: false, found: false, value: null, source: [], note: null },
    line_url: { checked: false, found: false, value: null, source: [], note: null },
    facebook_url: { checked: false, found: false, value: null, source: [], note: null },
    website_url: { checked: false, found: false, value: null, source: [], note: null },
    primary_cta: { checked: false, found: false, value: null, note: null },
  };
}

function defaultCuratedTaxonomy() {
  return {
    category: { checked: false, found: false, value: null, note: null },
    subtype: { checked: false, found: false, value: null, note: null },
    tags: { checked: false, found: false, value: [], note: null },
  };
}

function defaultRequestedChecksJson() {
  return {
    version: 1,
    groups: [],
  };
}

function defaultFieldReturnPayload() {
  return {
    checklist_results: [],
    cta_return: {},
    taxonomy_return: {},
    requested_check_returns: {},
    note: null,
  };
}

function defaultConfirmedCtaContact() {
  return {
    phone: null,
    line_url: null,
    facebook_url: null,
    website_url: null,
    primary_cta: null,
  };
}

function defaultConfirmedTaxonomy() {
  return {
    category: null,
    subtype: null,
    tags: [],
  };
}

function normalizeConfidenceValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CONFIDENCE_VALUES.has(normalized) ? normalized : "unknown";
}

function normalizePrimaryCtaValue(value, fieldName) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!PRIMARY_CTA_VALUES.has(normalized)) {
    throw new Error(`${fieldName} must be one of: map, phone, line`);
  }
  return normalized;
}

function normalizeJsonSourceList(value, fieldName) {
  if (value == null || value === "") return [];
  try {
    return normalizeStringListInput(Array.isArray(value) ? value : JSON.stringify(value), fieldName);
  } catch {
    return [];
  }
}

function normalizeOptionalUrlValue(value, fieldName) {
  if (value == null || value === "") return null;
  return normalizeHttpUrl(value, fieldName);
}

function normalizeJsonSafeValue(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function normalizeRequestedCheckAnswerType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return [
    "text",
    "url",
    "phone",
    "select",
    "multi_select",
    "boolean",
    "boolean_with_conditions",
    "number_with_unit",
    "hours",
    "note_only",
  ].includes(normalized)
    ? normalized
    : "text";
}

function normalizeRequestedCheckReturnKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw
    .split(".")
    .map((part) => String(part || "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, ""))
    .filter(Boolean)
    .join(".");
}

function normalizeRequestedCheckSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = String(value.kind || "").trim().toLowerCase() || null;
  const confidence = value.confidence == null ? null : normalizeConfidenceValue(value.confidence);
  const note = value.note == null ? null : String(value.note || "").trim() || null;
  if (!kind && !confidence && !note) return null;
  const next = {};
  if (kind) next.kind = kind;
  if (confidence) next.confidence = confidence;
  if (note) next.note = note;
  return next;
}

function normalizeRequestedCheckValueByAnswerType(value, answerType, fieldName) {
  if (value == null) return null;
  if (typeof value === "string") {
    if (answerType === "url") {
      try {
        return normalizeOptionalUrlValue(value, fieldName);
      } catch {
        return String(value || "").trim() || null;
      }
    }
    return String(value || "").trim() || null;
  }
  return normalizeJsonSafeValue(value);
}

function normalizeRequestedChecksJson(value, fieldName = "requested_checks_json") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  const base = defaultRequestedChecksJson();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  const groupsRaw = Array.isArray(parsed.groups) ? parsed.groups : [];
  return {
    version: 1,
    groups: groupsRaw
      .map((group, groupIndex) => {
        if (!group || typeof group !== "object" || Array.isArray(group)) return null;
        const groupKey = String(group.group_key || "").trim().toLowerCase();
        if (!["cta_contact", "taxonomy", "custom"].includes(groupKey)) return null;
        const checksRaw = Array.isArray(group.checks) ? group.checks : [];
        const checks = checksRaw
          .map((check, checkIndex) => {
            if (!check || typeof check !== "object" || Array.isArray(check)) return null;
            const answerType = normalizeRequestedCheckAnswerType(check.answer_type);
            return {
              key: String(check.key || "").trim().toLowerCase() || `check_${groupIndex}_${checkIndex}`,
              requested: Boolean(check.requested),
              label: String(check.label || "").trim() || "",
              instruction: String(check.instruction || "").trim() || "",
              answer_type: answerType,
              suggested_value: normalizeRequestedCheckValueByAnswerType(
                check.suggested_value,
                answerType,
                `${fieldName}.groups[${groupIndex}].checks[${checkIndex}].suggested_value`
              ),
              condition_prompt: check.condition_prompt == null ? null : String(check.condition_prompt || "").trim() || null,
              evidence_required: Boolean(check.evidence_required),
              source: normalizeRequestedCheckSource(check.source),
            };
          })
          .filter(Boolean);
        return {
          group_key: groupKey,
          group_label: String(group.group_label || "").trim() || groupKey,
          checks,
        };
      })
      .filter(Boolean),
  };
}

function hasMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return String(value || "").trim().length > 0;
}

function normalizeAiCtaContactJson(value, fieldName = "ai_cta_contact_json") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  const base = defaultAiCtaContact();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  return {
    phone: parsed.phone == null ? null : String(parsed.phone || "").trim() || null,
    line_url: normalizeOptionalUrlValue(parsed.line_url, `${fieldName}.line_url`),
    facebook_url: normalizeOptionalUrlValue(parsed.facebook_url, `${fieldName}.facebook_url`),
    website_url: normalizeOptionalUrlValue(parsed.website_url, `${fieldName}.website_url`),
    primary_cta: normalizePrimaryCtaValue(parsed.primary_cta, `${fieldName}.primary_cta`),
    source: normalizeJsonSourceList(parsed.source, `${fieldName}.source`),
    confidence: normalizeConfidenceValue(parsed.confidence),
    note: parsed.note == null ? null : String(parsed.note || "").trim() || null,
  };
}

function normalizeAiTaxonomyJson(value, fieldName = "ai_taxonomy_json") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  const base = defaultAiTaxonomy();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  return {
    category: parsed.category == null ? null : String(parsed.category || "").trim() || null,
    subtype: parsed.subtype == null ? null : String(parsed.subtype || "").trim() || null,
    tags: normalizeJsonSourceList(parsed.tags, `${fieldName}.tags`),
    source: normalizeJsonSourceList(parsed.source, `${fieldName}.source`),
    confidence: normalizeConfidenceValue(parsed.confidence),
    note: parsed.note == null ? null : String(parsed.note || "").trim() || null,
  };
}

function normalizeCuratedCtaFieldValue(rawValue, fieldName, kind = "text") {
  const row = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const checked = Boolean(row.checked);
  let value = null;
  if (kind === "url") value = normalizeOptionalUrlValue(row.value, `${fieldName}.value`);
  else if (kind === "primary_cta") value = normalizePrimaryCtaValue(row.value, `${fieldName}.value`);
  else value = row.value == null ? null : String(row.value || "").trim() || null;
  return {
    checked,
    found: checked && hasMeaningfulValue(value),
    value,
    source: kind === "primary_cta" ? undefined : normalizeJsonSourceList(row.source, `${fieldName}.source`),
    note: row.note == null ? null : String(row.note || "").trim() || null,
  };
}

function normalizeCuratedCtaContactJson(value, fieldName = "curated_cta_contact_json") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  const base = defaultCuratedCtaContact();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  return {
    phone: normalizeCuratedCtaFieldValue(parsed.phone, `${fieldName}.phone`, "text"),
    line_url: normalizeCuratedCtaFieldValue(parsed.line_url, `${fieldName}.line_url`, "url"),
    facebook_url: normalizeCuratedCtaFieldValue(parsed.facebook_url, `${fieldName}.facebook_url`, "url"),
    website_url: normalizeCuratedCtaFieldValue(parsed.website_url, `${fieldName}.website_url`, "url"),
    primary_cta: (() => {
      const normalized = normalizeCuratedCtaFieldValue(parsed.primary_cta, `${fieldName}.primary_cta`, "primary_cta");
      return {
        checked: normalized.checked,
        found: normalized.found,
        value: normalized.value,
        note: normalized.note,
      };
    })(),
  };
}

function normalizeCuratedTaxonomyJson(value, fieldName = "curated_taxonomy_json") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  const base = defaultCuratedTaxonomy();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  const normalizeEntry = (rawValue, entryFieldName, isArray = false) => {
    const row = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
    const checked = Boolean(row.checked);
    const valueNormalized = isArray
      ? normalizeJsonSourceList(row.value, `${entryFieldName}.value`)
      : row.value == null ? null : String(row.value || "").trim() || null;
    return {
      checked,
      found: checked && hasMeaningfulValue(valueNormalized),
      value: valueNormalized,
      note: row.note == null ? null : String(row.note || "").trim() || null,
    };
  };
  return {
    category: normalizeEntry(parsed.category, `${fieldName}.category`),
    subtype: normalizeEntry(parsed.subtype, `${fieldName}.subtype`),
    tags: normalizeEntry(parsed.tags, `${fieldName}.tags`, true),
  };
}

function normalizeFieldReturnEvidence(rawValue, fieldName) {
  const evidenceDeliverableId = rawValue?.evidence_deliverable_id == null || rawValue.evidence_deliverable_id === ""
    ? null
    : Number(rawValue.evidence_deliverable_id || 0) || null;
  let evidenceSourceUrl = null;
  try {
    evidenceSourceUrl = normalizeOptionalUrlValue(rawValue?.evidence_source_url, `${fieldName}.evidence_source_url`);
  } catch {
    evidenceSourceUrl = null;
  }
  return {
    evidence_deliverable_id: evidenceDeliverableId,
    evidence_source_url: evidenceSourceUrl,
  };
}

function normalizeFieldReturnCtaEntry(rawValue, fieldName, kind = "text") {
  const row = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const checked = Boolean(row.checked);
  const evidence = normalizeFieldReturnEvidence(row, fieldName);
  let value = null;
  if (checked) {
    try {
      if (kind === "url") value = normalizeOptionalUrlValue(row.value, `${fieldName}.value`);
      else if (kind === "primary_cta") value = normalizePrimaryCtaValue(row.value, `${fieldName}.value`);
      else value = row.value == null ? null : String(row.value || "").trim() || null;
    } catch {
      value = null;
    }
  }
  return {
    checked,
    found: checked && (hasMeaningfulValue(value) || evidence.evidence_deliverable_id != null || Boolean(evidence.evidence_source_url)),
    value: checked ? value : null,
    note: row.note == null ? null : String(row.note || "").trim() || null,
    evidence_deliverable_id: evidence.evidence_deliverable_id,
    evidence_source_url: evidence.evidence_source_url,
  };
}

function defaultFieldReturnCtaShape() {
  return {
    phone: { checked: false, found: false, value: null, note: null, evidence_deliverable_id: null, evidence_source_url: null },
    line_url: { checked: false, found: false, value: null, note: null, evidence_deliverable_id: null, evidence_source_url: null },
    facebook_url: { checked: false, found: false, value: null, note: null, evidence_deliverable_id: null, evidence_source_url: null },
    website_url: { checked: false, found: false, value: null, note: null, evidence_deliverable_id: null, evidence_source_url: null },
    primary_cta: { checked: false, found: false, value: null, note: null, evidence_deliverable_id: null, evidence_source_url: null },
  };
}

function normalizeFieldReturnCtaJson(value, fieldName = "field_return_payload_json.cta_return") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  const base = defaultFieldReturnCtaShape();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  return {
    phone: normalizeFieldReturnCtaEntry(parsed.phone, `${fieldName}.phone`, "text"),
    line_url: normalizeFieldReturnCtaEntry(parsed.line_url, `${fieldName}.line_url`, "url"),
    facebook_url: normalizeFieldReturnCtaEntry(parsed.facebook_url, `${fieldName}.facebook_url`, "url"),
    website_url: normalizeFieldReturnCtaEntry(parsed.website_url, `${fieldName}.website_url`, "url"),
    primary_cta: normalizeFieldReturnCtaEntry(parsed.primary_cta, `${fieldName}.primary_cta`, "primary_cta"),
  };
}

function normalizeFieldReturnTaxonomyEntry(rawValue, fieldName, isTags = false) {
  const row = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const checked = Boolean(row.checked);
  const evidence = normalizeFieldReturnEvidence(row, fieldName);
  let value = isTags ? [] : null;
  if (checked) {
    try {
      if (isTags) value = Array.isArray(row.value) ? normalizeStringListInput(row.value, `${fieldName}.value`) : [];
      else value = row.value == null ? null : String(row.value || "").trim() || null;
    } catch {
      value = isTags ? [] : null;
    }
  }
  return {
    checked,
    found: checked && (hasMeaningfulValue(value) || evidence.evidence_deliverable_id != null || Boolean(evidence.evidence_source_url)),
    value: checked ? value : (isTags ? [] : null),
    note: row.note == null ? null : String(row.note || "").trim() || null,
    evidence_deliverable_id: evidence.evidence_deliverable_id,
    evidence_source_url: evidence.evidence_source_url,
  };
}

function defaultFieldReturnTaxonomyShape() {
  return {
    category: { checked: false, found: false, value: null, note: null, evidence_deliverable_id: null, evidence_source_url: null },
    subtype: { checked: false, found: false, value: null, note: null, evidence_deliverable_id: null, evidence_source_url: null },
    tags: { checked: false, found: false, value: [], note: null, evidence_deliverable_id: null, evidence_source_url: null },
  };
}

function normalizeFieldReturnTaxonomyJson(value, fieldName = "field_return_payload_json.taxonomy_return") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  const base = defaultFieldReturnTaxonomyShape();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  return {
    category: normalizeFieldReturnTaxonomyEntry(parsed.category, `${fieldName}.category`, false),
    subtype: normalizeFieldReturnTaxonomyEntry(parsed.subtype, `${fieldName}.subtype`, false),
    tags: normalizeFieldReturnTaxonomyEntry(parsed.tags, `${fieldName}.tags`, true),
  };
}

function normalizeRequestedCheckReturnValue(rawValue, answerType, fieldName) {
  if (rawValue == null) {
    return answerType === "multi_select" ? [] : null;
  }
  try {
    if (answerType === "url") return normalizeOptionalUrlValue(rawValue, fieldName);
    if (["text", "phone", "select", "hours"].includes(answerType)) {
      return String(rawValue || "").trim() || null;
    }
    if (answerType === "multi_select") {
      return Array.isArray(rawValue) ? normalizeStringListInput(rawValue, fieldName) : [];
    }
    if (answerType === "boolean" || answerType === "boolean_with_conditions") {
      return typeof rawValue === "boolean" ? rawValue : null;
    }
    if (answerType === "number_with_unit") {
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) return { number: rawValue, unit: null };
      if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return null;
      const numeric = Number(rawValue.number);
      return Number.isFinite(numeric)
        ? { number: numeric, unit: rawValue.unit == null ? null : String(rawValue.unit || "").trim() || null }
        : null;
    }
    if (answerType === "note_only") return null;
  } catch {
    return answerType === "multi_select" ? [] : null;
  }
  return normalizeJsonSafeValue(rawValue);
}

function inferRequestedCheckAnswerTypeFromReturnRow(row) {
  const explicitAnswerType = String(row?.answer_type || "").trim().toLowerCase();
  if (explicitAnswerType) return normalizeRequestedCheckAnswerType(explicitAnswerType);
  const value = row?.value;
  if (Array.isArray(value)) return "multi_select";
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "number") || Object.prototype.hasOwnProperty.call(value, "unit")) {
      return "number_with_unit";
    }
    return "text";
  }
  if (typeof value === "boolean") {
    return (row?.condition_note || row?.note) ? "boolean_with_conditions" : "boolean";
  }
  if (!hasMeaningfulValue(value) && (row?.condition_note || row?.note)) {
    return "note_only";
  }
  return "text";
}

function normalizeRequestedCheckReturnEntry(rawValue, fieldName) {
  const row = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const checked = Boolean(row.checked);
  const answerType = inferRequestedCheckAnswerTypeFromReturnRow(row);
  const evidence = normalizeFieldReturnEvidence(row, fieldName);
  const evidenceText = row.evidence == null ? null : String(row.evidence || "").trim() || null;
  const note = row.note == null ? null : String(row.note || "").trim() || null;
  const conditionNote = row.condition_note == null ? null : String(row.condition_note || "").trim() || null;
  const value = checked
    ? normalizeRequestedCheckReturnValue(row.value, answerType, `${fieldName}.value`)
    : (answerType === "multi_select" ? null : null);
  const hasEvidence = evidence.evidence_deliverable_id != null || Boolean(evidence.evidence_source_url) || Boolean(evidenceText);
  const hasCondition = Boolean(conditionNote);
  const hasNote = Boolean(note);
  const found = checked && (
    hasMeaningfulValue(value)
    || hasEvidence
    || (answerType === "note_only" && (hasNote || hasCondition))
    || (answerType === "boolean_with_conditions" && (value === true || hasCondition))
  );
  return {
    checked,
    found,
    answer_type: answerType,
    value: checked ? value : null,
    condition_note: checked ? conditionNote : null,
    evidence: checked ? evidenceText : null,
    note,
    evidence_deliverable_id: checked ? evidence.evidence_deliverable_id : null,
    evidence_source_url: checked ? evidence.evidence_source_url : null,
  };
}

function normalizeRequestedCheckReturns(value, fieldName = "field_return_payload_json.requested_check_returns") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.entries(parsed).reduce((acc, [key, row]) => {
    const normalizedKey = normalizeRequestedCheckReturnKey(key);
    if (!normalizedKey) return acc;
    acc[normalizedKey] = normalizeRequestedCheckReturnEntry(row, `${fieldName}.${normalizedKey}`);
    return acc;
  }, {});
}

function normalizeFieldReturnPayloadJson(value, fieldName = "field_return_payload_json") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  const base = defaultFieldReturnPayload();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  const checklistResultsRaw = Array.isArray(parsed.checklist_results) ? parsed.checklist_results : [];
  const checklistResults = checklistResultsRaw
    .map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const checked = Boolean(row.checked);
      const evidence = normalizeFieldReturnEvidence(row, `${fieldName}.checklist_results[${index}]`);
      const valueNormalized = row.value == null
        ? null
        : Array.isArray(row.value)
          ? normalizeJsonSourceList(row.value, `${fieldName}.checklist_results[${index}].value`)
          : String(row.value || "").trim() || null;
      return {
        checklist_id: row.checklist_id == null || row.checklist_id === "" ? null : Number(row.checklist_id || 0) || null,
        checked,
        found: checked && (hasMeaningfulValue(valueNormalized) || evidence.evidence_deliverable_id != null || Boolean(evidence.evidence_source_url)),
        value: checked ? valueNormalized : null,
        note: row.note == null ? null : String(row.note || "").trim() || null,
        evidence_deliverable_id: evidence.evidence_deliverable_id,
        evidence_source_url: evidence.evidence_source_url,
      };
    })
    .filter(Boolean);
  return {
    checklist_results: checklistResults,
    cta_return: normalizeFieldReturnCtaJson(parsed.cta_return, `${fieldName}.cta_return`),
    taxonomy_return: normalizeFieldReturnTaxonomyJson(parsed.taxonomy_return, `${fieldName}.taxonomy_return`),
    requested_check_returns: normalizeRequestedCheckReturns(parsed.requested_check_returns, `${fieldName}.requested_check_returns`),
    note: parsed.note == null ? null : String(parsed.note || "").trim() || null,
  };
}

function normalizeConfirmedCtaContactJson(value, fieldName = "confirmed_cta_contact_json") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  const base = defaultConfirmedCtaContact();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  return {
    phone: parsed.phone == null ? null : String(parsed.phone || "").trim() || null,
    line_url: normalizeOptionalUrlValue(parsed.line_url, `${fieldName}.line_url`),
    facebook_url: normalizeOptionalUrlValue(parsed.facebook_url, `${fieldName}.facebook_url`),
    website_url: normalizeOptionalUrlValue(parsed.website_url, `${fieldName}.website_url`),
    primary_cta: normalizePrimaryCtaValue(parsed.primary_cta, `${fieldName}.primary_cta`),
  };
}

function normalizeConfirmedTaxonomyJson(value, fieldName = "confirmed_taxonomy_json") {
  const parsed = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJson(value, null);
  const base = defaultConfirmedTaxonomy();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  return {
    category: parsed.category == null ? null : String(parsed.category || "").trim() || null,
    subtype: parsed.subtype == null ? null : String(parsed.subtype || "").trim() || null,
    tags: normalizeJsonSourceList(parsed.tags, `${fieldName}.tags`),
  };
}

function normalizeCurationStatusValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CURATION_STATUS_VALUES.has(normalized) ? normalized : "not_started";
}

function normalizeConfirmedMetaStatusValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CONFIRMED_META_STATUS_VALUES.has(normalized) ? normalized : "not_started";
}

function normalizeContentDraftRow(row) {
  if (!row) return null;
  return {
    ...row,
    suggested_related: parseJson(row.suggested_related_json, []),
    confirmed_cta_contact_json: normalizeConfirmedCtaContactJson(row.confirmed_cta_contact_json),
    confirmed_taxonomy_json: normalizeConfirmedTaxonomyJson(row.confirmed_taxonomy_json),
    confirmed_meta_status: normalizeConfirmedMetaStatusValue(row.confirmed_meta_status),
    confirmed_by_user_id: Number(row.confirmed_by_user_id || 0) || null,
    confirmed_at: row.confirmed_at || null,
    confirmed_note: row.confirmed_note == null ? null : String(row.confirmed_note || "").trim() || null,
  };
}
function normalizeSearchEnrichmentRow(row) {
  if (!row) return null;
  return {
    ...row,
    top_results_json: parseJson(row.top_results_json, []),
    official_urls_json: parseJson(row.official_urls_json, []),
    search_angle_hints_json: parseJson(row.search_angle_hints_json, []),
    payload_json: parseJson(row.payload_json, null),
  };
}

function buildSearchSignalSummary(searchRow) {
  const topResults = Array.isArray(searchRow?.top_results_json) ? searchRow.top_results_json : [];
  const officialUrls = Array.isArray(searchRow?.official_urls_json) ? searchRow.official_urls_json : [];
  const angleHints = Array.isArray(searchRow?.search_angle_hints_json) ? searchRow.search_angle_hints_json : [];
  const normalizedResultCount = topResults.length;
  const officialUrlCount = officialUrls.length;
  const explicitOfficialCount = topResults.filter((row) => row && row.is_official === true).length;
  const webPresenceProvided = toNullableScore(searchRow?.web_presence_score, "web_presence_score");
  const contentGapProvided = toNullableScore(searchRow?.content_gap_score, "content_gap_score");
  const entityConfidence = toNullableScore(searchRow?.entity_confidence_score, "entity_confidence_score");

  const resultCoverageScore = normalizedResultCount >= 10 ? 10 : normalizedResultCount >= 6 ? 8 : normalizedResultCount >= 3 ? 6 : normalizedResultCount >= 1 ? 4 : 1;
  const officialPresenceScore = officialUrlCount >= 2 ? 10 : officialUrlCount >= 1 ? 7 : explicitOfficialCount > 0 ? 6 : 2;
  const angleHintScore = angleHints.length >= 4 ? 10 : angleHints.length >= 2 ? 7 : angleHints.length >= 1 ? 5 : 2;

  const webPresenceScore = webPresenceProvided == null
    ? clampScore((resultCoverageScore * 0.55) + (officialPresenceScore * 0.45), 0, 10)
    : clampScore(webPresenceProvided, 0, 10);

  const contentGapScore = contentGapProvided == null
    ? clampScore(10 - ((resultCoverageScore * 0.5) + (officialPresenceScore * 0.3) + (angleHintScore * 0.2)), 0, 10)
    : clampScore(contentGapProvided, 0, 10);

  return {
    normalized_result_count: normalizedResultCount,
    official_url_count: officialUrlCount,
    angle_hint_count: angleHints.length,
    entity_confidence_score: entityConfidence == null ? null : clampScore(entityConfidence, 0, 10),
    result_coverage_score: Number(resultCoverageScore.toFixed(3)),
    official_presence_score: Number(officialPresenceScore.toFixed(3)),
    angle_hint_score: Number(angleHintScore.toFixed(3)),
    web_presence_score: Number(webPresenceScore.toFixed(3)),
    content_gap_score: Number(contentGapScore.toFixed(3)),
  };
}

function normalizePlaceIntelligenceRow(row) {
  if (!row) return null;
  return {
    ...row,
    why_selected_json: parseJson(row.why_selected_json, []),
    best_content_angles_json: parseJson(row.best_content_angles_json, []),
    payload_json: parseJson(row.payload_json, null),
  };
}

function normalizeSocialSignalRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJson(row.payload_json, null),
  };
}

function normalizeMomentumRow(row) {
  if (!row) return null;
  return {
    ...row,
    momentum_reason: parseJson(row.momentum_reason, null),
    payload_json: parseJson(row.payload_json, null),
  };
}

function normalizeContentDirectionRow(row) {
  if (!row) return null;
  return {
    ...row,
    secondary_angles_json: parseJson(row.secondary_angles_json, []),
    why_now_json: parseJson(row.why_now_json, []),
    why_not_now_json: parseJson(row.why_not_now_json, []),
    recommended_capture_plan_json: parseJson(row.recommended_capture_plan_json, []),
    recommended_content_formats_json: parseJson(row.recommended_content_formats_json, []),
    signal_summary_json: parseJson(row.signal_summary_json, {}),
    gaps_json: parseJson(row.gaps_json, []),
    payload_json: parseJson(row.payload_json, null),
  };
}

function normalizeWorkflowModelRow(row) {
  if (!row) return null;
  return {
    ...row,
    current_draft_id: Number(row.current_draft_id || 0) || null,
    current_review_report_id: Number(row.current_review_report_id || 0) || null,
    current_field_pack_id: Number(row.current_field_pack_id || 0) || null,
    state_version: Math.max(1, Number(row.state_version || 0) || 1),
    content_version: Math.max(0, Number(row.content_version || 0) || 0),
  };
}

function normalizeAssignmentRow(row) {
  if (!row) return null;
  const externalAssigneeProfile = parseJson(row.external_assignee_profile_json, null);
  const explicitAssignmentKind = normalizeAssignmentKindValue(row.assignment_kind);
  const derivedAssignmentKind = normalizeAssignmentKindValue(
    String(row.assignee_role || "").trim().toLowerCase() === "editor" ? "editorial" : "field",
    "field"
  );
  const internalAssigneeEmail = Number(row.assignee_user_id || 0) > 0
    ? String(row.assignee_email || "").trim().toLowerCase()
    : "";
  const legacyExternalEmail = !Number(row.assignee_user_id || 0)
    && !externalAssigneeProfile
    && String(row.assignee_contact || "").trim().includes("@")
    && !String(row.assignee_contact || "").trim().startsWith("@")
      ? String(row.assignee_contact || "").trim().toLowerCase()
      : "";
  const externalAssigneeEmail = String(externalAssigneeProfile?.email || "").trim().toLowerCase() || legacyExternalEmail;
  return {
    ...row,
    brief_json: parseJson(row.brief_json, null),
    requirements_json: parseJson(row.requirements_json, null),
    assignment_kind: explicitAssignmentKind || derivedAssignmentKind,
    external_assignee_profile_json: externalAssigneeProfile,
    assignee_email: externalAssigneeEmail || internalAssigneeEmail || null,
    image_reset_required: Number(row.image_reset_required || 0) === 1,
    video_reset_required: Number(row.video_reset_required || 0) === 1,
  };
}

function normalizeAssignmentSubmissionRow(row) {
  if (!row) return null;
  return {
    ...row,
    article_payload_json: parseJson(row.article_payload_json, null),
    media_payload_json: parseJson(row.media_payload_json, null),
    field_return_payload_json: normalizeFieldReturnPayloadJson(row.field_return_payload_json),
  };
}

function fieldReturnEvidenceLabelFromKey(groupKey, checkKey) {
  const normalizedGroupKey = String(groupKey || "").trim().toLowerCase();
  const normalizedCheckKey = String(checkKey || "").trim().toLowerCase();
  if (normalizedGroupKey === "cta_contact") {
    if (normalizedCheckKey === "phone") return "เบอร์โทร";
    if (normalizedCheckKey === "line_url") return "ลิงก์ LINE";
    if (normalizedCheckKey === "facebook_url") return "ลิงก์ Facebook";
    if (normalizedCheckKey === "website_url") return "ลิงก์เว็บไซต์";
    if (normalizedCheckKey === "primary_cta") return "ปุ่มหลัก";
  }
  if (normalizedGroupKey === "taxonomy") {
    if (normalizedCheckKey === "category") return "หมวดหลัก";
    if (normalizedCheckKey === "subtype") return "หมวดย่อย";
    if (normalizedCheckKey === "tags") return "แท็ก";
  }
  return normalizedCheckKey
    .split(/[_\-.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeAssignmentSubmissionDraftRow(row) {
  if (!row) return null;
  return {
    ...row,
    article_payload_json: parseJson(row.article_payload_json, null),
  };
}

function normalizeAssignmentSubmissionDeliverableRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJson(row.payload_json, null),
  };
}

function mergeAssignmentSubmissionObjectPayload(existingPayload, incomingPayload) {
  const base = existingPayload && typeof existingPayload === "object" && !Array.isArray(existingPayload)
    ? existingPayload
    : null;
  const incoming = incomingPayload && typeof incomingPayload === "object" && !Array.isArray(incomingPayload)
    ? incomingPayload
    : null;
  if (!incoming) return base;
  if (!base) return incoming;
  return { ...base, ...incoming };
}

function normalizeAssignmentSubmissionMediaAsset(asset) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) return null;
  const id = asset.id == null || asset.id === "" ? null : Number(asset.id || 0) || null;
  const publicUrl = String(asset.public_url || "").trim() || null;
  const fileName = String(asset.file_name || "").trim() || null;
  const mimeType = String(asset.mime_type || "").trim() || null;
  if (!id && !publicUrl && !fileName) return null;
  return {
    id,
    file_name: fileName,
    mime_type: mimeType,
    public_url: publicUrl,
  };
}

function mergeAssignmentSubmissionMediaPayload(existingPayload, incomingPayload) {
  const base = existingPayload && typeof existingPayload === "object" && !Array.isArray(existingPayload)
    ? existingPayload
    : null;
  const incoming = incomingPayload && typeof incomingPayload === "object" && !Array.isArray(incomingPayload)
    ? incomingPayload
    : null;
  if (!incoming) return base;
  if (!base) return incoming;

  const existingAssets = Array.isArray(base.assets) ? base.assets : [];
  const incomingAssets = Array.isArray(incoming.assets) ? incoming.assets : [];
  if (!incomingAssets.length) {
    return { ...base, ...incoming, assets: existingAssets };
  }

  const merged = [];
  const seen = new Map();
  const pushAsset = (rawAsset) => {
    const asset = normalizeAssignmentSubmissionMediaAsset(rawAsset);
    if (!asset) return;
    const dedupeKey = asset.id != null
      ? `id:${asset.id}`
      : asset.public_url
        ? `url:${asset.public_url}`
        : `file:${asset.file_name || ""}|${asset.mime_type || ""}`;
    if (seen.has(dedupeKey)) {
      merged[seen.get(dedupeKey)] = { ...merged[seen.get(dedupeKey)], ...asset };
      return;
    }
    seen.set(dedupeKey, merged.length);
    merged.push(asset);
  };

  existingAssets.forEach(pushAsset);
  incomingAssets.forEach(pushAsset);
  return {
    ...base,
    ...incoming,
    assets: merged,
  };
}

function normalizeIntelligenceModelRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence_summary_json: parseJson(row.evidence_summary_json, null),
    signals_json: parseJson(row.signals_json, null),
    scores_json: parseJson(row.scores_json, null),
    niche_json: parseJson(row.niche_json, null),
    gaps_json: parseJson(row.gaps_json, []),
    next_actions_json: parseJson(row.next_actions_json, []),
    brief_json: parseJson(row.brief_json, null),
    readiness_json: parseJson(row.readiness_json, null),
    reasons_json: parseJson(row.reasons_json, null),
    payload_json: parseJson(row.payload_json, null),
  };
}

function normalizeReadinessBriefRow(row) {
  if (!row) return null;
  return {
    ...row,
    readiness_json: parseJson(row.readiness_json, null),
    brief_json: parseJson(row.brief_json, null),
    reasons_json: parseJson(row.reasons_json, null),
    blockers_json: parseJson(row.blockers_json, []),
    missing_requirements_json: parseJson(row.missing_requirements_json, []),
  };
}

function normalizeAssignmentHandoffRow(row) {
  if (!row) return null;
  return {
    ...row,
    handoff_package_json: parseJson(row.handoff_package_json, null),
  };
}

function normalizeExecutionControlsRow(row) {
  if (!row) return null;
  return {
    ...row,
    must_include_points_json: parseJson(row.must_include_points_json, []),
    must_avoid_points_json: parseJson(row.must_avoid_points_json, []),
    blockers_json: parseJson(row.blockers_json, []),
    missing_requirements_json: parseJson(row.missing_requirements_json, []),
    reasons_json: parseJson(row.reasons_json, null),
    payload_json: parseJson(row.payload_json, null),
  };
}

function normalizeExecutionChannelRow(row) {
  if (!row) return null;
  return {
    ...row,
    derived_controls_json: parseJson(row.derived_controls_json, null),
    recommended_version_json: parseJson(row.recommended_version_json, null),
    alternatives_json: parseJson(row.alternatives_json, []),
    validation_json: parseJson(row.validation_json, null),
  };
}
function toNullableNumber(value, fieldName) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
  return n;
}

function toNullableNonNegativeInt(value, fieldName) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return n;
}

function normalizeJsonListInput(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  if (typeof value === "string") return parseJson(value, []);
  return [];
}

function normalizePayloadInput(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") return parseJson(value, null);
  if (typeof value === "object") return value;
  return null;
}

function normalizeEvaluationDebugOverrides(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!src) {
    return {
      used: false,
      keys: [],
      values: {},
    };
  }
  const values = {};
  const keys = [];

  const boolKeys = [
    "upstream_ready_for_handoff",
    "review_signal_present",
    "review_usable",
    "handoff_usable",
    "ready_for_handoff",
  ];
  for (const key of boolKeys) {
    if (Object.prototype.hasOwnProperty.call(src, key) && typeof src[key] === "boolean") {
      values[key] = src[key];
      keys.push(key);
    }
  }

  if (Object.prototype.hasOwnProperty.call(src, "submission_decision")) {
    const value = String(src.submission_decision || "").trim().toLowerCase();
    if (value === "accept" || value === "request_more" || value === "block") {
      values.submission_decision = value;
      keys.push("submission_decision");
    }
  }
  if (Object.prototype.hasOwnProperty.call(src, "governance_decision")) {
    const value = String(src.governance_decision || "").trim().toLowerCase();
    if (value === "ready_for_review" || value === "request_more" || value === "hold") {
      values.governance_decision = value;
      keys.push("governance_decision");
    }
  }
  if (Object.prototype.hasOwnProperty.call(src, "handoff_governance_decision")) {
    const value = String(src.handoff_governance_decision || "").trim().toLowerCase();
    if (value === "ready" || value === "request_more" || value === "hold") {
      values.handoff_governance_decision = value;
      keys.push("handoff_governance_decision");
    }
  }

  return {
    used: keys.length > 0,
    keys,
    values,
  };
}

export function hasRecognizedEvaluationOverrideInput(raw) {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const expectedDeliverables = normalizeAssignmentDeliverableTypeList(payload.expected_deliverables);
  if (expectedDeliverables.length > 0) {
    return true;
  }
  return normalizeEvaluationDebugOverrides(payload.debug_overrides).used;
}

function applyDecisionOverrideReconciliation({
  overrideDecision,
  currentDecision,
  currentReadyFlag,
  reasonCodes,
  decisionReasonMap,
  conflictingReasonCodes = [],
  readyByDecision = null,
}) {
  const dedupeCodes = (list) => {
    const seen = new Set();
    const out = [];
    for (const code of Array.isArray(list) ? list : []) {
      const normalized = String(code || "").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  };

  const normalizedOverride = typeof overrideDecision === "string"
    ? String(overrideDecision).trim().toLowerCase()
    : "";
  const normalizedCurrentDecision = String(currentDecision || "").trim().toLowerCase();
  let nextDecision = normalizedCurrentDecision;
  let nextReadyFlag = Boolean(currentReadyFlag);
  let nextReasonCodes = Array.isArray(reasonCodes) ? [...reasonCodes] : [];

  if (!normalizedOverride) {
    return {
      decision: nextDecision,
      ready_flag: nextReadyFlag,
      reason_codes: dedupeCodes(nextReasonCodes),
    };
  }

  const mappedDecisionReasons = Object.values(decisionReasonMap || {})
    .map((code) => String(code || "").trim().toLowerCase())
    .filter(Boolean);
  const removable = new Set([
    ...mappedDecisionReasons,
    ...(Array.isArray(conflictingReasonCodes) ? conflictingReasonCodes : [])
      .map((code) => String(code || "").trim().toLowerCase())
      .filter(Boolean),
  ]);

  nextDecision = normalizedOverride;
  nextReasonCodes = nextReasonCodes.filter((code) => !removable.has(String(code || "").trim().toLowerCase()));
  if (readyByDecision && Object.prototype.hasOwnProperty.call(readyByDecision, nextDecision)) {
    nextReadyFlag = Boolean(readyByDecision[nextDecision]);
  }
  const mappedReason = decisionReasonMap?.[nextDecision];
  if (mappedReason) {
    nextReasonCodes.push(mappedReason);
  }

  return {
    decision: nextDecision,
    ready_flag: nextReadyFlag,
    reason_codes: dedupeCodes(nextReasonCodes),
  };
}

function reconcileNestedSummariesForHandoffOverride({
  handoffDecision,
  submissionSummary,
  deliverablesSummary,
}) {
  const dedupeCodes = (list) => {
    const seen = new Set();
    const out = [];
    for (const code of Array.isArray(list) ? list : []) {
      const normalized = String(code || "").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  };
  const normalizeReasons = (list, removeCodes, addCode) => {
    const removeSet = new Set((Array.isArray(removeCodes) ? removeCodes : [])
      .map((code) => String(code || "").trim().toLowerCase())
      .filter(Boolean));
    const next = dedupeCodes(list).filter((code) => !removeSet.has(code));
    const normalizedAdd = String(addCode || "").trim().toLowerCase();
    if (normalizedAdd && !next.includes(normalizedAdd)) {
      next.push(normalizedAdd);
    }
    return next;
  };

  const normalizedDecision = String(handoffDecision || "").trim().toLowerCase();
  let nextSubmission = submissionSummary;
  let nextDeliverables = deliverablesSummary;

  if (normalizedDecision === "ready") {
    if (submissionSummary && typeof submissionSummary === "object") {
      const submissionDebug = submissionSummary.debug && typeof submissionSummary.debug === "object"
        ? submissionSummary.debug
        : {};
      nextSubmission = {
        ...submissionSummary,
        submission_decision: "accept",
        ready_for_handoff: true,
        review_usable: true,
        handoff_usable: true,
        effective_submission_decision: "accept",
        effective_ready_for_handoff: true,
        reconciled_copy: true,
        reconciled_from_parent_override: true,
        reconciled_from_decision: normalizedDecision,
        debug: {
          ...submissionDebug,
          handoff_ready: true,
          upstream_ready_for_handoff: true,
          effective_submission_decision: "accept",
          effective_ready_for_handoff: true,
        },
        reason_codes: normalizeReasons(
          submissionSummary.reason_codes,
          [
            "assignment_submission_decision_block",
            "assignment_submission_decision_blocked_upstream",
            "assignment_submission_decision_request_more",
            "handoff_not_ready",
            "submission_requires_more_deliverables",
          ],
          "assignment_submission_decision_accept",
        ),
      };
    }
    if (deliverablesSummary && typeof deliverablesSummary === "object") {
      const deliverablesSourceTrace = deliverablesSummary.source_trace && typeof deliverablesSummary.source_trace === "object"
        ? deliverablesSummary.source_trace
        : {};
      const deliverablesDebug = deliverablesSummary.debug && typeof deliverablesSummary.debug === "object"
        ? deliverablesSummary.debug
        : {};
      nextDeliverables = {
        ...deliverablesSummary,
        governance_decision: "ready_for_review",
        ready_for_review: true,
        ready_for_handoff: true,
        review_usable: true,
        handoff_usable: true,
        effective_governance_decision: "ready_for_review",
        effective_submission_decision: "accept",
        effective_ready_for_review: true,
        reconciled_copy: true,
        reconciled_from_parent_override: true,
        reconciled_from_decision: normalizedDecision,
        source_trace: {
          ...deliverablesSourceTrace,
          submission_decision: "accept",
          upstream_ready_for_handoff: true,
          effective_submission_decision: "accept",
        },
        debug: {
          ...deliverablesDebug,
          submission_decision: "accept",
          effective_governance_decision: "ready_for_review",
          effective_submission_decision: "accept",
          effective_ready_for_review: true,
        },
        reason_codes: normalizeReasons(
          deliverablesSummary.reason_codes,
          [
            "assignment_deliverables_governance_hold",
            "assignment_deliverables_governance_request_more",
            "assignment_not_ready_for_review",
            "assignment_submission_decision_block",
            "assignment_submission_decision_blocked_upstream",
            "handoff_not_ready",
          ],
          "assignment_deliverables_governance_ready_for_review",
        ),
      };
    }
  }

  return {
    submission_summary: nextSubmission,
    deliverables_summary: nextDeliverables,
  };
}

function didSummarySemanticsDiverge(rawSummary, effectiveSummary, semanticFields = []) {
  for (const field of Array.isArray(semanticFields) ? semanticFields : []) {
    const rawValue = rawSummary && Object.prototype.hasOwnProperty.call(rawSummary, field)
      ? rawSummary[field]
      : null;
    const effectiveValue = effectiveSummary && Object.prototype.hasOwnProperty.call(effectiveSummary, field)
      ? effectiveSummary[field]
      : null;
    if (JSON.stringify(rawValue) !== JSON.stringify(effectiveValue)) {
      return true;
    }
  }
  return false;
}

function toRawEvaluationOptions(options = {}) {
  const next = options && typeof options === "object" && !Array.isArray(options)
    ? { ...options }
    : {};
  delete next.debug_overrides;
  delete next.expected_deliverables;
  return next;
}

function normalizeEvidenceRow(row) {
  if (!row) return null;
  return {
    ...row,
    list_value_json: parseJson(row.list_value_json, []),
    payload_json: parseJson(row.payload_json, null),
    source_family: classifyEvidenceSourceFamily(row),
  };
}

function normalizeApprovedContextRow(row) {
  if (!row) return null;
  return {
    ...row,
    selected_list_json: parseJson(row.selected_list_json, []),
  };
}

function normalizeFieldPackStatus(value) {
  const normalized = String(value || "draft").trim().toLowerCase();
  if (normalized === "ready_for_handoff") return "ready_for_field";
  return ["draft", "ready_for_field", "field_in_progress", "field_done", "on_hold"].includes(normalized)
    ? normalized
    : "";
}

function normalizeFieldPackChecklistType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["must_verify_fact", "must_capture", "must_ask_question"].includes(normalized)
    ? normalized
    : "";
}

function normalizeFieldPackChecklistStatus(value) {
  const normalized = String(value || "todo").trim().toLowerCase();
  return ["todo", "doing", "done", "skip"].includes(normalized)
    ? normalized
    : "";
}

function normalizeFieldPackReferenceScope(value) {
  const normalized = String(value || "general").trim().toLowerCase();
  return ["general", "writer"].includes(normalized)
    ? normalized
    : "";
}

function normalizeFieldPackSourceFamily(value) {
  const normalized = String(value || "manual").trim().toLowerCase();
  return ["official", "institutional", "google_maps", "wongnai", "manual", "system"].includes(normalized)
    ? normalized
    : "";
}

function normalizeFieldPackMediaHintKind(value) {
  const normalized = String(value || "reference").trim().toLowerCase();
  return ["cover", "gallery", "raw", "reference"].includes(normalized)
    ? normalized
    : "";
}

function normalizeFieldPackAssignmentScope(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["field", "writer"].includes(normalized)
    ? normalized
    : "";
}

function toBooleanInt(value, fieldName) {
  if (value == null || value === "") return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === 1 || value === "1") return 1;
  if (value === 0 || value === "0") return 0;
  throw new Error(`${fieldName} must be a boolean`);
}

function normalizeFieldPackRow(row) {
  if (!row) return null;
  return {
    ...row,
    is_current: Boolean(row.is_current),
    writer_ready: Boolean(row.writer_ready),
    ai_highlights_json: parseJson(row.ai_highlights_json, []),
    ai_unknowns_json: parseJson(row.ai_unknowns_json, []),
    verified_facts_json: parseJson(row.verified_facts_json, []),
    uncertain_facts_json: parseJson(row.uncertain_facts_json, []),
    social_shot_emphasis_json: parseJson(row.social_shot_emphasis_json, []),
    social_on_camera_points_json: parseJson(row.social_on_camera_points_json, []),
    writer_key_points_json: parseJson(row.writer_key_points_json, []),
    ai_cta_contact_json: normalizeAiCtaContactJson(row.ai_cta_contact_json),
    ai_taxonomy_json: normalizeAiTaxonomyJson(row.ai_taxonomy_json),
    requested_checks_json: normalizeRequestedChecksJson(row.requested_checks_json),
    curated_cta_contact_json: normalizeCuratedCtaContactJson(row.curated_cta_contact_json),
    curated_taxonomy_json: normalizeCuratedTaxonomyJson(row.curated_taxonomy_json),
    curation_status: normalizeCurationStatusValue(row.curation_status),
    curated_by_user_id: Number(row.curated_by_user_id || 0) || null,
    curated_at: row.curated_at || null,
    curation_note: row.curation_note == null ? null : String(row.curation_note || "").trim() || null,
  };
}

function normalizeFieldPackChecklistRow(row) {
  if (!row) return null;
  return {
    ...row,
  };
}

function normalizeFieldPackReferenceRow(row) {
  if (!row) return null;
  return {
    ...row,
  };
}

  function normalizeFieldPackMediaHintRow(row) {
    if (!row) return null;
    return {
      ...row,
      selected: Boolean(row.selected),
  };
}

function normalizeFieldPackAssignmentRow(row) {
  if (!row) return null;
  return {
    ...row,
  };
}

function buildFieldPackEditableState(row) {
  if (!row) return {};
  return {
    content_item_id: row.content_item_id,
    source_draft_id: row.source_draft_id,
    source_review_report_id: row.source_review_report_id,
    source_draft_input_snapshot_id: row.source_draft_input_snapshot_id,
    status: row.status,
    is_current: row.is_current,
    ai_summary: row.ai_summary,
    ai_highlights: Array.isArray(row.ai_highlights_json) ? row.ai_highlights_json : [],
    ai_unknowns: Array.isArray(row.ai_unknowns_json) ? row.ai_unknowns_json : [],
    editor_summary: row.editor_summary,
    verified_facts: Array.isArray(row.verified_facts_json) ? row.verified_facts_json : [],
    uncertain_facts: Array.isArray(row.uncertain_facts_json) ? row.uncertain_facts_json : [],
    story_angle: row.story_angle,
    field_notes: row.field_notes,
    social_hook: row.social_hook,
    social_shot_emphasis: Array.isArray(row.social_shot_emphasis_json) ? row.social_shot_emphasis_json : [],
    social_on_camera_points: Array.isArray(row.social_on_camera_points_json) ? row.social_on_camera_points_json : [],
    social_caption_angle: row.social_caption_angle,
    ai_cta_contact_json: row.ai_cta_contact_json,
    ai_taxonomy_json: row.ai_taxonomy_json,
    requested_checks_json: row.requested_checks_json,
    curated_cta_contact_json: row.curated_cta_contact_json,
    curated_taxonomy_json: row.curated_taxonomy_json,
    curation_status: row.curation_status,
    curated_by_user_id: row.curated_by_user_id,
    curated_at: row.curated_at,
    curation_note: row.curation_note,
    writer_ready: row.writer_ready,
    writer_angle: row.writer_angle,
    writer_key_points: Array.isArray(row.writer_key_points_json) ? row.writer_key_points_json : [],
    writer_notes: row.writer_notes,
    updated_by: row.updated_by,
  };
}

function normalizeArrayLikeInput(value, fieldName) {
  if (Array.isArray(value)) return value;
  return parseJsonInputStrict(value ?? [], fieldName, "array") || [];
}

function normalizeFieldPackPayload(payload = {}, options = {}) {
  const requireContentItemId = options?.requireContentItemId !== false;
  const contentItemId = payload?.content_item_id == null || payload.content_item_id === ""
    ? null
    : Number(payload.content_item_id || 0);
  if (requireContentItemId && !contentItemId) {
    throw new Error("content_item_id is required");
  }

  const status = normalizeFieldPackStatus(payload?.status ?? "draft");
  if (!status) throw new Error("invalid field pack status");

  const sourceDraftId = payload?.source_draft_id == null || payload.source_draft_id === ""
    ? null
    : Number(payload.source_draft_id || 0) || null;
  const sourceReviewReportId = payload?.source_review_report_id == null || payload.source_review_report_id === ""
    ? null
    : Number(payload.source_review_report_id || 0) || null;
  const sourceDraftInputSnapshotId = payload?.source_draft_input_snapshot_id == null || payload.source_draft_input_snapshot_id === ""
    ? null
    : Number(payload.source_draft_input_snapshot_id || 0) || null;

  return {
    content_item_id: contentItemId,
    source_draft_id: sourceDraftId,
    source_review_report_id: sourceReviewReportId,
    source_draft_input_snapshot_id: sourceDraftInputSnapshotId,
    status,
    is_current: toBooleanInt(payload?.is_current ?? 1, "is_current"),
    ai_summary: payload?.ai_summary == null ? null : String(payload.ai_summary || "").trim() || null,
    ai_highlights_json: JSON.stringify(normalizeStringListInput(payload?.ai_highlights_json ?? payload?.ai_highlights ?? [], "ai_highlights_json")),
    ai_unknowns_json: JSON.stringify(normalizeStringListInput(payload?.ai_unknowns_json ?? payload?.ai_unknowns ?? [], "ai_unknowns_json")),
    editor_summary: payload?.editor_summary == null ? null : String(payload.editor_summary || "").trim() || null,
    verified_facts_json: JSON.stringify(normalizeStringListInput(payload?.verified_facts_json ?? payload?.verified_facts ?? [], "verified_facts_json")),
    uncertain_facts_json: JSON.stringify(normalizeStringListInput(payload?.uncertain_facts_json ?? payload?.uncertain_facts ?? [], "uncertain_facts_json")),
    story_angle: payload?.story_angle == null ? null : String(payload.story_angle || "").trim() || null,
    field_notes: payload?.field_notes == null ? null : String(payload.field_notes || "").trim() || null,
    social_hook: payload?.social_hook == null ? null : String(payload.social_hook || "").trim() || null,
    social_shot_emphasis_json: JSON.stringify(normalizeStringListInput(payload?.social_shot_emphasis_json ?? payload?.social_shot_emphasis ?? [], "social_shot_emphasis_json")),
    social_on_camera_points_json: JSON.stringify(normalizeStringListInput(payload?.social_on_camera_points_json ?? payload?.social_on_camera_points ?? [], "social_on_camera_points_json")),
    social_caption_angle: payload?.social_caption_angle == null ? null : String(payload.social_caption_angle || "").trim() || null,
    ai_cta_contact_json: JSON.stringify(normalizeAiCtaContactJson(payload?.ai_cta_contact_json)),
    ai_taxonomy_json: JSON.stringify(normalizeAiTaxonomyJson(payload?.ai_taxonomy_json)),
    requested_checks_json: JSON.stringify(normalizeRequestedChecksJson(payload?.requested_checks_json)),
    curated_cta_contact_json: JSON.stringify(normalizeCuratedCtaContactJson(payload?.curated_cta_contact_json)),
    curated_taxonomy_json: JSON.stringify(normalizeCuratedTaxonomyJson(payload?.curated_taxonomy_json)),
    curation_status: normalizeCurationStatusValue(payload?.curation_status),
    curated_by_user_id: payload?.curated_by_user_id == null || payload.curated_by_user_id === "" ? null : Number(payload.curated_by_user_id || 0) || null,
    curated_at: payload?.curated_at == null || payload.curated_at === "" ? null : toNullableDateIso(payload.curated_at, "curated_at"),
    curation_note: payload?.curation_note == null ? null : String(payload.curation_note || "").trim() || null,
    writer_ready: toBooleanInt(payload?.writer_ready ?? 0, "writer_ready"),
    writer_angle: payload?.writer_angle == null ? null : String(payload.writer_angle || "").trim() || null,
    writer_key_points_json: JSON.stringify(normalizeStringListInput(payload?.writer_key_points_json ?? payload?.writer_key_points ?? [], "writer_key_points_json")),
    writer_notes: payload?.writer_notes == null ? null : String(payload.writer_notes || "").trim() || null,
    updated_by: payload?.updated_by == null ? null : String(payload.updated_by || "").trim() || null,
  };
}

function normalizeFieldPackChecklistInputs(value) {
  const rows = normalizeArrayLikeInput(value, "field_pack_checklists");
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`field_pack_checklists[${index}] must be an object`);
    }
    const checklistType = normalizeFieldPackChecklistType(row.checklist_type);
    if (!checklistType) throw new Error(`field_pack_checklists[${index}].checklist_type is invalid`);
    const itemText = String(row.item_text || "").trim();
    if (!itemText) throw new Error(`field_pack_checklists[${index}].item_text is required`);
    const status = normalizeFieldPackChecklistStatus(row.status ?? "todo");
    if (!status) throw new Error(`field_pack_checklists[${index}].status is invalid`);
    let captureType = null;
    if (checklistType === "must_capture") {
      captureType = String(row.capture_type || "").trim().toLowerCase();
      if (!["photo", "video", "both"].includes(captureType)) {
        throw new Error(`field_pack_checklists[${index}].capture_type is required and must be photo/video/both. Got: ${captureType}`);
      }
    }
    return {
      checklist_type: checklistType,
      item_text: itemText,
      capture_type: captureType,
      item_order: row.item_order == null || row.item_order === "" ? index : toNullableNonNegativeInt(row.item_order, `field_pack_checklists[${index}].item_order`),
      status,
      note: row.note == null ? null : String(row.note || "").trim() || null,
    };
  });
}

function normalizeFieldPackReferenceInputs(value) {
  const rows = normalizeArrayLikeInput(value, "field_pack_references");
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`field_pack_references[${index}] must be an object`);
    }
    const scope = normalizeFieldPackReferenceScope(row.reference_scope ?? "general");
    if (!scope) throw new Error(`field_pack_references[${index}].reference_scope is invalid`);
    const label = String(row.label || "").trim();
    if (!label) throw new Error(`field_pack_references[${index}].label is required`);
    const url = normalizeHttpUrl(row.url, `field_pack_references[${index}].url`);
    const sourceFamily = normalizeFieldPackSourceFamily(row.source_family ?? "manual");
    if (!sourceFamily) throw new Error(`field_pack_references[${index}].source_family is invalid`);
    return {
      reference_scope: scope,
      label,
      url,
      source_family: sourceFamily,
      note: row.note == null ? null : String(row.note || "").trim() || null,
      item_order: row.item_order == null || row.item_order === "" ? index : toNullableNonNegativeInt(row.item_order, `field_pack_references[${index}].item_order`),
    };
  });
}

function normalizeFieldPackMediaHintInputs(value) {
  const rows = normalizeArrayLikeInput(value, "field_pack_media_hints");
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`field_pack_media_hints[${index}] must be an object`);
    }
    const kind = normalizeFieldPackMediaHintKind(row.kind ?? "reference");
    if (!kind) throw new Error(`field_pack_media_hints[${index}].kind is invalid`);
    const url = normalizeHttpUrl(row.url, `field_pack_media_hints[${index}].url`);
    return {
      content_asset_id: row.content_asset_id == null || row.content_asset_id === "" ? null : Number(row.content_asset_id || 0) || null,
      url,
      kind,
      caption: row.caption == null ? null : String(row.caption || "").trim() || null,
      selected: toBooleanInt(row.selected ?? 0, `field_pack_media_hints[${index}].selected`),
      item_order: row.item_order == null || row.item_order === "" ? index : toNullableNonNegativeInt(row.item_order, `field_pack_media_hints[${index}].item_order`),
    };
  });
}

function normalizeFieldPackAssignmentInputs(value) {
  const rows = normalizeArrayLikeInput(value, "field_pack_assignments");
  const seenScopes = new Set();
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`field_pack_assignments[${index}] must be an object`);
    }
    const scope = normalizeFieldPackAssignmentScope(row.assignment_scope);
    if (!scope) throw new Error(`field_pack_assignments[${index}].assignment_scope is invalid`);
    if (seenScopes.has(scope)) throw new Error(`field_pack_assignments contains duplicate scope: ${scope}`);
    seenScopes.add(scope);
    return {
      assignment_scope: scope,
      linked_assignment_id: row.linked_assignment_id == null || row.linked_assignment_id === "" ? null : Number(row.linked_assignment_id || 0) || null,
      assigned_user_id: row.assigned_user_id == null || row.assigned_user_id === "" ? null : Number(row.assigned_user_id || 0) || null,
      assigned_name: row.assigned_name == null ? null : String(row.assigned_name || "").trim() || null,
      assigned_role: row.assigned_role == null ? null : String(row.assigned_role || "").trim() || null,
      assigned_at: toNullableDateIso(row.assigned_at, `field_pack_assignments[${index}].assigned_at`),
      due_at: toNullableDateIso(row.due_at, `field_pack_assignments[${index}].due_at`),
      note: row.note == null ? null : String(row.note || "").trim() || null,
    };
  });
}

function runInTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function isSqliteUniqueConstraintError(err) {
  const message = String(err?.message || "");
  return /UNIQUE\s+constraint\s+failed|constraint\s+failed/i.test(message);
}

function createConflictError(message) {
  const error = new Error(message);
  error.code = "CONFLICT";
  return error;
}

function mapItem(row) {
  if (!row) return null;
  return {
    ...row,
    tags: parseTags(row.tags),
  };
}

function normalizeStoredSlug(rawValue, fallbackKey = "item") {
  const isWeakSlug = (value) => {
    const text = String(value || "").trim();
    return !text || text.length < 3 || /^\d+$/.test(text);
  };
  const raw = String(rawValue || "").trim().toLowerCase();
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) && !isWeakSlug(raw)) {
    return raw;
  }
  const normalized = raw
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) && !isWeakSlug(normalized)) {
    return normalized;
  }
  const fallback = String(fallbackKey || "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return fallback || "item";
}

function toItemBaseParams(data) {
  return {
    item_uid: data.item_uid,
    type: data.type,
    category: data.category,
    lang: data.lang,
    title: data.title,
    normalized_title: data.normalized_title,
    slug: data.slug,
    description_raw: data.description_raw,
    description_clean: data.description_clean,
    summary: data.summary,
    meta_title: data.meta_title,
    meta_description: data.meta_description,
    event_period_text: data.event_period_text,
    location_text: data.location_text,
    latitude: data.latitude,
    longitude: data.longitude,
    map_url: data.map_url,
    google_place_id: data.google_place_id,
    image_url: data.image_url,
    tags: data.tags,
    workflow_status: data.workflow_status,
  };
}

function toItemInsertParams(data) {
  return toItemBaseParams(data);
}

function toItemUpdateParams(data) {
  const base = toItemBaseParams(data);
  return {
    id: data.id,
    type: base.type,
    category: base.category,
    lang: base.lang,
    title: base.title,
    normalized_title: base.normalized_title,
    slug: base.slug,
    description_raw: base.description_raw,
    description_clean: base.description_clean,
    summary: base.summary,
    meta_title: base.meta_title,
    meta_description: base.meta_description,
    event_period_text: base.event_period_text,
    location_text: base.location_text,
    latitude: base.latitude,
    longitude: base.longitude,
    map_url: base.map_url,
    google_place_id: base.google_place_id,
    image_url: base.image_url,
    tags: base.tags,
    workflow_status: base.workflow_status,
  };
}

function toSourceSqlParams(data, contentItemId) {
  return {
    content_item_id: contentItemId,
    source_type: data.source_type,
    source_name: data.source_name,
    source_url: data.source_url,
    source_entity_id: data.source_entity_id,
    payload_json: data.payload_json,
  };
}

function ensureLifecycleColumns(db) {
  const cols = db.prepare("PRAGMA table_info(published_articles)").all();
  const names = new Set(cols.map((c) => c.name));

  if (!names.has("draft_id")) {
    db.exec("ALTER TABLE published_articles ADD COLUMN draft_id INTEGER;");
  }

  if (!names.has("review_report_id")) {
    db.exec("ALTER TABLE published_articles ADD COLUMN review_report_id INTEGER;");
  }

  if (!names.has("latitude")) {
    db.exec("ALTER TABLE published_articles ADD COLUMN latitude REAL;");
  }

  if (!names.has("longitude")) {
    db.exec("ALTER TABLE published_articles ADD COLUMN longitude REAL;");
  }

  if (!names.has("map_url")) {
    db.exec("ALTER TABLE published_articles ADD COLUMN map_url TEXT;");
  }

  if (!names.has("google_place_id")) {
    db.exec("ALTER TABLE published_articles ADD COLUMN google_place_id TEXT;");
  }

  if (!names.has("event_period_text")) {
    db.exec("ALTER TABLE published_articles ADD COLUMN event_period_text TEXT;");
  }

  if (!names.has("location_text")) {
    db.exec("ALTER TABLE published_articles ADD COLUMN location_text TEXT;");
  }
}

function ensureTranslationTables(db) {
  const readTranslationCols = () => db.prepare("PRAGMA table_info(content_translations)").all();
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_translations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_content_item_id INTEGER NOT NULL,
      source_published_article_id INTEGER,
      source_draft_id INTEGER,
      source_review_report_id INTEGER,
      source_fingerprint TEXT NOT NULL,
      lang TEXT NOT NULL,
      translated_title TEXT,
      translated_excerpt TEXT,
      translated_body TEXT,
      translated_meta_title TEXT,
      translated_meta_description TEXT,
      translation_status TEXT NOT NULL DEFAULT 'pending',
      automatic_check_status TEXT NOT NULL DEFAULT 'pending',
      automatic_check_report_json TEXT,
      translation_recheck_status TEXT NOT NULL DEFAULT 'not_checked',
      translation_recheck_score REAL,
      accuracy_score REAL,
      fluency_score REAL,
      term_score REAL,
      back_translation_th TEXT,
      recheck_summary_th TEXT,
      recheck_issues_json TEXT,
      recheck_model TEXT,
      rechecked_at TEXT,
      repair_attempt_count INTEGER NOT NULL DEFAULT 0,
      stale_flag INTEGER NOT NULL DEFAULT 0,
      translator_engine TEXT,
      translator_model TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(source_content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
      FOREIGN KEY(source_published_article_id) REFERENCES published_articles(id) ON DELETE SET NULL,
      FOREIGN KEY(source_draft_id) REFERENCES content_drafts(id) ON DELETE SET NULL,
      FOREIGN KEY(source_review_report_id) REFERENCES review_reports(id) ON DELETE SET NULL,
      UNIQUE(source_content_item_id, lang)
    );
    CREATE INDEX IF NOT EXISTS idx_content_translations_source ON content_translations(source_content_item_id);
    CREATE INDEX IF NOT EXISTS idx_content_translations_lang ON content_translations(lang);
    CREATE INDEX IF NOT EXISTS idx_content_translations_publishable ON content_translations(automatic_check_status, stale_flag, translation_status);

    CREATE TABLE IF NOT EXISTS translation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_uid TEXT NOT NULL UNIQUE,
      stage TEXT NOT NULL DEFAULT 'final-prefrontend',
      status TEXT NOT NULL DEFAULT 'running',
      input_count INTEGER NOT NULL DEFAULT 0,
      output_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT
    );
  `);

  let cols = readTranslationCols();
  const sourcePublishedArticleCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "source_published_article_id")
    : null;
  const needsNullablePublishedSourceMigration = Number(sourcePublishedArticleCol?.notnull || 0) === 1;

  if (needsNullablePublishedSourceMigration) {
    db.exec("PRAGMA foreign_keys = OFF;");
    try {
      db.exec("BEGIN IMMEDIATE;");
      db.exec("ALTER TABLE content_translations RENAME TO content_translations_legacy_nullable_source;");
      db.exec(`
        CREATE TABLE content_translations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_content_item_id INTEGER NOT NULL,
          source_published_article_id INTEGER,
          source_draft_id INTEGER,
          source_review_report_id INTEGER,
          source_fingerprint TEXT NOT NULL,
          lang TEXT NOT NULL,
          translated_title TEXT,
          translated_excerpt TEXT,
          translated_body TEXT,
          translated_meta_title TEXT,
          translated_meta_description TEXT,
          translation_status TEXT NOT NULL DEFAULT 'pending',
          automatic_check_status TEXT NOT NULL DEFAULT 'pending',
          automatic_check_report_json TEXT,
          translation_recheck_status TEXT NOT NULL DEFAULT 'not_checked',
          translation_recheck_score REAL,
          accuracy_score REAL,
          fluency_score REAL,
          term_score REAL,
          back_translation_th TEXT,
          recheck_summary_th TEXT,
          recheck_issues_json TEXT,
          recheck_model TEXT,
          rechecked_at TEXT,
          repair_attempt_count INTEGER NOT NULL DEFAULT 0,
          stale_flag INTEGER NOT NULL DEFAULT 0,
          translator_engine TEXT,
          translator_model TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(source_content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
          FOREIGN KEY(source_published_article_id) REFERENCES published_articles(id) ON DELETE SET NULL,
          FOREIGN KEY(source_draft_id) REFERENCES content_drafts(id) ON DELETE SET NULL,
          FOREIGN KEY(source_review_report_id) REFERENCES review_reports(id) ON DELETE SET NULL,
          UNIQUE(source_content_item_id, lang)
        );
      `);
      db.exec(`
        INSERT INTO content_translations (
          id, source_content_item_id, source_published_article_id, source_draft_id, source_review_report_id,
          source_fingerprint, lang, translated_title, translated_excerpt, translated_body,
          translated_meta_title, translated_meta_description, translation_status, automatic_check_status,
          automatic_check_report_json, translation_recheck_status, translation_recheck_score,
          accuracy_score, fluency_score, term_score, back_translation_th, recheck_summary_th,
          recheck_issues_json, recheck_model, rechecked_at, repair_attempt_count,
          stale_flag, translator_engine, translator_model, created_at, updated_at
        )
        SELECT
          id,
          source_content_item_id,
          NULLIF(source_published_article_id, 0),
          source_draft_id,
          source_review_report_id,
          source_fingerprint,
          lang,
          translated_title,
          translated_excerpt,
          translated_body,
          translated_meta_title,
          translated_meta_description,
          translation_status,
          automatic_check_status,
          automatic_check_report_json,
          'not_checked',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          stale_flag,
          translator_engine,
          translator_model,
          created_at,
          updated_at
        FROM content_translations_legacy_nullable_source;
      `);
      db.exec("DROP TABLE content_translations_legacy_nullable_source;");
      db.exec("CREATE INDEX IF NOT EXISTS idx_content_translations_source ON content_translations(source_content_item_id);");
      db.exec("CREATE INDEX IF NOT EXISTS idx_content_translations_lang ON content_translations(lang);");
      db.exec("CREATE INDEX IF NOT EXISTS idx_content_translations_publishable ON content_translations(automatic_check_status, stale_flag, translation_status);");
      db.exec("COMMIT;");
    } catch (error) {
      try {
        db.exec("ROLLBACK;");
      } catch {}
      throw error;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
    cols = readTranslationCols();
  }

  const translationRecheckStatusCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "translation_recheck_status")
    : null;
  if (!translationRecheckStatusCol) db.exec("ALTER TABLE content_translations ADD COLUMN translation_recheck_status TEXT NOT NULL DEFAULT 'not_checked';");
  const translationRecheckScoreCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "translation_recheck_score")
    : null;
  if (!translationRecheckScoreCol) db.exec("ALTER TABLE content_translations ADD COLUMN translation_recheck_score REAL;");
  const accuracyScoreCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "accuracy_score")
    : null;
  if (!accuracyScoreCol) db.exec("ALTER TABLE content_translations ADD COLUMN accuracy_score REAL;");
  const fluencyScoreCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "fluency_score")
    : null;
  if (!fluencyScoreCol) db.exec("ALTER TABLE content_translations ADD COLUMN fluency_score REAL;");
  const termScoreCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "term_score")
    : null;
  if (!termScoreCol) db.exec("ALTER TABLE content_translations ADD COLUMN term_score REAL;");
  const backTranslationCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "back_translation_th")
    : null;
  if (!backTranslationCol) db.exec("ALTER TABLE content_translations ADD COLUMN back_translation_th TEXT;");
  const recheckSummaryCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "recheck_summary_th")
    : null;
  if (!recheckSummaryCol) db.exec("ALTER TABLE content_translations ADD COLUMN recheck_summary_th TEXT;");
  const recheckIssuesCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "recheck_issues_json")
    : null;
  if (!recheckIssuesCol) db.exec("ALTER TABLE content_translations ADD COLUMN recheck_issues_json TEXT;");
  const recheckModelCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "recheck_model")
    : null;
  if (!recheckModelCol) db.exec("ALTER TABLE content_translations ADD COLUMN recheck_model TEXT;");
  const recheckedAtCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "rechecked_at")
    : null;
  if (!recheckedAtCol) db.exec("ALTER TABLE content_translations ADD COLUMN rechecked_at TEXT;");
  const repairAttemptCountCol = Array.isArray(cols)
    ? cols.find((col) => String(col?.name || "").trim() === "repair_attempt_count")
    : null;
  if (!repairAttemptCountCol) db.exec("ALTER TABLE content_translations ADD COLUMN repair_attempt_count INTEGER NOT NULL DEFAULT 0;");
}

function ensureContentAssetWorkflowColumns(db) {
  const cols = db.prepare("PRAGMA table_info(content_assets)").all();
  const names = new Set(cols.map((c) => c.name));

  if (!names.has("selected_in_clean")) {
    db.exec("ALTER TABLE content_assets ADD COLUMN selected_in_clean INTEGER NOT NULL DEFAULT 0;");
  }

  if (!names.has("is_cover")) {
    db.exec("ALTER TABLE content_assets ADD COLUMN is_cover INTEGER NOT NULL DEFAULT 0;");
  }

  if (!names.has("placement_type")) {
    db.exec("ALTER TABLE content_assets ADD COLUMN placement_type TEXT NOT NULL DEFAULT 'unused';");
  }
  if (!names.has("assignment_id")) {
    db.exec("ALTER TABLE content_assets ADD COLUMN assignment_id INTEGER;");
  }
  if (!names.has("assignment_round")) {
    db.exec("ALTER TABLE content_assets ADD COLUMN assignment_round INTEGER NOT NULL DEFAULT 0;");
  }
  if (!names.has("assignment_media_type")) {
    db.exec("ALTER TABLE content_assets ADD COLUMN assignment_media_type TEXT;");
  }
  if (!names.has("assignment_surface")) {
    db.exec("ALTER TABLE content_assets ADD COLUMN assignment_surface TEXT;");
  }
  if (!names.has("assignment_sync_batch_id")) {
    db.exec("ALTER TABLE content_assets ADD COLUMN assignment_sync_batch_id TEXT;");
  }

  db.exec(`
    UPDATE content_assets
    SET selected_in_clean = CASE WHEN role IN ('cover','gallery','inline') THEN 1 ELSE 0 END
    WHERE selected_in_clean IS NULL OR selected_in_clean NOT IN (0,1);

    UPDATE content_assets
    SET is_cover = CASE WHEN role='cover' THEN 1 ELSE 0 END
    WHERE is_cover IS NULL OR is_cover NOT IN (0,1);

    UPDATE content_assets
    SET placement_type = CASE
      WHEN role='inline' THEN 'inline'
      WHEN role='gallery' THEN 'gallery'
      WHEN role='cover' THEN 'gallery'
      ELSE 'unused'
    END
    WHERE placement_type IS NULL OR placement_type='';

    UPDATE content_assets
    SET assignment_round = 0
    WHERE assignment_round IS NULL OR assignment_round < 0;
  `);
}

function ensureReferenceMediaSelectionTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_reference_media_selections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL,
      reference_media_id TEXT NOT NULL,
      selected_for_ai INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
      UNIQUE(content_item_id, reference_media_id)
    );
    CREATE INDEX IF NOT EXISTS idx_content_reference_media_selections_item
    ON content_reference_media_selections(content_item_id);
    CREATE INDEX IF NOT EXISTS idx_content_reference_media_selections_selected
    ON content_reference_media_selections(content_item_id, selected_for_ai);
  `);
}

function ensureFieldPackTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS field_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL,
      source_draft_id INTEGER,
      source_review_report_id INTEGER,
      source_draft_input_snapshot_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'ready_for_field', 'field_in_progress', 'field_done', 'on_hold')),
      is_current INTEGER NOT NULL DEFAULT 1
        CHECK (is_current IN (0, 1)),
      ai_summary TEXT,
      ai_highlights_json TEXT NOT NULL DEFAULT '[]',
      ai_unknowns_json TEXT NOT NULL DEFAULT '[]',
      editor_summary TEXT,
      verified_facts_json TEXT NOT NULL DEFAULT '[]',
      uncertain_facts_json TEXT NOT NULL DEFAULT '[]',
      story_angle TEXT,
      field_notes TEXT,
      social_hook TEXT,
      social_shot_emphasis_json TEXT NOT NULL DEFAULT '[]',
      social_on_camera_points_json TEXT NOT NULL DEFAULT '[]',
      social_caption_angle TEXT,
      writer_ready INTEGER NOT NULL DEFAULT 0
        CHECK (writer_ready IN (0, 1)),
      writer_angle TEXT,
      writer_key_points_json TEXT NOT NULL DEFAULT '[]',
      writer_notes TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT,
      FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
      FOREIGN KEY(source_draft_id) REFERENCES content_drafts(id) ON DELETE SET NULL,
      FOREIGN KEY(source_review_report_id) REFERENCES review_reports(id) ON DELETE SET NULL,
      FOREIGN KEY(source_draft_input_snapshot_id) REFERENCES draft_input_snapshots(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_field_packs_current_per_item
      ON field_packs(content_item_id)
      WHERE is_current = 1 AND archived_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_field_packs_item
      ON field_packs(content_item_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_field_packs_status
      ON field_packs(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS field_pack_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_pack_id INTEGER NOT NULL,
      checklist_type TEXT NOT NULL
        CHECK (checklist_type IN ('must_verify_fact', 'must_capture', 'must_ask_question')),
      item_text TEXT NOT NULL,
      capture_type TEXT
        CHECK (capture_type IS NULL OR capture_type IN ('photo', 'video', 'both')),
      item_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'doing', 'done', 'skip')),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(field_pack_id) REFERENCES field_packs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_field_pack_checklists_pack_type
      ON field_pack_checklists(field_pack_id, checklist_type, item_order, id);

    CREATE TABLE IF NOT EXISTS field_pack_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_pack_id INTEGER NOT NULL,
      reference_scope TEXT NOT NULL DEFAULT 'general'
        CHECK (reference_scope IN ('general', 'writer')),
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      source_family TEXT NOT NULL DEFAULT 'manual'
        CHECK (source_family IN ('official', 'institutional', 'google_maps', 'wongnai', 'manual', 'system')),
      note TEXT,
      item_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(field_pack_id) REFERENCES field_packs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_field_pack_references_pack_scope
      ON field_pack_references(field_pack_id, reference_scope, item_order, id);

    CREATE TABLE IF NOT EXISTS field_pack_media_hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_pack_id INTEGER NOT NULL,
      content_asset_id INTEGER,
      url TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'reference'
        CHECK (kind IN ('cover', 'gallery', 'raw', 'reference')),
      caption TEXT,
      selected INTEGER NOT NULL DEFAULT 0
        CHECK (selected IN (0, 1)),
      item_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(field_pack_id) REFERENCES field_packs(id) ON DELETE CASCADE,
      FOREIGN KEY(content_asset_id) REFERENCES content_assets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_field_pack_media_hints_pack
      ON field_pack_media_hints(field_pack_id, kind, item_order, id);

    CREATE TABLE IF NOT EXISTS field_pack_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_pack_id INTEGER NOT NULL,
      assignment_scope TEXT NOT NULL
        CHECK (assignment_scope IN ('field', 'writer')),
      linked_assignment_id INTEGER,
      assigned_user_id INTEGER,
      assigned_name TEXT,
      assigned_role TEXT,
      assigned_at TEXT,
      due_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(field_pack_id) REFERENCES field_packs(id) ON DELETE CASCADE,
      FOREIGN KEY(linked_assignment_id) REFERENCES content_assignments(id) ON DELETE SET NULL,
      FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_field_pack_assignments_scope
      ON field_pack_assignments(field_pack_id, assignment_scope);
    CREATE INDEX IF NOT EXISTS idx_field_pack_assignments_linked
      ON field_pack_assignments(linked_assignment_id, due_at);
  `);

  const mediaHintCols = db.prepare("PRAGMA table_info(field_pack_media_hints)").all();
  const mediaHintNames = new Set(mediaHintCols.map((c) => c.name));
  if (!mediaHintNames.has("content_asset_id")) {
    db.exec("ALTER TABLE field_pack_media_hints ADD COLUMN content_asset_id INTEGER;");
  }
  if (mediaHintNames.has("asset_id")) {
    db.exec(`
      UPDATE field_pack_media_hints
      SET content_asset_id = COALESCE(content_asset_id, asset_id)
      WHERE asset_id IS NOT NULL
  `);
  }

  const checklistTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='field_pack_checklists' LIMIT 1").get();
  const checklistSql = String(checklistTable?.sql || "").trim().toLowerCase();
  const requiresChecklistMigration =
    checklistSql.includes("must_capture_shot")
    || !checklistSql.includes("capture_type");

  if (requiresChecklistMigration) {
    db.exec("PRAGMA foreign_keys = OFF;");
    try {
      db.exec("BEGIN IMMEDIATE;");
      db.exec("ALTER TABLE field_pack_checklists RENAME TO field_pack_checklists_legacy_must_capture;");
      db.exec(`
        CREATE TABLE field_pack_checklists (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          field_pack_id INTEGER NOT NULL,
          checklist_type TEXT NOT NULL
            CHECK (checklist_type IN ('must_verify_fact', 'must_capture', 'must_ask_question')),
          item_text TEXT NOT NULL,
          capture_type TEXT
            CHECK (capture_type IS NULL OR capture_type IN ('photo', 'video', 'both')),
          item_order INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'todo'
            CHECK (status IN ('todo', 'doing', 'done', 'skip')),
          note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(field_pack_id) REFERENCES field_packs(id) ON DELETE CASCADE
        );
      `);
      db.exec(`
        INSERT INTO field_pack_checklists (
          id, field_pack_id, checklist_type, item_text, capture_type, item_order, status, note, created_at, updated_at
        )
        SELECT
          id,
          field_pack_id,
          CASE
            WHEN checklist_type='must_capture_shot' THEN 'must_capture'
            ELSE checklist_type
          END,
          item_text,
          CASE
            WHEN checklist_type='must_capture_shot' THEN 'both'
            ELSE NULL
          END,
          item_order,
          status,
          note,
          created_at,
          updated_at
        FROM field_pack_checklists_legacy_must_capture;
      `);
      db.exec("DROP TABLE field_pack_checklists_legacy_must_capture;");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_field_pack_checklists_pack_type
          ON field_pack_checklists(field_pack_id, checklist_type, item_order, id);
      `);
      db.exec("COMMIT;");
    } catch (error) {
      try {
        db.exec("ROLLBACK;");
      } catch {}
      throw error;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }
}

function ensureAgentProfileTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      agent_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      profile_text TEXT NOT NULL DEFAULT '',
      is_enabled INTEGER NOT NULL DEFAULT 1
        CHECK (is_enabled IN (0, 1)),
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function ensureAiFeaturePolicyTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_feature_policies (
      feature_key TEXT PRIMARY KEY,
      policy_key TEXT NOT NULL,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ai_feature_policies_updated_at ON ai_feature_policies(updated_at DESC);
  `);
}

function ensureWorkflowHeadColumns(db) {
  const cols = db.prepare("PRAGMA table_info(content_workflow_models)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("current_draft_id")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN current_draft_id INTEGER;");
  }
  if (!names.has("current_review_report_id")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN current_review_report_id INTEGER;");
  }
  if (!names.has("current_field_pack_id")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN current_field_pack_id INTEGER;");
  }
  if (!names.has("state_version")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN state_version INTEGER NOT NULL DEFAULT 1;");
  }
  if (!names.has("content_version")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0;");
  }
  if (!names.has("last_actor_email")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN last_actor_email TEXT;");
  }
  if (!names.has("last_transition_at")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN last_transition_at TEXT;");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_content_workflow_models_current_draft
      ON content_workflow_models(current_draft_id);
    CREATE INDEX IF NOT EXISTS idx_content_workflow_models_current_review
      ON content_workflow_models(current_review_report_id);
    CREATE INDEX IF NOT EXISTS idx_content_workflow_models_current_field_pack
      ON content_workflow_models(current_field_pack_id);
  `);
}

function normalizeAgentProfileRow(row) {
  if (!row) return null;
  return {
    ...row,
    is_enabled: Boolean(row.is_enabled),
  };
}

function normalizeAiFeaturePolicyRow(row) {
  if (!row) return null;
  return {
    feature_key: String(row.feature_key || "").trim(),
    policy_key: String(row.policy_key || "").trim(),
    updated_by: row.updated_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function ensureFieldPackAssignmentForeignKeySupport(db) {
  const tables = [
    {
      name: "field_pack_assignments",
      legacyName: "field_pack_assignments_legacy_fk",
      createSql: `
        CREATE TABLE field_pack_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          field_pack_id INTEGER NOT NULL,
          assignment_scope TEXT NOT NULL
            CHECK (assignment_scope IN ('field', 'writer')),
          linked_assignment_id INTEGER,
          assigned_user_id INTEGER,
          assigned_name TEXT,
          assigned_role TEXT,
          assigned_at TEXT,
          due_at TEXT,
          note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(field_pack_id) REFERENCES field_packs(id) ON DELETE CASCADE,
          FOREIGN KEY(linked_assignment_id) REFERENCES content_assignments(id) ON DELETE SET NULL,
          FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
      `,
      insertColumns: "id, field_pack_id, assignment_scope, linked_assignment_id, assigned_user_id, assigned_name, assigned_role, assigned_at, due_at, note, created_at, updated_at",
      indexSql: [
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_field_pack_assignments_scope ON field_pack_assignments(field_pack_id, assignment_scope);",
        "CREATE INDEX IF NOT EXISTS idx_field_pack_assignments_linked ON field_pack_assignments(linked_assignment_id, due_at);",
      ],
    },
    {
      name: "content_assignment_submissions",
      legacyName: "content_assignment_submissions_legacy_fk",
      createSql: `
        CREATE TABLE content_assignment_submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          assignment_id INTEGER NOT NULL,
          content_item_id INTEGER NOT NULL,
          submitted_by_user_id INTEGER NOT NULL,
          submission_state TEXT NOT NULL DEFAULT 'submitted',
          article_payload_json TEXT,
          media_payload_json TEXT,
          contributor_note TEXT,
          reviewer_note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT,
          FOREIGN KEY(assignment_id) REFERENCES content_assignments(id) ON DELETE CASCADE,
          FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
          FOREIGN KEY(submitted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
        );
      `,
      insertColumns: "id, assignment_id, content_item_id, submitted_by_user_id, submission_state, article_payload_json, media_payload_json, contributor_note, reviewer_note, created_at, updated_at, reviewed_at",
      indexSql: [
        "CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment ON content_assignment_submissions(assignment_id, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_assignment_submissions_item ON content_assignment_submissions(content_item_id, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_assignment_submissions_state ON content_assignment_submissions(submission_state, created_at DESC);",
      ],
    },
    {
      name: "content_assignment_submission_deliverables",
      legacyName: "content_assignment_submission_deliverables_legacy_fk",
      createSql: `
        CREATE TABLE content_assignment_submission_deliverables (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          assignment_id INTEGER NOT NULL,
          submission_id INTEGER NOT NULL,
          content_item_id INTEGER NOT NULL,
          deliverable_type TEXT NOT NULL,
          title TEXT,
          lang TEXT NOT NULL DEFAULT 'th',
          text_content TEXT,
          payload_json TEXT,
          source_asset_id INTEGER,
          source_url TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(assignment_id) REFERENCES content_assignments(id) ON DELETE CASCADE,
          FOREIGN KEY(submission_id) REFERENCES content_assignment_submissions(id) ON DELETE CASCADE,
          FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
        );
      `,
      insertColumns: "id, assignment_id, submission_id, content_item_id, deliverable_type, title, lang, text_content, payload_json, source_asset_id, source_url, status, created_by, created_at, updated_at",
      indexSql: [
        "CREATE INDEX IF NOT EXISTS idx_assignment_submission_deliverables_submission ON content_assignment_submission_deliverables(submission_id, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_assignment_submission_deliverables_assignment ON content_assignment_submission_deliverables(assignment_id, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_assignment_submission_deliverables_type ON content_assignment_submission_deliverables(deliverable_type, created_at DESC);",
      ],
    },
    {
      name: "content_assignment_handoff_snapshots",
      legacyName: "content_assignment_handoff_snapshots_legacy_fk",
      createSql: `
        CREATE TABLE content_assignment_handoff_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          assignment_id INTEGER NOT NULL,
          content_item_id INTEGER NOT NULL,
          readiness_brief_id INTEGER,
          handoff_package_json TEXT NOT NULL,
          guard_status TEXT NOT NULL DEFAULT 'ready',
          force_reason TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(assignment_id) REFERENCES content_assignments(id) ON DELETE CASCADE,
          FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
          FOREIGN KEY(readiness_brief_id) REFERENCES content_readiness_briefs(id) ON DELETE SET NULL
        );
      `,
      insertColumns: "id, assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, force_reason, created_by, created_at",
      indexSql: [
        "CREATE INDEX IF NOT EXISTS idx_assignment_handoff_assignment ON content_assignment_handoff_snapshots(assignment_id, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_assignment_handoff_item ON content_assignment_handoff_snapshots(content_item_id, created_at DESC);",
      ],
    },
  ];

  const repairs = tables.filter((tableConfig) => {
    const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(tableConfig.name);
    const sql = String(table?.sql || "").trim().toLowerCase();
    return sql.includes("content_assignments_legacy_external");
  });

  if (!repairs.length) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.exec("BEGIN IMMEDIATE;");
    for (const tableConfig of repairs) {
      db.exec(`ALTER TABLE ${tableConfig.name} RENAME TO ${tableConfig.legacyName};`);
      db.exec(tableConfig.createSql);
      db.exec(`
        INSERT INTO ${tableConfig.name} (${tableConfig.insertColumns})
        SELECT ${tableConfig.insertColumns}
        FROM ${tableConfig.legacyName};
      `);
      db.exec(`DROP TABLE ${tableConfig.legacyName};`);
      for (const indexSql of tableConfig.indexSql) {
        db.exec(indexSql);
      }
    }
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {}
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

function ensureAssignmentTableSupport(db) {
  const cols = db.prepare("PRAGMA table_info(content_assignments)").all();
  if (!Array.isArray(cols) || !cols.length) return;
  const names = new Set(cols.map((c) => String(c?.name || "").trim()));
  const assigneeUserCol = cols.find((c) => String(c?.name || "").trim() === "assignee_user_id");
  const requiresNullableAssigneeMigration = Number(assigneeUserCol?.notnull || 0) === 1;

  if (requiresNullableAssigneeMigration) {
    const hasAssigneeName = names.has("assignee_name");
    const hasAssigneeContact = names.has("assignee_contact");
    db.exec("PRAGMA foreign_keys = OFF;");
    try {
      db.exec("BEGIN IMMEDIATE;");
      db.exec("ALTER TABLE content_assignments RENAME TO content_assignments_legacy_external;");
      db.exec(`
        CREATE TABLE content_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          assignment_uid TEXT NOT NULL UNIQUE,
          content_item_id INTEGER NOT NULL,
          assignment_kind TEXT NOT NULL DEFAULT 'field',
          assignee_user_id INTEGER,
          assignee_name TEXT,
          assignee_contact TEXT,
          external_assignee_profile_json TEXT,
          assigned_by_user_id INTEGER,
          state TEXT NOT NULL DEFAULT 'assigned',
          brief_json TEXT,
          requirements_json TEXT,
          due_at TEXT,
          latest_submission_id INTEGER,
          latest_submission_at TEXT,
          revision_round INTEGER NOT NULL DEFAULT 0,
          accepted_at TEXT,
          image_reset_required INTEGER NOT NULL DEFAULT 0,
          image_reset_reason TEXT,
          video_reset_required INTEGER NOT NULL DEFAULT 0,
          video_reset_reason TEXT,
          contributor_note TEXT,
          internal_note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
          FOREIGN KEY(assignee_user_id) REFERENCES users(id) ON DELETE RESTRICT,
          FOREIGN KEY(assigned_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
      db.exec(`
        INSERT INTO content_assignments (
          id, assignment_uid, content_item_id, assignment_kind, assignee_user_id, assignee_name, assignee_contact, external_assignee_profile_json,
          assigned_by_user_id, state, brief_json, requirements_json, due_at, latest_submission_id,
          latest_submission_at, revision_round, accepted_at, image_reset_required, image_reset_reason, video_reset_required, video_reset_reason, contributor_note, internal_note, created_at, updated_at
        )
        SELECT
          id, assignment_uid, content_item_id,
          ${names.has("assignment_kind") ? "assignment_kind" : "'field'"},
          assignee_user_id,
          ${hasAssigneeName ? "assignee_name" : "NULL"},
          ${hasAssigneeContact ? "assignee_contact" : "NULL"},
          ${names.has("external_assignee_profile_json") ? "external_assignee_profile_json" : "NULL"},
          assigned_by_user_id, state, brief_json, requirements_json, due_at, latest_submission_id,
          latest_submission_at, revision_round, NULL, 0, NULL, 0, NULL, contributor_note, internal_note, created_at, updated_at
        FROM content_assignments_legacy_external;
      `);
      db.exec("DROP TABLE content_assignments_legacy_external;");
      db.exec("CREATE INDEX IF NOT EXISTS idx_content_assignments_item ON content_assignments(content_item_id, created_at DESC);");
      db.exec("CREATE INDEX IF NOT EXISTS idx_content_assignments_assignee ON content_assignments(assignee_user_id, state, updated_at DESC);");
      db.exec("CREATE INDEX IF NOT EXISTS idx_content_assignments_state ON content_assignments(state, updated_at DESC);");
      db.exec("COMMIT;");
    } catch (error) {
      try {
        db.exec("ROLLBACK;");
      } catch {}
      throw error;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
    return;
  }

  if (!names.has("assignee_name")) {
    db.exec("ALTER TABLE content_assignments ADD COLUMN assignee_name TEXT;");
  }
  if (!names.has("assignee_contact")) {
    db.exec("ALTER TABLE content_assignments ADD COLUMN assignee_contact TEXT;");
  }
  if (!names.has("external_assignee_profile_json")) {
    db.exec("ALTER TABLE content_assignments ADD COLUMN external_assignee_profile_json TEXT;");
  }
  if (!names.has("assignment_kind")) {
    db.exec("ALTER TABLE content_assignments ADD COLUMN assignment_kind TEXT NOT NULL DEFAULT 'field';");
  }
  if (!names.has("accepted_at")) {
    db.exec("ALTER TABLE content_assignments ADD COLUMN accepted_at TEXT;");
  }
  if (!names.has("image_reset_required")) {
    db.exec("ALTER TABLE content_assignments ADD COLUMN image_reset_required INTEGER NOT NULL DEFAULT 0;");
  }
  if (!names.has("image_reset_reason")) {
    db.exec("ALTER TABLE content_assignments ADD COLUMN image_reset_reason TEXT;");
  }
  if (!names.has("video_reset_required")) {
    db.exec("ALTER TABLE content_assignments ADD COLUMN video_reset_required INTEGER NOT NULL DEFAULT 0;");
  }
  if (!names.has("video_reset_reason")) {
    db.exec("ALTER TABLE content_assignments ADD COLUMN video_reset_reason TEXT;");
  }
}

function ensureAssignmentSubmissionDraftTableSupport(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_assignment_submission_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      revision_round INTEGER NOT NULL DEFAULT 1,
      content_item_id INTEGER NOT NULL,
      article_payload_json TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(assignment_id, user_id, revision_round),
      FOREIGN KEY(assignment_id) REFERENCES content_assignments(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
    );
  `);
  const cols = db.prepare("PRAGMA table_info(content_assignment_submission_drafts)").all();
  const hasRevisionRound = Array.isArray(cols) && cols.some((row) => String(row?.name || "").trim() === "revision_round");
  if (!hasRevisionRound) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("ALTER TABLE content_assignment_submission_drafts RENAME TO content_assignment_submission_drafts_legacy_round;");
    db.exec(`
      CREATE TABLE content_assignment_submission_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        revision_round INTEGER NOT NULL DEFAULT 1,
        content_item_id INTEGER NOT NULL,
        article_payload_json TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(assignment_id, user_id, revision_round),
        FOREIGN KEY(assignment_id) REFERENCES content_assignments(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
      );
    `);
    db.exec(`
      INSERT INTO content_assignment_submission_drafts (
        id, assignment_id, user_id, revision_round, content_item_id, article_payload_json, expires_at, created_at, updated_at
      )
      SELECT
        d.id,
        d.assignment_id,
        d.user_id,
        0 AS revision_round,
        d.content_item_id,
        d.article_payload_json,
        d.expires_at,
        d.created_at,
        d.updated_at
      FROM content_assignment_submission_drafts_legacy_round d;
    `);
    db.exec("DROP TABLE content_assignment_submission_drafts_legacy_round;");
    db.exec("PRAGMA foreign_keys = ON;");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_assignment_submission_drafts_expiry ON content_assignment_submission_drafts(expires_at, updated_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_assignment_submission_drafts_assignment ON content_assignment_submission_drafts(assignment_id, user_id, revision_round, updated_at DESC);");
}

function ensureUsersProfileSupport(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (!Array.isArray(cols) || !cols.length) return;
  const names = new Set(cols.map((c) => String(c?.name || "").trim()));
  if (!names.has("profile_json")) {
    db.exec("ALTER TABLE users ADD COLUMN profile_json TEXT;");
  }
}

function ensureItemClaimSupport(db) {
  const cols = db.prepare("PRAGMA table_info(content_items)").all();
  if (!Array.isArray(cols) || !cols.length) return;
  const names = new Set(cols.map((c) => String(c?.name || "").trim()));
  if (!names.has("claimed_by_user_id")) {
    db.exec("ALTER TABLE content_items ADD COLUMN claimed_by_user_id INTEGER;");
  }
  if (!names.has("claimed_at")) {
    db.exec("ALTER TABLE content_items ADD COLUMN claimed_at TEXT;");
  }
  if (!names.has("claim_note")) {
    db.exec("ALTER TABLE content_items ADD COLUMN claim_note TEXT;");
  }
  if (!names.has("event_period_text")) {
    db.exec("ALTER TABLE content_items ADD COLUMN event_period_text TEXT;");
  }
  if (!names.has("location_text")) {
    db.exec("ALTER TABLE content_items ADD COLUMN location_text TEXT;");
  }
}

function ensureFieldPackMetadataSupport(db) {
  const cols = db.prepare("PRAGMA table_info(field_packs)").all();
  if (!Array.isArray(cols) || !cols.length) return;
  const names = new Set(cols.map((c) => String(c?.name || "").trim()));
  // Legacy SQLite upgrades stay additive here. schema.sql remains the canonical source
  // for CHECK/FK parity on fresh databases, while repository normalizers enforce values.
  if (!names.has("ai_cta_contact_json")) {
    db.exec("ALTER TABLE field_packs ADD COLUMN ai_cta_contact_json TEXT NOT NULL DEFAULT '{}';");
  }
  if (!names.has("ai_taxonomy_json")) {
    db.exec("ALTER TABLE field_packs ADD COLUMN ai_taxonomy_json TEXT NOT NULL DEFAULT '{}';");
  }
  if (!names.has("requested_checks_json")) {
    db.exec("ALTER TABLE field_packs ADD COLUMN requested_checks_json TEXT NOT NULL DEFAULT '{\"version\":1,\"groups\":[]}';");
  }
  if (!names.has("curated_cta_contact_json")) {
    db.exec("ALTER TABLE field_packs ADD COLUMN curated_cta_contact_json TEXT NOT NULL DEFAULT '{}';");
  }
  if (!names.has("curated_taxonomy_json")) {
    db.exec("ALTER TABLE field_packs ADD COLUMN curated_taxonomy_json TEXT NOT NULL DEFAULT '{}';");
  }
  if (!names.has("curation_status")) {
    db.exec("ALTER TABLE field_packs ADD COLUMN curation_status TEXT NOT NULL DEFAULT 'not_started';");
  }
  if (!names.has("curated_by_user_id")) {
    db.exec("ALTER TABLE field_packs ADD COLUMN curated_by_user_id INTEGER;");
  }
  if (!names.has("curated_at")) {
    db.exec("ALTER TABLE field_packs ADD COLUMN curated_at TEXT;");
  }
  if (!names.has("curation_note")) {
    db.exec("ALTER TABLE field_packs ADD COLUMN curation_note TEXT;");
  }
}

function ensureAssignmentSubmissionFieldReturnSupport(db) {
  const cols = db.prepare("PRAGMA table_info(content_assignment_submissions)").all();
  if (!Array.isArray(cols) || !cols.length) return;
  const names = new Set(cols.map((c) => String(c?.name || "").trim()));
  if (!names.has("field_return_payload_json")) {
    db.exec("ALTER TABLE content_assignment_submissions ADD COLUMN field_return_payload_json TEXT;");
  }
  if (!names.has("updated_at")) {
    db.exec("ALTER TABLE content_assignment_submissions ADD COLUMN updated_at TEXT;");
    db.exec("UPDATE content_assignment_submissions SET updated_at=COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);");
  }
}

function ensureContentDraftConfirmedMetaSupport(db) {
  const cols = db.prepare("PRAGMA table_info(content_drafts)").all();
  if (!Array.isArray(cols) || !cols.length) return;
  const names = new Set(cols.map((c) => String(c?.name || "").trim()));
  if (!names.has("confirmed_cta_contact_json")) {
    db.exec("ALTER TABLE content_drafts ADD COLUMN confirmed_cta_contact_json TEXT NOT NULL DEFAULT '{}';");
  }
  if (!names.has("confirmed_taxonomy_json")) {
    db.exec("ALTER TABLE content_drafts ADD COLUMN confirmed_taxonomy_json TEXT NOT NULL DEFAULT '{}';");
  }
  if (!names.has("confirmed_meta_status")) {
    db.exec("ALTER TABLE content_drafts ADD COLUMN confirmed_meta_status TEXT NOT NULL DEFAULT 'not_started';");
  }
  if (!names.has("confirmed_by_user_id")) {
    db.exec("ALTER TABLE content_drafts ADD COLUMN confirmed_by_user_id INTEGER;");
  }
  if (!names.has("confirmed_at")) {
    db.exec("ALTER TABLE content_drafts ADD COLUMN confirmed_at TEXT;");
  }
  if (!names.has("confirmed_note")) {
    db.exec("ALTER TABLE content_drafts ADD COLUMN confirmed_note TEXT;");
  }
}
export function createRepository(db) {
  ensureLifecycleColumns(db);
  ensureTranslationTables(db);
  ensureContentAssetWorkflowColumns(db);
  ensureReferenceMediaSelectionTable(db);
  ensureFieldPackTables(db);
  ensureWorkflowHeadColumns(db);
  ensureAgentProfileTables(db);
  ensureAiFeaturePolicyTables(db);
  ensureUsersProfileSupport(db);
  ensureItemClaimSupport(db);
  ensureAssignmentTableSupport(db);
  ensureFieldPackMetadataSupport(db);
  ensureAssignmentSubmissionFieldReturnSupport(db);
  ensureContentDraftConfirmedMetaSupport(db);
  ensureAssignmentSubmissionDraftTableSupport(db);
  ensureFieldPackAssignmentForeignKeySupport(db);
  const insertItemStmt = db.prepare(`
    INSERT INTO content_items (
      item_uid, type, category, lang, title, normalized_title, slug,
      description_raw, description_clean, summary, meta_title, meta_description,
      event_period_text, location_text,
      latitude, longitude, map_url, google_place_id, image_url, tags, workflow_status
    ) VALUES (
      @item_uid, @type, @category, @lang, @title, @normalized_title, @slug,
      @description_raw, @description_clean, @summary, @meta_title, @meta_description,
      @event_period_text, @location_text,
      @latitude, @longitude, @map_url, @google_place_id, @image_url, @tags, @workflow_status
    )
  `);

  const updateItemStmt = db.prepare(`
    UPDATE content_items SET
      type=@type,
      category=@category,
      lang=@lang,
      title=@title,
      normalized_title=@normalized_title,
      slug=@slug,
      description_raw=@description_raw,
      description_clean=@description_clean,
      summary=@summary,
      meta_title=@meta_title,
      meta_description=@meta_description,
      event_period_text=@event_period_text,
      location_text=@location_text,
      latitude=@latitude,
      longitude=@longitude,
      map_url=@map_url,
      google_place_id=@google_place_id,
      image_url=@image_url,
      tags=@tags,
      workflow_status=@workflow_status,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=@id AND is_deleted=0
  `);

  const softDeleteStmt = db.prepare("UPDATE content_items SET is_deleted=1, updated_at=CURRENT_TIMESTAMP WHERE id=?");
  const updateItemCategoryStmt = db.prepare("UPDATE content_items SET category=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_deleted=0");
  const listStmt = db.prepare(`SELECT * FROM content_items WHERE is_deleted=0 ORDER BY id DESC`);
  const getStmt = db.prepare("SELECT * FROM content_items WHERE id=? AND is_deleted=0");
  const claimItemStmt = db.prepare(`
    UPDATE content_items
    SET
      claimed_by_user_id=?,
      claimed_at=CURRENT_TIMESTAMP,
      claim_note=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND is_deleted=0 AND claimed_by_user_id IS NULL
  `);
  const takeOverItemClaimStmt = db.prepare(`
    UPDATE content_items
    SET
      claimed_by_user_id=?,
      claimed_at=CURRENT_TIMESTAMP,
      claim_note=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND is_deleted=0
  `);
  const releaseItemClaimStmt = db.prepare(`
    UPDATE content_items
    SET
      claimed_by_user_id=NULL,
      claimed_at=NULL,
      claim_note=NULL,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND is_deleted=0 AND claimed_by_user_id=?
  `);
  const releaseItemClaimByAdminStmt = db.prepare(`
    UPDATE content_items
    SET
      claimed_by_user_id=NULL,
      claimed_at=NULL,
      claim_note=NULL,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND is_deleted=0
  `);

  const insertSourceStmt = db.prepare(`
    INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
    VALUES (@content_item_id, @source_type, @source_name, @source_url, @source_entity_id, @payload_json)
  `);
  const updateSourceByUrlStmt = db.prepare(`
    UPDATE source_records SET
      content_item_id=@content_item_id,
      source_type=@source_type,
      source_name=@source_name,
      source_entity_id=@source_entity_id,
      payload_json=@payload_json,
      updated_at=CURRENT_TIMESTAMP
    WHERE source_url=@source_url
  `);
  const sourceByUrlStmt = db.prepare("SELECT id FROM source_records WHERE source_url=?");
  const deleteSourceByItemStmt = db.prepare("DELETE FROM source_records WHERE content_item_id=?");
  const listSourceByItemStmt = db.prepare("SELECT * FROM source_records WHERE content_item_id=? ORDER BY id DESC");

  const clearQualityStmt = db.prepare("DELETE FROM quality_checks WHERE content_item_id=?");
  const insertQualityStmt = db.prepare("INSERT INTO quality_checks (content_item_id, check_name, status, reason) VALUES (?, ?, ?, ?)");

  const upsertStagingStmt = db.prepare(`
    INSERT INTO staging_items (content_item_id, staged_payload_json, status)
    VALUES (?, ?, 'approved')
    ON CONFLICT(content_item_id) DO UPDATE SET
      staged_payload_json=excluded.staged_payload_json,
      status='approved',
      staged_at=CURRENT_TIMESTAMP
  `);

  const listStagingStmt = db.prepare(`
    SELECT s.id AS staging_id, s.status AS staging_status, s.staged_at, s.staged_payload_json, c.*
    FROM staging_items s
    JOIN content_items c ON c.id = s.content_item_id
    WHERE c.is_deleted=0
    ORDER BY s.staged_at DESC
  `);

  const insertVersionStmt = db.prepare(`
    INSERT INTO content_versions (
      content_item_id, version_no, title, description_clean, summary, meta_title, meta_description, generated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const latestVersionStmt = db.prepare("SELECT COALESCE(MAX(version_no), 0) AS max_version FROM content_versions WHERE content_item_id=?");

  const insertAuditStmt = db.prepare(`
    INSERT INTO audit_logs (actor_email, action, target_type, target_id, assignment_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPipelineRunStmt = db.prepare(`
    INSERT INTO pipeline_runs (run_uid, stage, status, input_count, output_count, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const finishPipelineRunStmt = db.prepare(`
    UPDATE pipeline_runs SET status=?, output_count=?, message=?, finished_at=CURRENT_TIMESTAMP
    WHERE run_uid=?
  `);

  const insertExportJobStmt = db.prepare(`
    INSERT INTO export_jobs (job_uid, format, output_path, item_count, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const finishExportJobStmt = db.prepare(`
    UPDATE export_jobs SET status=?, finished_at=CURRENT_TIMESTAMP WHERE job_uid=?
  `);

  const insertSourceIngestionStmt = db.prepare(`
    INSERT INTO source_ingestions (batch_uid, adapter, source_label, status, item_count, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const finishSourceIngestionStmt = db.prepare(`
    UPDATE source_ingestions SET status=?, item_count=?, message=?, finished_at=CURRENT_TIMESTAMP
    WHERE batch_uid=?
  `);

  const insertRawSourceItemStmt = db.prepare(`
    INSERT INTO source_raw_items (
      batch_uid, source_ref, source_url, source_type, title_raw, description_raw, payload_json, normalized_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRawSourceMediaStmt = db.prepare(`
    INSERT INTO source_raw_media (raw_item_id, media_url, checksum, mime_type, width, height, status, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEvidenceBlockStmt = db.prepare(`
    INSERT INTO evidence_blocks (
      content_item_id, block_type, source_type, source_record_type, source_record_id,
      source_url, source_label, lang, attribution_text,
      text_value, numeric_value, list_value_json, payload_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const listEvidenceBlocksByItemStmt = db.prepare(`
    SELECT *
    FROM evidence_blocks
    WHERE content_item_id=?
    ORDER BY id DESC
  `);

  const insertApprovedContextBlockStmt = db.prepare(`
    INSERT INTO approved_context_blocks (
      content_item_id, evidence_block_id, context_type, selected_text, selected_numeric,
      selected_list_json, note, editor_note, sort_order, confidence, status, approved_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const listApprovedContextByItemStmt = db.prepare(`
    SELECT
      acb.*,
      eb.block_type AS evidence_block_type,
      eb.source_type AS evidence_source_type,
      eb.source_url AS evidence_source_url,
      eb.source_label AS evidence_source_label,
      eb.source_record_type AS evidence_source_record_type,
      eb.source_record_id AS evidence_source_record_id,
      eb.lang AS evidence_lang
    FROM approved_context_blocks acb
    JOIN evidence_blocks eb ON eb.id = acb.evidence_block_id
    WHERE acb.content_item_id=?
    ORDER BY acb.sort_order ASC, acb.id DESC
  `);

  const updateApprovedContextByIdStmt = db.prepare(`
    UPDATE approved_context_blocks
    SET
      context_type = COALESCE(?, context_type),
      selected_text = COALESCE(?, selected_text),
      selected_numeric = COALESCE(?, selected_numeric),
      selected_list_json = COALESCE(?, selected_list_json),
      note = COALESCE(?, note),
      editor_note = COALESCE(?, editor_note),
      sort_order = COALESCE(?, sort_order),
      confidence = COALESCE(?, confidence),
      status = COALESCE(?, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id=? AND content_item_id=?
  `);

  const getApprovedContextByIdStmt = db.prepare(`
    SELECT
      acb.*,
      eb.block_type AS evidence_block_type,
      eb.source_type AS evidence_source_type,
      eb.source_url AS evidence_source_url,
      eb.source_label AS evidence_source_label,
      eb.source_record_type AS evidence_source_record_type,
      eb.source_record_id AS evidence_source_record_id,
      eb.lang AS evidence_lang
    FROM approved_context_blocks acb
    JOIN evidence_blocks eb ON eb.id = acb.evidence_block_id
    WHERE acb.id=? AND acb.content_item_id=?
    LIMIT 1
  `);

  const insertDraftInputSnapshotStmt = db.prepare(`
    INSERT INTO draft_input_snapshots (content_item_id, source, run_uid, payload_json, input_json, context_hash, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const findActiveApprovedContextByEvidenceStmt = db.prepare(`
    SELECT id
    FROM approved_context_blocks
    WHERE content_item_id=? AND evidence_block_id=? AND status='active'
    ORDER BY id DESC
    LIMIT 1
  `);

  const insertGenerationRunStmt = db.prepare(`
    INSERT INTO generation_runs (run_uid, mode, model, status, input_count, output_count, error_count, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const finishGenerationRunStmt = db.prepare(`
    UPDATE generation_runs SET status=?, output_count=?, error_count=?, message=?, finished_at=CURRENT_TIMESTAMP
    WHERE run_uid=?
  `);

  const upsertDraftStmt = db.prepare(`
    INSERT INTO content_drafts (
      content_item_id, generation_run_uid, draft_title, excerpt, body,
      meta_title, meta_description, suggested_related_json, ai_quality_score,
      confirmed_cta_contact_json, confirmed_taxonomy_json, confirmed_meta_status,
      confirmed_by_user_id, confirmed_at, confirmed_note, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(content_item_id, generation_run_uid) DO UPDATE SET
      draft_title=excluded.draft_title,
      excerpt=excluded.excerpt,
      body=excluded.body,
      meta_title=excluded.meta_title,
      meta_description=excluded.meta_description,
      suggested_related_json=excluded.suggested_related_json,
      ai_quality_score=excluded.ai_quality_score,
      confirmed_cta_contact_json=excluded.confirmed_cta_contact_json,
      confirmed_taxonomy_json=excluded.confirmed_taxonomy_json,
      confirmed_meta_status=excluded.confirmed_meta_status,
      confirmed_by_user_id=excluded.confirmed_by_user_id,
      confirmed_at=excluded.confirmed_at,
      confirmed_note=excluded.confirmed_note,
      status=excluded.status,
      updated_at=CURRENT_TIMESTAMP
  `);

  const latestDraftByItemStmt = db.prepare(`
    SELECT *
    FROM content_drafts
    WHERE content_item_id=?
    ORDER BY id DESC
    LIMIT 1
  `);

  const getDraftByIdStmt = db.prepare(`
    SELECT *
    FROM content_drafts
    WHERE id=?
    LIMIT 1
  `);

  const insertReviewReportStmt = db.prepare(`
    INSERT INTO review_reports (
      content_item_id, draft_id, duplication_score, seo_risk_score, metadata_score,
      grounding_score, ai_quality_score, total_score, issues_json, report_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const latestReviewByItemStmt = db.prepare(`
    SELECT *
    FROM review_reports
    WHERE content_item_id=?
    ORDER BY id DESC
    LIMIT 1
  `);

  const latestApprovedReviewByItemStmt = db.prepare(`
    SELECT *
    FROM review_reports
    WHERE content_item_id=? AND status='approved'
    ORDER BY id DESC
    LIMIT 1
  `);

  const getReviewReportByIdStmt = db.prepare(`
    SELECT *
    FROM review_reports
    WHERE id=?
    LIMIT 1
  `);

  const insertFieldPackStmt = db.prepare(`
    INSERT INTO field_packs (
      content_item_id, source_draft_id, source_review_report_id, source_draft_input_snapshot_id,
      status, is_current, ai_summary, ai_highlights_json, ai_unknowns_json,
      editor_summary, verified_facts_json, uncertain_facts_json,
      story_angle, field_notes, social_hook, social_shot_emphasis_json,
      social_on_camera_points_json, social_caption_angle,
      ai_cta_contact_json, ai_taxonomy_json, requested_checks_json, curated_cta_contact_json, curated_taxonomy_json,
      curation_status, curated_by_user_id, curated_at, curation_note,
      writer_ready, writer_angle, writer_key_points_json, writer_notes, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const updateFieldPackStmt = db.prepare(`
    UPDATE field_packs
    SET
      source_draft_id=?,
      source_review_report_id=?,
      source_draft_input_snapshot_id=?,
      status=?,
      is_current=?,
      ai_summary=?,
      ai_highlights_json=?,
      ai_unknowns_json=?,
      editor_summary=?,
      verified_facts_json=?,
      uncertain_facts_json=?,
      story_angle=?,
      field_notes=?,
      social_hook=?,
      social_shot_emphasis_json=?,
      social_on_camera_points_json=?,
      social_caption_angle=?,
      ai_cta_contact_json=?,
      ai_taxonomy_json=?,
      requested_checks_json=?,
      curated_cta_contact_json=?,
      curated_taxonomy_json=?,
      curation_status=?,
      curated_by_user_id=?,
      curated_at=?,
      curation_note=?,
      writer_ready=?,
      writer_angle=?,
      writer_key_points_json=?,
      writer_notes=?,
      updated_by=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);

  const getFieldPackByIdStmt = db.prepare(`
    SELECT *
    FROM field_packs
    WHERE id=?
    LIMIT 1
  `);

  const getCurrentFieldPackByItemStmt = db.prepare(`
    SELECT *
    FROM field_packs
    WHERE content_item_id=? AND is_current=1 AND archived_at IS NULL
    ORDER BY id DESC
    LIMIT 1
  `);
  const countDraftsByItemStmt = db.prepare(`
    SELECT COUNT(*) AS c
    FROM content_drafts
    WHERE content_item_id=?
  `);
  const countReviewsByItemStmt = db.prepare(`
    SELECT COUNT(*) AS c
    FROM review_reports
    WHERE content_item_id=?
  `);
  const countFieldPacksByItemStmt = db.prepare(`
    SELECT COUNT(*) AS c
    FROM field_packs
    WHERE content_item_id=? AND archived_at IS NULL
  `);

  const listFieldPacksByItemStmt = db.prepare(`
    SELECT *
    FROM field_packs
    WHERE content_item_id=?
    ORDER BY is_current DESC, id DESC
  `);

  const clearCurrentFieldPacksByItemStmt = db.prepare(`
    UPDATE field_packs
    SET is_current=0, updated_at=CURRENT_TIMESTAMP
    WHERE content_item_id=? AND archived_at IS NULL
  `);

  const listAgentProfilesStmt = db.prepare(`
    SELECT *
    FROM agent_profiles
    ORDER BY agent_key ASC
  `);

  const getAgentProfileStmt = db.prepare(`
    SELECT *
    FROM agent_profiles
    WHERE agent_key=?
    LIMIT 1
  `);

  const upsertAgentProfileStmt = db.prepare(`
    INSERT INTO agent_profiles (
      agent_key, display_name, profile_text, is_enabled, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(agent_key) DO UPDATE SET
      display_name=excluded.display_name,
      profile_text=excluded.profile_text,
      is_enabled=excluded.is_enabled,
      updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP
  `);

  const listAiFeaturePoliciesStmt = db.prepare(`
    SELECT *
    FROM ai_feature_policies
    ORDER BY feature_key ASC
  `);

  const getAiFeaturePolicyStmt = db.prepare(`
    SELECT *
    FROM ai_feature_policies
    WHERE feature_key=?
    LIMIT 1
  `);

  const upsertAiFeaturePolicyStmt = db.prepare(`
    INSERT INTO ai_feature_policies (
      feature_key, policy_key, updated_by, updated_at
    ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(feature_key) DO UPDATE SET
      policy_key=excluded.policy_key,
      updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP
  `);

  const listFieldPackChecklistsByPackStmt = db.prepare(`
    SELECT *
    FROM field_pack_checklists
    WHERE field_pack_id=?
    ORDER BY checklist_type ASC, item_order ASC, id ASC
  `);

  const deleteFieldPackChecklistsByPackStmt = db.prepare(`
    DELETE FROM field_pack_checklists
    WHERE field_pack_id=?
  `);

  const insertFieldPackChecklistStmt = db.prepare(`
  INSERT INTO field_pack_checklists (
    field_pack_id, checklist_type, item_text, capture_type, item_order, status, note, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const listFieldPackReferencesByPackStmt = db.prepare(`
    SELECT *
    FROM field_pack_references
    WHERE field_pack_id=?
    ORDER BY reference_scope ASC, item_order ASC, id ASC
  `);

  const deleteFieldPackReferencesByPackStmt = db.prepare(`
    DELETE FROM field_pack_references
    WHERE field_pack_id=?
  `);

  const insertFieldPackReferenceStmt = db.prepare(`
    INSERT INTO field_pack_references (
      field_pack_id, reference_scope, label, url, source_family, note, item_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const listFieldPackMediaHintsByPackStmt = db.prepare(`
    SELECT *
    FROM field_pack_media_hints
    WHERE field_pack_id=?
    ORDER BY kind ASC, item_order ASC, id ASC
  `);

  const deleteFieldPackMediaHintsByPackStmt = db.prepare(`
    DELETE FROM field_pack_media_hints
    WHERE field_pack_id=?
  `);

  const insertFieldPackMediaHintStmt = db.prepare(`
    INSERT INTO field_pack_media_hints (
      field_pack_id, content_asset_id, url, kind, caption, selected, item_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const listFieldPackAssignmentsByPackStmt = db.prepare(`
    SELECT *
    FROM field_pack_assignments
    WHERE field_pack_id=?
    ORDER BY assignment_scope ASC, id ASC
  `);

  const getDraftInputSnapshotByIdStmt = db.prepare(`
    SELECT *
    FROM draft_input_snapshots
    WHERE id=?
    LIMIT 1
  `);

  const getContentAssetByIdStmt = db.prepare(`
    SELECT *
    FROM content_assets
    WHERE id=?
    LIMIT 1
  `);

  const getContentAssetByItemAndAssetStmt = db.prepare(`
    SELECT *
    FROM content_assets
    WHERE content_item_id=? AND asset_id=?
    LIMIT 1
  `);
  const getContentAssetWithAssetByItemAndAssetStmt = db.prepare(`
    SELECT ca.*, a.mime_type, a.file_name, a.storage_path
    FROM content_assets ca
    JOIN assets a ON a.id = ca.asset_id
    WHERE ca.content_item_id=? AND ca.asset_id=?
    LIMIT 1
  `);

  const deleteFieldPackAssignmentsByPackStmt = db.prepare(`
    DELETE FROM field_pack_assignments
    WHERE field_pack_id=?
  `);

  const deleteFieldPackByIdStmt = db.prepare(`
    DELETE FROM field_packs
    WHERE id=?
  `);

  const insertFieldPackAssignmentStmt = db.prepare(`
    INSERT INTO field_pack_assignments (
      field_pack_id, assignment_scope, linked_assignment_id, assigned_user_id,
      assigned_name, assigned_role, assigned_at, due_at, note, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const insertReviewActionStmt = db.prepare(`
    INSERT INTO review_actions (content_item_id, report_id, action, reviewer_email, notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const updateReviewStatusStmt = db.prepare(`
    UPDATE review_reports SET status=? WHERE id=?
  `);

  const clearLinkSuggestionsByItemStmt = db.prepare("DELETE FROM internal_link_suggestions WHERE content_item_id=?");
  const insertLinkSuggestionStmt = db.prepare(`
    INSERT INTO internal_link_suggestions (
      content_item_id, target_content_item_id, anchor_text, relevance_score, reason, status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const updateLinkSuggestionReviewStmt = db.prepare(`
    UPDATE internal_link_suggestions
    SET status=?, reviewed_at=CURRENT_TIMESTAMP, reviewer_email=?
    WHERE id=?
  `);

  const insertPublishRunStmt = db.prepare(`
    INSERT INTO publish_runs (run_uid, status, input_count, output_count, message)
    VALUES (?, ?, ?, ?, ?)
  `);

  const finishPublishRunStmt = db.prepare(`
    UPDATE publish_runs SET status=?, output_count=?, message=?, finished_at=CURRENT_TIMESTAMP
    WHERE run_uid=?
  `);

  const upsertPublishedArticleStmt = db.prepare(`
    INSERT INTO published_articles (
      content_item_id, draft_id, review_report_id, slug, title, excerpt, body,
      meta_title, meta_description, event_period_text, location_text, latitude, longitude, map_url, google_place_id,
      related_json, internal_links_json, status, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(content_item_id) DO UPDATE SET
      draft_id=excluded.draft_id,
      review_report_id=excluded.review_report_id,
      slug=excluded.slug,
      title=excluded.title,
      excerpt=excluded.excerpt,
      body=excluded.body,
      meta_title=excluded.meta_title,
      meta_description=excluded.meta_description,
      event_period_text=excluded.event_period_text,
      location_text=excluded.location_text,
      latitude=excluded.latitude,
      longitude=excluded.longitude,
      map_url=excluded.map_url,
      google_place_id=excluded.google_place_id,
      related_json=excluded.related_json,
      internal_links_json=excluded.internal_links_json,
      status=excluded.status,
      published_at=CURRENT_TIMESTAMP
  `);


  const upsertTranslationStmt = db.prepare(`
    INSERT INTO content_translations (
      source_content_item_id, source_published_article_id, source_draft_id, source_review_report_id,
      source_fingerprint, lang,
      translated_title, translated_excerpt, translated_body,
      translated_meta_title, translated_meta_description,
      translation_status, automatic_check_status, automatic_check_report_json,
      translation_recheck_status, translation_recheck_score,
      accuracy_score, fluency_score, term_score,
      back_translation_th, recheck_summary_th, recheck_issues_json, recheck_model, rechecked_at,
      repair_attempt_count,
      stale_flag, translator_engine, translator_model, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(source_content_item_id, lang) DO UPDATE SET
      source_published_article_id=excluded.source_published_article_id,
      source_draft_id=excluded.source_draft_id,
      source_review_report_id=excluded.source_review_report_id,
      source_fingerprint=excluded.source_fingerprint,
      translated_title=excluded.translated_title,
      translated_excerpt=excluded.translated_excerpt,
      translated_body=excluded.translated_body,
      translated_meta_title=excluded.translated_meta_title,
      translated_meta_description=excluded.translated_meta_description,
      translation_status=excluded.translation_status,
      automatic_check_status=excluded.automatic_check_status,
      automatic_check_report_json=excluded.automatic_check_report_json,
      translation_recheck_status=excluded.translation_recheck_status,
      translation_recheck_score=excluded.translation_recheck_score,
      accuracy_score=excluded.accuracy_score,
      fluency_score=excluded.fluency_score,
      term_score=excluded.term_score,
      back_translation_th=excluded.back_translation_th,
      recheck_summary_th=excluded.recheck_summary_th,
      recheck_issues_json=excluded.recheck_issues_json,
      recheck_model=excluded.recheck_model,
      rechecked_at=excluded.rechecked_at,
      repair_attempt_count=excluded.repair_attempt_count,
      stale_flag=excluded.stale_flag,
      translator_engine=excluded.translator_engine,
      translator_model=excluded.translator_model,
      updated_at=CURRENT_TIMESTAMP
  `);

  const getTranslationStmt = db.prepare(`
    SELECT * FROM content_translations WHERE source_content_item_id=? AND lang=? LIMIT 1
  `);

  const listTranslationsStmt = db.prepare(`
    SELECT ct.*, c.title AS source_title, c.lang AS source_lang
    FROM content_translations ct
    JOIN content_items c ON c.id = ct.source_content_item_id
    ORDER BY ct.updated_at DESC, ct.id DESC
  `);

  const listTranslationsByItemStmt = db.prepare(`
    SELECT ct.*, c.title AS source_title, c.lang AS source_lang
    FROM content_translations ct
    JOIN content_items c ON c.id = ct.source_content_item_id
    WHERE ct.source_content_item_id=?
    ORDER BY ct.updated_at DESC, ct.id DESC
  `);

  const markStaleTranslationsStmt = db.prepare(`
    UPDATE content_translations
    SET stale_flag=1,
        translation_status='stale',
        automatic_check_status='failed',
        translation_recheck_status='not_checked',
        translation_recheck_score=NULL,
        accuracy_score=NULL,
        fluency_score=NULL,
        term_score=NULL,
        back_translation_th=NULL,
        recheck_summary_th=NULL,
        recheck_issues_json=NULL,
        recheck_model=NULL,
        rechecked_at=NULL,
        updated_at=CURRENT_TIMESTAMP
    WHERE source_content_item_id=? AND source_fingerprint<>?
  `);

  const clearStaleCurrentFingerprintStmt = db.prepare(`
    UPDATE content_translations
    SET stale_flag=0,
        updated_at=CURRENT_TIMESTAMP
    WHERE source_content_item_id=? AND source_fingerprint=?
  `);

  const updateTranslationRecheckStmt = db.prepare(`
    UPDATE content_translations
    SET translation_recheck_status=?,
        translation_recheck_score=?,
        accuracy_score=?,
        fluency_score=?,
        term_score=?,
        back_translation_th=?,
        recheck_summary_th=?,
        recheck_issues_json=?,
        recheck_model=?,
        rechecked_at=?,
        repair_attempt_count=?,
        updated_at=CURRENT_TIMESTAMP
    WHERE source_content_item_id=? AND lang=?
  `);

  const updateTranslationRepairResultStmt = db.prepare(`
    UPDATE content_translations
    SET source_fingerprint=?,
        translated_title=?,
        translated_excerpt=?,
        translated_body=?,
        translated_meta_title=?,
        translated_meta_description=?,
        translation_status=?,
        automatic_check_status=?,
        automatic_check_report_json=?,
        translation_recheck_status='not_checked',
        translation_recheck_score=NULL,
        accuracy_score=NULL,
        fluency_score=NULL,
        term_score=NULL,
        back_translation_th=NULL,
        recheck_summary_th=NULL,
        recheck_issues_json=NULL,
        recheck_model=NULL,
        rechecked_at=NULL,
        repair_attempt_count=?,
        stale_flag=0,
        updated_at=CURRENT_TIMESTAMP
    WHERE source_content_item_id=? AND lang=?
  `);

  const insertTranslationRunStmt = db.prepare(`
    INSERT INTO translation_runs (run_uid, stage, status, input_count, output_count, failed_count, message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const finishTranslationRunStmt = db.prepare(`
    UPDATE translation_runs SET status=?, output_count=?, failed_count=?, message=?, finished_at=CURRENT_TIMESTAMP
    WHERE run_uid=?
  `);
  const getPublishedArticleByItemStmt = db.prepare(`
    SELECT *
    FROM published_articles
    WHERE content_item_id=?
    LIMIT 1
  `);
  const updatePublishedArticleStatusByItemStmt = db.prepare(`
    UPDATE published_articles
    SET status=?, published_at=CASE WHEN ?='published' THEN CURRENT_TIMESTAMP ELSE published_at END
    WHERE content_item_id=?
  `);
  const deletePublishedArticleByItemStmt = db.prepare(`
    DELETE FROM published_articles
    WHERE content_item_id=?
  `);
  const restorePublishedArticleByItemStmt = db.prepare(`
    INSERT INTO published_articles (
      content_item_id, draft_id, review_report_id, slug, title, excerpt, body,
      meta_title, meta_description, event_period_text, location_text, latitude, longitude, map_url, google_place_id,
      related_json, internal_links_json, status, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_item_id) DO UPDATE SET
      draft_id=excluded.draft_id,
      review_report_id=excluded.review_report_id,
      slug=excluded.slug,
      title=excluded.title,
      excerpt=excluded.excerpt,
      body=excluded.body,
      meta_title=excluded.meta_title,
      meta_description=excluded.meta_description,
      event_period_text=excluded.event_period_text,
      location_text=excluded.location_text,
      latitude=excluded.latitude,
      longitude=excluded.longitude,
      map_url=excluded.map_url,
      google_place_id=excluded.google_place_id,
      related_json=excluded.related_json,
      internal_links_json=excluded.internal_links_json,
      status=excluded.status,
      published_at=excluded.published_at
  `);

  const upsertWorkflowModelStmt = db.prepare(`
    INSERT INTO content_workflow_models (
      content_item_id, production_state, publication_state, assignment_state,
      current_draft_id, current_review_report_id, current_field_pack_id,
      state_version, content_version, last_actor_email, last_transition_at,
      last_transition_note, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_item_id) DO UPDATE SET
      production_state=excluded.production_state,
      publication_state=excluded.publication_state,
      assignment_state=excluded.assignment_state,
      current_draft_id=excluded.current_draft_id,
      current_review_report_id=excluded.current_review_report_id,
      current_field_pack_id=excluded.current_field_pack_id,
      state_version=excluded.state_version,
      content_version=excluded.content_version,
      last_actor_email=excluded.last_actor_email,
      last_transition_at=excluded.last_transition_at,
      last_transition_note=excluded.last_transition_note,
      updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP
  `);

  const getWorkflowModelByItemStmt = db.prepare(`
    SELECT *
    FROM content_workflow_models
    WHERE content_item_id=?
    LIMIT 1
  `);

  const insertWorkflowTransitionStmt = db.prepare(`
    INSERT INTO content_workflow_transitions (
      content_item_id, assignment_id, state_group, from_state, to_state, actor_email, actor_role, reason_code, note, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const listWorkflowTransitionsByItemStmt = db.prepare(`
    SELECT *
    FROM content_workflow_transitions
    WHERE content_item_id=?
    ORDER BY id DESC
    LIMIT ?
  `);
  const latestWorkflowTransitionByItemStmt = db.prepare(`
    SELECT *
    FROM content_workflow_transitions
    WHERE content_item_id=?
    ORDER BY id DESC
    LIMIT 1
  `);
  const countWorkflowTransitionsByItemStmt = db.prepare(`
    SELECT COUNT(*) AS c
    FROM content_workflow_transitions
    WHERE content_item_id=?
  `);

  const listAuditByTargetStmt = db.prepare(`
    SELECT *
    FROM audit_logs
    WHERE target_type=? AND target_id=?
    ORDER BY id DESC
    LIMIT ?
  `);

  const insertAssignmentStmt = db.prepare(`
    INSERT INTO content_assignments (
      assignment_uid, content_item_id, assignment_kind, assignee_user_id, assignee_name, assignee_contact, external_assignee_profile_json, assigned_by_user_id, state,
      brief_json, requirements_json, due_at, contributor_note, internal_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const ASSIGNMENT_SELECT_WITH_ASSIGNEE = `
    SELECT
      a.*,
      COALESCE(u.display_name, a.assignee_name) AS assignee_display_name,
      COALESCE(u.email, a.assignee_contact) AS assignee_email,
      u.role AS assignee_role,
      assigner.display_name AS assigned_by_display_name,
      assigner.email AS assigned_by_email
    FROM content_assignments a
    LEFT JOIN users u ON u.id = a.assignee_user_id
    LEFT JOIN users assigner ON assigner.id = a.assigned_by_user_id
  `;

  const getAssignmentByIdStmt = db.prepare(`
    ${ASSIGNMENT_SELECT_WITH_ASSIGNEE}
    WHERE a.id=?
    LIMIT 1
  `);

  const getAssignmentByUidStmt = db.prepare(`
    ${ASSIGNMENT_SELECT_WITH_ASSIGNEE}
    WHERE a.assignment_uid=?
    LIMIT 1
  `);

  const listAssignmentsByItemStmt = db.prepare(`
    ${ASSIGNMENT_SELECT_WITH_ASSIGNEE}
    WHERE a.content_item_id=?
    ORDER BY a.id DESC
  `);

  const listAssignmentsByAssigneeStmt = db.prepare(`
    ${ASSIGNMENT_SELECT_WITH_ASSIGNEE}
    WHERE a.assignee_user_id=?
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT ?
  `);
  const listAssignmentsStmt = db.prepare(`
    ${ASSIGNMENT_SELECT_WITH_ASSIGNEE}
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT ?
  `);
  function listAssignmentsByScopeUserIds(userIds = [], limit = 50) {
    const ids = Array.isArray(userIds)
      ? Array.from(new Set(userIds.map((value) => Number(value || 0)).filter(Boolean)))
      : [];
    if (!ids.length) return [];
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const placeholders = ids.map(() => "?").join(", ");
    const stmt = db.prepare(`
      ${ASSIGNMENT_SELECT_WITH_ASSIGNEE}
      WHERE a.assignee_user_id IN (${placeholders}) OR a.assigned_by_user_id IN (${placeholders})
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT ?
    `);
    return stmt.all(...ids, ...ids, safeLimit).map(normalizeAssignmentRow);
  }
  const listExternalAssignmentsByAssignerStmt = db.prepare(`
    ${ASSIGNMENT_SELECT_WITH_ASSIGNEE}
    WHERE a.assigned_by_user_id=? AND a.assignee_user_id IS NULL
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT ?
  `);

  const updateAssignmentStateStmt = db.prepare(`
    UPDATE content_assignments
    SET
      state=?,
      contributor_note=COALESCE(?, contributor_note),
      internal_note=COALESCE(?, internal_note),
      revision_round=CASE WHEN ? THEN revision_round + 1 ELSE revision_round END,
      accepted_at=CASE
        WHEN ? THEN COALESCE(accepted_at, CURRENT_TIMESTAMP)
        WHEN ? THEN NULL
        ELSE accepted_at
      END,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);
  const updateAssignmentMediaResetPolicyStmt = db.prepare(`
    UPDATE content_assignments
    SET
      image_reset_required=?,
      image_reset_reason=?,
      video_reset_required=?,
      video_reset_reason=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);
  const listAssignmentRoundAssetsByTypeStmt = db.prepare(`
    SELECT
      ca.id AS content_asset_id,
      ca.asset_id,
      ca.content_item_id,
      ca.assignment_id,
      ca.assignment_round,
      ca.assignment_media_type,
      a.file_name,
      a.storage_disk,
      a.storage_path,
      a.mime_type,
      a.size_bytes
    FROM content_assets ca
    JOIN assets a ON a.id = ca.asset_id
    WHERE ca.assignment_id=?
      AND ca.assignment_round=?
      AND ca.assignment_media_type=?
      AND COALESCE(ca.assignment_surface, '')='assignment_work'
    ORDER BY ca.id ASC
  `);
  const deleteContentAssetByIdStmt = db.prepare(`
    DELETE FROM content_assets
    WHERE id=?
  `);
  const countAssetLinksStmt = db.prepare(`
    SELECT COUNT(*) AS c
    FROM content_assets
    WHERE asset_id=?
  `);
  const deleteAssetByIdStmt = db.prepare(`
    DELETE FROM assets
    WHERE id=?
  `);

  const insertAssignmentSubmissionStmt = db.prepare(`
    INSERT INTO content_assignment_submissions (
      assignment_id, content_item_id, submitted_by_user_id, submission_state,
      article_payload_json, media_payload_json, field_return_payload_json,
      contributor_note, reviewer_note, created_at, updated_at, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateAssignmentSubmissionStmt = db.prepare(`
    UPDATE content_assignment_submissions
    SET
      submitted_by_user_id=?,
      submission_state=?,
      article_payload_json=?,
      media_payload_json=?,
      field_return_payload_json=?,
      contributor_note=COALESCE(?, contributor_note),
      reviewer_note=COALESCE(?, reviewer_note),
      reviewed_at=COALESCE(?, reviewed_at),
      updated_at=?
    WHERE id=?
  `);

  const listAssignmentSubmissionsStmt = db.prepare(`
    SELECT *
    FROM content_assignment_submissions
    WHERE assignment_id=?
    ORDER BY id DESC
  `);
  const getAssignmentSubmissionByIdStmt = db.prepare(`
    SELECT *
    FROM content_assignment_submissions
    WHERE id=?
    LIMIT 1
  `);
  const getAssignmentSubmissionDraftStmt = db.prepare(`
    SELECT *
    FROM content_assignment_submission_drafts
    WHERE assignment_id=? AND user_id=? AND revision_round=?
    LIMIT 1
  `);
  const upsertAssignmentSubmissionDraftStmt = db.prepare(`
    INSERT INTO content_assignment_submission_drafts (
      assignment_id, user_id, revision_round, content_item_id, article_payload_json, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(assignment_id, user_id, revision_round) DO UPDATE SET
      article_payload_json=excluded.article_payload_json,
      content_item_id=excluded.content_item_id,
      expires_at=excluded.expires_at,
      updated_at=CURRENT_TIMESTAMP
  `);
  const deleteAssignmentSubmissionDraftStmt = db.prepare(`
    DELETE FROM content_assignment_submission_drafts
    WHERE assignment_id=? AND user_id=? AND revision_round=?
  `);
  const deleteAssignmentSubmissionDraftsByAssignmentRoundStmt = db.prepare(`
    DELETE FROM content_assignment_submission_drafts
    WHERE assignment_id=? AND revision_round=?
  `);
  const deleteExpiredAssignmentSubmissionDraftsStmt = db.prepare(`
    DELETE FROM content_assignment_submission_drafts
    WHERE expires_at < ?
  `);
  const insertAssignmentSubmissionDeliverableStmt = db.prepare(`
    INSERT INTO content_assignment_submission_deliverables (
      assignment_id, submission_id, content_item_id, deliverable_type, title, lang,
      text_content, payload_json, source_asset_id, source_url, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getAssignmentSubmissionDeliverableByIdStmt = db.prepare(`
    SELECT *
    FROM content_assignment_submission_deliverables
    WHERE id=?
    LIMIT 1
  `);
  const findLatestAssignmentSubmissionDeliverableByTypeStmt = db.prepare(`
    SELECT *
    FROM content_assignment_submission_deliverables
    WHERE assignment_id=? AND submission_id=? AND deliverable_type=? AND lang=?
    ORDER BY id DESC
    LIMIT 1
  `);
  const updateAssignmentSubmissionDeliverableStmt = db.prepare(`
    UPDATE content_assignment_submission_deliverables
    SET
      title=COALESCE(?, title),
      text_content=COALESCE(?, text_content),
      payload_json=COALESCE(?, payload_json),
      source_asset_id=COALESCE(?, source_asset_id),
      source_url=COALESCE(?, source_url),
      status=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);
  const listAssignmentSubmissionDeliverablesBySubmissionStmt = db.prepare(`
    SELECT *
    FROM content_assignment_submission_deliverables
    WHERE assignment_id=? AND submission_id=?
    ORDER BY id DESC
  `);
  const listAssignmentSubmissionDeliverablesByAssignmentStmt = db.prepare(`
    SELECT *
    FROM content_assignment_submission_deliverables
    WHERE assignment_id=?
    ORDER BY id DESC
  `);

  const insertAssignmentHandoffSnapshotStmt = db.prepare(`
    INSERT INTO content_assignment_handoff_snapshots (
      assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, force_reason, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const latestAssignmentHandoffByAssignmentStmt = db.prepare(`
    SELECT *
    FROM content_assignment_handoff_snapshots
    WHERE assignment_id=?
    ORDER BY id DESC
    LIMIT 1
  `);

  const attachLatestSubmissionToAssignmentStmt = db.prepare(`
    UPDATE content_assignments
    SET latest_submission_id=?, latest_submission_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);

  const insertIntelligenceModelStmt = db.prepare(`
    INSERT INTO content_intelligence_models (
      content_item_id, model_version,
      quality_score, popularity_score, momentum_score, confidence_score,
      source_coverage_signal, fact_completeness_signal, official_presence_signal, review_presence_signal,
      social_presence_signal, visual_signal, local_uniqueness_signal, content_gap_signal,
      evidence_summary_json, signals_json, scores_json, niche_json, gaps_json, next_actions_json,
      brief_json, readiness_json, reasons_json, payload_json, computed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const latestIntelligenceModelByItemStmt = db.prepare(`
    SELECT *
    FROM content_intelligence_models
    WHERE content_item_id=?
    ORDER BY id DESC
    LIMIT 1
  `);

  const insertReadinessBriefStmt = db.prepare(`
    INSERT INTO content_readiness_briefs (
      content_item_id,
      readiness_json,
      brief_json,
      reasons_json,
      blockers_json,
      missing_requirements_json,
      computed_from_model_id,
      computed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const latestReadinessBriefByItemStmt = db.prepare(`
    SELECT *
    FROM content_readiness_briefs
    WHERE content_item_id=?
    ORDER BY id DESC
    LIMIT 1
  `);
  const latestReadinessBriefByItemBeforeStmt = db.prepare(`
    SELECT *
    FROM content_readiness_briefs
    WHERE content_item_id=? AND created_at<=?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);

  const getReadinessBriefByIdStmt = db.prepare(`
    SELECT *
    FROM content_readiness_briefs
    WHERE id=?
    LIMIT 1
  `);

  const insertExecutionControlsStmt = db.prepare(`
    INSERT INTO content_execution_controls (
      content_item_id,
      source_readiness_brief_id,
      source_intelligence_model_id,
      must_include_points_json,
      must_avoid_points_json,
      blockers_json,
      missing_requirements_json,
      reasons_json,
      payload_json,
      computed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const latestExecutionControlsByItemStmt = db.prepare(`
    SELECT *
    FROM content_execution_controls
    WHERE content_item_id=?
    ORDER BY id DESC
    LIMIT 1
  `);
  const latestExecutionControlsByItemBeforeStmt = db.prepare(`
    SELECT *
    FROM content_execution_controls
    WHERE content_item_id=? AND created_at<=?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  const latestExecutionControlsByItemAndReadinessBeforeStmt = db.prepare(`
    SELECT *
    FROM content_execution_controls
    WHERE content_item_id=? AND source_readiness_brief_id=? AND created_at<=?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);

  const insertExecutionChannelStmt = db.prepare(`
    INSERT INTO content_execution_channels (
      content_item_id,
      source_readiness_brief_id,
      channel,
      lang,
      derived_controls_json,
      recommended_version_json,
      alternatives_json,
      validation_json,
      status,
      generated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateExecutionChannelByIdStmt = db.prepare(`
    UPDATE content_execution_channels
    SET
      source_readiness_brief_id=COALESCE(?, source_readiness_brief_id),
      lang=?,
      derived_controls_json=?,
      recommended_version_json=?,
      alternatives_json=?,
      validation_json=?,
      status=?,
      generated_by=COALESCE(?, generated_by),
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);

  const updateExecutionChannelValidationStmt = db.prepare(`
    UPDATE content_execution_channels
    SET
      derived_controls_json=?,
      validation_json=?,
      status=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);

  const getExecutionChannelByIdStmt = db.prepare(`
    SELECT *
    FROM content_execution_channels
    WHERE id=?
    LIMIT 1
  `);

  const listExecutionChannelsByItemStmt = db.prepare(`
    SELECT *
    FROM content_execution_channels
    WHERE content_item_id=?
    ORDER BY created_at DESC, id DESC
  `);

  const latestExecutionChannelByItemAndChannelStmt = db.prepare(`
    SELECT *
    FROM content_execution_channels
    WHERE content_item_id=? AND channel=?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  const latestExecutionChannelByItemAndChannelBeforeStmt = db.prepare(`
    SELECT *
    FROM content_execution_channels
    WHERE content_item_id=? AND channel=? AND created_at<=?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  const latestExecutionChannelByItemAndChannelAndReadinessBeforeStmt = db.prepare(`
    SELECT *
    FROM content_execution_channels
    WHERE content_item_id=? AND channel=? AND source_readiness_brief_id=? AND created_at<=?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  function normalizeInput(input = {}) {
    const itemId = Number(input.id || 0) || 0;
    const title = String(input.title || "").trim();
    const fallbackSlugKey = itemId > 0 ? `item-${itemId}` : title || "item";
    const tags = Array.isArray(input.tags)
      ? input.tags
      : String(input.tags || "")
          .split("|")
          .map((x) => x.trim())
          .filter(Boolean);

    return {
      id: Number(input.id || 0),
      item_uid: input.item_uid || randomUUID(),
      type: String(input.type || "").trim().toLowerCase(),
      category: String(input.category || "").trim().toLowerCase(),
      lang: String(input.lang || "th").trim().toLowerCase(),
      title,
      normalized_title: String(input.normalized_title || input.title || "").trim(),
      slug: normalizeStoredSlug(input.slug || title, fallbackSlugKey),
      description_raw: String(input.description_raw || input.description || "").trim(),
      description_clean: String(input.description_clean || "").trim(),
      summary: String(input.summary || "").trim(),
      meta_title: String(input.meta_title || "").trim(),
      meta_description: String(input.meta_description || "").trim(),
      event_period_text: String(input.event_period_text || "").trim(),
      location_text: String(input.location_text || "").trim(),
      latitude: input.latitude === "" || input.latitude == null ? null : Number(input.latitude),
      longitude: input.longitude === "" || input.longitude == null ? null : Number(input.longitude),
      map_url: String(input.map_url || "").trim(),
      google_place_id: String(input.google_place_id || "").trim(),
      image_url: String(input.image_url || input.image || "").trim(),
      tags: JSON.stringify(tags),
      workflow_status: String(input.workflow_status || "raw").trim(),
      source_type: String(input.source_type || "manual").trim(),
      source_name: String(input.source_name || "manual").trim(),
      source_url: String(input.source_url || "").trim() || null,
      source_entity_id: String(input.source_entity_id || "").trim() || null,
      payload_json: input.payload_json ? JSON.stringify(input.payload_json) : null,
    };
  }

  function upsertSource(data, contentItemId) {
    const sourceParams = toSourceSqlParams(data, contentItemId);
    if (!sourceParams.source_url) {
      insertSourceStmt.run(sourceParams);
      return;
    }

    const existing = sourceByUrlStmt.get(sourceParams.source_url);
    if (existing) {
      updateSourceByUrlStmt.run(sourceParams);
      return;
    }

    insertSourceStmt.run(sourceParams);
  }

  function saveItemInternal(data, actorEmail = "system@local") {
    if (data.id > 0) {
      updateItemStmt.run(toItemUpdateParams(data));
      deleteSourceByItemStmt.run(data.id);
      upsertSource(data, data.id);
      logAudit(actorEmail, "item.update", "content_item", String(data.id), { title: data.title });
      return getItem(data.id);
    }

    const result = insertItemStmt.run(toItemInsertParams(data));
    const newId = Number(result.lastInsertRowid);
    upsertSource(data, newId);
    logAudit(actorEmail, "item.create", "content_item", String(newId), { title: data.title });
    return getItem(newId);
  }

  function saveItem(input, actorEmail = "system@local") {
    const data = normalizeInput(input);
    // Temporary compatibility: callers should not need to drive workflow via the
    // legacy mirror. Preserve the current mirror unless a caller explicitly sends one.
    if (!Object.prototype.hasOwnProperty.call(input || {}, "workflow_status") && Number(data.id || 0) > 0) {
      const existing = getItem(Number(data.id || 0));
      data.workflow_status = String(existing?.workflow_status || "raw").trim() || "raw";
    }
    return saveItemInternal(data, actorEmail);
  }

  function advanceWorkflowHead(contentItemId, workflowPatch = {}, actorEmail = "system@local", metadata = {}) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("contentItemId is required");
    return upsertWorkflowModel(itemId, workflowPatch, actorEmail, metadata);
  }

  function createItemWithWorkflowHead(itemInput = {}, workflowPatch = {}, actorEmail = "system@local", metadata = {}) {
    const mergedPatch = {
      publication_state: "draft",
      ...workflowPatch,
    };
    const item = saveItem(
      withCanonicalWorkflowStatusSeed(itemInput, mergedPatch),
      actorEmail
    );
    const itemId = Number(item?.id || 0) || 0;
    if (!itemId) throw new Error("Failed to create content item");
    const model = createWorkflowHead(itemId, mergedPatch, actorEmail, metadata);
    return { item, workflow_model: model };
  }

  function updateItemWithWorkflowHead(itemInput = {}, actorEmail = "system@local", options = {}) {
    const workflowPatch = options?.workflow_patch && typeof options.workflow_patch === "object"
      ? { ...options.workflow_patch }
      : null;
    const item = saveItem(
      workflowPatch ? withCanonicalWorkflowStatusSeed(itemInput, workflowPatch) : itemInput,
      actorEmail
    );
    const itemId = Number(item?.id || 0) || 0;
    if (!itemId) throw new Error("Failed to update content item");
    if (!workflowPatch) {
      return { item, workflow_model: null };
    }
    const workflowModel = advanceWorkflowHead(
      itemId,
      workflowPatch,
      actorEmail,
      options?.workflow_metadata && typeof options.workflow_metadata === "object"
        ? { ...options.workflow_metadata }
        : {}
    );
    return { item, workflow_model: workflowModel };
  }

  function listItems() {
    return listStmt.all().map(mapItem);
  }

  function listItemsByStatus(statuses = []) {
    if (!Array.isArray(statuses) || statuses.length === 0) {
      return listItems();
    }
    const normalizedStatuses = new Set(
      statuses
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    );
    return listItems().filter((item) => {
      const head = getWorkflowModelByItem(item.id);
      if (!head) return false;
      const workflowStatus = deriveWorkflowStatusFromModel(head);
      return normalizedStatuses.has(workflowStatus);
    });
  }

  function getItem(id) {
    return mapItem(getStmt.get(id));
  }

  function claimItem(itemId, claimedByUserId, options = {}) {
    const id = Number(itemId || 0);
    const actorId = Number(claimedByUserId || 0);
    if (!id || !actorId) {
      throw new Error("invalid item claim payload");
    }
    const current = getItem(id);
    if (!current) {
      throw new Error("item not found");
    }
    const note = String(options?.claim_note || "").trim() || null;
    const result = claimItemStmt.run(actorId, note, id);
    if (Number(result?.changes || 0) < 1) {
      throw createConflictError("item is already claimed");
    }
    return getItem(id);
  }

  function releaseItemClaim(itemId, claimedByUserId, options = {}) {
    const id = Number(itemId || 0);
    const actorId = Number(claimedByUserId || 0);
    if (!id || !actorId) {
      throw new Error("invalid item claim payload");
    }
    const current = getItem(id);
    if (!current) {
      throw new Error("item not found");
    }
    const force = options?.force === true;
    const result = force
      ? releaseItemClaimByAdminStmt.run(id)
      : releaseItemClaimStmt.run(id, actorId);
    if (Number(result?.changes || 0) < 1) {
      throw createConflictError(force ? "item claim is already released" : "item claim belongs to another user");
    }
    return getItem(id);
  }

  function takeOverItemClaim(itemId, claimedByUserId, options = {}) {
    const id = Number(itemId || 0);
    const actorId = Number(claimedByUserId || 0);
    if (!id || !actorId) {
      throw new Error("invalid item claim payload");
    }
    const current = getItem(id);
    if (!current) {
      throw new Error("item not found");
    }
    const note = String(options?.claim_note || "").trim() || null;
    takeOverItemClaimStmt.run(actorId, note, id);
    return getItem(id);
  }

  function deleteItem(id, actorEmail = "system@local") {
    softDeleteStmt.run(id);
    logAudit(actorEmail, "item.delete", "content_item", String(id), null);
  }

  function getRawOnlyHardDeleteEligibility(itemId) {
    const id = Number(itemId || 0) || 0;
    if (!id) {
      return { eligible: false, item: null, workflow_model: null, blockers: [{ key: "invalid_item_id", count: 0 }] };
    }

    const item = db.prepare(`
      SELECT id, item_uid, type, category, title, workflow_status, claimed_by_user_id, is_deleted
      FROM content_items
      WHERE id=?
      LIMIT 1
    `).get(id) || null;
    if (!item) {
      return { eligible: false, item: null, workflow_model: null, blockers: [{ key: "item_not_found", count: 0 }] };
    }

    const workflowModel = getWorkflowModelByItem(id);
    const blockers = [];
    const addBlocker = (key, count = 0) => blockers.push({ key, count: Number(count || 0) || 0 });

    if (Number(item.is_deleted || 0) !== 0) addBlocker("already_deleted");
    if (String(item.workflow_status || "").trim().toLowerCase() !== "raw") addBlocker("workflow_status_not_raw");
    if (Number(item.claimed_by_user_id || 0) > 0) addBlocker("claimed_item");

    if (!workflowModel) {
      addBlocker("workflow_model_missing");
    } else {
      if (String(workflowModel.production_state || "").trim().toLowerCase() !== "collected") addBlocker("production_state_not_collected");
      if (String(workflowModel.publication_state || "").trim().toLowerCase() !== "draft") addBlocker("publication_state_not_draft");
      if (Number(workflowModel.current_draft_id || 0) > 0) addBlocker("current_draft_exists");
      if (Number(workflowModel.current_review_report_id || 0) > 0) addBlocker("current_review_exists");
      if (Number(workflowModel.current_field_pack_id || 0) > 0) addBlocker("current_field_pack_exists");
    }

    const downstreamChecks = [
      ["content_drafts", "SELECT COUNT(*) AS c FROM content_drafts WHERE content_item_id=?"],
      ["review_reports", "SELECT COUNT(*) AS c FROM review_reports WHERE content_item_id=?"],
      ["field_packs", "SELECT COUNT(*) AS c FROM field_packs WHERE content_item_id=?"],
      ["published_articles", "SELECT COUNT(*) AS c FROM published_articles WHERE content_item_id=?"],
      ["reviews_raw", "SELECT COUNT(*) AS c FROM reviews_raw WHERE content_item_id=?"],
      ["quality_checks", "SELECT COUNT(*) AS c FROM quality_checks WHERE content_item_id=?"],
      ["content_translations", "SELECT COUNT(*) AS c FROM content_translations WHERE source_content_item_id=?"],
      ["content_assignments", "SELECT COUNT(*) AS c FROM content_assignments WHERE content_item_id=?"],
      ["content_assignment_submissions", "SELECT COUNT(*) AS c FROM content_assignment_submissions WHERE content_item_id=?"],
      ["content_assignment_submission_deliverables", "SELECT COUNT(*) AS c FROM content_assignment_submission_deliverables WHERE content_item_id=?"],
      ["content_assignment_handoff_snapshots", "SELECT COUNT(*) AS c FROM content_assignment_handoff_snapshots WHERE content_item_id=?"],
      ["content_versions", "SELECT COUNT(*) AS c FROM content_versions WHERE content_item_id=?"],
      ["approved_context_blocks", "SELECT COUNT(*) AS c FROM approved_context_blocks WHERE content_item_id=?"],
      ["draft_input_snapshots", "SELECT COUNT(*) AS c FROM draft_input_snapshots WHERE content_item_id=?"],
      ["content_readiness_briefs", "SELECT COUNT(*) AS c FROM content_readiness_briefs WHERE content_item_id=?"],
      ["content_execution_controls", "SELECT COUNT(*) AS c FROM content_execution_controls WHERE content_item_id=?"],
      ["content_execution_channels", "SELECT COUNT(*) AS c FROM content_execution_channels WHERE content_item_id=?"],
      ["search_enrichment_records", "SELECT COUNT(*) AS c FROM search_enrichment_records WHERE content_item_id=?"],
      ["place_intelligence_scores", "SELECT COUNT(*) AS c FROM place_intelligence_scores WHERE content_item_id=?"],
      ["social_signal_sources", "SELECT COUNT(*) AS c FROM social_signal_sources WHERE content_item_id=?"],
      ["social_momentum_snapshots", "SELECT COUNT(*) AS c FROM social_momentum_snapshots WHERE content_item_id=?"],
      ["content_direction_reports", "SELECT COUNT(*) AS c FROM content_direction_reports WHERE content_item_id=?"],
      ["review_actions", "SELECT COUNT(*) AS c FROM review_actions WHERE content_item_id=?"],
      ["content_intelligence_models", "SELECT COUNT(*) AS c FROM content_intelligence_models WHERE content_item_id=?"],
      ["internal_link_sources", "SELECT COUNT(*) AS c FROM internal_link_suggestions WHERE content_item_id=?"],
      ["internal_link_targets", "SELECT COUNT(*) AS c FROM internal_link_suggestions WHERE target_content_item_id=?"],
      ["staging_items", "SELECT COUNT(*) AS c FROM staging_items WHERE content_item_id=?"],
    ];
    const downstreamCheckKeys = new Set(downstreamChecks.map(([key]) => key));
    for (const entry of REFERENCE_CLEANUP_CANDIDATE_DEFS) {
      if (RAW_ONLY_HARD_DELETE_ALLOWED_REFERENCE_KEYS.has(entry.key)) continue;
      if (downstreamCheckKeys.has(entry.key)) continue;
      downstreamChecks.push([entry.key, `SELECT COUNT(*) AS c FROM ${entry.table} WHERE ${entry.where}`]);
      downstreamCheckKeys.add(entry.key);
    }

    for (const [key, sql] of downstreamChecks) {
      const count = Number(db.prepare(sql).get(id)?.c || 0) || 0;
      if (count > 0) addBlocker(key, count);
    }

    return {
      eligible: blockers.length === 0,
      item: {
        id: Number(item.id || 0) || 0,
        item_uid: item.item_uid || null,
        type: item.type || null,
        category: item.category || null,
        title: item.title || null,
        workflow_status: item.workflow_status || null,
        claimed_by_user_id: Number(item.claimed_by_user_id || 0) || null,
        is_deleted: Number(item.is_deleted || 0) || 0,
      },
      workflow_model: workflowModel || null,
      blockers,
    };
  }

  function hardDeleteRawOnlyItem(itemId, actorEmail = "system@local") {
    const eligibility = getRawOnlyHardDeleteEligibility(itemId);
    if (!eligibility?.eligible || !eligibility?.item) {
      const err = new Error("item is not eligible for raw-only hard delete");
      err.statusCode = 409;
      err.eligibility = eligibility;
      throw err;
    }

    const id = Number(eligibility.item.id || 0) || 0;
    const linkedAssetIds = db.prepare("SELECT asset_id FROM content_assets WHERE content_item_id=?").all(id)
      .map((row) => Number(row?.asset_id || 0) || 0)
      .filter((value) => value > 0);

    db.exec("BEGIN IMMEDIATE");
    try {
      logAudit(actorEmail, "item.hard_delete_raw", "content_item", String(id), {
        snapshot: {
          id,
          item_uid: eligibility.item.item_uid || null,
          title: eligibility.item.title || null,
          type: eligibility.item.type || null,
          category: eligibility.item.category || null,
          workflow_status: eligibility.item.workflow_status || null,
        },
        workflow_model: eligibility.workflow_model
          ? {
              production_state: eligibility.workflow_model.production_state || null,
              publication_state: eligibility.workflow_model.publication_state || null,
              current_draft_id: Number(eligibility.workflow_model.current_draft_id || 0) || null,
              current_review_report_id: Number(eligibility.workflow_model.current_review_report_id || 0) || null,
              current_field_pack_id: Number(eligibility.workflow_model.current_field_pack_id || 0) || null,
            }
          : null,
        linked_asset_ids: linkedAssetIds,
      });
      db.prepare("DELETE FROM content_items WHERE id=?").run(id);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw error;
    }

    return {
      ok: true,
      item_id: id,
      deleted_asset_ids: [...new Set(linkedAssetIds)],
      snapshot: eligibility.item,
    };
  }

  function bulkDeleteItems(hardItemIds = [], softItemIds = [], actorEmail = "system@local") {
    const hardIds = Array.isArray(hardItemIds)
      ? hardItemIds.map((id) => Number(id || 0)).filter((id) => id > 0)
      : [];
    const softIds = Array.isArray(softItemIds)
      ? softItemIds.map((id) => Number(id || 0)).filter((id) => id > 0)
      : [];

    const linkedAssetIds = [];

    return runInTransaction(db, () => {
      const deletedIds = [];

      for (const id of hardIds) {
        const eligibility = getRawOnlyHardDeleteEligibility(id);
        if (!eligibility?.eligible || !eligibility?.item) {
          const err = new Error("item is not eligible for raw-only hard delete");
          err.statusCode = 409;
          err.eligibility = eligibility;
          throw err;
        }

        const assetIds = db.prepare("SELECT asset_id FROM content_assets WHERE content_item_id=?").all(id)
          .map((row) => Number(row?.asset_id || 0) || 0)
          .filter((value) => value > 0);

        linkedAssetIds.push(...assetIds);

        logAudit(actorEmail, "item.hard_delete_raw", "content_item", String(id), {
          snapshot: {
            id,
            item_uid: eligibility.item.item_uid || null,
            title: eligibility.item.title || null,
            type: eligibility.item.type || null,
            category: eligibility.item.category || null,
            workflow_status: eligibility.item.workflow_status || null,
          },
          workflow_model: eligibility.workflow_model
            ? {
                production_state: eligibility.workflow_model.production_state || null,
                publication_state: eligibility.workflow_model.publication_state || null,
                current_draft_id: Number(eligibility.workflow_model.current_draft_id || 0) || null,
                current_review_report_id: Number(eligibility.workflow_model.current_review_report_id || 0) || null,
                current_field_pack_id: Number(eligibility.workflow_model.current_field_pack_id || 0) || null,
              }
            : null,
          linked_asset_ids: assetIds,
        });

        db.prepare("DELETE FROM content_items WHERE id=?").run(id);
        deletedIds.push(id);
      }

      for (const id of softIds) {
        softDeleteStmt.run(id);
        logAudit(actorEmail, "item.delete", "content_item", String(id), null);
        deletedIds.push(id);
      }

      return {
        deleted_ids: deletedIds,
        deleted_asset_ids: [...new Set(linkedAssetIds)],
      };
    });
  }

  function updateItemsCategory(ids = [], category = "", actorEmail = "system@local") {
    const normalizedCategory = String(category || "").trim().toLowerCase();
    const itemIds = Array.isArray(ids)
      ? ids.map((id) => Number(id || 0)).filter((id) => id > 0)
      : [];
    if (!normalizedCategory || !itemIds.length) return 0;

    for (const id of itemIds) {
      updateItemCategoryStmt.run(normalizedCategory, id);
      logAudit(actorEmail, "item.bulk_update_category", "content_item", String(id), { category: normalizedCategory });
    }
    return itemIds.length;
  }

  function replaceQualityChecks(contentItemId, checks = []) {
    clearQualityStmt.run(contentItemId);
    for (const check of checks) {
      insertQualityStmt.run(contentItemId, check.check_name, check.status, check.reason || null);
    }
  }

  function listQualityChecks() {
    const stmt = db.prepare(`
      SELECT q.*, c.title, wm.production_state, wm.publication_state
      FROM quality_checks q
      JOIN content_items c ON c.id = q.content_item_id
      LEFT JOIN content_workflow_models wm ON wm.content_item_id = c.id
      WHERE c.is_deleted=0
      ORDER BY q.id DESC
    `);
    return stmt.all().map((row) => ({
      ...row,
      workflow_head_derived_status: deriveWorkflowStatusFromRowStates(row),
      workflow_head_status_source: "workflow_head",
    }));
  }

  function setWorkflowStatus(ids = [], status = "raw") {
    if (!ids.length) return;
    const placeholders = ids.map(() => "?").join(",");
    const stmt = db.prepare(`UPDATE content_items SET workflow_status=?, updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND is_deleted=0`);
    stmt.run(status, ...ids);
  }

  function withCanonicalWorkflowStatusSeed(itemInput = {}, workflowPatch = {}) {
    const payload = itemInput && typeof itemInput === "object" ? { ...itemInput } : {};
    if (Object.prototype.hasOwnProperty.call(payload, "workflow_status")) {
      return payload;
    }
    const derivedWorkflowStatus = deriveWorkflowStatusSeedFromPatch(workflowPatch);
    if (!derivedWorkflowStatus) {
      return payload;
    }
    payload.workflow_status = derivedWorkflowStatus;
    return payload;
  }

function normalizeStateValue(value, stateGroup) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return "";
    if (stateGroup === "production") return PRODUCTION_STATES.has(normalized) ? normalized : "";
    if (stateGroup === "publication") return PUBLICATION_STATES.has(normalized) ? normalized : "";
    if (stateGroup === "assignment") return ASSIGNMENT_STATES.has(normalized) ? normalized : "";
    return "";
  }

  function canTransition(stateGroup, fromState, toState) {
    if (!STATE_GROUPS.has(stateGroup)) return false;
    if (!toState) return false;
    if (!fromState) return true;
    if (fromState === toState) return true;
    const rulesForGroup = TRANSITION_RULES[stateGroup];
    const allowed = rulesForGroup?.[fromState];
    if (!allowed) return false;
    return allowed.has(toState);
  }

  function assertValidTransition(stateGroup, fromState, toState) {
    if (!canTransition(stateGroup, fromState, toState)) {
      throw new Error(`invalid ${stateGroup} transition: ${String(fromState || "null")} -> ${String(toState || "null")}`);
    }
  }

  function recordWorkflowTransition(contentItemId, stateGroup, fromState, toState, actorEmail, actorRole, reasonCode, note, metadata = {}) {
    const assignmentId = metadata?.assignment_id == null ? null : Number(metadata.assignment_id || 0) || null;
    const createdAt = toBangkokSqlTimestamp();
    insertWorkflowTransitionStmt.run(
      Number(contentItemId || 0),
      assignmentId,
      stateGroup,
      fromState || null,
      toState || null,
      actorEmail || null,
      actorRole || null,
      reasonCode || null,
      note || null,
      createdAt
    );
  }

  function buildWorkflowHeadDefaults(contentItemId, workflowStatus = "raw") {
    const itemId = Number(contentItemId || 0);
    const legacyStates = mapWorkflowStatusToModelStates(workflowStatus || "raw");
    const latestDraft = latestDraftByItemStmt.get(itemId);
    const latestReview = latestReviewByItemStmt.get(itemId);
    const currentFieldPack = getCurrentFieldPackByItemStmt.get(itemId);
    const latestTransition = latestWorkflowTransitionByItemStmt.get(itemId);
    const draftCount = Number(countDraftsByItemStmt.get(itemId)?.c || 0);
    const reviewCount = Number(countReviewsByItemStmt.get(itemId)?.c || 0);
    const fieldPackCount = Number(countFieldPacksByItemStmt.get(itemId)?.c || 0);
    const transitionCount = Number(countWorkflowTransitionsByItemStmt.get(itemId)?.c || 0);
    return {
      production_state: legacyStates.production_state,
      publication_state: legacyStates.publication_state,
      assignment_state: null,
      current_draft_id: Number(latestDraft?.id || 0) || null,
      current_review_report_id: Number(latestReview?.id || 0) || null,
      current_field_pack_id: Number(currentFieldPack?.id || 0) || null,
      state_version: Math.max(1, transitionCount || 1),
      content_version: Math.max(draftCount, reviewCount, fieldPackCount, 0),
      last_actor_email: String(latestTransition?.actor_email || "").trim() || null,
      last_transition_at: String(latestTransition?.created_at || "").trim() || null,
      last_transition_note: null,
      updated_by: "system@local",
    };
  }

  function buildWorkflowHeadPayload(previous, payload = {}, actor = "system@local", metadata = {}) {
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(payload || {}, key);
    const resolvePointer = (key, previousValue) => {
      if (!hasOwn(key)) return Number(previousValue || 0) || null;
      const value = payload[key];
      if (value == null || value === "") return null;
      return Number(value || 0) || null;
    };
    const contentVersion = payload.content_version == null || payload.content_version === ""
      ? Math.max(0, Number(previous?.content_version || 0) || 0)
      : Math.max(0, Number(payload.content_version || 0) || 0);
    const stateVersion = payload.state_version == null || payload.state_version === ""
      ? Math.max(1, Number(previous?.state_version || 0) || 1)
      : Math.max(1, Number(payload.state_version || 0) || 1);
    const lastActorEmail = payload.last_actor_email == null
      ? (String(actor || "").trim() || previous?.last_actor_email || null)
      : (String(payload.last_actor_email || "").trim() || null);
    const explicitTransitionTime = payload.last_transition_at == null
      ? null
      : (String(payload.last_transition_at || "").trim() || null);
    return {
      production_state: payload.production_state,
      publication_state: payload.publication_state,
      assignment_state: payload.assignment_state,
      current_draft_id: resolvePointer("current_draft_id", previous?.current_draft_id),
      current_review_report_id: resolvePointer("current_review_report_id", previous?.current_review_report_id),
      current_field_pack_id: resolvePointer("current_field_pack_id", previous?.current_field_pack_id),
      state_version: stateVersion,
      content_version: contentVersion,
      last_actor_email: lastActorEmail,
      last_transition_at: explicitTransitionTime || previous?.last_transition_at || null,
      last_transition_note: payload.last_transition_note == null
        ? (previous?.last_transition_note || null)
        : (String(payload.last_transition_note || "").trim() || null),
      updated_by: String(actor || "").trim() || "system@local",
      should_bump_state_version: metadata?.bump_state_version === true,
      should_bump_content_version: metadata?.bump_content_version === true,
    };
  }

  function reconcileLegacyWorkflowStatusMirror(contentItemId, nextModel, actor = "system@local", metadata = {}) {
    const itemId = Number(contentItemId || 0) || 0;
    if (!itemId || !nextModel) return;
    const item = getItem(itemId);
    if (!item) return;
    const currentWorkflowStatus = String(item?.workflow_status || "raw").trim().toLowerCase();
    const derivedWorkflowStatus = deriveWorkflowStatusFromModel(nextModel);
    if (currentWorkflowStatus === derivedWorkflowStatus) return;
    setWorkflowStatus([itemId], derivedWorkflowStatus);
    const reasonCode = String(metadata?.reason_code || "").trim().toLowerCase() || "workflow_status_reconciled";
    logAudit(actor, "workflow_status.reconcile", "content_item", String(itemId), {
      reason_code: reasonCode,
      source_workflow_status: currentWorkflowStatus || null,
      derived_workflow_status: derivedWorkflowStatus,
      production_state: nextModel?.production_state || null,
      publication_state: nextModel?.publication_state || null,
    });
  }

  function createWorkflowHead(contentItemId, payload = {}, actor = "system@local", metadata = {}) {
    const id = Number(contentItemId || 0);
    if (!id) throw new Error("contentItemId is required");
    const existing = getWorkflowModelByItemStmt.get(id);
    if (existing) return normalizeWorkflowModelRow(existing);
    const item = getItem(id);
    if (!item) throw new Error(`content item not found for workflow head: ${id}`);
    const seed = buildWorkflowHeadDefaults(id, item?.workflow_status || "raw");
    const productionState = normalizeStateValue(payload.production_state || seed.production_state, "production");
    const publicationState = normalizeStateValue(payload.publication_state || seed.publication_state, "publication");
    const assignmentStateRaw = payload.assignment_state ?? seed.assignment_state ?? null;
    const assignmentState = assignmentStateRaw == null || assignmentStateRaw === ""
      ? null
      : normalizeStateValue(assignmentStateRaw, "assignment");
    if (!productionState) throw new Error("invalid production_state");
    if (!publicationState) throw new Error("invalid publication_state");
    if (assignmentStateRaw != null && assignmentStateRaw !== "" && !assignmentState) throw new Error("invalid assignment_state");
    const nextPayload = buildWorkflowHeadPayload(seed, payload, actor, metadata);
    const actorRole = normalizeWorkflowActorRole(metadata.actor_role);
    const reasonCode = String(metadata.reason_code || "").trim().toLowerCase() || null;
    const createdAt = nextPayload.last_transition_at || toBangkokSqlTimestamp();
    upsertWorkflowModelStmt.run(
      id,
      productionState,
      publicationState,
      assignmentState,
      nextPayload.current_draft_id,
      nextPayload.current_review_report_id,
      nextPayload.current_field_pack_id,
      nextPayload.state_version,
      nextPayload.content_version,
      nextPayload.last_actor_email,
      createdAt,
      nextPayload.last_transition_note,
      nextPayload.updated_by
    );
    if (productionState) {
      recordWorkflowTransition(id, "production", null, productionState, actor, actorRole, reasonCode, nextPayload.last_transition_note);
    }
    if (publicationState) {
      recordWorkflowTransition(id, "publication", null, publicationState, actor, actorRole, reasonCode, nextPayload.last_transition_note);
    }
    if (assignmentState != null) {
      recordWorkflowTransition(id, "assignment", null, assignmentState, actor, actorRole, reasonCode, nextPayload.last_transition_note, {
        assignment_id: metadata?.assignment_id ?? null,
      });
    }
    const nextModel = normalizeWorkflowModelRow(getWorkflowModelByItemStmt.get(id));
    reconcileLegacyWorkflowStatusMirror(id, nextModel, actor, { reason_code: reasonCode });
    return nextModel;
  }

  function ensureWorkflowModel(contentItemId) {
    const id = Number(contentItemId || 0);
    if (!id) throw new Error("contentItemId is required");
    const existing = getWorkflowModelByItemStmt.get(id);
    if (existing) return normalizeWorkflowModelRow(existing);
    const item = getItem(id);
    if (!item) throw new Error(`content item not found for workflow head: ${id}`);
    throw new Error(`workflow head missing for item ${id}`);
  }

  function repairWorkflowHeadFromLegacy(contentItemId, actor = "system@local") {
    const id = Number(contentItemId || 0);
    if (!id) throw new Error("contentItemId is required");
    const existing = getWorkflowModelByItem(id);
    if (existing) return existing;
    const item = getItem(id);
    if (!item) throw new Error(`content item not found for workflow head: ${id}`);
    return createWorkflowHead(
      id,
      buildWorkflowHeadDefaults(id, item?.workflow_status || "raw"),
      actor,
      { actor_role: "system", reason_code: "workflow_head_repaired_from_legacy" }
    );
  }

  function upsertWorkflowModel(contentItemId, payload = {}, actor = "system@local", metadata = {}) {
    const id = Number(contentItemId || 0);
    if (!id) throw new Error("contentItemId is required");
    const previous = getWorkflowModelByItem(id);
    if (!previous) {
      throw new Error(`workflow head missing for item ${id}`);
    }
    const productionState = normalizeStateValue(payload.production_state || previous.production_state, "production");
    const publicationState = normalizeStateValue(payload.publication_state || previous.publication_state, "publication");
    const assignmentStateRaw = payload.assignment_state ?? previous.assignment_state ?? null;
    const assignmentState = assignmentStateRaw == null || assignmentStateRaw === ""
      ? null
      : normalizeStateValue(assignmentStateRaw, "assignment");
    if (!productionState) throw new Error("invalid production_state");
    if (!publicationState) throw new Error("invalid publication_state");
    if (assignmentStateRaw != null && assignmentStateRaw !== "" && !assignmentState) throw new Error("invalid assignment_state");
    const nextPayload = buildWorkflowHeadPayload(previous, payload, actor, metadata);
    const note = nextPayload.last_transition_note;
    const actorRole = normalizeWorkflowActorRole(metadata.actor_role);
    const reasonCode = String(metadata.reason_code || "").trim().toLowerCase() || null;
    const skipAssignmentTransitionValidation = metadata?.skip_assignment_transition_validation === true;
    const skipProductionTransitionValidation = metadata?.skip_production_transition_validation === true;
    const skipPublicationTransitionValidation = metadata?.skip_publication_transition_validation === true;

    if (productionState !== previous.production_state && !skipProductionTransitionValidation) {
      assertValidTransition("production", previous.production_state, productionState);
    }
    if (publicationState !== previous.publication_state && !skipPublicationTransitionValidation) {
      assertValidTransition("publication", previous.publication_state, publicationState);
    }
    if ((assignmentState || null) !== (previous.assignment_state || null) && assignmentState != null && !skipAssignmentTransitionValidation) {
      assertValidTransition("assignment", previous.assignment_state || null, assignmentState);
    }

    const stateChanged = productionState !== previous.production_state
      || publicationState !== previous.publication_state
      || (assignmentState || null) !== (previous.assignment_state || null);
    const stateVersion = nextPayload.should_bump_state_version
      ? Math.max(1, Number(previous?.state_version || 0) || 1) + 1
      : Math.max(1, Number(nextPayload.state_version || previous?.state_version || 1) || 1);
    const contentPointersChanged =
      Number(nextPayload.current_draft_id || 0) !== Number(previous?.current_draft_id || 0)
      || Number(nextPayload.current_review_report_id || 0) !== Number(previous?.current_review_report_id || 0)
      || Number(nextPayload.current_field_pack_id || 0) !== Number(previous?.current_field_pack_id || 0);
    const contentVersion = nextPayload.should_bump_content_version || contentPointersChanged
      ? Math.max(0, Number(previous?.content_version || 0) || 0) + 1
      : Math.max(0, Number(nextPayload.content_version || previous?.content_version || 0) || 0);
    const transitionTime = stateChanged
      ? toBangkokSqlTimestamp()
      : (nextPayload.last_transition_at || previous?.last_transition_at || null);

    upsertWorkflowModelStmt.run(
      id,
      productionState,
      publicationState,
      assignmentState,
      nextPayload.current_draft_id,
      nextPayload.current_review_report_id,
      nextPayload.current_field_pack_id,
      stateVersion,
      contentVersion,
      nextPayload.last_actor_email,
      transitionTime,
      note,
      nextPayload.updated_by
    );

    if (productionState !== previous.production_state) {
      recordWorkflowTransition(id, "production", previous.production_state, productionState, actor, actorRole, reasonCode, note);
    }
    if (publicationState !== previous.publication_state) {
      recordWorkflowTransition(id, "publication", previous.publication_state, publicationState, actor, actorRole, reasonCode, note);
    }
    if ((assignmentState || null) !== (previous.assignment_state || null) && assignmentState != null) {
      recordWorkflowTransition(id, "assignment", previous.assignment_state || null, assignmentState, actor, actorRole, reasonCode, note, {
        assignment_id: metadata?.assignment_id ?? null,
      });
    }
    const nextModel = normalizeWorkflowModelRow(getWorkflowModelByItemStmt.get(id));
    reconcileLegacyWorkflowStatusMirror(id, nextModel, actor, { reason_code: reasonCode });
    return nextModel;
  }

  function getWorkflowModelByItem(contentItemId) {
    return normalizeWorkflowModelRow(getWorkflowModelByItemStmt.get(Number(contentItemId || 0)));
  }

  function getWorkflowHeadByItem(contentItemId) {
    return getWorkflowModelByItem(contentItemId);
  }

  function syncWorkflowHeadPointers(contentItemId, actor = "system@local", metadata = {}) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("contentItemId is required");
    const previous = ensureWorkflowModel(itemId);
    const latestDraft = latestDraftByItem(itemId);
    const latestReview = latestReviewByItem(itemId);
    const currentFieldPack = getCurrentFieldPackByItem(itemId);
    return upsertWorkflowModel(
      itemId,
      {
        current_draft_id: Number(latestDraft?.id || 0) || null,
        current_review_report_id: Number(latestReview?.id || 0) || null,
        current_field_pack_id: Number(currentFieldPack?.id || 0) || null,
        last_transition_note: previous?.last_transition_note || null,
      },
      actor,
      {
        ...metadata,
        bump_content_version: metadata?.bump_content_version === true,
      }
    );
  }

  function backfillWorkflowHeads(actor = "system@local") {
    const items = listItems();
    let count = 0;
    for (const item of items) {
      const itemId = Number(item?.id || 0) || 0;
      if (!itemId) continue;
      const workflow = repairWorkflowHeadFromLegacy(itemId, actor);
      const latestDraft = latestDraftByItem(itemId);
      const latestReview = latestReviewByItem(itemId);
      const currentFieldPack = getCurrentFieldPackByItem(itemId);
      const transitionCount = Number(countWorkflowTransitionsByItemStmt.get(itemId)?.c || 0);
      const draftCount = Number(countDraftsByItemStmt.get(itemId)?.c || 0);
      const reviewCount = Number(countReviewsByItemStmt.get(itemId)?.c || 0);
      const fieldPackCount = Number(countFieldPacksByItemStmt.get(itemId)?.c || 0);
      const latestTransition = latestWorkflowTransitionByItemStmt.get(itemId);
      const next = upsertWorkflowModel(
        itemId,
        {
          current_draft_id: Number(latestDraft?.id || 0) || null,
          current_review_report_id: Number(latestReview?.id || 0) || null,
          current_field_pack_id: Number(currentFieldPack?.id || 0) || null,
          state_version: Math.max(1, Number(workflow?.state_version || 0) || transitionCount || 1),
          content_version: Math.max(
            Number(workflow?.content_version || 0) || 0,
            draftCount,
            reviewCount,
            fieldPackCount
          ),
          last_actor_email: String(workflow?.last_actor_email || latestTransition?.actor_email || actor).trim() || actor,
          last_transition_at: String(workflow?.last_transition_at || latestTransition?.created_at || "").trim() || null,
          last_transition_note: workflow?.last_transition_note || null,
        },
        actor,
        {
          actor_role: "system",
          reason_code: "workflow_head_backfill",
        }
      );
      if (next) count += 1;
    }
    return { count };
  }

  function listItemsByWorkflowHead(filters = {}) {
    const productionStates = Array.isArray(filters?.production_states)
      ? filters.production_states.map((value) => normalizeStateValue(value, "production")).filter(Boolean)
      : [];
    const publicationStates = Array.isArray(filters?.publication_states)
      ? filters.publication_states.map((value) => normalizeStateValue(value, "publication")).filter(Boolean)
      : [];
    const assignmentStates = Array.isArray(filters?.assignment_states)
      ? filters.assignment_states.map((value) => normalizeStateValue(value, "assignment")).filter(Boolean)
      : [];
    return listItems().filter((item) => {
      const head = getWorkflowModelByItem(item.id);
      if (!head) return false;
      if (productionStates.length && !productionStates.includes(String(head?.production_state || "").trim().toLowerCase())) {
        return false;
      }
      if (publicationStates.length && !publicationStates.includes(String(head?.publication_state || "").trim().toLowerCase())) {
        return false;
      }
      if (assignmentStates.length && !assignmentStates.includes(String(head?.assignment_state || "").trim().toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  function getWorkflowStateDriftByItem(contentItemId) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) return null;
    const item = getItem(itemId);
    if (!item) return null;
    const model = getWorkflowModelByItem(itemId);
    if (!model) {
      return {
        source_workflow_status: String(item.workflow_status || "raw").trim().toLowerCase() || "raw",
        derived_workflow_status: null,
        model_production_state: null,
        model_publication_state: null,
        mismatch_flags: {
          workflow_status_mismatch: true,
          workflow_head_missing: true,
        },
        has_drift: true,
      };
    }
    const sourceWorkflowStatus = String(item.workflow_status || "raw").trim().toLowerCase() || "raw";
    const derivedWorkflowStatus = deriveWorkflowStatusFromModel(model);
    const mismatch = sourceWorkflowStatus !== derivedWorkflowStatus;
    return {
      source_workflow_status: sourceWorkflowStatus,
      derived_workflow_status: derivedWorkflowStatus,
      model_production_state: model?.production_state || null,
      model_publication_state: model?.publication_state || null,
      mismatch_flags: {
        workflow_status_mismatch: mismatch,
      },
    };
  }

  function listWorkflowTransitionsByItem(contentItemId, limit = 50, filters = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const itemId = Number(contentItemId || 0);
    const stateGroup = String(filters?.state_group || "").trim().toLowerCase();
    const actorEmail = String(filters?.actor_email || "").trim().toLowerCase();
    const reasonCode = String(filters?.reason_code || "").trim().toLowerCase();
    const assignmentId = filters?.assignment_id == null ? null : Number(filters.assignment_id || 0) || null;
    if (stateGroup && !STATE_GROUPS.has(stateGroup)) {
      throw new Error("invalid state_group filter");
    }
    const clauses = ["content_item_id=?"];
    const params = [itemId];
    if (stateGroup) {
      clauses.push("state_group=?");
      params.push(stateGroup);
    }
    if (actorEmail) {
      clauses.push("LOWER(COALESCE(actor_email,''))=?");
      params.push(actorEmail);
    }
    if (reasonCode) {
      clauses.push("LOWER(COALESCE(reason_code,''))=?");
      params.push(reasonCode);
    }
    if (assignmentId != null) {
      clauses.push("assignment_id=?");
      params.push(assignmentId);
    }
    const sql = `
      SELECT *
      FROM content_workflow_transitions
      WHERE ${clauses.join(" AND ")}
      ORDER BY id DESC
      LIMIT ?
    `;
    params.push(safeLimit);
    return db.prepare(sql).all(...params);
  }

  function listWorkflowTransitionsByAssignment(assignmentId, limit = 50, filters = {}) {
    const id = Number(assignmentId || 0);
    if (!id) return [];
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const actorEmail = String(filters?.actor_email || "").trim().toLowerCase();
    const reasonCode = String(filters?.reason_code || "").trim().toLowerCase();
    const clauses = ["state_group='assignment'", "assignment_id=?"];
    const params = [id];
    if (actorEmail) {
      clauses.push("LOWER(COALESCE(actor_email,''))=?");
      params.push(actorEmail);
    }
    if (reasonCode) {
      clauses.push("LOWER(COALESCE(reason_code,''))=?");
      params.push(reasonCode);
    }
    const sql = `
      SELECT *
      FROM content_workflow_transitions
      WHERE ${clauses.join(" AND ")}
      ORDER BY id DESC
      LIMIT ?
    `;
    params.push(safeLimit);
    return db.prepare(sql).all(...params);
  }

  function listAuditByTarget(targetType, targetId, limit = 100, filters = {}) {
    const safeType = String(targetType || "").trim().toLowerCase();
    const safeId = String(targetId || "").trim();
    if (!safeType || !safeId) return [];
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const action = String(filters?.action || "").trim().toLowerCase();
    const actionPrefix = String(filters?.action_prefix || "").trim().toLowerCase();
    const actorEmail = String(filters?.actor_email || "").trim().toLowerCase();
    const assignmentId = filters?.assignment_id == null ? null : Number(filters.assignment_id || 0) || null;
    const clauses = ["target_type=?", "target_id=?"];
    const params = [safeType, safeId];
    if (action) {
      clauses.push("LOWER(COALESCE(action,''))=?");
      params.push(action);
    }
    if (actionPrefix) {
      clauses.push("LOWER(COALESCE(action,'')) LIKE ?");
      params.push(`${actionPrefix}%`);
    }
    if (actorEmail) {
      clauses.push("LOWER(COALESCE(actor_email,''))=?");
      params.push(actorEmail);
    }
    if (assignmentId != null) {
      clauses.push("assignment_id=?");
      params.push(assignmentId);
    }
    const sql = `
      SELECT *
      FROM audit_logs
      WHERE ${clauses.join(" AND ")}
      ORDER BY id DESC
      LIMIT ?
    `;
    params.push(safeLimit);
    return db.prepare(sql).all(...params).map((row) => ({
      ...row,
      details_json: parseJson(row.details_json, null),
    }));
  }

  function syncWorkflowAssignmentStateOnCreate(contentItemId, assignmentState, actorEmail = "system@local", metadata = {}) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) {
      return {
        applied: false,
        skipped_reason: "invalid_content_item_id",
      };
    }

    const workflow = ensureWorkflowModel(itemId);
    const existingState = normalizeStateValue(workflow?.assignment_state, "assignment");
    if (existingState) {
      return {
        applied: false,
        skipped_reason: "existing_assignment_state_preserved",
        from_state: existingState,
        to_state: existingState,
      };
    }

    const targetState = normalizeStateValue(assignmentState || "assigned", "assignment") || "assigned";
    const reasonCode = String(metadata?.reason_code || "").trim().toLowerCase() || WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC;
    const actorRole = normalizeWorkflowActorRole(metadata?.actor_role);
    const note = metadata?.note == null ? null : String(metadata.note || "").trim() || null;
    const model = upsertWorkflowModel(
      itemId,
      {
        assignment_state: targetState,
        last_transition_note: note || workflow?.last_transition_note || null,
      },
      String(actorEmail || "").trim() || "system@local",
      {
        actor_role: actorRole,
        reason_code: reasonCode,
        assignment_id: metadata?.assignment_id ?? null,
      }
    );

    return {
      applied: true,
      skipped_reason: null,
      from_state: existingState || null,
      to_state: model?.assignment_state || targetState,
      reason_code: reasonCode,
    };
  }

  function normalizeExternalAssigneeProfile(value, fallbackName = "", fallbackContact = "") {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const profile = {
      name: String(source.name || fallbackName || "").trim(),
      phone: String(source.phone || "").trim(),
      email: String(source.email || "").trim().toLowerCase(),
      line_id: String(source.line_id || "").trim(),
    };
    if (!profile.name) {
      return null;
    }
    if (!profile.phone && !profile.email && !profile.line_id) {
      const fallback = String(fallbackContact || "").trim();
      if (fallback) {
        if (fallback.startsWith("@")) {
          profile.line_id = fallback;
        } else if (fallback.includes("@")) {
          profile.email = fallback.toLowerCase();
        } else {
          profile.phone = fallback;
        }
      }
    }
    if (!profile.phone && !profile.email && !profile.line_id) {
      throw new Error("external assignee profile requires phone or email or line_id");
    }
    return profile;
  }

  function createAssignment(payload = {}, actorUserId = null, metadata = {}) {
    const contentItemId = Number(payload.content_item_id || 0);
    const assigneeUserId = Number(payload.assignee_user_id || 0);
    const assigneeName = payload.assignee_name == null ? null : String(payload.assignee_name || "").trim() || null;
    const assigneeContact = payload.assignee_contact == null ? null : String(payload.assignee_contact || "").trim() || null;
    const externalAssigneeProfileInput = payload.external_assignee_profile_json == null
      ? null
      : parseJsonInputStrict(payload.external_assignee_profile_json, "external_assignee_profile_json", "object");
    if (!contentItemId) throw new Error("content_item_id is required");
    if (!assigneeUserId && !assigneeName) throw new Error("assignee_user_id or assignee_name is required");
    const externalAssigneeProfile = assigneeUserId
      ? null
      : normalizeExternalAssigneeProfile(externalAssigneeProfileInput, assigneeName || "", assigneeContact || "");
    const effectiveAssigneeName = assigneeUserId
      ? null
      : String(externalAssigneeProfile?.name || assigneeName || "").trim() || null;
    const effectiveAssigneeContact = assigneeUserId
      ? null
      : String(
        assigneeContact
        || externalAssigneeProfile?.phone
        || externalAssigneeProfile?.email
        || externalAssigneeProfile?.line_id
        || ""
      ).trim() || null;
    if (!assigneeUserId && !effectiveAssigneeName) throw new Error("assignee_name is required for external assignee");
    if (!assigneeUserId && !effectiveAssigneeContact) throw new Error("assignee_contact is required for external assignee");
    const assignmentUid = String(payload.assignment_uid || randomUUID()).trim();
    const assignmentKind = normalizeAssignmentKindValue(payload.assignment_kind, "field");
    const state = normalizeStateValue(payload.state || "assigned", "assignment");
    if (!state) throw new Error("invalid assignment state");
    const dueAt = payload.due_at == null || payload.due_at === "" ? null : toNullableDateIso(payload.due_at, "due_at");
    const briefJson = payload.brief_json == null ? null : parseJsonInputStrict(payload.brief_json, "brief_json", "object");
    const requirementsJson = payload.requirements_json == null
      ? null
      : parseJsonInputStrict(payload.requirements_json, "requirements_json", "object");
    const contributorNote = payload.contributor_note == null ? null : String(payload.contributor_note || "").trim() || null;
    const internalNote = payload.internal_note == null ? null : String(payload.internal_note || "").trim() || null;

    insertAssignmentStmt.run(
      assignmentUid,
      contentItemId,
      assignmentKind,
      assigneeUserId || null,
      effectiveAssigneeName,
      effectiveAssigneeContact,
      externalAssigneeProfile ? JSON.stringify(externalAssigneeProfile) : null,
      actorUserId == null ? null : Number(actorUserId),
      state,
      briefJson ? JSON.stringify(briefJson) : null,
      requirementsJson ? JSON.stringify(requirementsJson) : null,
      dueAt,
      contributorNote,
      internalNote
    );
    const created = normalizeAssignmentRow(getAssignmentByUidStmt.get(assignmentUid));
    const workflowSync = syncWorkflowAssignmentStateOnCreate(
      contentItemId,
      created?.state || state,
      String(metadata?.actor_email || "").trim() || "system@local",
      {
        actor_role: metadata?.actor_role,
        reason_code: metadata?.reason_code || WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC,
        note: metadata?.note || null,
        assignment_id: created?.id || null,
      }
    );
    return {
      ...created,
      workflow_sync: workflowSync,
    };
  }

  function getAssignmentById(assignmentId) {
    return normalizeAssignmentRow(getAssignmentByIdStmt.get(Number(assignmentId || 0)));
  }

  function setAssignmentLatestSubmission(assignmentId, submissionId) {
    const assignmentKey = Number(assignmentId || 0) || 0;
    const submissionKey = Number(submissionId || 0) || 0;
    if (!assignmentKey) throw new Error("assignment_id is required");
    if (!submissionKey) throw new Error("submission_id is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
    if (!assignment) throw new Error("assignment not found");
    const submission = normalizeAssignmentSubmissionRow(getAssignmentSubmissionByIdStmt.get(submissionKey));
    if (!submission) throw new Error("submission not found");
    if (Number(submission.assignment_id || 0) !== assignmentKey) {
      throw new Error("submission does not belong to assignment");
    }
    attachLatestSubmissionToAssignmentStmt.run(submissionKey, assignmentKey);
    return normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
  }

  function listAssignmentsByItem(contentItemId) {
    return listAssignmentsByItemStmt.all(Number(contentItemId || 0)).map(normalizeAssignmentRow);
  }

  function listAssignmentsByAssignee(assigneeUserId, limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return listAssignmentsByAssigneeStmt.all(Number(assigneeUserId || 0), safeLimit).map(normalizeAssignmentRow);
  }

  function listAssignments(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return listAssignmentsStmt.all(safeLimit).map(normalizeAssignmentRow);
  }

  function listExternalAssignmentsByAssigner(assignerUserId, limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return listExternalAssignmentsByAssignerStmt.all(Number(assignerUserId || 0), safeLimit).map(normalizeAssignmentRow);
  }

  function updateAssignmentState(assignmentId, nextState, actorEmail = "system@local", payload = {}) {
    const id = Number(assignmentId || 0);
    const normalizedState = normalizeStateValue(nextState, "assignment");
    if (!id) throw new Error("assignmentId is required");
    if (!normalizedState) throw new Error("invalid assignment state");
    const existing = getAssignmentByIdStmt.get(id);
    if (!existing) throw new Error("assignment not found");
    const contributorNote = payload.contributor_note == null ? null : String(payload.contributor_note || "").trim() || null;
    const internalNote = payload.internal_note == null ? null : String(payload.internal_note || "").trim() || null;
    const actorRole = normalizeWorkflowActorRole(payload.actor_role);
    const reasonCode = payload.reason_code == null ? null : String(payload.reason_code || "").trim().toLowerCase() || null;
    const existingAssignmentState = String(existing.state || "").toLowerCase();
    if (existingAssignmentState === normalizedState) {
      return normalizeAssignmentRow(existing);
    }
    assertValidTransition("assignment", existingAssignmentState, normalizedState);
    const workflow = ensureWorkflowModel(Number(existing.content_item_id));
    const workflowAssignmentState = normalizeStateValue(workflow?.assignment_state, "assignment") || null;
    const shouldSyncWorkflow = workflowAssignmentState !== normalizedState;
    const canSyncViaTransition = shouldSyncWorkflow ? canTransition("assignment", workflowAssignmentState, normalizedState) : true;
    const shouldIncrementRevision = normalizedState === "revision_requested" ? 1 : 0;
    const shouldSetAcceptedAt = normalizedState === "accepted" ? 1 : 0;
    const wasAcceptedLifecycle = existingAssignmentState === "accepted" || existingAssignmentState === "closed";
    const isAcceptedLifecycle = normalizedState === "accepted" || normalizedState === "closed";
    const shouldClearAcceptedAt = wasAcceptedLifecycle && !isAcceptedLifecycle ? 1 : 0;
    updateAssignmentStateStmt.run(
      normalizedState,
      contributorNote,
      internalNote,
      shouldIncrementRevision,
      shouldSetAcceptedAt,
      shouldClearAcceptedAt,
      id
    );
    if (shouldSyncWorkflow) {
      upsertWorkflowModel(
        Number(existing.content_item_id),
        {
          assignment_state: normalizedState,
          last_transition_note: internalNote || contributorNote || workflow?.last_transition_note || null,
        },
        actorEmail,
        {
          actor_role: actorRole,
          reason_code: reasonCode || (canSyncViaTransition
            ? WORKFLOW_REASON_CODES.ASSIGNMENT_STATE_SYNC
            : WORKFLOW_REASON_CODES.ASSIGNMENT_STATE_RECONCILE_SYNC),
          assignment_id: id,
          skip_assignment_transition_validation: !canSyncViaTransition,
        }
      );
    }
    return normalizeAssignmentRow(getAssignmentByIdStmt.get(id));
  }

  function updateAssignmentMediaResetPolicy(assignmentId, payload = {}) {
    const id = Number(assignmentId || 0) || 0;
    if (!id) throw new Error("assignmentId is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(id));
    if (!assignment) throw new Error("assignment not found");
    const imageResetRequired = payload.image_reset_required == null
      ? Number(assignment.image_reset_required ? 1 : 0)
      : Number(payload.image_reset_required ? 1 : 0);
    const videoResetRequired = payload.video_reset_required == null
      ? Number(assignment.video_reset_required ? 1 : 0)
      : Number(payload.video_reset_required ? 1 : 0);
    const imageResetReason = payload.image_reset_reason == null
      ? (assignment.image_reset_reason == null ? null : String(assignment.image_reset_reason || "").trim() || null)
      : String(payload.image_reset_reason || "").trim() || null;
    const videoResetReason = payload.video_reset_reason == null
      ? (assignment.video_reset_reason == null ? null : String(assignment.video_reset_reason || "").trim() || null)
      : String(payload.video_reset_reason || "").trim() || null;
    updateAssignmentMediaResetPolicyStmt.run(
      imageResetRequired,
      imageResetReason,
      videoResetRequired,
      videoResetReason,
      id
    );
    return normalizeAssignmentRow(getAssignmentByIdStmt.get(id));
  }

  function listAssignmentRoundAssetsByType(assignmentId, assignmentRound, mediaType) {
    const id = Number(assignmentId || 0) || 0;
    const round = Math.max(0, Number(assignmentRound || 0) || 0);
    const type = String(mediaType || "").trim().toLowerCase();
    if (!id || !round || !["image", "video"].includes(type)) return [];
    return listAssignmentRoundAssetsByTypeStmt.all(id, round, type).map((row) => ({
      content_asset_id: Number(row.content_asset_id || 0) || 0,
      asset_id: Number(row.asset_id || 0) || 0,
      content_item_id: Number(row.content_item_id || 0) || 0,
      assignment_id: Number(row.assignment_id || 0) || 0,
      assignment_round: Number(row.assignment_round || 0) || 0,
      assignment_media_type: String(row.assignment_media_type || "").trim().toLowerCase() || null,
      file_name: String(row.file_name || "").trim() || null,
      storage_disk: String(row.storage_disk || "").trim() || null,
      storage_path: String(row.storage_path || "").trim() || null,
      mime_type: String(row.mime_type || "").trim().toLowerCase() || null,
      size_bytes: Number(row.size_bytes || 0) || 0,
    }));
  }

  function requestAssignmentRevisionWithReset(assignmentId, actorEmail = "system@local", payload = {}) {
    const id = Number(assignmentId || 0) || 0;
    if (!id) throw new Error("assignmentId is required");
    const imageResetRequired = Number(payload.image_reset_required ? 1 : 0);
    const videoResetRequired = Number(payload.video_reset_required ? 1 : 0);
    const imageResetReason = String(payload.image_reset_reason || "").trim() || null;
    const videoResetReason = String(payload.video_reset_reason || "").trim() || null;
    if (imageResetRequired && !imageResetReason) {
      throw new Error("image_reset_reason is required when image_reset_required=true");
    }
    if (videoResetRequired && !videoResetReason) {
      throw new Error("video_reset_reason is required when video_reset_required=true");
    }
    const contributorNote = payload.contributor_note == null ? null : String(payload.contributor_note || "").trim() || null;
    const internalNote = payload.internal_note == null ? null : String(payload.internal_note || "").trim() || null;
    const actorRole = normalizeWorkflowActorRole(payload.actor_role);
    const reasonCode = payload.reason_code == null ? null : String(payload.reason_code || "").trim().toLowerCase() || null;

    const run = () => runInTransaction(db, () => {
      const current = normalizeAssignmentRow(getAssignmentByIdStmt.get(id));
      if (!current) throw new Error("assignment not found");
      const roundBeforeRevision = Math.max(1, (Number(current.revision_round || 0) || 0) + 1);
      updateAssignmentMediaResetPolicyStmt.run(
        imageResetRequired,
        imageResetReason,
        videoResetRequired,
        videoResetReason,
        id
      );
      const assignment = updateAssignmentState(id, "revision_requested", actorEmail, {
        contributor_note: contributorNote,
        internal_note: internalNote,
        actor_role: actorRole,
        reason_code: reasonCode,
      });
      const imageDeleteResult = imageResetRequired
        ? deleteAssignmentRoundAssetsByType(id, roundBeforeRevision, "image")
        : { removed_content_assets: 0, removed_assets: 0, deleted_files: [] };
      const videoDeleteResult = videoResetRequired
        ? deleteAssignmentRoundAssetsByType(id, roundBeforeRevision, "video")
        : { removed_content_assets: 0, removed_assets: 0, deleted_files: [] };
      const deletedFiles = []
        .concat(Array.isArray(imageDeleteResult?.deleted_files) ? imageDeleteResult.deleted_files : [])
        .concat(Array.isArray(videoDeleteResult?.deleted_files) ? videoDeleteResult.deleted_files : []);
      return {
        assignment,
        round_before_revision: roundBeforeRevision,
        reset_policy: {
          image_reset_required: imageResetRequired === 1,
          image_reset_reason: imageResetReason,
          video_reset_required: videoResetRequired === 1,
          video_reset_reason: videoResetReason,
        },
        deletion_results: {
          image: imageDeleteResult,
          video: videoDeleteResult,
        },
        deleted_files: deletedFiles,
      };
    });
    return run();
  }

  function deleteAssignmentRoundAssetsByType(assignmentId, assignmentRound, mediaType) {
    const rows = listAssignmentRoundAssetsByType(assignmentId, assignmentRound, mediaType);
    if (!rows.length) return { removed_content_assets: 0, removed_assets: 0, deleted_files: [] };
    const deletedFiles = [];
    let removedContentAssets = 0;
    let removedAssets = 0;
    for (const row of rows) {
      if (row.content_asset_id) {
        const contentAssetResult = deleteContentAssetByIdStmt.run(row.content_asset_id);
        removedContentAssets += Number(contentAssetResult?.changes || 0) || 0;
      }
      if (row.asset_id) {
        const links = Number(countAssetLinksStmt.get(row.asset_id)?.c || 0) || 0;
        if (!links) {
          const assetResult = deleteAssetByIdStmt.run(row.asset_id);
          const deleted = Number(assetResult?.changes || 0) || 0;
          removedAssets += deleted;
          if (deleted > 0 && row.storage_path && String(row.storage_disk || "").trim().toLowerCase() === "local") {
            deletedFiles.push(String(row.storage_path || "").trim());
          }
        }
      }
    }
    return {
      removed_content_assets: removedContentAssets,
      removed_assets: removedAssets,
      deleted_files: deletedFiles,
    };
  }

  function addAssignmentSubmission(payload = {}) {
    const assignmentId = Number(payload.assignment_id || 0);
    const submittedByUserId = Number(payload.submitted_by_user_id || 0);
    if (!assignmentId) throw new Error("assignment_id is required");
    if (!submittedByUserId) throw new Error("submitted_by_user_id is required");
    const assignment = getAssignmentByIdStmt.get(assignmentId);
    if (!assignment) throw new Error("assignment not found");
    const submissionState = normalizeSubmissionStateValue(payload.submission_state || "submitted");
    if (!submissionState) throw new Error("invalid submission_state");
    const currentAssignmentState = String(assignment.state || "").trim().toLowerCase();
    if (["submitted", "resubmitted"].includes(currentAssignmentState)) {
      throw new Error("duplicate submission is not allowed before reviewer action");
    }
    if (!["assigned", "in_progress", "revision_requested"].includes(currentAssignmentState)) {
      throw new Error(`assignment is not accepting submissions from state=${currentAssignmentState || "unknown"}`);
    }
    if (submissionState === "resubmitted" && currentAssignmentState !== "revision_requested") {
      throw new Error("resubmitted is allowed only when assignment is revision_requested");
    }
    if (submissionState === "submitted" && currentAssignmentState === "revision_requested") {
      throw new Error("use resubmitted when assignment is revision_requested");
    }
    const articlePayload = payload.article_payload_json == null ? null : parseJsonInputStrict(payload.article_payload_json, "article_payload_json", "object");
    const mediaPayload = payload.media_payload_json == null ? null : parseJsonInputStrict(payload.media_payload_json, "media_payload_json", "object");
    const fieldReturnPayload = payload.field_return_payload_json == null
      ? null
      : normalizeFieldReturnPayloadJson(
        parseJsonInputStrict(payload.field_return_payload_json, "field_return_payload_json", "object"),
        "field_return_payload_json"
      );
    const contributorNote = payload.contributor_note == null ? null : String(payload.contributor_note || "").trim() || null;
    const reviewerNote = payload.reviewer_note == null ? null : String(payload.reviewer_note || "").trim() || null;
    const reviewedAt = payload.reviewed_at == null || payload.reviewed_at === "" ? null : toNullableDateIso(payload.reviewed_at, "reviewed_at");

    if (submissionState === "resubmitted") {
      const latestSubmissionId = Number(assignment.latest_submission_id || 0) || null;
      const latestSubmission = latestSubmissionId
        ? normalizeAssignmentSubmissionRow(getAssignmentSubmissionByIdStmt.get(latestSubmissionId))
        : null;
      if (latestSubmission && Number(latestSubmission.assignment_id || 0) === assignmentId) {
        const updatedAt = toBangkokSqlTimestamp();
        const nextArticlePayload = articlePayload == null
          ? latestSubmission.article_payload_json
          : mergeAssignmentSubmissionObjectPayload(latestSubmission.article_payload_json, articlePayload);
        const nextMediaPayload = mediaPayload == null
          ? latestSubmission.media_payload_json
          : mergeAssignmentSubmissionMediaPayload(latestSubmission.media_payload_json, mediaPayload);
        const nextFieldReturnPayload = fieldReturnPayload == null
          ? latestSubmission.field_return_payload_json
          : fieldReturnPayload;
        updateAssignmentSubmissionStmt.run(
          submittedByUserId,
          submissionState,
          nextArticlePayload ? JSON.stringify(nextArticlePayload) : null,
          nextMediaPayload ? JSON.stringify(nextMediaPayload) : null,
          nextFieldReturnPayload ? JSON.stringify(nextFieldReturnPayload) : null,
          contributorNote,
          reviewerNote,
          reviewedAt,
          updatedAt,
          latestSubmissionId
        );
        setAssignmentLatestSubmission(assignmentId, latestSubmissionId);
        return normalizeAssignmentSubmissionRow(
          db.prepare("SELECT * FROM content_assignment_submissions WHERE id=? LIMIT 1").get(latestSubmissionId)
        );
      }
    }

    const createdAt = toBangkokSqlTimestamp();
    const res = insertAssignmentSubmissionStmt.run(
      assignmentId,
      Number(assignment.content_item_id),
      submittedByUserId,
      submissionState,
      articlePayload ? JSON.stringify(articlePayload) : null,
      mediaPayload ? JSON.stringify(mediaPayload) : null,
      fieldReturnPayload ? JSON.stringify(fieldReturnPayload) : null,
      contributorNote,
      reviewerNote,
      createdAt,
      createdAt,
      reviewedAt
    );
    const submissionId = Number(res.lastInsertRowid || 0);
    setAssignmentLatestSubmission(assignmentId, submissionId);
    return normalizeAssignmentSubmissionRow(
      db.prepare("SELECT * FROM content_assignment_submissions WHERE id=? LIMIT 1").get(submissionId)
    );
  }

  function listAssignmentSubmissions(assignmentId) {
    return listAssignmentSubmissionsStmt.all(Number(assignmentId || 0)).map(normalizeAssignmentSubmissionRow);
  }

  function getAssignmentSubmissionById(submissionId) {
    return normalizeAssignmentSubmissionRow(getAssignmentSubmissionByIdStmt.get(Number(submissionId || 0)));
  }

  function upsertAssignmentSubmissionDraft(payload = {}) {
    const assignmentId = Number(payload.assignment_id || 0);
    const userId = Number(payload.user_id || 0);
    const expiresAtRaw = String(payload.expires_at || "").trim();
    if (!assignmentId) throw new Error("assignment_id is required");
    if (!userId) throw new Error("user_id is required");
    if (!expiresAtRaw) throw new Error("expires_at is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentId));
    if (!assignment) throw new Error("assignment not found");
    const revisionRound = Math.max(1, Number(payload.revision_round || assignment.revision_round + 1 || 1) || 1);
    const contentItemId = Number(assignment.content_item_id || 0) || 0;
    if (!contentItemId) throw new Error("assignment content_item_id is invalid");
    const articlePayload = payload.article_payload_json == null ? null : parseJsonInputStrict(payload.article_payload_json, "article_payload_json", "object");
    const expiresAt = toNullableDateIso(expiresAtRaw, "expires_at");
    if (!expiresAt) throw new Error("expires_at is required");
    upsertAssignmentSubmissionDraftStmt.run(
      assignmentId,
      userId,
      revisionRound,
      contentItemId,
      articlePayload ? JSON.stringify(articlePayload) : null,
      expiresAt
    );
    return normalizeAssignmentSubmissionDraftRow(getAssignmentSubmissionDraftStmt.get(assignmentId, userId, revisionRound));
  }

  function getAssignmentSubmissionDraft(assignmentId, userId, options = {}) {
    const id = Number(assignmentId || 0) || 0;
    const actorId = Number(userId || 0) || 0;
    if (!id || !actorId) return null;
    const nowIso = toNullableDateIso(options.now, "now") || new Date().toISOString();
    deleteExpiredAssignmentSubmissionDraftsStmt.run(nowIso);
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(id));
    if (!assignment) return null;
    const revisionRound = Math.max(1, Number(options.revision_round || assignment.revision_round + 1 || 1) || 1);
    const row = normalizeAssignmentSubmissionDraftRow(getAssignmentSubmissionDraftStmt.get(id, actorId, revisionRound));
    if (!row) return null;
    const expiresAt = String(row.expires_at || "").trim();
    if (!expiresAt) return null;
    if (new Date(expiresAt).getTime() < new Date(nowIso).getTime()) {
      deleteAssignmentSubmissionDraftStmt.run(id, actorId, revisionRound);
      return null;
    }
    return row;
  }

  function deleteAssignmentSubmissionDraft(assignmentId, userId, revisionRound = 0) {
    const id = Number(assignmentId || 0) || 0;
    const actorId = Number(userId || 0) || 0;
    const round = Math.max(1, Number(revisionRound || 0) || 0);
    if (!id || !actorId || !round) return 0;
    const result = deleteAssignmentSubmissionDraftStmt.run(id, actorId, round);
    return Number(result?.changes || 0) || 0;
  }

  function deleteAssignmentSubmissionDraftsByAssignment(assignmentId, revisionRound = 0) {
    const id = Number(assignmentId || 0) || 0;
    const round = Math.max(1, Number(revisionRound || 0) || 0);
    if (!id || !round) return 0;
    const result = deleteAssignmentSubmissionDraftsByAssignmentRoundStmt.run(id, round);
    return Number(result?.changes || 0) || 0;
  }

  function getAssignmentSubmissionDraftPrefill(assignmentId, userId, options = {}) {
    const id = Number(assignmentId || 0) || 0;
    const actorId = Number(userId || 0) || 0;
    if (!id || !actorId) return { draft: null, source: "none" };
    const nowIso = toNullableDateIso(options.now, "now") || new Date().toISOString();
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(id));
    if (!assignment) return { draft: null, source: "none" };
    const revisionRound = Math.max(1, Number(options.revision_round || assignment.revision_round + 1 || 1) || 1);
    const draft = getAssignmentSubmissionDraft(id, actorId, { now: nowIso, revision_round: revisionRound });
    if (draft) return { draft, source: "draft" };
    const assignmentState = String(assignment.state || "").trim().toLowerCase();
    if (assignmentState !== "revision_requested") return { draft: null, source: "none" };
    const latestSubmission = normalizeAssignmentSubmissionRow(
      getAssignmentSubmissionByIdStmt.get(Number(assignment.latest_submission_id || 0) || 0)
    );
    if (!latestSubmission || Number(latestSubmission.assignment_id || 0) !== id) {
      return { draft: null, source: "none" };
    }
    const fallbackPayload = latestSubmission.article_payload_json && typeof latestSubmission.article_payload_json === "object"
      ? latestSubmission.article_payload_json
      : null;
    if (!fallbackPayload) return { draft: null, source: "none" };
    return {
      draft: {
        id: null,
        assignment_id: id,
        user_id: actorId,
        revision_round: revisionRound,
        content_item_id: Number(assignment.content_item_id || 0) || 0,
        article_payload_json: fallbackPayload,
        expires_at: null,
        created_at: null,
        updated_at: null,
      },
      source: "latest_submission_fallback",
    };
  }

  function purgeExpiredAssignmentSubmissionDrafts(nowValue = "") {
    const nowIso = toNullableDateIso(nowValue, "now") || new Date().toISOString();
    const result = deleteExpiredAssignmentSubmissionDraftsStmt.run(nowIso);
    return Number(result?.changes || 0) || 0;
  }

  function createAssignmentSubmissionDeliverable(payload = {}, actorEmail = "system@local") {
    const assignmentId = Number(payload.assignment_id || 0);
    const submissionId = Number(payload.submission_id || 0);
    if (!assignmentId) throw new Error("assignment_id is required");
    if (!submissionId) throw new Error("submission_id is required");

    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentId));
    if (!assignment) throw new Error("assignment not found");
    const submission = normalizeAssignmentSubmissionRow(getAssignmentSubmissionByIdStmt.get(submissionId));
    if (!submission) throw new Error("submission not found");
    if (Number(submission.assignment_id || 0) !== assignmentId) {
      throw new Error("submission does not belong to assignment");
    }
    const latestSubmissionId = Number(assignment.latest_submission_id || 0) || null;
    if (latestSubmissionId && latestSubmissionId !== submissionId) {
      throw new Error("submission is not latest for assignment");
    }

    const payloadContentItemId = payload.content_item_id == null ? null : Number(payload.content_item_id || 0);
    const contentItemId = payloadContentItemId || Number(assignment.content_item_id || 0);
    if (!contentItemId) throw new Error("content_item_id is required");
    if (contentItemId !== Number(assignment.content_item_id || 0) || contentItemId !== Number(submission.content_item_id || 0)) {
      throw new Error("content_item_id does not match assignment/submission");
    }

    const deliverableType = normalizeAssignmentDeliverableTypeValue(payload.deliverable_type);
    if (!deliverableType) throw new Error("invalid deliverable_type");
    const lang = normalizeExecutionLangValue(payload.lang || "th");
    if (!lang) throw new Error("invalid lang");
    const status = normalizeAssignmentDeliverableStatusValue(payload.status || "draft");
    if (!status) throw new Error("invalid deliverable status");

    const title = payload.title == null ? null : String(payload.title || "").trim() || null;
    const textContent = payload.text_content == null ? null : String(payload.text_content || "").trim() || null;
    const payloadJson = payload.payload_json == null ? null : parseJsonInputStrict(payload.payload_json, "payload_json", "any");
    const sourceAssetId = payload.source_asset_id == null || payload.source_asset_id === ""
      ? null
      : Number(payload.source_asset_id || 0);
    if (sourceAssetId != null && (!Number.isFinite(sourceAssetId) || sourceAssetId <= 0)) {
      throw new Error("source_asset_id must be a positive integer");
    }
    if (sourceAssetId != null) {
      const linkedContentAsset = getContentAssetWithAssetByItemAndAssetStmt.get(contentItemId, sourceAssetId);
      if (!linkedContentAsset) {
        throw new Error("source_asset_id does not belong to content item");
      }
      if (
        ASSIGNMENT_ASSET_BACKED_DELIVERABLE_TYPES.has(deliverableType)
        && !assetMimeMatchesDeliverableType(deliverableType, linkedContentAsset.mime_type)
      ) {
        throw new Error("source_asset_id mime_type does not match deliverable_type");
      }
    }
    const sourceUrl = payload.source_url == null ? null : String(payload.source_url || "").trim() || null;
    if (ASSIGNMENT_TEXT_LIKE_DELIVERABLE_TYPES.has(deliverableType) && !textContent && !sourceUrl) {
      throw new Error("text-like deliverables require text_content or source_url");
    }
    const createdBy = String(actorEmail || "").trim() || "system@local";

    if (ASSIGNMENT_TEXT_LIKE_DELIVERABLE_TYPES.has(deliverableType)) {
      const existing = normalizeAssignmentSubmissionDeliverableRow(
        findLatestAssignmentSubmissionDeliverableByTypeStmt.get(assignmentId, submissionId, deliverableType, lang)
      );
      if (existing) {
        updateAssignmentSubmissionDeliverableStmt.run(
          title,
          textContent,
          payloadJson ? JSON.stringify(payloadJson) : null,
          sourceAssetId,
          sourceUrl,
          status,
          Number(existing.id || 0)
        );
        return normalizeAssignmentSubmissionDeliverableRow(getAssignmentSubmissionDeliverableByIdStmt.get(Number(existing.id || 0)));
      }
    }

    const res = insertAssignmentSubmissionDeliverableStmt.run(
      assignmentId,
      submissionId,
      contentItemId,
      deliverableType,
      title,
      lang,
      textContent,
      payloadJson ? JSON.stringify(payloadJson) : null,
      sourceAssetId,
      sourceUrl,
      status,
      createdBy
    );
    const deliverableId = Number(res.lastInsertRowid || 0);
    return normalizeAssignmentSubmissionDeliverableRow(getAssignmentSubmissionDeliverableByIdStmt.get(deliverableId));
  }

  function listAssignmentSubmissionDeliverablesBySubmission(assignmentId, submissionId) {
    const assignmentKey = Number(assignmentId || 0);
    const submissionKey = Number(submissionId || 0);
    if (!assignmentKey) throw new Error("assignment_id is required");
    if (!submissionKey) throw new Error("submission_id is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
    if (!assignment) throw new Error("assignment not found");
    const submission = normalizeAssignmentSubmissionRow(getAssignmentSubmissionByIdStmt.get(submissionKey));
    if (!submission) throw new Error("submission not found");
    if (Number(submission.assignment_id || 0) !== assignmentKey) {
      throw new Error("submission does not belong to assignment");
    }
    return listAssignmentSubmissionDeliverablesBySubmissionStmt
      .all(assignmentKey, submissionKey)
      .map(normalizeAssignmentSubmissionDeliverableRow);
  }

  function listAssignmentSubmissionDeliverablesByAssignment(assignmentId) {
    const assignmentKey = Number(assignmentId || 0);
    if (!assignmentKey) throw new Error("assignment_id is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
    if (!assignment) throw new Error("assignment not found");
    return listAssignmentSubmissionDeliverablesByAssignmentStmt
      .all(assignmentKey)
      .map(normalizeAssignmentSubmissionDeliverableRow);
  }

  function summarizeAssignmentDeliverables(assignmentId, options = {}) {
    const assignmentKey = Number(assignmentId || 0);
    if (!assignmentKey) throw new Error("assignment_id is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
    if (!assignment) throw new Error("assignment not found");

    const allDeliverables = listAssignmentSubmissionDeliverablesByAssignment(assignmentKey);
    const fulfilledDeliverables = allDeliverables.filter((row) => isFulfilledAssignmentDeliverableStatus(row?.status));
    const latestSubmissionId = Number(assignment.latest_submission_id || 0) || null;
    const latestSubmissionDeliverables = latestSubmissionId
      ? fulfilledDeliverables.filter((row) => Number(row.submission_id || 0) === latestSubmissionId)
      : [];

    const expectedFromOverride = normalizeAssignmentDeliverableTypeList(options?.expected_deliverables ?? null);
    const expectedFromRequirements = normalizeAssignmentDeliverableTypeList(assignment?.requirements_json?.expected_deliverables);
    const expectedFromBrief = normalizeAssignmentDeliverableTypeList(assignment?.brief_json?.expected_deliverables);
    const handoff = getLatestAssignmentHandoffByAssignment(assignmentKey);
    const handoffPackage = handoff?.handoff_package_json && typeof handoff.handoff_package_json === "object"
      ? handoff.handoff_package_json
      : null;
    const expectedFromHandoff = normalizeAssignmentDeliverableTypeList(handoffPackage?.expected_deliverables);
    const derivedFallback = deriveExpectedDeliverablesFromHandoff(handoffPackage);

    const expectedDeliverables =
      expectedFromOverride.length > 0
        ? expectedFromOverride
        : expectedFromRequirements.length > 0
          ? expectedFromRequirements
          : expectedFromBrief.length > 0
            ? expectedFromBrief
            : expectedFromHandoff.length > 0
              ? expectedFromHandoff
              : derivedFallback;

    const submittedDeliverableTypes = normalizeAssignmentDeliverableTypeList(fulfilledDeliverables.map((row) => row?.deliverable_type));
    const latestSubmittedDeliverableTypes = normalizeAssignmentDeliverableTypeList(latestSubmissionDeliverables.map((row) => row?.deliverable_type));
    const missingDeliverableTypes = expectedDeliverables.filter((type) => !submittedDeliverableTypes.includes(type));
    const missingLatestSubmissionDeliverableTypes = expectedDeliverables.filter((type) => !latestSubmittedDeliverableTypes.includes(type));

    return {
      assignment_id: assignmentKey,
      content_item_id: Number(assignment.content_item_id || 0) || null,
      latest_submission_id: latestSubmissionId,
      expected_deliverables: expectedDeliverables,
      submitted_deliverable_types: submittedDeliverableTypes,
      latest_submission_deliverable_types: latestSubmittedDeliverableTypes,
      missing_deliverable_types: missingDeliverableTypes,
      missing_latest_submission_deliverable_types: missingLatestSubmissionDeliverableTypes,
      total_deliverables: allDeliverables.length,
      fulfilled_deliverables_count: fulfilledDeliverables.length,
      expected_count: expectedDeliverables.length,
      submitted_count: submittedDeliverableTypes.length,
      missing_count: missingDeliverableTypes.length,
      latest_submission_submitted_count: latestSubmittedDeliverableTypes.length,
      latest_submission_missing_count: missingLatestSubmissionDeliverableTypes.length,
      expectation_source: expectedFromOverride.length > 0
        ? "explicit_override"
        : expectedFromRequirements.length > 0
          ? "assignment_requirements"
          : expectedFromBrief.length > 0
            ? "assignment_brief"
            : expectedFromHandoff.length > 0
              ? "handoff_package"
              : "derived_fallback",
      handoff_snapshot_id: handoff?.id || null,
      handoff_guard_status: handoff?.guard_status || null,
    };
  }

  function evaluateAssignmentDeliverablesReadiness(assignmentId, options = {}) {
    const summary = summarizeAssignmentDeliverables(assignmentId, options);
    const expectedDeliverables = Array.isArray(summary?.expected_deliverables) ? summary.expected_deliverables : [];
    const submittedDeliverableTypes = Array.isArray(summary?.submitted_deliverable_types) ? summary.submitted_deliverable_types : [];
    const latestSubmittedDeliverableTypes = Array.isArray(summary?.latest_submission_deliverable_types)
      ? summary.latest_submission_deliverable_types
      : [];
    const assignmentLevelMissingDeliverableTypes = Array.isArray(summary?.missing_deliverable_types)
      ? summary.missing_deliverable_types
      : [];
    const missingDeliverableTypes = Array.isArray(summary?.missing_latest_submission_deliverable_types)
      ? summary.missing_latest_submission_deliverable_types
      : expectedDeliverables.filter((type) => !latestSubmittedDeliverableTypes.includes(type));
    const blockers = [];
    const reasonCodes = [];

    if (!summary?.latest_submission_id) {
      reasonCodes.push("latest_submission_missing");
      blockers.push({
        code: "latest_submission_missing",
        stage: "deliverable_readiness",
        message: "assignment does not have latest submission",
      });
    }

    if (expectedDeliverables.length === 0) {
      reasonCodes.push("expected_deliverables_not_defined");
      blockers.push({
        code: "expected_deliverables_not_defined",
        stage: "deliverable_readiness",
        message: "expected deliverables are not defined; readiness is conservative false",
      });
    }

    if (missingDeliverableTypes.length > 0) {
      reasonCodes.push("expected_deliverables_missing_latest_submission");
      blockers.push({
        code: "expected_deliverables_missing_latest_submission",
        stage: "deliverable_readiness",
        message: `latest submission is missing expected deliverables: ${missingDeliverableTypes.join(", ")}`,
      });
    }

    const readyForReview = Boolean(summary?.latest_submission_id)
      && expectedDeliverables.length > 0
      && missingDeliverableTypes.length === 0;

    return {
      assignment_id: Number(summary?.assignment_id || 0) || Number(assignmentId || 0),
      content_item_id: summary?.content_item_id || null,
      latest_submission_id: summary?.latest_submission_id || null,
      ready_for_review: readyForReview,
      expected_deliverables: expectedDeliverables,
      submitted_deliverable_types: submittedDeliverableTypes,
      latest_submission_deliverable_types: latestSubmittedDeliverableTypes,
      missing_deliverable_types: missingDeliverableTypes,
      blockers,
      reason_codes: dedupeStringList(reasonCodes),
      debug: {
        ready_logic_submission_scope: "latest_submission",
        expectation_source: summary?.expectation_source || null,
        total_deliverables: Number(summary?.total_deliverables || 0),
        expected_count: Number(summary?.expected_count || expectedDeliverables.length),
        submitted_count: Number(summary?.submitted_count || submittedDeliverableTypes.length),
        submitted_count_latest_submission: Number(summary?.latest_submission_submitted_count || latestSubmittedDeliverableTypes.length),
        missing_count: Number(summary?.latest_submission_missing_count || missingDeliverableTypes.length),
        assignment_level_missing_count: Number(summary?.missing_count || assignmentLevelMissingDeliverableTypes.length),
        assignment_level_missing_deliverable_types: assignmentLevelMissingDeliverableTypes,
      },
      summary,
    };
  }

  function getLatestAssignmentDeliverablesBundle(assignmentId, options = {}) {
    const assignmentKey = Number(assignmentId || 0);
    if (!assignmentKey) throw new Error("assignment_id is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
    if (!assignment) throw new Error("assignment not found");

    const summary = summarizeAssignmentDeliverables(assignmentKey, options);
    const latestSubmissionId = Number(summary?.latest_submission_id || 0) || null;
    const latestDeliverables = latestSubmissionId
      ? listAssignmentSubmissionDeliverablesBySubmission(assignmentKey, latestSubmissionId)
        .filter((row) => isFulfilledAssignmentDeliverableStatus(row?.status))
      : [];

  const availableDeliverableTypes = normalizeAssignmentDeliverableTypeList(latestDeliverables.map((row) => row?.deliverable_type));
  const expectedDeliverables = normalizeAssignmentDeliverableTypeList(summary?.expected_deliverables);
  const missingDeliverableTypes = expectedDeliverables.filter((type) => !availableDeliverableTypes.includes(type));
  const sourceAssetIds = Array.from(new Set(
    latestDeliverables
      .map((row) => Number(row?.source_asset_id || 0) || 0)
      .filter((value) => value > 0)
  ));
  const sourceAssetStoragePathById = new Map();
  if (sourceAssetIds.length) {
    const placeholders = sourceAssetIds.map(() => "?").join(", ");
    db.prepare(`SELECT id, storage_path FROM assets WHERE id IN (${placeholders})`)
      .all(...sourceAssetIds)
      .forEach((row) => {
        const assetId = Number(row?.id || 0) || 0;
        if (!assetId || sourceAssetStoragePathById.has(assetId)) return;
        sourceAssetStoragePathById.set(assetId, String(row?.storage_path || "").trim() || null);
      });
  }

  const deliverablesByType = {};
  for (const type of ASSIGNMENT_DELIVERABLE_TYPES) {
    deliverablesByType[type] = [];
  }
    for (const row of latestDeliverables) {
      const type = normalizeAssignmentDeliverableTypeValue(row?.deliverable_type);
      if (!type) continue;
      deliverablesByType[type].push({
        id: Number(row?.id || 0) || null,
        assignment_id: Number(row?.assignment_id || assignmentKey) || assignmentKey,
        submission_id: Number(row?.submission_id || 0) || latestSubmissionId,
        content_item_id: Number(row?.content_item_id || assignment?.content_item_id || 0) || null,
        deliverable_type: type,
        title: row?.title || null,
        lang: row?.lang || null,
        text_content: row?.text_content || null,
        payload_json: row?.payload_json || null,
        source_asset_id: row?.source_asset_id == null ? null : Number(row.source_asset_id || 0) || null,
        storage_path: sourceAssetStoragePathById.get(Number(row?.source_asset_id || 0) || 0) || null,
        source_url: row?.source_url || null,
        status: row?.status || null,
        created_by: row?.created_by || null,
        created_at: row?.created_at || null,
        updated_at: row?.updated_at || null,
      });
    }

    const textLikeDeliverables = {};
    for (const type of ASSIGNMENT_TEXT_LIKE_DELIVERABLE_TYPES) {
      if ((deliverablesByType[type] || []).length > 0) {
        textLikeDeliverables[type] = deliverablesByType[type];
      }
    }

    const assetBackedDeliverables = {};
    for (const type of ASSIGNMENT_ASSET_BACKED_DELIVERABLE_TYPES) {
      if ((deliverablesByType[type] || []).length > 0) {
        assetBackedDeliverables[type] = deliverablesByType[type];
      }
    }

    const reasonCodes = [];
    if (!latestSubmissionId) {
      reasonCodes.push("latest_submission_missing");
    }
    if (expectedDeliverables.length === 0) {
      reasonCodes.push("expected_deliverables_not_defined");
    }
    if (missingDeliverableTypes.length > 0) {
      reasonCodes.push("expected_deliverables_missing_latest_submission");
    }

    return {
      assignment_id: assignmentKey,
      content_item_id: Number(assignment.content_item_id || 0) || null,
      latest_submission_id: latestSubmissionId,
      expected_deliverables: expectedDeliverables,
      available_deliverable_types: availableDeliverableTypes,
      missing_deliverable_types: missingDeliverableTypes,
      deliverables_by_type: deliverablesByType,
      text_like_deliverables: {
        available_types: availableDeliverableTypes.filter((type) => ASSIGNMENT_TEXT_LIKE_DELIVERABLE_TYPES.has(type)),
        deliverables_by_type: textLikeDeliverables,
      },
      asset_backed_deliverables: {
        available_types: availableDeliverableTypes.filter((type) => ASSIGNMENT_ASSET_BACKED_DELIVERABLE_TYPES.has(type)),
        deliverables_by_type: assetBackedDeliverables,
      },
      source_trace: {
        latest_submission_id: latestSubmissionId,
        trace_mode: "latest_submission_only",
      },
      reason_codes: dedupeStringList(reasonCodes),
      debug: {
        latest_submission_deliverable_count: latestDeliverables.length,
        expectation_source: summary?.expectation_source || null,
      },
      summary,
    };
  }

  function evaluateAssignmentDeliverablesUtilityReadiness(assignmentId, options = {}) {
    const bundle = getLatestAssignmentDeliverablesBundle(assignmentId, options);
    const availableTypes = Array.isArray(bundle?.available_deliverable_types) ? bundle.available_deliverable_types : [];
    const missingTypes = Array.isArray(bundle?.missing_deliverable_types) ? bundle.missing_deliverable_types : [];
    const expectedTypes = Array.isArray(bundle?.expected_deliverables) ? bundle.expected_deliverables : [];
    const latestSubmissionId = Number(bundle?.latest_submission_id || 0) || null;
    const deliverablesByType = bundle?.deliverables_by_type && typeof bundle.deliverables_by_type === "object"
      ? bundle.deliverables_by_type
      : {};

    const blockers = [];
    const reasonCodes = [];

    if (!latestSubmissionId) {
      reasonCodes.push("latest_submission_missing");
      blockers.push({
        code: "latest_submission_missing",
        stage: "deliverable_utility_readiness",
        message: "assignment does not have latest submission",
      });
    }

    if (expectedTypes.length === 0) {
      reasonCodes.push("expected_deliverables_not_defined");
      blockers.push({
        code: "expected_deliverables_not_defined",
        stage: "deliverable_utility_readiness",
        message: "expected deliverables are not defined; handoff usability is conservative false",
      });
    }

    if (missingTypes.length > 0) {
      reasonCodes.push("expected_deliverables_missing_latest_submission");
      blockers.push({
        code: "expected_deliverables_missing_latest_submission",
        stage: "deliverable_utility_readiness",
        message: `latest submission is missing expected deliverables: ${missingTypes.join(", ")}`,
      });
    }

    const latestRecords = [];
    for (const type of ASSIGNMENT_DELIVERABLE_TYPES) {
      const rows = Array.isArray(deliverablesByType[type]) ? deliverablesByType[type] : [];
      latestRecords.push(...rows);
    }

    const hasReviewMinimumSignal = latestRecords.some((row) => {
      const hasText = Boolean(String(row?.text_content || "").trim());
      const hasSourceAsset = row?.source_asset_id != null && Number(row.source_asset_id || 0) > 0;
      const hasSourceUrl = Boolean(String(row?.source_url || "").trim());
      return hasText || hasSourceAsset || hasSourceUrl;
    });

    if (!hasReviewMinimumSignal) {
      reasonCodes.push("review_signal_missing");
      blockers.push({
        code: "review_signal_missing",
        stage: "deliverable_utility_readiness",
        message: "latest submission does not have minimum text/source signals for review utility",
      });
    }

    const hasExpectedDeliverablesDefined = expectedTypes.length > 0;
    const reviewUsable = Boolean(latestSubmissionId) && hasExpectedDeliverablesDefined && hasReviewMinimumSignal;
    const handoffUsable = Boolean(latestSubmissionId) && hasExpectedDeliverablesDefined && missingTypes.length === 0;

    if (reviewUsable) {
      reasonCodes.push("review_usable_minimum_signal_met");
    }
    if (!reviewUsable && latestSubmissionId && hasReviewMinimumSignal && !hasExpectedDeliverablesDefined) {
      reasonCodes.push("review_usable_false_expected_not_defined");
    }
    if (!handoffUsable && latestSubmissionId && expectedTypes.length > 0 && missingTypes.length > 0) {
      reasonCodes.push("handoff_usable_false_missing_expected");
    }
    if (handoffUsable) {
      reasonCodes.push("handoff_usable_expected_complete");
    }

    return {
      assignment_id: Number(bundle?.assignment_id || assignmentId || 0) || Number(assignmentId || 0),
      content_item_id: bundle?.content_item_id || null,
      latest_submission_id: latestSubmissionId,
      review_usable: reviewUsable,
      handoff_usable: handoffUsable,
      available_deliverable_types: availableTypes,
      missing_deliverable_types: missingTypes,
      blockers,
      reason_codes: dedupeStringList(reasonCodes),
      debug: {
        expected_count: expectedTypes.length,
        available_count: availableTypes.length,
        missing_count: missingTypes.length,
        has_review_minimum_signal: hasReviewMinimumSignal,
        has_expected_deliverables_defined: hasExpectedDeliverablesDefined,
        constrained_by_expected_not_defined: !hasExpectedDeliverablesDefined,
      },
      bundle,
    };
  }

  function evaluateAssignmentHandoffUtilityByAssignment(assignmentId, options = {}) {
    const assignmentKey = Number(assignmentId || 0);
    if (!assignmentKey) throw new Error("assignment_id is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
    if (!assignment) throw new Error("assignment not found");

    const itemId = Number(assignment.content_item_id || 0);
    if (!itemId) throw new Error("assignment content_item_id is required");
    const governance = buildGovernanceSummaryByItem(itemId);
    const deliverables = evaluateAssignmentDeliverablesUtilityReadiness(assignmentKey, options);
    const handoffSnapshot = getLatestAssignmentHandoffByAssignment(assignmentKey);

    const readinessReady = Boolean(governance?.readiness?.ready_for_content);
    const executionReady = Boolean(governance?.execution?.ready_for_execution);
    const upstreamReadyForHandoff = Boolean(governance?.handoff?.ready_for_handoff);
    const deliverablesReviewUsable = Boolean(deliverables?.review_usable);
    const deliverablesHandoffUsable = Boolean(deliverables?.handoff_usable);

    const readyForHandoff = upstreamReadyForHandoff && deliverablesHandoffUsable;

    const blockers = dedupeBlockers([
      ...(Array.isArray(governance?.handoff?.blockers) ? governance.handoff.blockers : []),
      ...(Array.isArray(deliverables?.blockers) ? deliverables.blockers : []),
    ]);
    const missingRequirements = dedupeStringList([
      ...(Array.isArray(governance?.handoff?.missing_requirements) ? governance.handoff.missing_requirements : []),
      ...(Array.isArray(deliverables?.missing_deliverable_types)
        ? deliverables.missing_deliverable_types.map((type) => `deliverable_type_missing:${String(type || "").trim().toLowerCase()}`)
        : []),
    ]);
    const reasonCodes = dedupeStringList([
      ...(Array.isArray(governance?.handoff?.reason_codes) ? governance.handoff.reason_codes : []),
      ...(Array.isArray(deliverables?.reason_codes) ? deliverables.reason_codes : []),
      ...(upstreamReadyForHandoff ? [] : ["handoff_upstream_not_ready"]),
      ...(deliverablesHandoffUsable ? [] : ["handoff_deliverables_not_ready"]),
      ...(deliverablesReviewUsable && !deliverablesHandoffUsable ? ["deliverables_review_only_not_handoff_usable"] : []),
      ...(readinessReady ? [] : ["handoff_readiness_not_ready_utility"]),
      ...(executionReady ? [] : ["handoff_execution_not_ready_utility"]),
      ...(readyForHandoff ? ["assignment_handoff_utility_ready"] : []),
    ]);

    return {
      assignment_id: assignmentKey,
      content_item_id: itemId,
      latest_submission_id: deliverables?.latest_submission_id || null,
      ready_for_handoff: readyForHandoff,
      readiness_ready: readinessReady,
      execution_ready: executionReady,
      deliverables_review_usable: deliverablesReviewUsable,
      deliverables_handoff_usable: deliverablesHandoffUsable,
      blockers,
      missing_requirements: missingRequirements,
      reason_codes: reasonCodes,
      sources: {
        source_readiness_brief_id: governance?.source_readiness_brief_id || null,
        source_controls_id: governance?.source_controls_id || null,
        source_execution_channels: governance?.source_execution_channels || null,
        source_assignment_handoff_snapshot_id: handoffSnapshot?.id || null,
      },
      debug: {
        upstream_ready_for_handoff: upstreamReadyForHandoff,
        governance_handoff_blockers_count: Array.isArray(governance?.handoff?.blockers) ? governance.handoff.blockers.length : 0,
        governance_handoff_missing_count: Array.isArray(governance?.handoff?.missing_requirements) ? governance.handoff.missing_requirements.length : 0,
        deliverables_blockers_count: Array.isArray(deliverables?.blockers) ? deliverables.blockers.length : 0,
        deliverables_missing_count: Array.isArray(deliverables?.missing_deliverable_types) ? deliverables.missing_deliverable_types.length : 0,
      },
      governance_summary: governance,
      deliverables_utility_readiness: deliverables,
    };
  }

  function evaluateAssignmentDeliverablesReviewDecisionByAssignment(assignmentId, options = {}) {
    const assignmentKey = Number(assignmentId || 0);
    if (!assignmentKey) throw new Error("assignment_id is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
    if (!assignment) throw new Error("assignment not found");

    const handoffUtility = evaluateAssignmentHandoffUtilityByAssignment(assignmentKey, options);
    const deliverablesUtility = handoffUtility?.deliverables_utility_readiness || evaluateAssignmentDeliverablesUtilityReadiness(assignmentKey, options);
    const latestSubmissionId = Number(deliverablesUtility?.latest_submission_id || 0) || null;
    const reviewUsable = Boolean(deliverablesUtility?.review_usable);
    const handoffUsable = Boolean(deliverablesUtility?.handoff_usable);
    const expectedCount = Number(deliverablesUtility?.debug?.expected_count || 0);
    const hasExpectedDefined = expectedCount > 0;
    const hasReviewSignal = Boolean(deliverablesUtility?.debug?.has_review_minimum_signal);
    const missingDeliverableTypes = Array.isArray(deliverablesUtility?.missing_deliverable_types)
      ? deliverablesUtility.missing_deliverable_types
      : [];

    const blockers = dedupeBlockers([
      ...(Array.isArray(deliverablesUtility?.blockers) ? deliverablesUtility.blockers : []),
    ]);
    const missingRequirements = dedupeStringList([
      ...missingDeliverableTypes.map((type) => `deliverable_type_missing:${String(type || "").trim().toLowerCase()}`),
    ]);
    const reasonCodes = dedupeStringList([
      ...(Array.isArray(deliverablesUtility?.reason_codes) ? deliverablesUtility.reason_codes : []),
      ...(Array.isArray(handoffUtility?.reason_codes) ? handoffUtility.reason_codes : []),
    ]);

    let reviewDecision = "blocked";
    if (latestSubmissionId && hasExpectedDefined && hasReviewSignal && reviewUsable && handoffUsable) {
      reviewDecision = "review_pass";
      reasonCodes.push("deliverables_review_decision_pass");
    } else if (latestSubmissionId && hasExpectedDefined && hasReviewSignal && reviewUsable && !handoffUsable) {
      reviewDecision = "request_more";
      reasonCodes.push("deliverables_review_decision_request_more");
    } else {
      reviewDecision = "blocked";
      reasonCodes.push("deliverables_review_decision_blocked");
    }

    if (!latestSubmissionId) {
      reasonCodes.push("latest_submission_missing");
    }
    if (!hasExpectedDefined) {
      reasonCodes.push("expected_deliverables_not_defined");
    }
    if (!hasReviewSignal) {
      reasonCodes.push("review_signal_missing");
    }

    return {
      assignment_id: assignmentKey,
      content_item_id: Number(assignment.content_item_id || 0) || null,
      latest_submission_id: latestSubmissionId,
      review_decision: reviewDecision,
      review_usable: reviewUsable,
      handoff_usable: handoffUsable,
      blockers,
      missing_requirements: missingRequirements,
      reason_codes: dedupeStringList(reasonCodes),
      available_deliverable_types: Array.isArray(deliverablesUtility?.available_deliverable_types)
        ? deliverablesUtility.available_deliverable_types
        : [],
      missing_deliverable_types: missingDeliverableTypes,
      debug: {
        expected_count: expectedCount,
        available_count: Number(deliverablesUtility?.debug?.available_count || 0),
        missing_count: Number(deliverablesUtility?.debug?.missing_count || 0),
        has_expected_deliverables_defined: hasExpectedDefined,
        has_review_minimum_signal: hasReviewSignal,
        handoff_utility_ready_for_handoff: Boolean(handoffUtility?.ready_for_handoff),
      },
      handoff_utility_summary: handoffUtility,
      deliverables_utility_readiness: deliverablesUtility,
    };
  }

  function evaluateAssignmentSubmissionDecisionByAssignment(assignmentId, options = {}) {
    const assignmentKey = Number(assignmentId || 0);
    if (!assignmentKey) throw new Error("assignment_id is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
    if (!assignment) throw new Error("assignment not found");

    const rawOptions = toRawEvaluationOptions(options);
    const rawHandoffUtility = evaluateAssignmentHandoffUtilityByAssignment(assignmentKey, rawOptions);
    const rawReviewDecision = evaluateAssignmentDeliverablesReviewDecisionByAssignment(assignmentKey, rawOptions);
    const handoffUtility = evaluateAssignmentHandoffUtilityByAssignment(assignmentKey, options);
    const reviewDecision = evaluateAssignmentDeliverablesReviewDecisionByAssignment(assignmentKey, options);

    const debugOverrides = normalizeEvaluationDebugOverrides(options?.debug_overrides);
    const latestSubmissionId = Number(reviewDecision?.latest_submission_id || 0) || null;
    let reviewUsable = Object.prototype.hasOwnProperty.call(debugOverrides.values, "review_usable")
      ? Boolean(debugOverrides.values.review_usable)
      : Boolean(reviewDecision?.review_usable);
    let handoffUsable = Object.prototype.hasOwnProperty.call(debugOverrides.values, "handoff_usable")
      ? Boolean(debugOverrides.values.handoff_usable)
      : Boolean(reviewDecision?.handoff_usable);
    let upstreamReadyForHandoff = Object.prototype.hasOwnProperty.call(debugOverrides.values, "upstream_ready_for_handoff")
      ? Boolean(debugOverrides.values.upstream_ready_for_handoff)
      : Boolean(handoffUtility?.debug?.upstream_ready_for_handoff);
    let readyForHandoff = Object.prototype.hasOwnProperty.call(debugOverrides.values, "ready_for_handoff")
      ? Boolean(debugOverrides.values.ready_for_handoff)
      : Boolean(handoffUtility?.ready_for_handoff);
    const expectedDefined = Boolean(reviewDecision?.debug?.has_expected_deliverables_defined);
    const hasReviewSignal = Object.prototype.hasOwnProperty.call(debugOverrides.values, "review_signal_present")
      ? Boolean(debugOverrides.values.review_signal_present)
      : Boolean(reviewDecision?.debug?.has_review_minimum_signal);

    const blockers = dedupeBlockers([
      ...(Array.isArray(reviewDecision?.blockers) ? reviewDecision.blockers : []),
      ...(Array.isArray(handoffUtility?.blockers) ? handoffUtility.blockers : []),
    ]);
    const missingRequirements = dedupeStringList([
      ...(Array.isArray(reviewDecision?.missing_requirements) ? reviewDecision.missing_requirements : []),
      ...(Array.isArray(handoffUtility?.missing_requirements) ? handoffUtility.missing_requirements : []),
    ]);
    let reasonCodes = dedupeStringList([
      ...(Array.isArray(reviewDecision?.reason_codes) ? reviewDecision.reason_codes : [])
        .filter((code) => !String(code || "").startsWith("deliverables_review_decision_")),
      ...(Array.isArray(handoffUtility?.reason_codes) ? handoffUtility.reason_codes : []),
    ]);

    let submissionDecision = "block";
    if (latestSubmissionId && reviewUsable && handoffUsable && readyForHandoff) {
      submissionDecision = "accept";
      reasonCodes.push("assignment_submission_decision_accept");
    } else if (!upstreamReadyForHandoff) {
      submissionDecision = "block";
      reasonCodes.push("assignment_submission_decision_blocked_upstream");
    } else if (latestSubmissionId && expectedDefined && hasReviewSignal && reviewUsable && !handoffUsable) {
      submissionDecision = "request_more";
      reasonCodes.push("assignment_submission_decision_request_more");
    } else {
      submissionDecision = "block";
      reasonCodes.push("assignment_submission_decision_block");
    }
    if (!latestSubmissionId) reasonCodes.push("latest_submission_missing");
    if (!expectedDefined) reasonCodes.push("expected_deliverables_not_defined");
    if (!hasReviewSignal) reasonCodes.push("review_signal_missing");
    if (!readyForHandoff) reasonCodes.push("handoff_not_ready");
    if (upstreamReadyForHandoff && reviewUsable && !handoffUsable) {
      reasonCodes.push("submission_requires_more_deliverables");
    }
    if (debugOverrides.used) {
      reasonCodes.push("debug_override_used");
    }
    let rawReasonCodes = dedupeStringList([
      ...(Array.isArray(rawReviewDecision?.reason_codes) ? rawReviewDecision.reason_codes : [])
        .filter((code) => !String(code || "").startsWith("deliverables_review_decision_")),
      ...(Array.isArray(rawHandoffUtility?.reason_codes) ? rawHandoffUtility.reason_codes : []),
    ]);
    const rawLatestSubmissionId = Number(rawReviewDecision?.latest_submission_id || 0) || null;
    const rawReviewUsable = Boolean(rawReviewDecision?.review_usable);
    const rawHandoffUsable = Boolean(rawReviewDecision?.handoff_usable);
    const rawUpstreamReadyForHandoff = Boolean(rawHandoffUtility?.debug?.upstream_ready_for_handoff);
    const rawReadyForHandoff = Boolean(rawHandoffUtility?.ready_for_handoff);
    const rawExpectedDefined = Boolean(rawReviewDecision?.debug?.has_expected_deliverables_defined);
    const rawHasReviewSignal = Boolean(rawReviewDecision?.debug?.has_review_minimum_signal);
    let rawSubmissionDecision = "block";
    if (rawLatestSubmissionId && rawReviewUsable && rawHandoffUsable && rawReadyForHandoff) {
      rawSubmissionDecision = "accept";
      rawReasonCodes.push("assignment_submission_decision_accept");
    } else if (!rawUpstreamReadyForHandoff) {
      rawSubmissionDecision = "block";
      rawReasonCodes.push("assignment_submission_decision_blocked_upstream");
    } else if (rawLatestSubmissionId && rawExpectedDefined && rawHasReviewSignal && rawReviewUsable && !rawHandoffUsable) {
      rawSubmissionDecision = "request_more";
      rawReasonCodes.push("assignment_submission_decision_request_more");
    } else {
      rawSubmissionDecision = "block";
      rawReasonCodes.push("assignment_submission_decision_block");
    }
    if (!rawLatestSubmissionId) rawReasonCodes.push("latest_submission_missing");
    if (!rawExpectedDefined) rawReasonCodes.push("expected_deliverables_not_defined");
    if (!rawHasReviewSignal) rawReasonCodes.push("review_signal_missing");
    if (!rawReadyForHandoff) rawReasonCodes.push("handoff_not_ready");
    if (rawUpstreamReadyForHandoff && rawReviewUsable && !rawHandoffUsable) {
      rawReasonCodes.push("submission_requires_more_deliverables");
    }
    const rawSummary = {
      submission_decision: rawSubmissionDecision,
      review_usable: rawReviewUsable,
      handoff_usable: rawHandoffUsable,
      ready_for_handoff: rawReadyForHandoff,
      reason_codes: dedupeStringList(rawReasonCodes),
      debug: {
        upstream_ready_for_handoff: rawUpstreamReadyForHandoff,
        handoff_ready: rawReadyForHandoff,
      },
    };
    if (typeof debugOverrides.values.submission_decision === "string") {
      const reconciled = applyDecisionOverrideReconciliation({
        overrideDecision: debugOverrides.values.submission_decision,
        currentDecision: submissionDecision,
        currentReadyFlag: readyForHandoff,
        reasonCodes,
        decisionReasonMap: {
          accept: "assignment_submission_decision_accept",
          request_more: "assignment_submission_decision_request_more",
          block: "assignment_submission_decision_block",
        },
        conflictingReasonCodes: [
          "assignment_submission_decision_blocked_upstream",
          "handoff_not_ready",
          "submission_requires_more_deliverables",
        ],
        readyByDecision: {
          accept: true,
          request_more: false,
          block: false,
        },
      });
      submissionDecision = reconciled.decision;
      readyForHandoff = reconciled.ready_flag;
      reasonCodes = dedupeStringList([
        ...reconciled.reason_codes,
        "assignment_submission_decision_debug_override",
      ]);
      if (submissionDecision === "accept") {
        reviewUsable = true;
        handoffUsable = true;
        upstreamReadyForHandoff = true;
      } else if (submissionDecision === "request_more") {
        reviewUsable = true;
        handoffUsable = false;
        upstreamReadyForHandoff = true;
      } else if (submissionDecision === "block") {
        reviewUsable = false;
        handoffUsable = false;
      }
    }
    const effectiveSummary = {
      submission_decision: submissionDecision,
      review_usable: reviewUsable,
      handoff_usable: handoffUsable,
      ready_for_handoff: readyForHandoff,
      reason_codes: dedupeStringList(reasonCodes),
      debug: {
        upstream_ready_for_handoff: upstreamReadyForHandoff,
        handoff_ready: readyForHandoff,
      },
    };
    const rawEffectiveDiverged = didSummarySemanticsDiverge(rawSummary, effectiveSummary, [
      "submission_decision",
      "review_usable",
      "handoff_usable",
      "ready_for_handoff",
      "reason_codes",
    ]);

    return {
      assignment_id: assignmentKey,
      content_item_id: Number(assignment.content_item_id || 0) || null,
      latest_submission_id: latestSubmissionId,
      submission_decision: submissionDecision,
      evaluation_mode: debugOverrides.used ? "debug_override" : "normal",
      debug_override_used: debugOverrides.used,
      debug_override_keys: debugOverrides.keys,
      review_usable: reviewUsable,
      handoff_usable: handoffUsable,
      ready_for_handoff: readyForHandoff,
      blockers,
      missing_requirements: missingRequirements,
      reason_codes: dedupeStringList(reasonCodes),
      available_deliverable_types: Array.isArray(reviewDecision?.available_deliverable_types)
        ? reviewDecision.available_deliverable_types
        : [],
      missing_deliverable_types: Array.isArray(reviewDecision?.missing_deliverable_types)
        ? reviewDecision.missing_deliverable_types
        : [],
      debug: {
        expected_count: Number(reviewDecision?.debug?.expected_count || 0),
        available_count: Number(reviewDecision?.debug?.available_count || 0),
        missing_count: Number(reviewDecision?.debug?.missing_count || 0),
        has_expected_deliverables_defined: expectedDefined,
        has_review_minimum_signal: hasReviewSignal,
        upstream_ready_for_handoff: upstreamReadyForHandoff,
        handoff_ready: readyForHandoff,
        debug_override_used: debugOverrides.used,
        debug_override_keys: debugOverrides.keys,
      },
      handoff_utility_summary: handoffUtility,
      deliverables_review_decision: reviewDecision,
      raw_summary: rawSummary,
      effective_summary: effectiveSummary,
      effective_summary_available: true,
      raw_effective_diverged: rawEffectiveDiverged,
      top_level_summary_mode: "effective",
    };
  }

  function evaluateAssignmentDeliverablesGovernanceSummaryByAssignment(assignmentId, options = {}) {
    const assignmentKey = Number(assignmentId || 0);
    if (!assignmentKey) throw new Error("assignment_id is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
    if (!assignment) throw new Error("assignment not found");

    const rawOptions = toRawEvaluationOptions(options);
    const rawDeliverablesReadiness = evaluateAssignmentDeliverablesReadiness(assignmentKey, rawOptions);
    const rawDeliverablesUtility = evaluateAssignmentDeliverablesUtilityReadiness(assignmentKey, rawOptions);
    const rawHandoffUtility = evaluateAssignmentHandoffUtilityByAssignment(assignmentKey, rawOptions);
    const rawSubmissionDecision = evaluateAssignmentSubmissionDecisionByAssignment(assignmentKey, rawOptions);

    const deliverablesReadiness = evaluateAssignmentDeliverablesReadiness(assignmentKey, options);
    const deliverablesUtility = evaluateAssignmentDeliverablesUtilityReadiness(assignmentKey, options);
    const handoffUtility = evaluateAssignmentHandoffUtilityByAssignment(assignmentKey, options);
    const submissionDecision = evaluateAssignmentSubmissionDecisionByAssignment(assignmentKey, options);
    const debugOverrides = normalizeEvaluationDebugOverrides(options?.debug_overrides);

    const latestSubmissionId = Number(
      submissionDecision?.latest_submission_id
      || handoffUtility?.latest_submission_id
      || deliverablesUtility?.latest_submission_id
      || deliverablesReadiness?.latest_submission_id
      || 0
    ) || null;
    const readyForHandoff = Boolean(submissionDecision?.ready_for_handoff);
    const reviewUsable = Boolean(submissionDecision?.review_usable);
    const handoffUsable = Boolean(submissionDecision?.handoff_usable);
    const submissionDecisionValue = String(submissionDecision?.submission_decision || "block").trim().toLowerCase();

    const blockers = dedupeBlockers([
      ...(Array.isArray(deliverablesReadiness?.blockers) ? deliverablesReadiness.blockers : []),
      ...(Array.isArray(deliverablesUtility?.blockers) ? deliverablesUtility.blockers : []),
      ...(Array.isArray(handoffUtility?.blockers) ? handoffUtility.blockers : []),
      ...(Array.isArray(submissionDecision?.blockers) ? submissionDecision.blockers : []),
    ]);
    const missingRequirements = dedupeStringList([
      ...(Array.isArray(deliverablesReadiness?.missing_deliverable_types)
        ? deliverablesReadiness.missing_deliverable_types.map((type) => `deliverable_type_missing:${String(type || "").trim().toLowerCase()}`)
        : []),
      ...(Array.isArray(deliverablesUtility?.missing_deliverable_types)
        ? deliverablesUtility.missing_deliverable_types.map((type) => `deliverable_type_missing:${String(type || "").trim().toLowerCase()}`)
        : []),
      ...(Array.isArray(handoffUtility?.missing_requirements) ? handoffUtility.missing_requirements : []),
      ...(Array.isArray(submissionDecision?.missing_requirements) ? submissionDecision.missing_requirements : []),
    ]);
    let reasonCodes = dedupeStringList([
      ...(Array.isArray(deliverablesReadiness?.reason_codes) ? deliverablesReadiness.reason_codes : []),
      ...(Array.isArray(deliverablesUtility?.reason_codes) ? deliverablesUtility.reason_codes : []),
      ...(Array.isArray(handoffUtility?.reason_codes) ? handoffUtility.reason_codes : []),
      ...(Array.isArray(submissionDecision?.reason_codes) ? submissionDecision.reason_codes : []),
    ]);

    let governanceDecision = "hold";
    if (submissionDecisionValue === "accept") {
      governanceDecision = "ready_for_review";
      reasonCodes.push("assignment_deliverables_governance_ready_for_review");
    } else if (submissionDecisionValue === "request_more") {
      governanceDecision = "request_more";
      reasonCodes.push("assignment_deliverables_governance_request_more");
    } else {
      governanceDecision = "hold";
      reasonCodes.push("assignment_deliverables_governance_hold");
    }
    let readyForReview = governanceDecision !== "hold";
    if (!latestSubmissionId) {
      reasonCodes.push("latest_submission_missing");
    }
    if (!readyForReview) {
      reasonCodes.push("assignment_not_ready_for_review");
    }
    if (debugOverrides.used) {
      reasonCodes.push("debug_override_used");
    }
    const rawLatestSubmissionId = Number(
      rawSubmissionDecision?.latest_submission_id
      || rawHandoffUtility?.latest_submission_id
      || rawDeliverablesUtility?.latest_submission_id
      || rawDeliverablesReadiness?.latest_submission_id
      || 0
    ) || null;
    const rawReadyForHandoff = Boolean(rawSubmissionDecision?.ready_for_handoff);
    const rawReviewUsable = Boolean(rawSubmissionDecision?.review_usable);
    const rawHandoffUsable = Boolean(rawSubmissionDecision?.handoff_usable);
    const rawSubmissionDecisionValue = String(rawSubmissionDecision?.submission_decision || "block").trim().toLowerCase();
    let rawReasonCodes = dedupeStringList([
      ...(Array.isArray(rawDeliverablesReadiness?.reason_codes) ? rawDeliverablesReadiness.reason_codes : []),
      ...(Array.isArray(rawDeliverablesUtility?.reason_codes) ? rawDeliverablesUtility.reason_codes : []),
      ...(Array.isArray(rawHandoffUtility?.reason_codes) ? rawHandoffUtility.reason_codes : []),
      ...(Array.isArray(rawSubmissionDecision?.reason_codes) ? rawSubmissionDecision.reason_codes : []),
    ]);
    let rawGovernanceDecision = "hold";
    if (rawSubmissionDecisionValue === "accept") {
      rawGovernanceDecision = "ready_for_review";
      rawReasonCodes.push("assignment_deliverables_governance_ready_for_review");
    } else if (rawSubmissionDecisionValue === "request_more") {
      rawGovernanceDecision = "request_more";
      rawReasonCodes.push("assignment_deliverables_governance_request_more");
    } else {
      rawGovernanceDecision = "hold";
      rawReasonCodes.push("assignment_deliverables_governance_hold");
    }
    const rawReadyForReview = rawGovernanceDecision !== "hold";
    if (!rawLatestSubmissionId) {
      rawReasonCodes.push("latest_submission_missing");
    }
    if (!rawReadyForReview) {
      rawReasonCodes.push("assignment_not_ready_for_review");
    }
    const rawSummary = {
      governance_decision: rawGovernanceDecision,
      ready_for_review: rawReadyForReview,
      ready_for_handoff: rawReadyForHandoff,
      review_usable: rawReviewUsable,
      handoff_usable: rawHandoffUsable,
      reason_codes: dedupeStringList(rawReasonCodes),
      source_trace: {
        latest_submission_id: rawLatestSubmissionId,
        submission_decision: rawSubmissionDecisionValue,
        upstream_ready_for_handoff: Boolean(rawSubmissionDecision?.debug?.upstream_ready_for_handoff),
      },
      debug: {
        submission_decision: rawSubmissionDecisionValue,
        expected_count: Number(rawSubmissionDecision?.debug?.expected_count || 0),
        available_count: Number(rawSubmissionDecision?.debug?.available_count || 0),
        missing_count: Number(rawSubmissionDecision?.debug?.missing_count || 0),
      },
    };
    if (typeof debugOverrides.values.governance_decision === "string") {
      const reconciled = applyDecisionOverrideReconciliation({
        overrideDecision: debugOverrides.values.governance_decision,
        currentDecision: governanceDecision,
        currentReadyFlag: readyForReview,
        reasonCodes,
        decisionReasonMap: {
          ready_for_review: "assignment_deliverables_governance_ready_for_review",
          request_more: "assignment_deliverables_governance_request_more",
          hold: "assignment_deliverables_governance_hold",
        },
        conflictingReasonCodes: [
          "assignment_not_ready_for_review",
        ],
        readyByDecision: {
          ready_for_review: true,
          request_more: true,
          hold: false,
        },
      });
      governanceDecision = reconciled.decision;
      readyForReview = reconciled.ready_flag;
      reasonCodes = dedupeStringList([
        ...reconciled.reason_codes,
        "assignment_deliverables_governance_debug_override",
      ]);
    }
    const effectiveSummary = {
      governance_decision: governanceDecision,
      ready_for_review: readyForReview,
      ready_for_handoff: readyForHandoff,
      review_usable: reviewUsable,
      handoff_usable: handoffUsable,
      reason_codes: dedupeStringList(reasonCodes),
      source_trace: {
        latest_submission_id: latestSubmissionId,
        submission_decision: submissionDecisionValue,
        upstream_ready_for_handoff: Boolean(submissionDecision?.debug?.upstream_ready_for_handoff),
      },
      debug: {
        submission_decision: submissionDecisionValue,
        expected_count: Number(submissionDecision?.debug?.expected_count || 0),
        available_count: Number(submissionDecision?.debug?.available_count || 0),
        missing_count: Number(submissionDecision?.debug?.missing_count || 0),
      },
    };
    const rawEffectiveDiverged = didSummarySemanticsDiverge(rawSummary, effectiveSummary, [
      "governance_decision",
      "ready_for_review",
      "ready_for_handoff",
      "review_usable",
      "handoff_usable",
      "reason_codes",
    ]);

    return {
      assignment_id: assignmentKey,
      content_item_id: Number(assignment.content_item_id || 0) || null,
      latest_submission_id: latestSubmissionId,
      governance_decision: governanceDecision,
      evaluation_mode: debugOverrides.used ? "debug_override" : "normal",
      debug_override_used: debugOverrides.used,
      debug_override_keys: debugOverrides.keys,
      ready_for_review: readyForReview,
      ready_for_handoff: readyForHandoff,
      review_usable: reviewUsable,
      handoff_usable: handoffUsable,
      blockers,
      missing_requirements: missingRequirements,
      reason_codes: dedupeStringList(reasonCodes),
      source_trace: {
        latest_submission_id: latestSubmissionId,
        submission_decision: submissionDecisionValue,
        upstream_ready_for_handoff: Boolean(submissionDecision?.debug?.upstream_ready_for_handoff),
      },
      debug: {
        submission_decision: submissionDecisionValue,
        expected_count: Number(submissionDecision?.debug?.expected_count || 0),
        available_count: Number(submissionDecision?.debug?.available_count || 0),
        missing_count: Number(submissionDecision?.debug?.missing_count || 0),
        debug_override_used: debugOverrides.used,
        debug_override_keys: debugOverrides.keys,
      },
      deliverables_readiness: deliverablesReadiness,
      deliverables_utility_readiness: deliverablesUtility,
      handoff_utility_summary: handoffUtility,
      submission_decision_summary: submissionDecision,
      raw_summary: rawSummary,
      effective_summary: effectiveSummary,
      effective_summary_available: true,
      raw_effective_diverged: rawEffectiveDiverged,
      top_level_summary_mode: "effective",
    };
  }

  function evaluateAssignmentHandoffGovernanceByAssignment(assignmentId, options = {}) {
    const assignmentKey = Number(assignmentId || 0);
    if (!assignmentKey) throw new Error("assignment_id is required");
    const assignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(assignmentKey));
    if (!assignment) throw new Error("assignment not found");

    const rawOptions = toRawEvaluationOptions(options);
    const rawHandoffUtility = evaluateAssignmentHandoffUtilityByAssignment(assignmentKey, rawOptions);
    const rawDeliverablesGovernance = evaluateAssignmentDeliverablesGovernanceSummaryByAssignment(assignmentKey, rawOptions);
    const rawSubmissionDecision = evaluateAssignmentSubmissionDecisionByAssignment(assignmentKey, rawOptions);

    const handoffUtility = evaluateAssignmentHandoffUtilityByAssignment(assignmentKey, options);
    const deliverablesGovernance = evaluateAssignmentDeliverablesGovernanceSummaryByAssignment(assignmentKey, options);
    const submissionDecision = evaluateAssignmentSubmissionDecisionByAssignment(assignmentKey, options);
    let effectiveDeliverablesGovernance = deliverablesGovernance;
    let effectiveSubmissionDecision = submissionDecision;
    const debugOverrides = normalizeEvaluationDebugOverrides(options?.debug_overrides);

    const latestSubmissionId = Number(
      deliverablesGovernance?.latest_submission_id
      || submissionDecision?.latest_submission_id
      || handoffUtility?.latest_submission_id
      || 0
    ) || null;
    let readyForHandoffGovernance = Boolean(handoffUtility?.ready_for_handoff)
      && String(deliverablesGovernance?.governance_decision || "").trim().toLowerCase() !== "hold"
      && String(submissionDecision?.submission_decision || "").trim().toLowerCase() !== "block";

    const blockers = dedupeBlockers([
      ...(Array.isArray(handoffUtility?.blockers) ? handoffUtility.blockers : []),
      ...(Array.isArray(deliverablesGovernance?.blockers) ? deliverablesGovernance.blockers : []),
      ...(Array.isArray(submissionDecision?.blockers) ? submissionDecision.blockers : []),
    ]);
    const missingRequirements = dedupeStringList([
      ...(Array.isArray(handoffUtility?.missing_requirements) ? handoffUtility.missing_requirements : []),
      ...(Array.isArray(deliverablesGovernance?.missing_requirements) ? deliverablesGovernance.missing_requirements : []),
      ...(Array.isArray(submissionDecision?.missing_requirements) ? submissionDecision.missing_requirements : []),
    ]);
    let reasonCodes = dedupeStringList([
      ...(Array.isArray(handoffUtility?.reason_codes) ? handoffUtility.reason_codes : []),
      ...(Array.isArray(deliverablesGovernance?.reason_codes) ? deliverablesGovernance.reason_codes : []),
      ...(Array.isArray(submissionDecision?.reason_codes) ? submissionDecision.reason_codes : []),
    ]);

    let handoffGovernanceDecision = "hold";
    if (!latestSubmissionId || !Boolean(handoffUtility?.debug?.upstream_ready_for_handoff)) {
      handoffGovernanceDecision = "hold";
      reasonCodes.push("assignment_handoff_governance_hold");
    } else if (
      String(deliverablesGovernance?.governance_decision || "").trim().toLowerCase() === "request_more"
      || String(submissionDecision?.submission_decision || "").trim().toLowerCase() === "request_more"
    ) {
      handoffGovernanceDecision = "request_more";
      reasonCodes.push("assignment_handoff_governance_request_more");
    } else if (readyForHandoffGovernance) {
      handoffGovernanceDecision = "ready";
      reasonCodes.push("assignment_handoff_governance_ready");
    } else {
      handoffGovernanceDecision = "hold";
      reasonCodes.push("assignment_handoff_governance_hold");
    }
    if (!latestSubmissionId) {
      reasonCodes.push("latest_submission_missing");
    }
    if (!readyForHandoffGovernance) {
      reasonCodes.push("assignment_not_ready_for_handoff_governance");
    }
    if (debugOverrides.used) {
      reasonCodes.push("debug_override_used");
    }
    const rawLatestSubmissionId = Number(
      rawDeliverablesGovernance?.latest_submission_id
      || rawSubmissionDecision?.latest_submission_id
      || rawHandoffUtility?.latest_submission_id
      || 0
    ) || null;
    let rawReadyForHandoffGovernance = Boolean(rawHandoffUtility?.ready_for_handoff)
      && String(rawDeliverablesGovernance?.governance_decision || "").trim().toLowerCase() !== "hold"
      && String(rawSubmissionDecision?.submission_decision || "").trim().toLowerCase() !== "block";
    let rawReasonCodes = dedupeStringList([
      ...(Array.isArray(rawHandoffUtility?.reason_codes) ? rawHandoffUtility.reason_codes : []),
      ...(Array.isArray(rawDeliverablesGovernance?.reason_codes) ? rawDeliverablesGovernance.reason_codes : []),
      ...(Array.isArray(rawSubmissionDecision?.reason_codes) ? rawSubmissionDecision.reason_codes : []),
    ]);
    let rawHandoffGovernanceDecision = "hold";
    if (!rawLatestSubmissionId || !Boolean(rawHandoffUtility?.debug?.upstream_ready_for_handoff)) {
      rawHandoffGovernanceDecision = "hold";
      rawReasonCodes.push("assignment_handoff_governance_hold");
    } else if (
      String(rawDeliverablesGovernance?.governance_decision || "").trim().toLowerCase() === "request_more"
      || String(rawSubmissionDecision?.submission_decision || "").trim().toLowerCase() === "request_more"
    ) {
      rawHandoffGovernanceDecision = "request_more";
      rawReasonCodes.push("assignment_handoff_governance_request_more");
    } else if (rawReadyForHandoffGovernance) {
      rawHandoffGovernanceDecision = "ready";
      rawReasonCodes.push("assignment_handoff_governance_ready");
    } else {
      rawHandoffGovernanceDecision = "hold";
      rawReasonCodes.push("assignment_handoff_governance_hold");
    }
    if (!rawLatestSubmissionId) {
      rawReasonCodes.push("latest_submission_missing");
    }
    if (!rawReadyForHandoffGovernance) {
      rawReasonCodes.push("assignment_not_ready_for_handoff_governance");
    }
    const rawSummary = {
      handoff_governance_decision: rawHandoffGovernanceDecision,
      ready_for_handoff_governance: rawReadyForHandoffGovernance,
      deliverables_governance_decision: String(rawDeliverablesGovernance?.governance_decision || "hold").trim().toLowerCase(),
      submission_decision: String(rawSubmissionDecision?.submission_decision || "block").trim().toLowerCase(),
      reason_codes: dedupeStringList(rawReasonCodes),
      source_trace: {
        latest_submission_id: rawLatestSubmissionId,
        source_handoff_utility_ready_for_handoff: Boolean(rawHandoffUtility?.ready_for_handoff),
        source_deliverables_governance_decision: String(rawDeliverablesGovernance?.governance_decision || "hold").trim().toLowerCase(),
        source_submission_decision: String(rawSubmissionDecision?.submission_decision || "block").trim().toLowerCase(),
      },
      debug: {
        upstream_ready_for_handoff: Boolean(rawHandoffUtility?.debug?.upstream_ready_for_handoff),
        deliverables_ready_for_review: Boolean(rawDeliverablesGovernance?.ready_for_review),
        deliverables_ready_for_handoff: Boolean(rawDeliverablesGovernance?.ready_for_handoff),
      },
    };
    const handoffDecisionOverrideUsed = typeof debugOverrides.values.handoff_governance_decision === "string";
    if (handoffDecisionOverrideUsed) {
      const overrideDecision = String(debugOverrides.values.handoff_governance_decision || "").trim().toLowerCase();
      const conflictingReasonCodes = ["assignment_not_ready_for_handoff_governance"];
      if (overrideDecision === "ready") {
        conflictingReasonCodes.push(
          "assignment_submission_decision_blocked_upstream",
          "assignment_submission_decision_block",
          "assignment_deliverables_governance_hold",
          "assignment_not_ready_for_review",
          "handoff_not_ready",
        );
      }
      const reconciled = applyDecisionOverrideReconciliation({
        overrideDecision,
        currentDecision: handoffGovernanceDecision,
        currentReadyFlag: readyForHandoffGovernance,
        reasonCodes,
        decisionReasonMap: {
          ready: "assignment_handoff_governance_ready",
          request_more: "assignment_handoff_governance_request_more",
          hold: "assignment_handoff_governance_hold",
        },
        conflictingReasonCodes,
        readyByDecision: {
          ready: true,
          request_more: false,
          hold: false,
        },
      });
      handoffGovernanceDecision = reconciled.decision;
      readyForHandoffGovernance = reconciled.ready_flag;
      reasonCodes = dedupeStringList([
        ...reconciled.reason_codes,
        "assignment_handoff_governance_debug_override",
      ]);

      const nestedReconciled = reconcileNestedSummariesForHandoffOverride({
        handoffDecision: handoffGovernanceDecision,
        submissionSummary: submissionDecision,
        deliverablesSummary: deliverablesGovernance,
      });
      effectiveSubmissionDecision = nestedReconciled.submission_summary;
      effectiveDeliverablesGovernance = nestedReconciled.deliverables_summary;
    }
    const effectiveDeliverablesGovernanceDecision = String(
      effectiveDeliverablesGovernance?.governance_decision || "hold"
    ).trim().toLowerCase();
    const effectiveSubmissionDecisionValue = String(
      effectiveSubmissionDecision?.submission_decision || "block"
    ).trim().toLowerCase();
    const rawDeliverablesGovernanceDecision = String(
      rawDeliverablesGovernance?.governance_decision || "hold"
    ).trim().toLowerCase();
    const rawSubmissionDecisionValue = String(
      rawSubmissionDecision?.submission_decision || "block"
    ).trim().toLowerCase();
    const decisionFieldsReconciled = (
      handoffDecisionOverrideUsed
      && handoffGovernanceDecision === "ready"
    ) || effectiveDeliverablesGovernanceDecision !== rawDeliverablesGovernanceDecision
      || effectiveSubmissionDecisionValue !== rawSubmissionDecisionValue;
    const effectiveSourceTrace = {
      latest_submission_id: latestSubmissionId,
      source_handoff_utility_ready_for_handoff: Boolean(handoffUtility?.ready_for_handoff),
      source_handoff_utility_mode: "effective",
      source_deliverables_governance_decision: effectiveDeliverablesGovernanceDecision,
      source_submission_decision: effectiveSubmissionDecisionValue,
      decision_fields_mode: "effective",
      decision_fields_reconciled: decisionFieldsReconciled,
    };

    const effectiveSummary = {
      handoff_governance_decision: handoffGovernanceDecision,
      ready_for_handoff_governance: readyForHandoffGovernance,
      deliverables_governance_decision: effectiveDeliverablesGovernanceDecision,
      submission_decision: effectiveSubmissionDecisionValue,
      reason_codes: dedupeStringList(reasonCodes),
      source_trace: effectiveSourceTrace,
      debug: {
        upstream_ready_for_handoff: Boolean(handoffUtility?.debug?.upstream_ready_for_handoff),
        deliverables_ready_for_review: Boolean(effectiveDeliverablesGovernance?.ready_for_review),
        deliverables_ready_for_handoff: Boolean(effectiveDeliverablesGovernance?.ready_for_handoff),
      },
    };
    const rawEffectiveDiverged = didSummarySemanticsDiverge(rawSummary, effectiveSummary, [
      "handoff_governance_decision",
      "ready_for_handoff_governance",
      "deliverables_governance_decision",
      "submission_decision",
      "reason_codes",
    ]);

    return {
      assignment_id: assignmentKey,
      content_item_id: Number(assignment.content_item_id || 0) || null,
      latest_submission_id: latestSubmissionId,
      ready_for_handoff_governance: readyForHandoffGovernance,
      handoff_governance_decision: handoffGovernanceDecision,
      evaluation_mode: debugOverrides.used ? "debug_override" : "normal",
      debug_override_used: debugOverrides.used,
      debug_override_keys: debugOverrides.keys,
      deliverables_governance_decision: effectiveDeliverablesGovernanceDecision,
      submission_decision: effectiveSubmissionDecisionValue,
      blockers,
      missing_requirements: missingRequirements,
      reason_codes: dedupeStringList(reasonCodes),
      source_trace: effectiveSourceTrace,
      debug: {
        upstream_ready_for_handoff: Boolean(handoffUtility?.debug?.upstream_ready_for_handoff),
        deliverables_ready_for_review: Boolean(effectiveDeliverablesGovernance?.ready_for_review),
        deliverables_ready_for_handoff: Boolean(effectiveDeliverablesGovernance?.ready_for_handoff),
        debug_override_used: debugOverrides.used,
        debug_override_keys: debugOverrides.keys,
      },
      handoff_utility_summary: handoffUtility,
      deliverables_governance_summary: effectiveDeliverablesGovernance,
      submission_decision_summary: effectiveSubmissionDecision,
      raw_summary: rawSummary,
      effective_summary: effectiveSummary,
      effective_summary_available: true,
      raw_effective_diverged: rawEffectiveDiverged,
      top_level_summary_mode: "effective",
    };
  }

  function addIntelligenceModel(payload = {}) {
    const contentItemId = Number(payload.content_item_id || 0);
    if (!contentItemId) throw new Error("content_item_id is required");

    const modelVersion = String(payload.model_version || "v1").trim() || "v1";
    const evidenceSummary = payload.evidence_summary_json == null
      ? null
      : parseJsonInputStrict(payload.evidence_summary_json, "evidence_summary_json", "object");
    const signalsJson = payload.signals_json == null ? null : parseJsonInputStrict(payload.signals_json, "signals_json", "object");
    const scoresJson = payload.scores_json == null ? null : parseJsonInputStrict(payload.scores_json, "scores_json", "object");
    const nicheJson = payload.niche_json == null ? null : parseJsonInputStrict(payload.niche_json, "niche_json", "object");
    const gapsJson = payload.gaps_json == null ? null : parseJsonInputStrict(payload.gaps_json, "gaps_json", "array");
    const nextActionsJson = payload.next_actions_json == null
      ? null
      : parseJsonInputStrict(payload.next_actions_json, "next_actions_json", "array");
    const briefJson = payload.brief_json == null ? null : parseJsonInputStrict(payload.brief_json, "brief_json", "object");
    const readinessJson = payload.readiness_json == null
      ? null
      : parseJsonInputStrict(payload.readiness_json, "readiness_json", "object");
    const reasonsJson = payload.reasons_json == null ? null : parseJsonInputStrict(payload.reasons_json, "reasons_json", "object");
    const payloadJson = payload.payload_json == null ? null : parseJsonInputStrict(payload.payload_json, "payload_json", "object");

    insertIntelligenceModelStmt.run(
      contentItemId,
      modelVersion,
      toNullableScore(payload.quality_score, "quality_score"),
      toNullableScore(payload.popularity_score, "popularity_score"),
      toNullableScore(payload.momentum_score, "momentum_score"),
      toNullableScore(payload.confidence_score, "confidence_score"),
      toNullableScore(payload.source_coverage_signal, "source_coverage_signal"),
      toNullableScore(payload.fact_completeness_signal, "fact_completeness_signal"),
      toNullableScore(payload.official_presence_signal, "official_presence_signal"),
      toNullableScore(payload.review_presence_signal, "review_presence_signal"),
      toNullableScore(payload.social_presence_signal, "social_presence_signal"),
      toNullableScore(payload.visual_signal, "visual_signal"),
      toNullableScore(payload.local_uniqueness_signal, "local_uniqueness_signal"),
      toNullableScore(payload.content_gap_signal, "content_gap_signal"),
      evidenceSummary ? JSON.stringify(evidenceSummary) : null,
      signalsJson ? JSON.stringify(signalsJson) : null,
      scoresJson ? JSON.stringify(scoresJson) : null,
      nicheJson ? JSON.stringify(nicheJson) : null,
      gapsJson ? JSON.stringify(gapsJson) : null,
      nextActionsJson ? JSON.stringify(nextActionsJson) : null,
      briefJson ? JSON.stringify(briefJson) : null,
      readinessJson ? JSON.stringify(readinessJson) : null,
      reasonsJson ? JSON.stringify(reasonsJson) : null,
      payloadJson ? JSON.stringify(payloadJson) : null,
      String(payload.computed_by || "").trim() || null
    );
    return normalizeIntelligenceModelRow(latestIntelligenceModelByItemStmt.get(contentItemId));
  }

  function getLatestIntelligenceModelByItem(contentItemId) {
    return normalizeIntelligenceModelRow(latestIntelligenceModelByItemStmt.get(Number(contentItemId || 0)));
  }

  function toScoreNumber(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return n;
  }

  function uniqueTextList(values = [], limit = 6) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
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

  function recomputeReadinessBriefByItem(contentItemId, actorEmail = "system@local") {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const workflow = ensureWorkflowModel(itemId);
    const intelligence = getLatestIntelligenceModelByItem(itemId);
    const latestDraft = latestDraftByItem(itemId);
    const latestReview = latestReviewByItem(itemId);
    const latestApprovedReview = latestApprovedReviewByItem(itemId);
    const direction = getLatestContentDirectionByItem(itemId);
    const published = db.prepare("SELECT id, slug, status, published_at FROM published_articles WHERE content_item_id=? LIMIT 1").get(itemId);
    const approvedContextCount = Number(
      db.prepare("SELECT COUNT(*) AS c FROM approved_context_blocks WHERE content_item_id=? AND status='active'").get(itemId)?.c || 0
    );
    const evidenceCount = Number(
      db.prepare("SELECT COUNT(*) AS c FROM evidence_blocks WHERE content_item_id=? AND status='active'").get(itemId)?.c || 0
    );

    const blockers = [];
    const missingRequirements = [];
    const reasons = {
      workflow_state: {
        production_state: workflow?.production_state || null,
        publication_state: workflow?.publication_state || null,
        assignment_state: workflow?.assignment_state || null,
      },
      checks: {},
      explanations: [],
    };

    const hasCoreProfile = Boolean(String(item.title || "").trim()) && Boolean(String(item.description_clean || item.description_raw || "").trim());
    const hasEvidence = approvedContextCount > 0 || evidenceCount > 0;
    const hasIntelligence = Boolean(intelligence);
    const isPublishTerminal = ["published", "archived", "deleted"].includes(String(workflow?.publication_state || "").toLowerCase());
    const hasDraft = Boolean(latestDraft?.id);
    const hasApprovedReview = Boolean(latestReview?.id) && String(latestReview?.status || "").toLowerCase() === "approved";
    const approvedReviewMatchesLatest =
      Boolean(latestApprovedReview?.id) && Number(latestApprovedReview?.id || 0) === Number(latestReview?.id || 0);
    const hasSeoMeta = Boolean(String(latestDraft?.meta_title || item.meta_title || "").trim()) && Boolean(
      String(latestDraft?.meta_description || item.meta_description || "").trim()
    );

    reasons.checks = {
      has_core_profile: hasCoreProfile,
      has_evidence: hasEvidence,
      has_intelligence: hasIntelligence,
      has_draft: hasDraft,
      has_approved_review: hasApprovedReview,
      approved_review_matches_latest: approvedReviewMatchesLatest,
      has_seo_meta: hasSeoMeta,
      is_publish_terminal: isPublishTerminal,
    };

    if (!hasCoreProfile) {
      missingRequirements.push("core_profile_missing");
      blockers.push({ code: "core_profile_missing", stage: "ready_for_content", message: "item needs title and cleaned/raw description" });
    }
    if (!hasEvidence) {
      missingRequirements.push("evidence_missing");
      blockers.push({ code: "evidence_missing", stage: "ready_for_content", message: "need approved context or active evidence block" });
    }
    if (!hasIntelligence) {
      missingRequirements.push("intelligence_missing");
      blockers.push({ code: "intelligence_missing", stage: "ready_for_content", message: "latest intelligence model not found" });
    }
    if (!hasDraft) {
      missingRequirements.push("draft_missing");
      blockers.push({ code: "draft_missing", stage: "ready_for_publish", message: "latest draft is required" });
    }
    if (!hasApprovedReview) {
      missingRequirements.push("approved_review_missing");
      blockers.push({ code: "approved_review_missing", stage: "ready_for_publish", message: "latest review must be approved" });
    }
    if (hasApprovedReview && !approvedReviewMatchesLatest) {
      missingRequirements.push("approved_review_stale");
      blockers.push({ code: "approved_review_stale", stage: "ready_for_publish", message: "approved review must match latest review" });
    }
    if (!hasSeoMeta) {
      missingRequirements.push("seo_meta_missing");
      blockers.push({ code: "seo_meta_missing", stage: "ready_for_publish", message: "meta_title and meta_description are required" });
    }
    if (isPublishTerminal) {
      blockers.push({ code: "publication_terminal", stage: "ready_for_publish", message: "item already in published/archived/deleted publication state" });
    }

    const readyForContent = hasCoreProfile && hasEvidence && hasIntelligence;
    const readyForPublish = hasDraft && hasApprovedReview && approvedReviewMatchesLatest && hasSeoMeta && !isPublishTerminal;

    const qualityScore = toScoreNumber(intelligence?.quality_score, 0);
    const popularityScore = toScoreNumber(intelligence?.popularity_score, 0);
    const momentumScore = toScoreNumber(intelligence?.momentum_score, 0);
    const confidenceScore = toScoreNumber(intelligence?.confidence_score, 0);
    const avgScore = (qualityScore + popularityScore + momentumScore + confidenceScore) / 4;

    const suggestedNiche = intelligence?.niche_json || {
      category: item.category || null,
      primary_angle: direction?.primary_angle || null,
      confidence_band: avgScore >= 7 ? "high" : avgScore >= 5 ? "medium" : "low",
    };

    const directionalGaps = Array.isArray(direction?.gaps_json) ? direction.gaps_json : [];
    const modelGaps = Array.isArray(intelligence?.gaps_json) ? intelligence.gaps_json : [];
    const mergedGaps = uniqueTextList([...modelGaps, ...directionalGaps], 8);

    const modelNextActions = Array.isArray(intelligence?.next_actions_json) ? intelligence.next_actions_json : [];
    const directionNextAction = String(direction?.recommended_next_action || "").trim();
    const mergedNextActions = uniqueTextList([...modelNextActions, directionNextAction], 8);

    const primaryAngle = String(direction?.primary_angle || "").trim() || String(suggestedNiche?.primary_angle || "").trim() || String(item.category || "").trim() || "local story";
    const whyNowList = Array.isArray(direction?.why_now_json) ? direction.why_now_json : [];
    const recommendedHook = uniqueTextList(whyNowList, 1)[0] || `Why now: ${item.title}`;
    const baseTitle = String(item.title || "Untitled place").trim();

    const evidenceSummary = intelligence?.evidence_summary_json || {
      approved_context_count: approvedContextCount,
      active_evidence_count: evidenceCount,
      has_draft: hasDraft,
      has_approved_review: hasApprovedReview,
    };

    const briefSummary = `Focus ${baseTitle} as ${primaryAngle}; prioritize evidence-backed points and practical info.`;
    const scriptSuggestions = uniqueTextList([
      `Hook: ${recommendedHook}.`,
      `Story arc: why ${baseTitle} matters for ${primaryAngle}.`,
      `Close with decision cue: who should go and best time to visit.`,
    ]);
    const captionSuggestions = uniqueTextList([
      `${baseTitle}: ${primaryAngle} in one quick take.`,
      `If you need ${primaryAngle}, start with ${baseTitle}.`,
      `${baseTitle} now: what stands out and what to know first.`,
    ]);
    const shotListSuggestions = uniqueTextList([
      "Entrance / location anchor shot",
      "Hero detail shot of signature point",
      "Atmosphere wide shot",
      "Practical info shot (map/time/access)",
      "Decision shot: why choose this place now",
    ]);

    const readiness = {
      ready_for_content: readyForContent,
      ready_for_publish: readyForPublish,
      evaluated_at: new Date().toISOString(),
      blockers,
      missing_requirements: missingRequirements,
    };

    const brief = {
      brief_summary: briefSummary,
      niche: suggestedNiche,
      gaps: mergedGaps,
      next_actions: mergedNextActions,
      evidence_summary: evidenceSummary,
      recommended_angle: primaryAngle,
      recommended_hook: recommendedHook,
      script_suggestions: scriptSuggestions,
      caption_suggestions: captionSuggestions,
      shot_list_suggestions: shotListSuggestions,
    };

    reasons.explanations.push(
      readyForContent
        ? "ready_for_content passed core profile, evidence, and intelligence checks"
        : "ready_for_content blocked by missing core/evidence/intelligence requirements"
    );
    reasons.explanations.push(
      readyForPublish
        ? "ready_for_publish passed draft/review/meta checks and not in terminal publication state"
        : "ready_for_publish blocked by draft/review/meta or terminal publication state"
    );

    insertReadinessBriefStmt.run(
      itemId,
      JSON.stringify(readiness),
      JSON.stringify(brief),
      JSON.stringify(reasons),
      JSON.stringify(blockers),
      JSON.stringify(missingRequirements),
      intelligence?.id || null,
      String(actorEmail || "").trim() || null
    );

    return normalizeReadinessBriefRow(latestReadinessBriefByItemStmt.get(itemId));
  }

  function getLatestReadinessBriefByItem(contentItemId) {
    return normalizeReadinessBriefRow(latestReadinessBriefByItemStmt.get(Number(contentItemId || 0)));
  }

  function uniqueInstructionList(values = [], limit = 8) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
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

  function buildExecutionControlsFromInputs(item, readinessSnapshot, intelligence) {
    const brief = readinessSnapshot?.brief_json || {};
    const evidenceSummary = brief?.evidence_summary || intelligence?.evidence_summary_json || null;
    const suggestedNiche = brief?.niche || intelligence?.niche_json || null;
    const gaps = Array.isArray(brief?.gaps) ? brief.gaps : Array.isArray(intelligence?.gaps_json) ? intelligence.gaps_json : [];
    const nextActions = Array.isArray(brief?.next_actions) ? brief.next_actions : Array.isArray(intelligence?.next_actions_json) ? intelligence.next_actions_json : [];

    const blockers = [];
    const missingRequirements = [];
    const reasons = {
      sources: {
        readiness_brief_id: readinessSnapshot?.id || null,
        intelligence_model_id: intelligence?.id || null,
      },
      checks: {},
      notes: [],
    };

    const recommendedAngle = String(brief?.recommended_angle || "").trim();
    const recommendedHook = String(brief?.recommended_hook || "").trim();
    const briefSummary = String(brief?.brief_summary || "").trim();
    const hasEvidenceSummary = Boolean(evidenceSummary && typeof evidenceSummary === "object");
    const hasNiche = Boolean(suggestedNiche && typeof suggestedNiche === "object");

    reasons.checks = {
      has_brief_summary: Boolean(briefSummary),
      has_recommended_angle: Boolean(recommendedAngle),
      has_recommended_hook: Boolean(recommendedHook),
      has_evidence_summary: hasEvidenceSummary,
      has_niche: hasNiche,
    };

    if (!briefSummary) {
      missingRequirements.push("brief_summary_missing");
      blockers.push({ code: "brief_summary_missing", stage: "execution_controls", message: "brief_summary is required" });
    }
    if (!recommendedAngle) {
      missingRequirements.push("recommended_angle_missing");
      blockers.push({ code: "recommended_angle_missing", stage: "execution_controls", message: "recommended_angle is required" });
    }
    if (!recommendedHook) {
      missingRequirements.push("recommended_hook_missing");
      blockers.push({ code: "recommended_hook_missing", stage: "execution_controls", message: "recommended_hook is required" });
    }
    if (!hasEvidenceSummary) {
      missingRequirements.push("evidence_summary_missing");
      blockers.push({ code: "evidence_summary_missing", stage: "execution_controls", message: "evidence_summary is required" });
    }

    const mustIncludePoints = uniqueInstructionList([
      recommendedAngle ? `ต้องยึดมุมหลัก: ${recommendedAngle}` : null,
      recommendedHook ? `ต้องมี hook หลัก: ${recommendedHook}` : null,
      briefSummary ? `ต้องคงสารหลักจาก brief: ${briefSummary}` : null,
      hasEvidenceSummary ? "ต้องอ้างอิงเฉพาะข้อมูลที่มีใน evidence_summary" : null,
      hasNiche ? "ต้องสะท้อน niche/positioning ของสถานที่" : null,
      gaps.length ? `ต้องตอบ gap สำคัญอย่างน้อย 1 จุด: ${String(gaps[0] || "").trim()}` : null,
      nextActions.length ? `ควรปิดท้ายด้วย next action ที่ชัดเจน: ${String(nextActions[0] || "").trim()}` : null,
    ], 8);

    const confidenceScore = Number(intelligence?.confidence_score || 0);
    const factCompleteness = Number(intelligence?.fact_completeness_signal || 0);
    const mustAvoidPoints = uniqueInstructionList([
      "ห้ามแต่งข้อมูลนอก evidence_summary หรือ brief",
      confidenceScore > 0 && confidenceScore < 5 ? "ห้ามใช้ถ้อยคำฟันธงสูงเกินหลักฐาน เพราะ confidence ต่ำ" : null,
      factCompleteness > 0 && factCompleteness < 5 ? "หลีกเลี่ยงการระบุรายละเอียดเชิงข้อเท็จจริงที่ยังไม่ครบ" : null,
      gaps.length ? `หลีกเลี่ยงการยืนยันประเด็นที่ยังเป็น gap: ${String(gaps[0] || "").trim()}` : null,
      "ห้ามสรุปว่า ready_for_publish จาก execution controls เพียงอย่างเดียว",
    ], 8);

    const controlsPayload = {
      must_include_points: mustIncludePoints,
      must_avoid_points: mustAvoidPoints,
      context: {
        item_title: item?.title || null,
        recommended_angle: recommendedAngle || null,
        recommended_hook: recommendedHook || null,
        brief_summary: briefSummary || null,
        niche: suggestedNiche || null,
        gaps,
        next_actions: nextActions,
        evidence_summary: evidenceSummary || null,
      },
    };

    return {
      controlsPayload,
      blockers,
      missingRequirements,
      reasons,
    };
  }

  function recomputeExecutionControlsByItem(contentItemId, actorEmail = "system@local") {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const readinessSnapshot = getLatestReadinessBriefByItem(itemId);
    if (!readinessSnapshot?.id) {
      throw new Error("readiness snapshot is required before deriving execution controls");
    }
    const intelligence = getLatestIntelligenceModelByItem(itemId);

    const derived = buildExecutionControlsFromInputs(item, readinessSnapshot, intelligence);
    insertExecutionControlsStmt.run(
      itemId,
      Number(readinessSnapshot.id || 0),
      intelligence?.id || null,
      JSON.stringify(derived.controlsPayload.must_include_points || []),
      JSON.stringify(derived.controlsPayload.must_avoid_points || []),
      JSON.stringify(derived.blockers || []),
      JSON.stringify(derived.missingRequirements || []),
      JSON.stringify(derived.reasons || {}),
      JSON.stringify(derived.controlsPayload),
      String(actorEmail || "").trim() || null
    );
    return normalizeExecutionControlsRow(latestExecutionControlsByItemStmt.get(itemId));
  }

  function getLatestExecutionControlsByItem(contentItemId) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    return normalizeExecutionControlsRow(latestExecutionControlsByItemStmt.get(itemId));
  }

  function validateLatestExecutionChannelByItemAndChannel(contentItemId, channel, actorEmail = "system@local") {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const normalizedChannel = normalizeExecutionChannelValue(channel);
    const controlsSnapshot = getLatestExecutionControlsByItem(itemId);
    if (!controlsSnapshot?.id) {
      throw new Error("execution controls snapshot is required; recompute execution controls first");
    }

    const latest = getLatestExecutionChannelByItemAndChannel(itemId, normalizedChannel);
    if (!latest?.id) {
      throw new Error("execution channel snapshot not found");
    }

    const blockers = [];
    const warnings = [];
    const missingRequirements = [];
    const checks = {
      has_required_record: Boolean(latest?.id),
      lang_is_th: String(latest?.lang || "").toLowerCase() === "th",
      has_recommended_version: Boolean(latest?.recommended_version_json && typeof latest.recommended_version_json === "object"),
      alternatives_is_array: Array.isArray(latest?.alternatives_json),
      has_controls_snapshot: Boolean(controlsSnapshot?.id),
    };

    if (!checks.lang_is_th) {
      missingRequirements.push("lang_not_th");
      blockers.push({ code: "lang_not_th", stage: "execution_validation", message: "execution channel lang must be th in v1" });
    }
    if (!checks.has_recommended_version) {
      missingRequirements.push("recommended_version_missing");
      blockers.push({ code: "recommended_version_missing", stage: "execution_validation", message: "recommended_version_json is required" });
    }
    if (!checks.alternatives_is_array) {
      missingRequirements.push("alternatives_invalid");
      blockers.push({ code: "alternatives_invalid", stage: "execution_validation", message: "alternatives_json must be an array" });
    } else if ((latest?.alternatives_json || []).length === 0) {
      warnings.push({ code: "alternatives_empty", stage: "execution_validation", message: "alternatives_json is empty" });
    }

    const validationStatus = blockers.length > 0 ? "blocked" : "validated";
    const validation = {
      validation_status: validationStatus,
      blockers,
      warnings,
      missing_requirements: missingRequirements,
      checks,
      validated_at: new Date().toISOString(),
      validated_by: String(actorEmail || "").trim() || null,
      source_controls_id: controlsSnapshot.id,
      source_readiness_brief_id: controlsSnapshot.source_readiness_brief_id || null,
    };

    const mergedDerivedControls = {
      must_include_points: controlsSnapshot.must_include_points_json || [],
      must_avoid_points: controlsSnapshot.must_avoid_points_json || [],
      source_controls_id: controlsSnapshot.id,
    };

    updateExecutionChannelValidationStmt.run(
      JSON.stringify(mergedDerivedControls),
      JSON.stringify(validation),
      validationStatus === "blocked" ? "blocked" : "validated",
      Number(latest.id || 0)
    );

    const updated = normalizeExecutionChannelRow(getExecutionChannelByIdStmt.get(Number(latest.id || 0)));
    return {
      item_id: itemId,
      channel: normalizedChannel,
      source_readiness_brief_id: controlsSnapshot.source_readiness_brief_id || null,
      controls_snapshot: controlsSnapshot,
      execution_channel: updated,
      validation,
    };
  }

  function normalizeExecutionChannelValue(value) {
    const channel = String(value || "").trim().toLowerCase();
    if (!EXECUTION_CHANNELS.has(channel)) {
      throw new Error("channel must be one of: facebook, tiktok");
    }
    return channel;
  }

  function normalizeExecutionLangValue(value) {
    const lang = String(value || "th").trim().toLowerCase();
    if (lang !== "th") {
      throw new Error("lang must be 'th' for v1");
    }
    return lang;
  }

  function normalizeExecutionStatusValue(value) {
    const status = String(value || "draft").trim().toLowerCase();
    if (!EXECUTION_STATUSES.has(status)) {
      throw new Error("status is invalid");
    }
    return status;
  }

  function createExecutionChannelRecord(payload = {}, actorEmail = "system@local") {
    const contentItemId = Number(payload.content_item_id || 0);
    if (!contentItemId) throw new Error("content_item_id is required");
    const item = getItem(contentItemId);
    if (!item) throw new Error("item not found");
    const latestReadiness = getLatestReadinessBriefByItem(contentItemId);
    if (!latestReadiness?.id) {
      throw new Error("readiness snapshot is required before creating execution channel");
    }

    const channel = normalizeExecutionChannelValue(payload.channel);
    const lang = normalizeExecutionLangValue(payload.lang);
    const status = normalizeExecutionStatusValue(payload.status);
    const requestedReadinessBriefId = payload.source_readiness_brief_id == null || payload.source_readiness_brief_id === ""
      ? null
      : Number(payload.source_readiness_brief_id || 0) || null;
    const sourceReadinessBriefId = requestedReadinessBriefId || Number(latestReadiness.id || 0) || null;
    if (!sourceReadinessBriefId) {
      throw new Error("source_readiness_brief_id is required");
    }

    const sourceReadiness = normalizeReadinessBriefRow(getReadinessBriefByIdStmt.get(sourceReadinessBriefId));
    if (!sourceReadiness?.id) {
      throw new Error("source_readiness_brief_id not found");
    }
    if (Number(sourceReadiness.content_item_id || 0) !== contentItemId) {
      throw new Error("source_readiness_brief_id does not belong to content_item_id");
    }

    const derivedControls = payload.derived_controls_json == null
      ? null
      : parseJsonInputStrict(payload.derived_controls_json, "derived_controls_json", "object");
    const recommendedVersion = payload.recommended_version_json == null
      ? null
      : parseJsonInputStrict(payload.recommended_version_json, "recommended_version_json", "object");
    const alternatives = payload.alternatives_json == null
      ? []
      : parseJsonInputStrict(payload.alternatives_json, "alternatives_json", "array");
    const validation = payload.validation_json == null
      ? null
      : parseJsonInputStrict(payload.validation_json, "validation_json", "object");
    const generatedBy = String(payload.generated_by || "").trim() || null;

    const existingId = Number(payload.id || 0);
    if (existingId > 0) {
      const existing = getExecutionChannelByIdStmt.get(existingId);
      if (!existing) throw new Error("execution channel not found");
      if (Number(existing.content_item_id || 0) !== contentItemId) {
        throw new Error("content_item_id does not match execution channel");
      }
      if (String(existing.channel || "").trim().toLowerCase() !== channel) {
        throw new Error("channel does not match existing execution channel");
      }

      updateExecutionChannelByIdStmt.run(
        sourceReadinessBriefId,
        lang,
        derivedControls ? JSON.stringify(derivedControls) : null,
        recommendedVersion ? JSON.stringify(recommendedVersion) : null,
        JSON.stringify(alternatives),
        validation ? JSON.stringify(validation) : null,
        status,
        generatedBy,
        existingId
      );

      const updated = normalizeExecutionChannelRow(getExecutionChannelByIdStmt.get(existingId));
      logAudit(actorEmail, "execution_channel.update", "execution_channel", String(existingId), {
        content_item_id: contentItemId,
        source_readiness_brief_id: sourceReadinessBriefId,
        channel,
        lang,
        status,
      });
      return updated;
    }

    const res = insertExecutionChannelStmt.run(
      contentItemId,
      sourceReadinessBriefId,
      channel,
      lang,
      derivedControls ? JSON.stringify(derivedControls) : null,
      recommendedVersion ? JSON.stringify(recommendedVersion) : null,
      JSON.stringify(alternatives),
      validation ? JSON.stringify(validation) : null,
      status,
      generatedBy
    );

    const createdId = Number(res.lastInsertRowid || 0);
    const created = normalizeExecutionChannelRow(getExecutionChannelByIdStmt.get(createdId));
    logAudit(actorEmail, "execution_channel.create", "execution_channel", String(createdId), {
      content_item_id: contentItemId,
      source_readiness_brief_id: sourceReadinessBriefId,
      channel,
      lang,
      status,
    });
    return created;
  }

  function listExecutionChannelsByItem(contentItemId) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    return listExecutionChannelsByItemStmt.all(itemId).map(normalizeExecutionChannelRow);
  }

  function getLatestExecutionChannelByItemAndChannel(contentItemId, channel) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    const normalizedChannel = normalizeExecutionChannelValue(channel);
    return normalizeExecutionChannelRow(
      latestExecutionChannelByItemAndChannelStmt.get(itemId, normalizedChannel)
    );
  }

  function getExecutionChannelCoverageByItem(contentItemId) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    const latestByChannel = {};
    for (const channel of EXECUTION_CHANNELS) {
      latestByChannel[channel] = getLatestExecutionChannelByItemAndChannel(itemId, channel);
    }
    return {
      item_id: itemId,
      required_channels: Array.from(EXECUTION_CHANNELS),
      channel_status: {
        facebook: {
          exists: Boolean(latestByChannel.facebook?.id),
          latest_id: latestByChannel.facebook?.id || null,
          source_readiness_brief_id: latestByChannel.facebook?.source_readiness_brief_id || null,
          status: latestByChannel.facebook?.status || null,
          updated_at: latestByChannel.facebook?.updated_at || null,
        },
        tiktok: {
          exists: Boolean(latestByChannel.tiktok?.id),
          latest_id: latestByChannel.tiktok?.id || null,
          source_readiness_brief_id: latestByChannel.tiktok?.source_readiness_brief_id || null,
          status: latestByChannel.tiktok?.status || null,
          updated_at: latestByChannel.tiktok?.updated_at || null,
        },
      },
    };
  }

  function dedupeStringList(values = []) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
      const text = String(raw || "").trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  }

  function evaluateExecutionReadinessByItem(contentItemId, channel = null) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const normalizedChannel = channel == null
      ? null
      : normalizeExecutionChannelValue(channel);
    const channels = normalizedChannel ? [normalizedChannel] : Array.from(EXECUTION_CHANNELS);

    const readinessSnapshot = getLatestReadinessBriefByItem(itemId);
    const controlsSnapshot = getLatestExecutionControlsByItem(itemId);
    const readinessJson = readinessSnapshot?.readiness_json || null;
    const readinessBlockers = Array.isArray(readinessJson?.blockers) ? readinessJson.blockers : [];
    const readinessMissing = Array.isArray(readinessJson?.missing_requirements) ? readinessJson.missing_requirements : [];
    const readyForContent = Boolean(readinessJson?.ready_for_content);

    const perChannel = {};
    for (const targetChannel of channels) {
      const latestExecution = getLatestExecutionChannelByItemAndChannel(itemId, targetChannel);
      const controlsBlockers = Array.isArray(controlsSnapshot?.blockers_json) ? controlsSnapshot.blockers_json : [];
      const controlsMissing = Array.isArray(controlsSnapshot?.missing_requirements_json) ? controlsSnapshot.missing_requirements_json : [];
      const blockers = [];
      const missingRequirements = [];
      const reasonCodes = [];

      if (!readinessSnapshot?.id) {
        reasonCodes.push("readiness_snapshot_missing");
        blockers.push({
          code: "readiness_snapshot_missing",
          stage: "execution_readiness",
          message: "readiness snapshot is required",
        });
      }

      if (!controlsSnapshot?.id) {
        reasonCodes.push("execution_controls_snapshot_missing");
        blockers.push({
          code: "execution_controls_snapshot_missing",
          stage: "execution_readiness",
          message: "execution controls snapshot is required",
        });
      }

      if (readinessSnapshot?.id && controlsSnapshot?.id) {
        if (Number(controlsSnapshot.source_readiness_brief_id || 0) !== Number(readinessSnapshot.id || 0)) {
          reasonCodes.push("execution_controls_stale");
          blockers.push({
            code: "execution_controls_stale",
            stage: "execution_readiness",
            message: "execution controls do not match latest readiness snapshot",
          });
        }
      }

      if (!readyForContent) {
        reasonCodes.push("readiness_not_ready_for_content");
      }

      if (controlsBlockers.length > 0) {
        reasonCodes.push("execution_controls_blocked");
      }
      if (controlsMissing.length > 0) {
        reasonCodes.push("execution_controls_missing_requirements");
      }

      const hasGeneratedOutput = Boolean(latestExecution?.id) &&
        ["generated", "validated"].includes(String(latestExecution?.status || "").toLowerCase());
      const hasRecommendedVersion = Boolean(latestExecution?.recommended_version_json && typeof latestExecution.recommended_version_json === "object");
      const hasAlternatives = Array.isArray(latestExecution?.alternatives_json) && latestExecution.alternatives_json.length > 0;
      const latestValidation = latestExecution?.validation_json && typeof latestExecution.validation_json === "object"
        ? latestExecution.validation_json
        : null;
      const validationStatus = String(latestValidation?.validation_status || "").trim().toLowerCase();
      const validationBlockers = Array.isArray(latestValidation?.blockers) ? latestValidation.blockers : [];
      const validationMissing = Array.isArray(latestValidation?.missing_requirements) ? latestValidation.missing_requirements : [];
      const validationBlocked = validationStatus === "blocked";
      const validationReady = validationStatus === "validated";
      const validationMissingStructure = !validationStatus;

      if (!latestExecution?.id) {
        reasonCodes.push("execution_channel_missing");
        missingRequirements.push("execution_channel_missing");
      }
      if (latestExecution?.id && !hasRecommendedVersion) {
        reasonCodes.push("recommended_version_missing");
        missingRequirements.push("recommended_version_missing");
      }
      if (latestExecution?.id && !hasAlternatives) {
        reasonCodes.push("alternatives_missing");
        missingRequirements.push("alternatives_missing");
      }
      if (latestExecution?.id && validationMissingStructure) {
        reasonCodes.push("execution_channel_validation_missing");
        missingRequirements.push("execution_channel_validation_missing");
      }
      if (latestExecution?.id && validationBlocked) {
        reasonCodes.push("execution_channel_validation_blocked");
      }
      if (latestExecution?.id && validationStatus && !validationReady && !validationBlocked) {
        reasonCodes.push("execution_channel_validation_not_ready");
        missingRequirements.push("execution_channel_validation_not_ready");
      }
      if (latestExecution?.id && validationMissing.length > 0) {
        reasonCodes.push("execution_channel_validation_missing_requirements");
      }

      const normalizedReadinessMissing = dedupeStringList([
        ...readinessMissing,
        ...controlsMissing,
        ...validationMissing,
      ]);
      const normalizedMissingRequirements = dedupeStringList([
        ...normalizedReadinessMissing,
        ...missingRequirements,
      ]);
      const normalizedValidationBlockers = validationBlocked && validationBlockers.length === 0
        ? [{
          code: "execution_channel_validation_blocked",
          stage: "execution_readiness",
          message: "latest execution validation is blocked",
        }]
        : [];

      perChannel[targetChannel] = {
        item_id: itemId,
        channel: targetChannel,
        source_readiness_brief_id: readinessSnapshot?.id || null,
        source_controls_id: controlsSnapshot?.id || null,
        source_execution_channel_id: latestExecution?.id || null,
        ready_for_execution:
          readyForContent &&
          blockers.length === 0 &&
          normalizedMissingRequirements.length === 0 &&
          hasGeneratedOutput &&
          hasRecommendedVersion &&
          hasAlternatives &&
          validationReady,
        reason_codes: dedupeStringList(reasonCodes),
        blockers: [
          ...readinessBlockers,
          ...controlsBlockers,
          ...validationBlockers,
          ...normalizedValidationBlockers,
          ...blockers,
        ],
        missing_requirements: normalizedMissingRequirements,
        has_generated_output: hasGeneratedOutput,
        has_recommended_version: hasRecommendedVersion,
        has_alternatives: hasAlternatives,
        debug: {
          ready_for_content: readyForContent,
          readiness_snapshot_exists: Boolean(readinessSnapshot?.id),
          controls_snapshot_exists: Boolean(controlsSnapshot?.id),
          controls_snapshot_stale:
            Boolean(readinessSnapshot?.id && controlsSnapshot?.id) &&
            Number(controlsSnapshot.source_readiness_brief_id || 0) !== Number(readinessSnapshot.id || 0),
          execution_channel_exists: Boolean(latestExecution?.id),
          execution_channel_status: latestExecution?.status || null,
          execution_validation_status: validationStatus || null,
          execution_validation_ready: validationReady,
        },
      };
    }

    if (normalizedChannel) {
      return perChannel[normalizedChannel] || null;
    }
    return {
      item_id: itemId,
      channels: perChannel,
    };
  }

  function toBooleanFlag(value) {
    if (typeof value === "boolean") return value;
    const text = String(value || "").trim().toLowerCase();
    return text === "1" || text === "true" || text === "yes" || text === "y";
  }

  function dedupeBlockers(blockers = []) {
    const out = [];
    const seen = new Set();
    for (const blocker of Array.isArray(blockers) ? blockers : []) {
      if (!blocker || typeof blocker !== "object") continue;
      const code = String(blocker.code || "").trim().toLowerCase();
      const stage = String(blocker.stage || "").trim().toLowerCase();
      const message = String(blocker.message || "").trim().toLowerCase();
      const key = `${code}|${stage}|${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(blocker);
    }
    return out;
  }

  function buildGovernanceSummaryByItem(contentItemId) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const readinessSnapshot = getLatestReadinessBriefByItem(itemId);
    const readinessJson = readinessSnapshot?.readiness_json || null;
    const readyForContent = Boolean(readinessJson?.ready_for_content);
    const readyForPublish = Boolean(readinessJson?.ready_for_publish);
    const readinessBlockers = Array.isArray(readinessJson?.blockers) ? readinessJson.blockers : [];
    const readinessMissing = Array.isArray(readinessJson?.missing_requirements) ? readinessJson.missing_requirements : [];
    const readinessReasonCodes = [];
    if (!readinessSnapshot?.id) readinessReasonCodes.push("readiness_snapshot_missing");
    if (!readyForContent) readinessReasonCodes.push("readiness_not_ready_for_content");
    if (!readyForPublish) readinessReasonCodes.push("readiness_not_ready_for_publish");

    const executionSummary = evaluateExecutionReadinessByItem(itemId);
    const channelRows = executionSummary?.channels && typeof executionSummary.channels === "object"
      ? executionSummary.channels
      : {};
    const readyChannels = [];
    const notReadyChannels = [];
    const executionReasonCodes = [];
    const executionBlockers = [];
    const executionMissing = [];
    const sourceControlsId = Object.values(channelRows).find((row) => Number(row?.source_controls_id || 0) > 0)?.source_controls_id || null;
    const sourceExecutionChannels = {};

    for (const channel of EXECUTION_CHANNELS) {
      const row = channelRows[channel] || null;
      sourceExecutionChannels[channel] = row?.source_execution_channel_id || null;
      if (row?.ready_for_execution) readyChannels.push(channel);
      else notReadyChannels.push(channel);
      executionReasonCodes.push(...(Array.isArray(row?.reason_codes) ? row.reason_codes : []));
      executionBlockers.push(...(Array.isArray(row?.blockers) ? row.blockers : []));
      executionMissing.push(...(Array.isArray(row?.missing_requirements) ? row.missing_requirements : []));
    }

    const readyForExecution = notReadyChannels.length === 0 && readyChannels.length === EXECUTION_CHANNELS.size;
    const handoffReasonCodes = dedupeStringList([
      ...readinessReasonCodes,
      ...executionReasonCodes,
      ...notReadyChannels.map((channel) => `execution_channel_not_ready:${channel}`),
      ...(readyForExecution ? [] : ["handoff_execution_not_ready"]),
      ...(readyForContent ? [] : ["handoff_readiness_not_ready"]),
    ]);
    const handoffBlockers = dedupeBlockers([
      ...readinessBlockers,
      ...executionBlockers,
    ]);
    const handoffMissing = dedupeStringList([
      ...readinessMissing,
      ...executionMissing,
    ]);
    const readyForHandoff = readyForContent && readyForExecution;

    return {
      item_id: itemId,
      source_readiness_brief_id: readinessSnapshot?.id || null,
      source_controls_id: sourceControlsId || null,
      source_execution_channels: sourceExecutionChannels,
      readiness: {
        ready_for_content: readyForContent,
        ready_for_publish: readyForPublish,
        reason_codes: dedupeStringList(readinessReasonCodes),
        blockers: readinessBlockers,
        missing_requirements: dedupeStringList(readinessMissing),
      },
      execution: {
        ready_for_execution: readyForExecution,
        ready_channels: readyChannels,
        not_ready_channels: notReadyChannels,
        channels: channelRows,
        reason_codes: dedupeStringList(executionReasonCodes),
        blockers: dedupeBlockers(executionBlockers),
        missing_requirements: dedupeStringList(executionMissing),
      },
      handoff: {
        ready_for_handoff: readyForHandoff,
        reason_codes: handoffReasonCodes,
        blockers: handoffBlockers,
        missing_requirements: handoffMissing,
        override_policy: {
          force_override_supported: true,
          force_reason_required: true,
          mode_when_ready: "readiness",
          mode_when_forced: "forced",
        },
      },
    };
  }

  function listFieldPackChecklistTexts(fieldPack, checklistType, limit = 12) {
    const rows = Array.isArray(fieldPack?.checklists) ? fieldPack.checklists : [];
    return uniqueTextList(
      rows
        .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === checklistType)
        .map((row) => row?.item_text),
      limit
    );
  }

  function mapFieldPackReferencesForHandoff(fieldPack, referenceScope = "general", limit = 12) {
    const rows = Array.isArray(fieldPack?.references) ? fieldPack.references : [];
    return rows
      .filter((row) => String(row?.reference_scope || "general").trim().toLowerCase() === referenceScope)
      .map((row) => ({
        label: String(row?.label || "").trim() || null,
        url: String(row?.url || "").trim() || null,
        source_family: String(row?.source_family || "manual").trim().toLowerCase() || "manual",
        note: String(row?.note || "").trim() || null,
      }))
      .filter((row) => row.label || row.url)
      .slice(0, limit);
  }

  function mapFieldPackMediaHintsForHandoff(fieldPack, limit = 12) {
    const rows = Array.isArray(fieldPack?.media_hints) ? fieldPack.media_hints : [];
    return rows
      .map((row) => ({
        content_asset_id: Number(row?.content_asset_id || 0) || null,
        url: String(row?.url || "").trim() || null,
        kind: String(row?.kind || "reference").trim().toLowerCase() || "reference",
        caption: String(row?.caption || "").trim() || null,
        selected: Boolean(row?.selected),
      }))
      .filter((row) => row.url || row.content_asset_id)
      .sort((a, b) => Number(b.selected) - Number(a.selected))
      .slice(0, limit);
  }

  function finalizeAssignmentHandoffPackage(handoffPackage) {
    if (!handoffPackage || typeof handoffPackage !== "object") return null;
    const next = { ...handoffPackage };
    const normalizedExpectedDeliverables = normalizeAssignmentDeliverableTypeList(next.expected_deliverables);
    next.expected_deliverables = normalizedExpectedDeliverables.length > 0
      ? normalizedExpectedDeliverables
      : deriveExpectedDeliverablesFromHandoff(next);
    return next;
  }

  function buildRequestedChecksHandoffPayload(requestedChecks, item) {
    const normalized = normalizeRequestedChecksJson(requestedChecks);
    const groups = normalized.groups
      .filter((group) => {
        const normalizedGroupKey = String(group?.group_key || "").trim().toLowerCase();
        if (normalizedGroupKey === "cta_contact") {
          return String(item?.type || "").trim().toLowerCase() === "place";
        }
        return true;
      })
      .map((group) => ({
        group_key: group.group_key,
        group_label: group.group_label,
        checks: (Array.isArray(group.checks) ? group.checks : []).filter((check) => check?.requested === true),
      }))
      .filter((group) => group.checks.length > 0);
    if (!groups.length) return null;
    return {
      version: 1,
      groups,
    };
  }

  function buildFieldPackHandoffPackage(item, fieldPack, governance, readinessSnapshot = null, options = {}) {
    const verifiedFacts = uniqueTextList(fieldPack?.verified_facts_json || [], 12);
    const uncertainFacts = uniqueTextList([
      ...(Array.isArray(fieldPack?.uncertain_facts_json) ? fieldPack.uncertain_facts_json : []),
      ...(Array.isArray(fieldPack?.ai_unknowns_json) ? fieldPack.ai_unknowns_json : []),
    ], 12);
    const mustVerifyFacts = listFieldPackChecklistTexts(fieldPack, "must_verify_fact", 12);
    const mustCaptureShots = listFieldPackChecklistTexts(fieldPack, "must_capture", 12);
    const mustAskQuestions = listFieldPackChecklistTexts(fieldPack, "must_ask_question", 12);
    const socialShotEmphasis = uniqueTextList(fieldPack?.social_shot_emphasis_json || [], 12);
    const socialOnCameraPoints = uniqueTextList(fieldPack?.social_on_camera_points_json || [], 12);
    const generalReferences = mapFieldPackReferencesForHandoff(fieldPack, "general", 12);
    const writerReferences = mapFieldPackReferencesForHandoff(fieldPack, "writer", 12);
    const mediaHints = mapFieldPackMediaHintsForHandoff(fieldPack, 12);
    const briefSummary = String(fieldPack?.editor_summary || fieldPack?.ai_summary || item?.summary || "").trim() || null;
    const recommendedAngle = String(fieldPack?.story_angle || "").trim() || null;
    const recommendedHook = String(fieldPack?.social_hook || "").trim() || null;
    const socialCaptionAngle = String(fieldPack?.social_caption_angle || "").trim() || null;
    const fieldNotes = String(fieldPack?.field_notes || "").trim() || null;
    const requestedChecks = buildRequestedChecksHandoffPayload(fieldPack?.requested_checks_json, item);

    return finalizeAssignmentHandoffPackage({
      brief_summary: briefSummary,
      niche: String(item?.category || "").trim() || null,
      gaps: uncertainFacts,
      next_actions: uniqueTextList([...mustVerifyFacts, ...mustAskQuestions], 12),
      evidence_summary: {
        verified_facts: verifiedFacts,
        references: generalReferences,
        field_notes: fieldNotes,
      },
      recommended_angle: recommendedAngle,
      recommended_hook: recommendedHook,
      script_suggestions: socialOnCameraPoints,
      caption_suggestions: socialCaptionAngle ? [socialCaptionAngle] : [],
      shot_list_suggestions: uniqueTextList([...mustCaptureShots, ...socialShotEmphasis], 12),
      field_notes: fieldNotes,
      references: generalReferences,
      writer_references: writerReferences,
      media_hints: mediaHints,
      ...(requestedChecks ? { requested_checks: requestedChecks } : {}),
      writer_ready: Boolean(fieldPack?.writer_ready),
      writer_notes: String(fieldPack?.writer_notes || "").trim() || null,
      source: {
        field_pack_id: Number(fieldPack?.id || 0) || null,
        field_pack_status: String(fieldPack?.status || "").trim().toLowerCase() || null,
        readiness_brief_id: Number(readinessSnapshot?.id || 0) || null,
        execution_controls_id: governance?.source_controls_id || null,
        execution_channels: governance?.source_execution_channels || null,
        content_item_id: Number(item?.id || 0) || null,
        generated_at: String(options?.generatedAt || "").trim() || new Date().toISOString(),
      },
    });
  }

  function buildAssignmentHandoffPackageFromFieldPack(fieldPack, item, options = {}) {
    const normalizedItem = item && typeof item === "object" ? item : null;
    const normalizedFieldPack = fieldPack && typeof fieldPack === "object" ? fieldPack : null;
    if (!normalizedItem?.id) throw new Error("item not found");
    if (!normalizedFieldPack?.id) throw new Error("field pack not found");
    return buildFieldPackHandoffPackage(
      normalizedItem,
      normalizedFieldPack,
      options?.governance || null,
      options?.readinessSnapshot || null,
      { generatedAt: options?.generatedAt || null }
    );
  }

  function buildAssignmentHandoffPreview(contentItemId) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const snapshot = getLatestReadinessBriefByItem(itemId);
    const readiness = snapshot?.readiness_json || null;
    const brief = snapshot?.brief_json || null;
    const governance = buildGovernanceSummaryByItem(itemId);
    const currentFieldPack = getCurrentFieldPackByItem(itemId);
    const fieldPackStatus = String(currentFieldPack?.status || "").trim().toLowerCase();
    const fieldPackReadyForHandoff = ["ready_for_field", "field_in_progress", "field_done"].includes(fieldPackStatus);

    let handoffPackage = null;
    let sourceOfTruth = "none";
    let briefSource = "none";
    const shouldUseFieldPack = Boolean(currentFieldPack?.id) && (fieldPackReadyForHandoff || !snapshot?.id);
    if (shouldUseFieldPack) {
      handoffPackage = buildFieldPackHandoffPackage(item, currentFieldPack, governance, snapshot || null);
      sourceOfTruth = "field_pack";
      briefSource = "field_pack";
    } else if (snapshot?.id) {
      handoffPackage = finalizeAssignmentHandoffPackage({
        brief_summary: brief?.brief_summary || null,
        niche: brief?.niche || null,
        gaps: Array.isArray(brief?.gaps) ? brief.gaps : [],
        next_actions: Array.isArray(brief?.next_actions) ? brief.next_actions : [],
        evidence_summary: brief?.evidence_summary || null,
        recommended_angle: brief?.recommended_angle || null,
        recommended_hook: brief?.recommended_hook || null,
        script_suggestions: Array.isArray(brief?.script_suggestions) ? brief.script_suggestions : [],
        caption_suggestions: Array.isArray(brief?.caption_suggestions) ? brief.caption_suggestions : [],
        shot_list_suggestions: Array.isArray(brief?.shot_list_suggestions) ? brief.shot_list_suggestions : [],
        source: {
          field_pack_id: null,
          readiness_brief_id: snapshot?.id || null,
          execution_controls_id: governance?.source_controls_id || null,
          execution_channels: governance?.source_execution_channels || null,
          content_item_id: itemId,
          generated_at: new Date().toISOString(),
        },
      });
      sourceOfTruth = "readiness_snapshot";
      briefSource = "readiness_snapshot";
    }

    const effectiveReadyForHandoff = shouldUseFieldPack
      ? fieldPackReadyForHandoff
      : Boolean(governance?.handoff?.ready_for_handoff);
    const effectiveReasonCodes = shouldUseFieldPack
      ? (effectiveReadyForHandoff
        ? ["field_pack_ready_for_handoff"]
        : [`field_pack_not_ready:${fieldPackStatus || "missing"}`])
      : (Array.isArray(governance?.handoff?.reason_codes) ? governance.handoff.reason_codes : []);
    const effectiveBlockers = shouldUseFieldPack
      ? (effectiveReadyForHandoff
        ? []
        : [{
          code: "field_pack_not_ready",
          stage: "assignment_handoff",
          message: "field pack status must be ready_for_field, field_in_progress, or field_done",
        }])
      : (Array.isArray(governance?.handoff?.blockers) ? governance.handoff.blockers : []);
    const effectiveMissingRequirements = shouldUseFieldPack
      ? []
      : (Array.isArray(governance?.handoff?.missing_requirements) ? governance.handoff.missing_requirements : []);

    return {
      item_id: itemId,
      field_pack: currentFieldPack || null,
      source_of_truth: sourceOfTruth,
      brief_source: briefSource,
      readiness_snapshot: snapshot || null,
      ready_for_content: Boolean(governance?.readiness?.ready_for_content),
      ready_for_execution: Boolean(governance?.execution?.ready_for_execution),
      ready_for_publish: Boolean(governance?.readiness?.ready_for_publish),
      ready_for_handoff: effectiveReadyForHandoff,
      reason_codes: effectiveReasonCodes,
      blockers: effectiveBlockers,
      missing_requirements: effectiveMissingRequirements,
      readiness_blockers: Array.isArray(readiness?.blockers) ? readiness.blockers : [],
      readiness_missing_requirements: Array.isArray(readiness?.missing_requirements) ? readiness.missing_requirements : [],
      handoff_package: handoffPackage,
      governance_summary: governance,
    };
  }

  function resolveFieldPackHandoffSourceContextAt(contentItemId, cutoffAt) {
    const itemId = Number(contentItemId || 0) || 0;
    const historicalCutoffAt = String(cutoffAt || "").trim();
    if (!itemId) throw new Error("content_item_id is required");
    if (!historicalCutoffAt) throw new Error("cutoffAt is required");

    const readinessSnapshot = normalizeReadinessBriefRow(
      latestReadinessBriefByItemBeforeStmt.get(itemId, historicalCutoffAt)
    );
    const readinessId = Number(readinessSnapshot?.id || 0) || null;
    const controlsSnapshot = readinessId
      ? normalizeExecutionControlsRow(
        latestExecutionControlsByItemAndReadinessBeforeStmt.get(itemId, readinessId, historicalCutoffAt)
      )
      : normalizeExecutionControlsRow(
        latestExecutionControlsByItemBeforeStmt.get(itemId, historicalCutoffAt)
      );

    const historicalExecutionChannels = {};
    const warnings = [];
    if (!readinessSnapshot?.id) warnings.push("historical_readiness_snapshot_missing");
    if (!controlsSnapshot?.id) warnings.push("historical_execution_controls_missing");

    for (const channel of EXECUTION_CHANNELS) {
      const channelSnapshot = readinessId
        ? normalizeExecutionChannelRow(
          latestExecutionChannelByItemAndChannelAndReadinessBeforeStmt.get(itemId, channel, readinessId, historicalCutoffAt)
        )
        : normalizeExecutionChannelRow(
          latestExecutionChannelByItemAndChannelBeforeStmt.get(itemId, channel, historicalCutoffAt)
        );
      historicalExecutionChannels[channel] = Number(channelSnapshot?.id || 0) || null;
      if (!channelSnapshot?.id) {
        warnings.push(`historical_execution_channel_missing:${channel}`);
      }
    }

    return {
      cutoff_at: historicalCutoffAt,
      readiness_snapshot: readinessSnapshot || null,
      execution_controls_snapshot: controlsSnapshot || null,
      governance: {
        source_readiness_brief_id: readinessId,
        source_controls_id: Number(controlsSnapshot?.id || 0) || null,
        source_execution_channels: historicalExecutionChannels,
      },
      warnings,
    };
  }

  function isDebugDiagnosticsEnabled() {
    return String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
  }

  function buildPublishableSourceSubmissionDiagnostics(assignment, latestSubmissionId, deliverablesBundle) {
    const assignmentId = Number(assignment?.id || 0) || 0;
    if (!assignmentId) return null;
    const assignmentContentItemId = Number(assignment?.content_item_id || 0) || null;
    const submissions = listAssignmentSubmissions(assignmentId);
    const queryTrace = {
      assignment_latest_submission_pointer_source: "content_assignments.latest_submission_id",
      submissions_query: "SELECT * FROM content_assignment_submissions WHERE assignment_id=? ORDER BY id DESC",
      deliverables_scope: "latest_submission_only",
      fulfilled_deliverable_filter: "isFulfilledAssignmentDeliverableStatus(row.status)",
    };

    const submissionRows = submissions.map((submission) => {
      const submissionId = Number(submission?.id || 0) || 0;
      const assignmentMatches = Number(submission?.assignment_id || 0) === assignmentId;
      const itemMatches = Number(submission?.content_item_id || 0) === Number(assignmentContentItemId || 0);
      let deliverables = [];
      let deliverableLookupError = null;
      try {
        deliverables = submissionId
          ? listAssignmentSubmissionDeliverablesBySubmission(assignmentId, submissionId)
          : [];
      } catch (err) {
        deliverableLookupError = String(err?.message || err || "").trim() || "deliverable_lookup_failed";
      }
      const fulfilledDeliverables = deliverables.filter((row) => isFulfilledAssignmentDeliverableStatus(row?.status));
      const articleDraftDeliverables = fulfilledDeliverables.filter((row) => {
        return String(row?.deliverable_type || "").trim().toLowerCase() === "article_draft";
      });
      const articleDraft = articleDraftDeliverables[0] || null;
      const included = submissionId === latestSubmissionId;
      const exclusionReasons = [];
      if (!assignmentMatches) exclusionReasons.push("assignment_id_mismatch");
      if (!itemMatches) exclusionReasons.push("content_item_id_mismatch");
      if (!included) exclusionReasons.push(`excluded_by_trace_mode:latest_submission_only(pointer=${latestSubmissionId || "null"})`);
      if (!fulfilledDeliverables.length) exclusionReasons.push("no_fulfilled_deliverables");
      if (!articleDraft?.id) exclusionReasons.push("article_draft_missing");
      if (!String(articleDraft?.text_content || "").trim() && !String(articleDraft?.source_url || "").trim()) {
        exclusionReasons.push("article_draft_empty");
      }
      if (deliverableLookupError) exclusionReasons.push(`deliverable_lookup_error:${deliverableLookupError}`);
      return {
        submission_id: submissionId || null,
        assignment_id: Number(submission?.assignment_id || 0) || null,
        content_item_id: Number(submission?.content_item_id || 0) || null,
        submission_state: String(submission?.submission_state || "").trim().toLowerCase() || null,
        created_at: submission?.created_at || null,
        reviewed_at: submission?.reviewed_at || null,
        assignment_latest_submission_pointer: submissionId === latestSubmissionId,
        deliverable_count: deliverables.length,
        fulfilled_deliverable_count: fulfilledDeliverables.length,
        article_draft_deliverable_id: Number(articleDraft?.id || 0) || null,
        article_draft_text_length: String(articleDraft?.text_content || "").trim().length,
        article_draft_status: String(articleDraft?.status || "").trim() || null,
        included_in_publishable_bundle: included,
        inclusion_reason: included ? "included_by_assignment_latest_submission_pointer" : null,
        exclusion_reasons: included ? [] : exclusionReasons,
      };
    });

    const latestRows = Array.isArray(deliverablesBundle?.deliverables_by_type?.article_draft)
      ? deliverablesBundle.deliverables_by_type.article_draft
      : [];

    return {
      assignment_id: assignmentId,
      assignment_state: String(assignment?.state || "").trim().toLowerCase() || null,
      assignment_content_item_id: assignmentContentItemId,
      assignment_latest_submission_id: Number(assignment?.latest_submission_id || 0) || null,
      resolved_latest_submission_id: latestSubmissionId,
      query_trace: queryTrace,
      latest_bundle_article_draft_deliverable_id: Number(latestRows[0]?.id || 0) || null,
      latest_bundle_article_draft_text_length: String(latestRows[0]?.text_content || "").trim().length,
      submissions: submissionRows,
    };
  }

  function buildPublishableSourceByItem(contentItemId) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const currentFieldPack = getCurrentFieldPackByItem(itemId);
    const assignments = listAssignmentsByItem(itemId);
    const assignmentStateRank = new Map([
      ["accepted", 0],
      ["closed", 1],
      ["submitted", 2],
      ["resubmitted", 3],
      ["revision_requested", 4],
      ["in_progress", 5],
      ["assigned", 6],
    ]);

    const candidates = assignments
      .map((assignment) => {
        const assignmentId = Number(assignment?.id || 0) || 0;
        if (!assignmentId) return null;
        const deliverablesBundle = getLatestAssignmentDeliverablesBundle(assignmentId);
        const deliverablesUtility = evaluateAssignmentDeliverablesUtilityReadiness(assignmentId);
        const governanceSummary = evaluateAssignmentDeliverablesGovernanceSummaryByAssignment(assignmentId);
        const latestSubmissionId = Number(
          governanceSummary?.latest_submission_id
          || deliverablesUtility?.latest_submission_id
          || deliverablesBundle?.latest_submission_id
          || 0
        ) || null;
        const latestSubmission = latestSubmissionId ? getAssignmentSubmissionById(latestSubmissionId) : null;
        const articleDraftRows = Array.isArray(deliverablesBundle?.deliverables_by_type?.article_draft)
          ? deliverablesBundle.deliverables_by_type.article_draft
          : [];
        const articleDraft = articleDraftRows
          .slice()
          .sort((a, b) => {
            const aThai = String(a?.lang || "").trim().toLowerCase() === "th" ? 1 : 0;
            const bThai = String(b?.lang || "").trim().toLowerCase() === "th" ? 1 : 0;
            return bThai - aThai;
          })
          .find((row) => row && (String(row?.text_content || "").trim() || String(row?.source_url || "").trim()))
          || articleDraftRows[0]
          || null;
        const articleText = String(articleDraft?.text_content || "").trim();
        const assignmentState = String(assignment?.state || "").trim().toLowerCase();
        const assignmentAccepted = assignmentState === "accepted" || assignmentState === "closed";
        const deliverablesReviewUsable = Boolean(deliverablesUtility?.review_usable);
        const hasArticleDraftDeliverable = Boolean(articleDraft?.id);
        const hasArticleDraftContent = Boolean(articleText || String(articleDraft?.source_url || "").trim());
        const readyForPublishSource = assignmentAccepted
          && Boolean(latestSubmissionId)
          && hasArticleDraftDeliverable
          && hasArticleDraftContent
          && deliverablesReviewUsable;

        return {
          assignment_id: assignmentId,
          assignment_state: assignmentState,
          assignment_rank: assignmentStateRank.has(assignmentState) ? assignmentStateRank.get(assignmentState) : 99,
          latest_submission_id: latestSubmissionId,
          latest_submission: latestSubmission,
          deliverables_bundle: deliverablesBundle,
          deliverables_utility: deliverablesUtility,
          governance_summary: governanceSummary,
          article_draft: articleDraft,
          article_text: articleText,
          has_article_draft_deliverable: hasArticleDraftDeliverable,
          has_article_draft_content: hasArticleDraftContent,
          ready_for_publish_source: readyForPublishSource,
          updated_at: String(assignment?.updated_at || assignment?.created_at || latestSubmission?.created_at || "").trim(),
          debug: isDebugDiagnosticsEnabled()
            ? buildPublishableSourceSubmissionDiagnostics(assignment, latestSubmissionId, deliverablesBundle)
            : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (Number(b.ready_for_publish_source) !== Number(a.ready_for_publish_source)) {
          return Number(b.ready_for_publish_source) - Number(a.ready_for_publish_source);
        }
        if (Number(b.has_article_draft_content) !== Number(a.has_article_draft_content)) {
          return Number(b.has_article_draft_content) - Number(a.has_article_draft_content);
        }
        if (Number(b.has_article_draft_deliverable) !== Number(a.has_article_draft_deliverable)) {
          return Number(b.has_article_draft_deliverable) - Number(a.has_article_draft_deliverable);
        }
        if (Number(b.deliverables_utility?.review_usable) !== Number(a.deliverables_utility?.review_usable)) {
          return Number(b.deliverables_utility?.review_usable) - Number(a.deliverables_utility?.review_usable);
        }
        if (a.assignment_rank !== b.assignment_rank) return a.assignment_rank - b.assignment_rank;
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
      });

    const candidate = candidates[0] || null;
    const articleText = String(candidate?.article_text || "").trim();
    const excerpt = articleText
      ? `${articleText.slice(0, 240)}${articleText.length > 240 ? "..." : ""}`
      : String(item.summary || "").trim() || null;
    const issues = [];

    if (!currentFieldPack?.id) issues.push("Missing current field pack");
    if (!assignments.length) issues.push("Missing assignment");
    if (!candidate) {
      issues.push("Missing publishable assignment source");
    } else {
      if (!(candidate.assignment_state === "accepted" || candidate.assignment_state === "closed")) {
        issues.push("Assignment has not been accepted yet");
      }
      if (!candidate.latest_submission_id) issues.push("Missing latest assignment submission");
      if (!candidate.article_draft?.id) issues.push("Missing article draft deliverable");
      if (!(articleText || String(candidate.article_draft?.source_url || "").trim())) {
        issues.push("Article draft deliverable has no content");
      }
      if (!candidate.deliverables_utility?.review_usable) {
        issues.push("Assignment deliverables are not review-usable");
      }
    }

    return {
      content_item_id: itemId,
      ready_for_publish_source: Boolean(candidate?.ready_for_publish_source),
      issues,
      checks: {
        has_current_field_pack: Boolean(currentFieldPack?.id),
        has_assignment: assignments.length > 0,
        assignment_accepted: Boolean(candidate && (candidate.assignment_state === "accepted" || candidate.assignment_state === "closed")),
        has_latest_submission: Boolean(candidate?.latest_submission_id),
        has_article_draft_deliverable: Boolean(candidate?.article_draft?.id),
        has_article_draft_content: Boolean(articleText || String(candidate?.article_draft?.source_url || "").trim()),
        deliverables_review_usable: Boolean(candidate?.deliverables_utility?.review_usable),
      },
      source: candidate ? {
        source_kind: "assignment_submission_article_draft",
        assignment_id: candidate.assignment_id,
        assignment_state: candidate.assignment_state,
        latest_submission_id: candidate.latest_submission_id,
        field_pack_id: Number(currentFieldPack?.id || 0) || null,
        article_draft_deliverable_id: Number(candidate.article_draft?.id || 0) || null,
        article_draft_lang: String(candidate.article_draft?.lang || "").trim().toLowerCase() || null,
        article_draft_title: String(candidate.article_draft?.title || "").trim() || null,
        article_draft_body_length: articleText.length,
        article_payload_json: candidate.latest_submission?.article_payload_json || null,
        reason_codes: dedupeStringList([
          ...(Array.isArray(candidate.deliverables_utility?.reason_codes) ? candidate.deliverables_utility.reason_codes : []),
          ...(Array.isArray(candidate.governance_summary?.reason_codes) ? candidate.governance_summary.reason_codes : []),
        ]),
      } : null,
      debug: isDebugDiagnosticsEnabled() ? {
        candidate_assignment_id: Number(candidate?.assignment_id || 0) || null,
        candidate_assignment_state: String(candidate?.assignment_state || "").trim().toLowerCase() || null,
        candidate_latest_submission_id: Number(candidate?.latest_submission_id || 0) || null,
        selection_trace: "candidates sorted by ready_for_publish_source desc, has_article_draft_content desc, has_article_draft_deliverable desc, deliverables_review_usable desc, assignment_rank asc, updated_at desc",
        has_article_draft_deliverable: Boolean(candidate?.has_article_draft_deliverable),
        article_draft_body_length: String(candidate?.article_text || "").trim().length,
        assignment_rank: Number(candidate?.assignment_rank ?? 99),
        ready_for_publish_source: Boolean(candidate?.ready_for_publish_source),
        selected_candidate_reason: candidate
          ? (candidate.ready_for_publish_source
            ? "won_by_ready_for_publish_source"
            : candidate.has_article_draft_content
              ? "won_by_article_draft_content_signal"
              : candidate.has_article_draft_deliverable
                ? "won_by_article_draft_deliverable_signal"
                : "won_by_assignment_rank_fallback")
          : null,
        assignments: candidates.map((row) => ({
          ...(row?.debug || {}),
          assignment_rank: Number(row?.assignment_rank ?? 99),
          ready_for_publish_source: Boolean(row?.ready_for_publish_source),
          has_article_draft_deliverable: Boolean(row?.has_article_draft_deliverable),
          article_draft_body_length: String(row?.article_text || "").trim().length,
        })).filter(Boolean),
      } : null,
      resolved_article: candidate ? {
        title: String(candidate.article_draft?.title || item.title || "").trim() || null,
        excerpt,
        body: articleText || null,
        meta_title: String(item.meta_title || candidate.article_draft?.title || item.title || "").trim() || null,
        meta_description: String(item.meta_description || excerpt || "").trim() || null,
      } : null,
    };
  }

  function buildFieldReturnEvidenceByItem(contentItemId) {
    const itemId = Number(contentItemId || 0) || 0;
    const empty = { version: 1, items: [] };
    if (!itemId) return empty;
    const assignments = listAssignmentsByItem(itemId);
    if (!assignments.length) return empty;
    const items = assignments
      .map((assignment) => {
        const assignmentId = Number(assignment?.id || 0) || 0;
        const latestSubmissionId = Number(assignment?.latest_submission_id || 0) || 0;
        if (!assignmentId || !latestSubmissionId) return [];
        const submission = getAssignmentSubmissionById(latestSubmissionId);
        const returns = submission?.field_return_payload_json?.requested_check_returns;
        if (!returns || typeof returns !== "object") return [];
        const submittedAt = submission?.updated_at || submission?.created_at || null;
        return Object.entries(returns).map(([key, entry]) => {
          const normalizedKey = String(key || "").trim().toLowerCase();
          const [groupKey = "", ...rest] = normalizedKey.split(".");
          const checkKey = rest.join(".").trim().toLowerCase();
          return {
            key: normalizedKey,
            group_key: groupKey || "other",
            check_key: checkKey || normalizedKey,
            label: fieldReturnEvidenceLabelFromKey(groupKey, checkKey || normalizedKey),
            checked: entry?.checked === true,
            found: entry?.found === true,
            value: entry?.value ?? null,
            condition_note: String(entry?.condition_note || "").trim() || null,
            evidence: String(entry?.evidence || "").trim() || null,
            note: String(entry?.note || "").trim() || null,
            submitted_at: submittedAt,
            submitted_by_user_id: Number(submission?.submitted_by_user_id || 0) || null,
            assignment_id: assignmentId,
            submission_id: latestSubmissionId,
          };
        });
      })
      .flat()
      .sort((a, b) => {
        const aTime = Date.parse(a?.submitted_at || "") || 0;
        const bTime = Date.parse(b?.submitted_at || "") || 0;
        if (bTime !== aTime) return bTime - aTime;
        return (Number(b?.submission_id || 0) || 0) - (Number(a?.submission_id || 0) || 0);
      });
    return {
      version: 1,
      items,
    };
  }

  function createAssignmentFromReadiness(
    contentItemId,
    payload = {},
    actorUserId = null,
    actorEmail = "system@local",
    actorRole = "system",
    options = {}
  ) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) throw new Error("content_item_id is required");

    const preview = buildAssignmentHandoffPreview(itemId);
    if (!preview.handoff_package) {
      throw new Error("field pack or readiness snapshot is required before creating assignment handoff");
    }

    const forceOverride = toBooleanFlag(payload.force_override ?? payload.force);
    const forceReason = payload.force_reason == null ? null : String(payload.force_reason || "").trim() || null;
    const requireReadyForHandoff = options?.requireReadyForHandoff !== false;
    if (requireReadyForHandoff && !preview.ready_for_handoff) {
      if (!forceOverride) {
        throw new Error("item is not ready_for_handoff; use force_override with force_reason");
      }
      if (!forceReason) {
        throw new Error("force_reason is required when force_override is enabled");
      }
    }

    const briefOverrideApplied = payload.brief_json != null;
    const assignmentBrief = briefOverrideApplied ? payload.brief_json : preview.handoff_package;

    const transactionResult = runInTransaction(db, () => {
      const assignment = createAssignment(
        {
          ...payload,
          content_item_id: itemId,
          brief_json: assignmentBrief,
        },
        actorUserId,
        {
          actor_email: actorEmail,
          actor_role: actorRole,
          reason_code: preview.source_of_truth === "field_pack"
            ? WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC_FROM_FIELD_PACK
            : WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC_FROM_READINESS,
          note: preview.ready_for_handoff
            ? `assignment created from ${preview.source_of_truth === "field_pack" ? "field pack handoff" : "readiness handoff"}`
            : `assignment created from forced ${preview.source_of_truth === "field_pack" ? "field pack handoff" : "readiness handoff"}`,
        }
      );

      insertAssignmentHandoffSnapshotStmt.run(
        Number(assignment.id || 0),
        itemId,
        Number(preview.readiness_snapshot?.id || 0) || null,
        JSON.stringify(preview.handoff_package),
        preview.ready_for_handoff ? "ready" : "forced",
        forceReason,
        String(actorEmail || "").trim() || null
      );

      const handoff = normalizeAssignmentHandoffRow(latestAssignmentHandoffByAssignmentStmt.get(Number(assignment.id || 0)));
      return { assignment, handoff };
    });
    return {
      assignment: transactionResult.assignment,
      handoff: transactionResult.handoff,
      preview,
      guard: {
        mode: preview.ready_for_handoff
          ? (preview.source_of_truth === "field_pack" ? "field_pack" : "readiness")
          : "forced",
        force_override: forceOverride,
        force_reason: forceReason,
        source_of_truth: preview.source_of_truth || "none",
        brief_source: briefOverrideApplied ? "override" : (preview.brief_source || "none"),
        brief_override_applied: briefOverrideApplied,
      },
    };
  }

  function repairAssignmentHandoffSnapshotForAssignment(assignmentId, fieldPackId, options = {}) {
    const resolvedAssignmentId = Number(assignmentId || 0) || 0;
    const resolvedFieldPackId = Number(fieldPackId || 0) || 0;
    const applyRequested = options?.apply === true;
    const actorEmail = String(options?.actorEmail || "system@local").trim() || "system@local";
    const repairExecutedAt = new Date().toISOString();
    const existingHandoff = resolvedAssignmentId ? getLatestAssignmentHandoffByAssignment(resolvedAssignmentId) : null;
    const assignment = resolvedAssignmentId ? getAssignmentById(resolvedAssignmentId) : null;
    const item = assignment?.content_item_id ? getItem(Number(assignment.content_item_id || 0)) : null;
    const fieldPack = resolvedFieldPackId ? getFieldPackBundleById(resolvedFieldPackId) : null;
    const fieldPackStatus = String(fieldPack?.status || "").trim().toLowerCase() || null;
    const supportedRepairStatuses = new Set(["ready_for_field", "field_in_progress", "field_done"]);
    const validationErrors = [];
    const validationWarnings = [];
    const historicalCutoffAt = String(assignment?.created_at || "").trim() || null;
    let historicalContext = null;

    if (!resolvedAssignmentId) validationErrors.push("assignment_id is required");
    if (!assignment) validationErrors.push("assignment not found");
    if (!resolvedFieldPackId) validationErrors.push("field_pack_id is required");
    if (assignment && String(assignment.assignment_kind || "").trim().toLowerCase() !== "field") {
      validationErrors.push("repair is supported only for field assignments");
    }
    if (existingHandoff?.id) validationWarnings.push("already_exists");
    if (resolvedFieldPackId && !fieldPack) validationErrors.push("field pack not found");
    if (assignment && fieldPack && Number(fieldPack.content_item_id || 0) !== Number(assignment.content_item_id || 0)) {
      validationErrors.push("field pack belongs to another content item");
    }
    if (fieldPack && !supportedRepairStatuses.has(fieldPackStatus || "")) {
      validationErrors.push("field pack status must be ready_for_field, field_in_progress, or field_done");
    }

    let handoffPackage = null;
    let historicalReadinessBriefId = null;
    if (!validationErrors.length && !existingHandoff?.id) {
      try {
        historicalContext = resolveFieldPackHandoffSourceContextAt(
          Number(assignment?.content_item_id || 0) || 0,
          historicalCutoffAt
        );
        historicalReadinessBriefId = Number(historicalContext?.readiness_snapshot?.id || 0) || null;
        handoffPackage = buildAssignmentHandoffPackageFromFieldPack(fieldPack, item, {
          governance: historicalContext?.governance || null,
          readinessSnapshot: historicalContext?.readiness_snapshot || null,
          generatedAt: historicalCutoffAt,
        });
        validationWarnings.push(...(Array.isArray(historicalContext?.warnings) ? historicalContext.warnings : []));
      } catch (error) {
        validationErrors.push(String(error?.message || "cannot build handoff package"));
      }
      if (!handoffPackage) {
        validationErrors.push("field pack does not contain a buildable handoff package");
      }
    }

    const requestedCheckGroups = Array.isArray(handoffPackage?.requested_checks?.groups)
      ? handoffPackage.requested_checks.groups
      : [];
    const requestedCheckCount = requestedCheckGroups.reduce((sum, group) => {
      return sum + (Array.isArray(group?.checks) ? group.checks.length : 0);
    }, 0);
    const wouldApply = validationErrors.length === 0 && !existingHandoff?.id;
    const baseDiagnostics = {
      ok: validationErrors.length === 0,
      created: false,
      repaired: false,
      reason: existingHandoff?.id ? "already_exists" : (validationErrors.length ? "rejected" : "dry_run"),
      assignment_id: resolvedAssignmentId || null,
      content_item_id: Number(assignment?.content_item_id || 0) || null,
      assignment_kind: String(assignment?.assignment_kind || "").trim().toLowerCase() || null,
      assignment_created_at: assignment?.created_at || null,
      field_pack_id: resolvedFieldPackId || null,
      field_pack_status: fieldPackStatus,
      field_pack_created_at: fieldPack?.created_at || null,
      field_pack_updated_at: fieldPack?.updated_at || null,
      historical_cutoff_at: historicalCutoffAt,
      historical_readiness_brief_id: historicalReadinessBriefId,
      historical_execution_controls_id: Number(historicalContext?.execution_controls_snapshot?.id || 0) || null,
      historical_execution_channels: historicalContext?.governance?.source_execution_channels || {
        facebook: null,
        tiktok: null,
      },
      repair_executed_at: repairExecutedAt,
      source_generated_at: String(handoffPackage?.source?.generated_at || historicalCutoffAt || "").trim() || null,
      existing_snapshot_id: Number(existingHandoff?.id || 0) || null,
      requested_check_group_count: requestedCheckGroups.length,
      requested_check_count: requestedCheckCount,
      apply_requested: applyRequested,
      would_apply: wouldApply,
      applied: false,
      errors: validationErrors,
      warnings: validationWarnings,
      mode: "repair_from_explicit_field_pack",
      audit_actor: actorEmail,
      handoff: existingHandoff || null,
    };

    if (existingHandoff?.id || validationErrors.length || !applyRequested) {
      return baseDiagnostics;
    }

    insertAssignmentHandoffSnapshotStmt.run(
      resolvedAssignmentId,
      Number(assignment?.content_item_id || 0) || null,
      historicalReadinessBriefId,
      JSON.stringify(handoffPackage),
      "repair_from_explicit_field_pack",
      null,
      actorEmail
    );

    const handoff = normalizeAssignmentHandoffRow(latestAssignmentHandoffByAssignmentStmt.get(resolvedAssignmentId));
    return {
      ...baseDiagnostics,
      ok: true,
      created: true,
      repaired: true,
      reason: "created",
      existing_snapshot_id: Number(handoff?.id || 0) || null,
      created_snapshot_id: Number(handoff?.id || 0) || null,
      would_apply: true,
      applied: true,
      handoff,
    };
  }

  function getLatestAssignmentHandoffByAssignment(assignmentId) {
    return normalizeAssignmentHandoffRow(latestAssignmentHandoffByAssignmentStmt.get(Number(assignmentId || 0)));
  }

  function addVersion(contentItemId, generatedBy, data) {
    const latest = latestVersionStmt.get(contentItemId)?.max_version || 0;
    insertVersionStmt.run(
      contentItemId,
      latest + 1,
      data.title || null,
      data.description_clean || null,
      data.summary || null,
      data.meta_title || null,
      data.meta_description || null,
      generatedBy
    );
  }

  function stageItem(contentItemId, payload) {
    upsertStagingStmt.run(contentItemId, JSON.stringify(payload));
  }

  function listStaging() {
    return listStagingStmt.all().map((row) => ({
      ...row,
      tags: parseTags(row.tags),
    }));
  }

  function createPipelineRun(stage, status, inputCount, outputCount, message) {
    const runUid = randomUUID();
    insertPipelineRunStmt.run(runUid, stage, status, inputCount || 0, outputCount || 0, message || null);
    return runUid;
  }

  function finishPipelineRun(runUid, status, outputCount, message) {
    finishPipelineRunStmt.run(status, outputCount || 0, message || null, runUid);
  }

  function createExportJob(format, outputPath, itemCount, status = "running") {
    const jobUid = randomUUID();
    insertExportJobStmt.run(jobUid, format, outputPath, itemCount || 0, status);
    return jobUid;
  }

  function finishExportJob(jobUid, status = "done") {
    finishExportJobStmt.run(status, jobUid);
  }

  function listExports() {
    return db.prepare("SELECT * FROM export_jobs ORDER BY id DESC LIMIT 100").all();
  }

  function startSourceIngestion(adapter, sourceLabel, status = "collected", message = null) {
    const batchUid = randomUUID();
    insertSourceIngestionStmt.run(batchUid, adapter, sourceLabel || null, status, 0, message || null);
    return batchUid;
  }

  function finishSourceIngestion(batchUid, status, itemCount, message = null) {
    finishSourceIngestionStmt.run(status, Number(itemCount || 0), message || null, batchUid);
  }

  function addRawSourceItem(batchUid, item = {}) {
    const payloadJson = item.payload_json ? JSON.stringify(item.payload_json) : null;
    const normalizedJson = item.normalized_json ? JSON.stringify(item.normalized_json) : null;

    const result = insertRawSourceItemStmt.run(
      batchUid,
      item.source_ref || null,
      item.source_url || null,
      item.source_type || "social",
      item.title_raw || null,
      item.description_raw || null,
      payloadJson,
      normalizedJson,
      item.status || "raw"
    );

    return Number(result.lastInsertRowid || 0);
  }

  function addRawSourceMedia(rawItemId, media = {}) {
    const result = insertRawSourceMediaStmt.run(
      rawItemId,
      media.media_url || null,
      media.checksum || null,
      media.mime_type || null,
      media.width ?? null,
      media.height ?? null,
      media.status || "raw",
      media.metadata_json ? JSON.stringify(media.metadata_json) : null
    );

    return Number(result.lastInsertRowid || 0);
  }

  function listSourceIngestions(limit = 100) {
    return db.prepare("SELECT * FROM source_ingestions ORDER BY id DESC LIMIT ?").all(Number(limit || 100));
  }

  function listRawSourceItems(batchUid = "", limit = 200) {
    if (batchUid) {
      return db
        .prepare("SELECT * FROM source_raw_items WHERE batch_uid=? ORDER BY id DESC LIMIT ?")
        .all(batchUid, Number(limit || 200));
    }
    return db.prepare("SELECT * FROM source_raw_items ORDER BY id DESC LIMIT ?").all(Number(limit || 200));
  }

  function listSourceRecordsByItem(contentItemId) {
    return listSourceByItemStmt.all(contentItemId).map((row) => ({
      ...row,
      payload_json: parseJson(row.payload_json, null),
    }));
  }

  function getOfficialReferenceByItem(contentItemId) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) return null;
    const rows = listSourceByItemStmt
      .all(itemId)
      .map((row) => ({
        row,
        score: scoreOfficialReferenceRecord(row),
      }))
      .filter((entry) => Number.isFinite(entry.score) && entry.score >= MIN_OFFICIAL_REFERENCE_SCORE)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return Number(b.row?.id || 0) - Number(a.row?.id || 0);
      });

    if (rows.length === 0) return null;
    return mapOfficialReferenceRow(rows[0].row);
  }

  function startGenerationRun(mode = "deterministic", model = "") {
    const runUid = randomUUID();
    insertGenerationRunStmt.run(runUid, mode, model || null, "running", 0, 0, 0, "Generation started");
    return runUid;
  }

  function finishGenerationRun(runUid, status, outputCount = 0, errorCount = 0, message = null) {
    finishGenerationRunStmt.run(status, Number(outputCount || 0), Number(errorCount || 0), message || null, runUid);
  }

  function hasOwnDraftField(source, key) {
    return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
  }

  function readDraftField(source, key, fallback = "") {
    if (hasOwnDraftField(source, key)) return source[key];
    return fallback;
  }

  function saveDraft(contentItemId, generationRunUid, draft = {}) {
    const confirmedCtaContact = normalizeConfirmedCtaContactJson(draft.confirmed_cta_contact_json);
    const confirmedTaxonomy = normalizeConfirmedTaxonomyJson(draft.confirmed_taxonomy_json);
    upsertDraftStmt.run(
      contentItemId,
      generationRunUid,
      String(readDraftField(draft, "draft_title", "Untitled draft") ?? ""),
      String(readDraftField(draft, "excerpt", "") ?? ""),
      String(readDraftField(draft, "body", "") ?? ""),
      String(readDraftField(draft, "meta_title", "") ?? ""),
      String(readDraftField(draft, "meta_description", "") ?? ""),
      JSON.stringify(draft.suggested_related || []),
      draft.ai_quality_score ?? null,
      JSON.stringify(confirmedCtaContact),
      JSON.stringify(confirmedTaxonomy),
      normalizeConfirmedMetaStatusValue(draft.confirmed_meta_status),
      draft.confirmed_by_user_id == null || draft.confirmed_by_user_id === "" ? null : Number(draft.confirmed_by_user_id || 0) || null,
      draft.confirmed_at == null || draft.confirmed_at === "" ? null : toNullableDateIso(draft.confirmed_at, "confirmed_at"),
      draft.confirmed_note == null ? null : String(draft.confirmed_note || "").trim() || null,
      String(readDraftField(draft, "status", "generated") || "generated")
    );

    return latestDraftByItem(contentItemId);
  }

  function latestDraftByItem(contentItemId) {
    return normalizeContentDraftRow(latestDraftByItemStmt.get(contentItemId));
  }

  function listDrafts(status = "") {
    const sql = status
      ? `SELECT d.*, c.title AS item_title, wm.production_state, wm.publication_state FROM content_drafts d JOIN content_items c ON c.id=d.content_item_id LEFT JOIN content_workflow_models wm ON wm.content_item_id=c.id WHERE d.status=? ORDER BY d.id DESC`
      : `SELECT d.*, c.title AS item_title, wm.production_state, wm.publication_state FROM content_drafts d JOIN content_items c ON c.id=d.content_item_id LEFT JOIN content_workflow_models wm ON wm.content_item_id=c.id ORDER BY d.id DESC`;
    const rows = status ? db.prepare(sql).all(status) : db.prepare(sql).all();
    return rows.map((row) => ({
      ...normalizeContentDraftRow(row),
      workflow_head_derived_status: deriveWorkflowStatusFromRowStates(row),
      workflow_head_status_source: "workflow_head",
    }));
  }

  function addReviewReport(contentItemId, draftId, report) {
    const result = insertReviewReportStmt.run(
      contentItemId,
      draftId || null,
      report.duplication_score || 0,
      report.seo_risk_score || 0,
      report.metadata_score || 0,
      report.grounding_score || 0,
      report.ai_quality_score || 0,
      report.total_score || 0,
      JSON.stringify(report.issues || []),
      JSON.stringify(report),
      report.status || "pending"
    );
    return Number(result.lastInsertRowid || 0);
  }

  function latestReviewByItem(contentItemId) {
    const row = latestReviewByItemStmt.get(contentItemId);
    if (!row) return null;
    return {
      ...row,
      issues: parseJson(row.issues_json, []),
      report: parseJson(row.report_json, null),
    };
  }

  function latestApprovedReviewByItem(contentItemId) {
    const row = latestApprovedReviewByItemStmt.get(contentItemId);
    if (!row) return null;
    return {
      ...row,
      issues: parseJson(row.issues_json, []),
      report: parseJson(row.report_json, null),
    };
  }

  function assertFieldPackAssignmentsBelongToItem(contentItemId, assignments = []) {
    const itemId = Number(contentItemId || 0);
    for (const assignment of Array.isArray(assignments) ? assignments : []) {
      const linkedAssignmentId = Number(assignment?.linked_assignment_id || 0) || null;
      if (!linkedAssignmentId) continue;
      const linkedAssignment = normalizeAssignmentRow(getAssignmentByIdStmt.get(linkedAssignmentId));
      if (!linkedAssignment) {
        throw new Error(`linked assignment not found: ${linkedAssignmentId}`);
      }
      if (Number(linkedAssignment.content_item_id || 0) !== itemId) {
        throw new Error(`linked assignment ${linkedAssignmentId} belongs to another content item`);
      }
    }
  }

  function assertFieldPackSourcesBelongToItem(contentItemId, payload) {
    const itemId = Number(contentItemId || 0);
    const draftId = Number(payload?.source_draft_id || 0) || null;
    const reviewReportId = Number(payload?.source_review_report_id || 0) || null;
    const snapshotId = Number(payload?.source_draft_input_snapshot_id || 0) || null;

    if (draftId) {
      const draft = getDraftByIdStmt.get(draftId);
      if (!draft) throw new Error(`source draft not found: ${draftId}`);
      if (Number(draft.content_item_id || 0) !== itemId) {
        throw new Error(`source draft ${draftId} belongs to another content item`);
      }
    }

    if (reviewReportId) {
      const review = getReviewReportByIdStmt.get(reviewReportId);
      if (!review) throw new Error(`source review report not found: ${reviewReportId}`);
      if (Number(review.content_item_id || 0) !== itemId) {
        throw new Error(`source review report ${reviewReportId} belongs to another content item`);
      }
    }

    if (snapshotId) {
      const snapshot = getDraftInputSnapshotByIdStmt.get(snapshotId);
      if (!snapshot) throw new Error(`source draft input snapshot not found: ${snapshotId}`);
      if (Number(snapshot.content_item_id || 0) !== itemId) {
        throw new Error(`source draft input snapshot ${snapshotId} belongs to another content item`);
      }
    }
  }

  function assertFieldPackMediaHintsBelongToItem(contentItemId, mediaHints = []) {
    const itemId = Number(contentItemId || 0);
    for (const mediaHint of Array.isArray(mediaHints) ? mediaHints : []) {
      const contentAssetId = Number(mediaHint?.content_asset_id || 0) || null;
      if (!contentAssetId) continue;
      const contentAsset = getContentAssetByIdStmt.get(contentAssetId);
      if (!contentAsset) {
        throw new Error(`content asset not found: ${contentAssetId}`);
      }
      if (Number(contentAsset.content_item_id || 0) !== itemId) {
        throw new Error(`content asset ${contentAssetId} belongs to another content item`);
      }
    }
  }

  function getFieldPackBundleById(fieldPackId) {
    const id = Number(fieldPackId || 0);
    if (!id) return null;
    const pack = normalizeFieldPackRow(getFieldPackByIdStmt.get(id));
    if (!pack) return null;
    return {
      ...pack,
      checklists: listFieldPackChecklistsByPackStmt.all(id).map(normalizeFieldPackChecklistRow),
      references: listFieldPackReferencesByPackStmt.all(id).map(normalizeFieldPackReferenceRow),
      media_hints: listFieldPackMediaHintsByPackStmt.all(id).map(normalizeFieldPackMediaHintRow),
      assignments: listFieldPackAssignmentsByPackStmt.all(id).map(normalizeFieldPackAssignmentRow),
    };
  }

  function getCurrentFieldPackByItem(contentItemId) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) return null;
    const row = getCurrentFieldPackByItemStmt.get(itemId);
    if (!row) return null;
    return getFieldPackBundleById(row.id);
  }

  function listFieldPacksByItem(contentItemId) {
    const itemId = Number(contentItemId || 0);
    if (!itemId) return [];
    return listFieldPacksByItemStmt.all(itemId).map(normalizeFieldPackRow);
  }

  function listAgentProfiles() {
    return listAgentProfilesStmt.all().map(normalizeAgentProfileRow).filter(Boolean);
  }

  function getAgentProfile(agentKey) {
    const key = String(agentKey || "").trim().toLowerCase();
    if (!key) return null;
    return normalizeAgentProfileRow(getAgentProfileStmt.get(key));
  }

  function upsertAgentProfile(agentKey, payload = {}) {
    const key = String(agentKey || "").trim().toLowerCase();
    if (!key) throw new Error("agent_key is required");
    const displayName = String(payload?.display_name || key).trim() || key;
    const profileText = payload && Object.prototype.hasOwnProperty.call(payload, "profile_text")
      ? String(payload.profile_text ?? "")
      : "";
    const isEnabled = toBooleanInt(payload?.is_enabled ?? 1, "is_enabled");
    const updatedBy = payload?.updated_by == null ? null : String(payload.updated_by || "").trim() || null;
    upsertAgentProfileStmt.run(key, displayName, profileText, isEnabled, updatedBy);
    return getAgentProfile(key);
  }

  function listAiFeaturePolicies() {
    return listAiFeaturePoliciesStmt.all().map(normalizeAiFeaturePolicyRow).filter(Boolean);
  }

  function getAiFeaturePolicy(featureKey) {
    const key = String(featureKey || "").trim();
    if (!key) return null;
    return normalizeAiFeaturePolicyRow(getAiFeaturePolicyStmt.get(key));
  }

  function upsertAiFeaturePolicy(featureKey, payload = {}) {
    const key = String(featureKey || "").trim();
    if (!key) throw new Error("feature_key is required");
    const policyKey = String(payload?.policy_key || "").trim();
    if (!policyKey) throw new Error("policy_key is required");
    const updatedBy = payload?.updated_by == null ? null : String(payload.updated_by || "").trim() || null;
    upsertAiFeaturePolicyStmt.run(key, policyKey, updatedBy);
    return getAiFeaturePolicy(key);
  }

  function replaceFieldPackChecklists(fieldPackId, items = []) {
    const id = Number(fieldPackId || 0);
    if (!id) throw new Error("field_pack_id is required");
    if (!getFieldPackByIdStmt.get(id)) throw new Error("field pack not found");
    const normalized = normalizeFieldPackChecklistInputs(items);
    runInTransaction(db, () => {
      deleteFieldPackChecklistsByPackStmt.run(id);
      for (const item of normalized) {
        insertFieldPackChecklistStmt.run(
          id,
          item.checklist_type,
          item.item_text,
          item.capture_type,
          item.item_order,
          item.status,
          item.note
        );
      }
    });
    return getFieldPackBundleById(id);
  }

  function replaceFieldPackReferences(fieldPackId, items = []) {
    const id = Number(fieldPackId || 0);
    if (!id) throw new Error("field_pack_id is required");
    if (!getFieldPackByIdStmt.get(id)) throw new Error("field pack not found");
    const normalized = normalizeFieldPackReferenceInputs(items);
    runInTransaction(db, () => {
      deleteFieldPackReferencesByPackStmt.run(id);
      for (const item of normalized) {
        insertFieldPackReferenceStmt.run(
          id,
          item.reference_scope,
          item.label,
          item.url,
          item.source_family,
          item.note,
          item.item_order
        );
      }
    });
    return getFieldPackBundleById(id);
  }

  function replaceFieldPackMediaHints(fieldPackId, items = []) {
    const id = Number(fieldPackId || 0);
    if (!id) throw new Error("field_pack_id is required");
    if (!getFieldPackByIdStmt.get(id)) throw new Error("field pack not found");
    const normalized = normalizeFieldPackMediaHintInputs(items);
    runInTransaction(db, () => {
      deleteFieldPackMediaHintsByPackStmt.run(id);
      for (const item of normalized) {
        insertFieldPackMediaHintStmt.run(
          id,
          item.content_asset_id,
          item.url,
          item.kind,
          item.caption,
          item.selected,
          item.item_order
        );
      }
    });
    return getFieldPackBundleById(id);
  }

  function replaceFieldPackAssignments(fieldPackId, items = []) {
    const id = Number(fieldPackId || 0);
    if (!id) throw new Error("field_pack_id is required");
    const fieldPack = normalizeFieldPackRow(getFieldPackByIdStmt.get(id));
    if (!fieldPack) throw new Error("field pack not found");
    const normalized = normalizeFieldPackAssignmentInputs(items);
    assertFieldPackAssignmentsBelongToItem(fieldPack.content_item_id, normalized);
    runInTransaction(db, () => {
      deleteFieldPackAssignmentsByPackStmt.run(id);
      for (const item of normalized) {
        insertFieldPackAssignmentStmt.run(
          id,
          item.assignment_scope,
          item.linked_assignment_id,
          item.assigned_user_id,
          item.assigned_name,
          item.assigned_role,
          item.assigned_at,
          item.due_at,
          item.note
        );
      }
    });
    return getFieldPackBundleById(id);
  }

  function createFieldPackInternal(payload = {}) {
    const normalized = normalizeFieldPackPayload(payload, { requireContentItemId: true });
    const item = getItem(normalized.content_item_id);
    if (!item) throw new Error("content item not found");
    assertFieldPackSourcesBelongToItem(normalized.content_item_id, normalized);
    if (normalized.is_current) {
      clearCurrentFieldPacksByItemStmt.run(normalized.content_item_id);
    }

    const result = insertFieldPackStmt.run(
      normalized.content_item_id,
      normalized.source_draft_id,
      normalized.source_review_report_id,
      normalized.source_draft_input_snapshot_id,
      normalized.status,
      normalized.is_current,
      normalized.ai_summary,
      normalized.ai_highlights_json,
      normalized.ai_unknowns_json,
      normalized.editor_summary,
      normalized.verified_facts_json,
      normalized.uncertain_facts_json,
      normalized.story_angle,
      normalized.field_notes,
      normalized.social_hook,
      normalized.social_shot_emphasis_json,
      normalized.social_on_camera_points_json,
      normalized.social_caption_angle,
      normalized.ai_cta_contact_json,
      normalized.ai_taxonomy_json,
      normalized.requested_checks_json,
      normalized.curated_cta_contact_json,
      normalized.curated_taxonomy_json,
      normalized.curation_status,
      normalized.curated_by_user_id,
      normalized.curated_at,
      normalized.curation_note,
      normalized.writer_ready,
      normalized.writer_angle,
      normalized.writer_key_points_json,
      normalized.writer_notes,
      normalized.updated_by
    );
    const fieldPackId = Number(result.lastInsertRowid || 0);

    if (payload.field_pack_checklists != null) {
      const checklistItems = normalizeFieldPackChecklistInputs(payload.field_pack_checklists);
      for (const itemRow of checklistItems) {
        insertFieldPackChecklistStmt.run(
          fieldPackId,
          itemRow.checklist_type,
          itemRow.item_text,
          itemRow.capture_type,
          itemRow.item_order,
          itemRow.status,
          itemRow.note
        );
      }
    }
    if (payload.field_pack_references != null) {
      const referenceItems = normalizeFieldPackReferenceInputs(payload.field_pack_references);
      for (const itemRow of referenceItems) {
        insertFieldPackReferenceStmt.run(
          fieldPackId,
          itemRow.reference_scope,
          itemRow.label,
          itemRow.url,
          itemRow.source_family,
          itemRow.note,
          itemRow.item_order
        );
      }
    }
    if (payload.field_pack_media_hints != null) {
      const mediaHintItems = normalizeFieldPackMediaHintInputs(payload.field_pack_media_hints);
      assertFieldPackMediaHintsBelongToItem(normalized.content_item_id, mediaHintItems);
      for (const itemRow of mediaHintItems) {
        insertFieldPackMediaHintStmt.run(
          fieldPackId,
          itemRow.content_asset_id,
          itemRow.url,
          itemRow.kind,
          itemRow.caption,
          itemRow.selected,
          itemRow.item_order
        );
      }
    }
    if (payload.field_pack_assignments != null) {
      const assignmentItems = normalizeFieldPackAssignmentInputs(payload.field_pack_assignments);
      assertFieldPackAssignmentsBelongToItem(normalized.content_item_id, assignmentItems);
      for (const itemRow of assignmentItems) {
        insertFieldPackAssignmentStmt.run(
          fieldPackId,
          itemRow.assignment_scope,
          itemRow.linked_assignment_id,
          itemRow.assigned_user_id,
          itemRow.assigned_name,
          itemRow.assigned_role,
          itemRow.assigned_at,
          itemRow.due_at,
          itemRow.note
        );
      }
    }

    return getFieldPackBundleById(fieldPackId);
  }

  function deleteFieldPackById(fieldPackId) {
    const id = Number(fieldPackId || 0);
    if (!id) throw new Error("field_pack_id is required");
    const pack = getFieldPackByIdStmt.get(id);
    if (!pack) throw new Error("field pack not found");
    const result = runInTransaction(db, () => {
      deleteFieldPackChecklistsByPackStmt.run(id);
      deleteFieldPackReferencesByPackStmt.run(id);
      deleteFieldPackMediaHintsByPackStmt.run(id);
      deleteFieldPackAssignmentsByPackStmt.run(id);
      deleteFieldPackByIdStmt.run(id);
      return { deleted: true, field_pack_id: id, content_item_id: Number(pack.content_item_id || 0) || null };
    });
    return result;
  }

  function returnFieldPackToCleanAtomic(contentItemId, notes, actorEmail = "system@local", metadata = {}) {
    const itemId = Number(contentItemId || 0) || 0;
    const reasonNote = String(notes || "").trim() || null;
    const actor = String(actorEmail || "").trim() || "system@local";
    const actorRole = normalizeWorkflowActorRole(metadata?.actor_role);
    if (!itemId) throw new Error("content_item_id is required");
    if (!reasonNote) throw new Error("notes/reason is required");

    return runInTransaction(db, () => {
      const currentFieldPack = normalizeFieldPackRow(getCurrentFieldPackByItemStmt.get(itemId));
      if (!currentFieldPack?.id) {
        throw new Error("current field pack not found");
      }

      const workflowBefore = ensureWorkflowModel(itemId);
      const productionStateBefore = String(workflowBefore?.production_state || "").trim().toLowerCase();
      const publicationStateBefore = String(workflowBefore?.publication_state || "").trim().toLowerCase();
      if (["ready_for_publish", "completed"].includes(productionStateBefore) || publicationStateBefore === "published") {
        throw new Error("cannot return to clean from publish-ready or published state");
      }

      const activeAssignmentStates = new Set(["assigned", "in_progress", "submitted", "resubmitted", "revision_requested", "accepted"]);
      const activeAssignments = listAssignmentsByItem(itemId)
        .filter((assignment) => activeAssignmentStates.has(String(assignment?.state || "").trim().toLowerCase()));
      if (activeAssignments.length > 0) {
        throw new Error("cannot return to clean: item has active assignment or handoff");
      }

      // Validate the transition before deleting the field pack so business-rule failures
      // are caught before we mutate child data, while the whole operation still stays atomic.
      if (productionStateBefore !== "analyzed") {
        assertValidTransition("production", workflowBefore?.production_state, "analyzed");
      }

      deleteFieldPackChecklistsByPackStmt.run(Number(currentFieldPack.id || 0) || 0);
      deleteFieldPackReferencesByPackStmt.run(Number(currentFieldPack.id || 0) || 0);
      deleteFieldPackMediaHintsByPackStmt.run(Number(currentFieldPack.id || 0) || 0);
      deleteFieldPackAssignmentsByPackStmt.run(Number(currentFieldPack.id || 0) || 0);
      deleteFieldPackByIdStmt.run(Number(currentFieldPack.id || 0) || 0);

      const workflowAfter = upsertWorkflowModel(
        itemId,
        {
          production_state: "analyzed",
          current_field_pack_id: null,
          last_transition_note: reasonNote,
        },
        actor,
        {
          actor_role: actorRole,
          reason_code: "field_pack_return_to_clean",
          bump_state_version: true,
          bump_content_version: true,
        }
      );

      logAudit(actor, "field_pack.return_to_clean", "content_item", String(itemId), {
        content_item_id: itemId,
        field_pack_id: Number(currentFieldPack.id || 0) || null,
        notes: reasonNote,
        from_production_state: workflowBefore?.production_state || null,
        to_production_state: workflowAfter?.production_state || null,
        from_publication_state: workflowBefore?.publication_state || null,
        to_publication_state: workflowAfter?.publication_state || null,
      });

      return {
        ok: true,
        content_item_id: itemId,
        deleted_field_pack_id: Number(currentFieldPack.id || 0) || null,
        action: "return_to_clean",
        redirect_url: `/clean-item.html?id=${itemId}`,
        previous_state: workflowBefore?.production_state || null,
        next_state: workflowAfter?.production_state || "analyzed",
      };
    });
  }

  function createFieldPack(payload = {}) {
    return runInTransaction(db, () => createFieldPackInternal(payload));
  }

  function updateFieldPackInternal(fieldPackId, payload = {}) {
    const id = Number(fieldPackId || 0);
    if (!id) throw new Error("field_pack_id is required");
    const existing = normalizeFieldPackRow(getFieldPackByIdStmt.get(id));
    if (!existing) throw new Error("field pack not found");

    const mergedPayload = {
      ...buildFieldPackEditableState(existing),
      ...payload,
      content_item_id: existing.content_item_id,
    };
    const normalized = normalizeFieldPackPayload(mergedPayload, { requireContentItemId: true });
    assertFieldPackSourcesBelongToItem(existing.content_item_id, normalized);

    if (normalized.is_current) {
      clearCurrentFieldPacksByItemStmt.run(existing.content_item_id);
    }

    updateFieldPackStmt.run(
      normalized.source_draft_id,
      normalized.source_review_report_id,
      normalized.source_draft_input_snapshot_id,
      normalized.status,
      normalized.is_current,
      normalized.ai_summary,
      normalized.ai_highlights_json,
      normalized.ai_unknowns_json,
      normalized.editor_summary,
      normalized.verified_facts_json,
      normalized.uncertain_facts_json,
      normalized.story_angle,
      normalized.field_notes,
      normalized.social_hook,
      normalized.social_shot_emphasis_json,
      normalized.social_on_camera_points_json,
      normalized.social_caption_angle,
      normalized.ai_cta_contact_json,
      normalized.ai_taxonomy_json,
      normalized.requested_checks_json,
      normalized.curated_cta_contact_json,
      normalized.curated_taxonomy_json,
      normalized.curation_status,
      normalized.curated_by_user_id,
      normalized.curated_at,
      normalized.curation_note,
      normalized.writer_ready,
      normalized.writer_angle,
      normalized.writer_key_points_json,
      normalized.writer_notes,
      normalized.updated_by,
      id
    );

    if (Object.prototype.hasOwnProperty.call(payload, "field_pack_checklists")) {
      const checklistItems = normalizeFieldPackChecklistInputs(payload.field_pack_checklists);
      deleteFieldPackChecklistsByPackStmt.run(id);
      for (const itemRow of checklistItems) {
        insertFieldPackChecklistStmt.run(
          id,
          itemRow.checklist_type,
          itemRow.item_text,
          itemRow.capture_type,
          itemRow.item_order,
          itemRow.status,
          itemRow.note
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, "field_pack_references")) {
      const referenceItems = normalizeFieldPackReferenceInputs(payload.field_pack_references);
      deleteFieldPackReferencesByPackStmt.run(id);
      for (const itemRow of referenceItems) {
        insertFieldPackReferenceStmt.run(
          id,
          itemRow.reference_scope,
          itemRow.label,
          itemRow.url,
          itemRow.source_family,
          itemRow.note,
          itemRow.item_order
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, "field_pack_media_hints")) {
      const mediaHintItems = normalizeFieldPackMediaHintInputs(payload.field_pack_media_hints);
      assertFieldPackMediaHintsBelongToItem(existing.content_item_id, mediaHintItems);
      deleteFieldPackMediaHintsByPackStmt.run(id);
      for (const itemRow of mediaHintItems) {
        insertFieldPackMediaHintStmt.run(
          id,
          itemRow.content_asset_id,
          itemRow.url,
          itemRow.kind,
          itemRow.caption,
          itemRow.selected,
          itemRow.item_order
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, "field_pack_assignments")) {
      const assignmentItems = normalizeFieldPackAssignmentInputs(payload.field_pack_assignments);
      assertFieldPackAssignmentsBelongToItem(existing.content_item_id, assignmentItems);
      deleteFieldPackAssignmentsByPackStmt.run(id);
      for (const itemRow of assignmentItems) {
        insertFieldPackAssignmentStmt.run(
          id,
          itemRow.assignment_scope,
          itemRow.linked_assignment_id,
          itemRow.assigned_user_id,
          itemRow.assigned_name,
          itemRow.assigned_role,
          itemRow.assigned_at,
          itemRow.due_at,
          itemRow.note
        );
      }
    }

    return getFieldPackBundleById(id);
  }

  function updateFieldPack(fieldPackId, payload = {}) {
    return runInTransaction(db, () => updateFieldPackInternal(fieldPackId, payload));
  }

  function saveItemWithFieldPack(itemInput = {}, fieldPackInput = {}, actorEmail = "system@local") {
    return runInTransaction(db, () => {
      const savedItem = saveItemInternal(normalizeInput(itemInput), actorEmail);
      let fieldPack = null;
      if (fieldPackInput && typeof fieldPackInput === "object") {
        const payload = {
          ...fieldPackInput,
          content_item_id: savedItem.id,
          updated_by: fieldPackInput.updated_by ?? actorEmail,
        };
        const fieldPackId = Number(fieldPackInput.id || fieldPackInput.field_pack_id || 0) || 0;
        if (fieldPackId) {
          const existingFieldPack = normalizeFieldPackRow(getFieldPackByIdStmt.get(fieldPackId));
          if (!existingFieldPack) throw new Error("field pack not found");
          if (Number(existingFieldPack.content_item_id || 0) !== Number(savedItem.id || 0)) {
            throw new Error(`field pack ${fieldPackId} belongs to another content item`);
          }
        }
        fieldPack = fieldPackId
          ? updateFieldPackInternal(fieldPackId, payload)
          : createFieldPackInternal(payload);
      }
      return { item: savedItem, field_pack: fieldPack };
    });
  }

  function listReviewQueue() {
    const rows = db
      .prepare(`
        SELECT rr.*, c.title AS item_title, wm.production_state, wm.publication_state,
               d.generation_run_uid AS draft_generation_run_uid,
               d.draft_title AS reviewed_draft_title,
               d.updated_at AS reviewed_draft_updated_at
        FROM review_reports rr
        JOIN content_items c ON c.id=rr.content_item_id
        LEFT JOIN content_workflow_models wm ON wm.content_item_id = c.id
        LEFT JOIN content_drafts d ON d.id=rr.draft_id
        WHERE rr.status IN ('pending','needs_revision')
        ORDER BY rr.id DESC
      `)
      .all();

    return rows.map((row) => ({
      ...row,
      workflow_head_derived_status: deriveWorkflowStatusFromRowStates(row),
      workflow_head_status_source: "workflow_head",
      issues: parseJson(row.issues_json, []),
      report: parseJson(row.report_json, null),
    }));
  }

  function addReviewAction(contentItemId, reportId, action, reviewerEmail, notes) {
    insertReviewActionStmt.run(contentItemId, reportId || null, action, reviewerEmail || null, notes || null);
  }

  function setReviewStatus(reportId, status) {
    updateReviewStatusStmt.run(status, reportId);
  }

  function saveInternalLinkSuggestions(contentItemId, suggestions = []) {
    clearLinkSuggestionsByItemStmt.run(contentItemId);
    for (const s of suggestions) {
      insertLinkSuggestionStmt.run(
        contentItemId,
        s.target_content_item_id,
        s.anchor_text,
        s.relevance_score || 0,
        s.reason || null,
        s.status || "suggested"
      );
    }
  }

  function listInternalLinkSuggestions(contentItemId = null, status = "") {
    const where = [];
    const params = [];

    if (contentItemId) {
      where.push("ils.content_item_id=?");
      params.push(contentItemId);
    }

    if (status) {
      where.push("ils.status=?");
      params.push(status);
    }

    const sql = `
      SELECT ils.*, c.title AS item_title, t.title AS target_title, t.slug AS target_slug
      FROM internal_link_suggestions ils
      JOIN content_items c ON c.id=ils.content_item_id
      JOIN content_items t ON t.id=ils.target_content_item_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ils.relevance_score DESC, ils.id DESC
    `;

    return db.prepare(sql).all(...params);
  }

  function reviewInternalLinkSuggestion(id, status, reviewerEmail) {
    updateLinkSuggestionReviewStmt.run(status, reviewerEmail || null, id);
  }

  function startPublishRun(message = "Publish started") {
    const runUid = randomUUID();
    insertPublishRunStmt.run(runUid, "running", 0, 0, message);
    return runUid;
  }

  function finishPublishRun(runUid, status, outputCount = 0, message = null) {
    finishPublishRunStmt.run(status, Number(outputCount || 0), message || null, runUid);
  }

  function savePublishedArticle(payload) {
    const contentItemId = Number(payload.content_item_id || 0) || 0;
    const slug = normalizeStoredSlug(
      payload.slug || payload.title || "",
      contentItemId > 0 ? `item-${contentItemId}` : "item-published"
    );
    upsertPublishedArticleStmt.run(
      contentItemId,
      payload.draft_id ?? null,
      payload.review_report_id ?? null,
      slug,
      payload.title,
      payload.excerpt || null,
      payload.body,
      payload.meta_title || null,
      payload.meta_description || null,
      String(payload.event_period_text || "").trim() || null,
      String(payload.location_text || "").trim() || null,
      Number.isFinite(Number(payload.latitude)) ? Number(payload.latitude) : null,
      Number.isFinite(Number(payload.longitude)) ? Number(payload.longitude) : null,
      String(payload.map_url || "").trim() || null,
      String(payload.google_place_id || "").trim() || null,
      JSON.stringify(payload.related || []),
      JSON.stringify(payload.internal_links || []),
      payload.status || "published"
    );
  }

  function backfillInvalidSlugs() {
    return runInTransaction(db, () => {
      let contentItemsUpdated = 0;
      let publishedArticlesUpdated = 0;

      const invalidContentItems = db.prepare(`
        SELECT id, title, slug
        FROM content_items
        WHERE slug IS NOT NULL AND TRIM(slug) <> ''
      `).all();
      const updateContentItemSlugStmt = db.prepare("UPDATE content_items SET slug=? WHERE id=?");
      for (const row of invalidContentItems) {
        const currentSlug = String(row?.slug || "").trim().toLowerCase();
        if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(currentSlug)) continue;
        const nextSlug = normalizeStoredSlug(row?.slug || row?.title || "", `item-${Number(row?.id || 0) || "content"}`);
        if (nextSlug && nextSlug !== currentSlug) {
          updateContentItemSlugStmt.run(nextSlug, Number(row.id || 0));
          contentItemsUpdated += 1;
        }
      }

      const invalidPublishedArticles = db.prepare(`
        SELECT id, content_item_id, title, slug
        FROM published_articles
        WHERE slug IS NOT NULL AND TRIM(slug) <> ''
      `).all();
      const updatePublishedSlugStmt = db.prepare("UPDATE published_articles SET slug=? WHERE id=?");
      for (const row of invalidPublishedArticles) {
        const currentSlug = String(row?.slug || "").trim().toLowerCase();
        if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(currentSlug)) continue;
        const nextSlug = normalizeStoredSlug(row?.slug || row?.title || "", `item-${Number(row?.content_item_id || row?.id || 0) || "published"}`);
        if (nextSlug && nextSlug !== currentSlug) {
          updatePublishedSlugStmt.run(nextSlug, Number(row.id || 0));
          publishedArticlesUpdated += 1;
        }
      }

      return {
        content_items_updated: contentItemsUpdated,
        published_articles_updated: publishedArticlesUpdated,
      };
    });
  }

  function listPublishedArticles() {
    const rows = db
      .prepare(`
        SELECT
          p.*,
          c.lang AS source_lang,
          c.type AS source_type,
          c.category AS source_category,
          c.image_url AS source_image
        FROM published_articles p
        JOIN content_items c ON c.id = p.content_item_id
        WHERE LOWER(COALESCE(p.status,''))='published'
        ORDER BY p.published_at DESC, p.id DESC
      `)
      .all();

    return rows.map((row) => ({
      ...row,
      related: parseJson(row.related_json, []),
      internal_links: parseJson(row.internal_links_json, []),
    }));
  }
  function getPublishedArticleByItem(contentItemId) {
    const row = getPublishedArticleByItemStmt.get(Number(contentItemId || 0));
    if (!row) return null;
    return {
      ...row,
      related: parseJson(row.related_json, []),
      internal_links: parseJson(row.internal_links_json, []),
    };
  }
  function setPublishedArticleStatusByItem(contentItemId, status) {
    const nextStatus = normalizeStateValue(status, "publication");
    if (!nextStatus) throw new Error("invalid publication status");
    const id = Number(contentItemId || 0);
    if (!id) throw new Error("content_item_id is required");
    const existing = getPublishedArticleByItemStmt.get(id);
    if (!existing) throw new Error("published article not found");
    updatePublishedArticleStatusByItemStmt.run(nextStatus, nextStatus, id);
    return getPublishedArticleByItem(id);
  }

  function deletePublishedArticleByItem(contentItemId) {
    const id = Number(contentItemId || 0);
    if (!id) throw new Error("content_item_id is required");
    deletePublishedArticleByItemStmt.run(id);
    return { ok: true, content_item_id: id };
  }

  function restorePublishedArticleByItem(snapshot) {
    const contentItemId = Number(snapshot?.content_item_id || 0) || 0;
    if (!contentItemId) throw new Error("published article snapshot content_item_id is required");
    restorePublishedArticleByItemStmt.run(
      contentItemId,
      snapshot?.draft_id ?? null,
      snapshot?.review_report_id ?? null,
      String(snapshot?.slug || "").trim(),
      String(snapshot?.title || "").trim(),
      String(snapshot?.excerpt || "").trim() || null,
      String(snapshot?.body || "").trim(),
      String(snapshot?.meta_title || "").trim() || null,
      String(snapshot?.meta_description || "").trim() || null,
      String(snapshot?.event_period_text || "").trim() || null,
      String(snapshot?.location_text || "").trim() || null,
      Number.isFinite(Number(snapshot?.latitude)) ? Number(snapshot.latitude) : null,
      Number.isFinite(Number(snapshot?.longitude)) ? Number(snapshot.longitude) : null,
      String(snapshot?.map_url || "").trim() || null,
      String(snapshot?.google_place_id || "").trim() || null,
      JSON.stringify(Array.isArray(snapshot?.related) ? snapshot.related : []),
      JSON.stringify(Array.isArray(snapshot?.internal_links) ? snapshot.internal_links : []),
      String(snapshot?.status || "published").trim().toLowerCase() || "published",
      String(snapshot?.published_at || "").trim() || new Date().toISOString()
    );
    return getPublishedArticleByItem(contentItemId);
  }

  function getTranslation(sourceContentItemId, lang) {
    const row = getTranslationStmt.get(sourceContentItemId, lang);
    if (!row) return null;
    const sourcePublishedArticleId = Number(row.source_published_article_id || 0) || null;
    const sourceDraftId = Number(row.source_draft_id || 0) || null;
    const sourceReviewReportId = Number(row.source_review_report_id || 0) || null;
    const sourceKind = sourcePublishedArticleId
      ? "published_article"
      : (sourceDraftId || sourceReviewReportId)
        ? "legacy_draft_review"
        : "assignment_publishable_source";
    return {
      ...row,
      automatic_check_report: parseJson(row.automatic_check_report_json, null),
      recheck_issues: parseJson(row.recheck_issues_json, []),
      source_kind: sourceKind,
    };
  }

  function upsertTranslation(payload) {
    upsertTranslationStmt.run(
      payload.source_content_item_id,
      payload.source_published_article_id,
      payload.source_draft_id ?? null,
      payload.source_review_report_id ?? null,
      payload.source_fingerprint,
      payload.lang,
      payload.translated_title || null,
      payload.translated_excerpt || null,
      payload.translated_body || null,
      payload.translated_meta_title || null,
      payload.translated_meta_description || null,
      payload.translation_status || "pending",
      payload.automatic_check_status || "pending",
      payload.automatic_check_report ? JSON.stringify(payload.automatic_check_report) : null,
      payload.translation_recheck_status || "not_checked",
      Number.isFinite(Number(payload.translation_recheck_score)) ? Number(payload.translation_recheck_score) : null,
      Number.isFinite(Number(payload.accuracy_score)) ? Number(payload.accuracy_score) : null,
      Number.isFinite(Number(payload.fluency_score)) ? Number(payload.fluency_score) : null,
      Number.isFinite(Number(payload.term_score)) ? Number(payload.term_score) : null,
      payload.back_translation_th || null,
      payload.recheck_summary_th || null,
      payload.recheck_issues_json != null
        ? String(payload.recheck_issues_json || "").trim() || null
        : payload.recheck_issues
          ? JSON.stringify(payload.recheck_issues)
          : null,
      payload.recheck_model || null,
      payload.rechecked_at || null,
      Number(payload.repair_attempt_count || 0) || 0,
      payload.stale_flag ? 1 : 0,
      payload.translator_engine || null,
      payload.translator_model || null
    );
  }

  function listTranslations(sourceContentItemId = null) {
    const rows = sourceContentItemId
      ? listTranslationsByItemStmt.all(sourceContentItemId)
      : listTranslationsStmt.all();

    return rows.map((row) => ({
      ...row,
      automatic_check_report: parseJson(row.automatic_check_report_json, null),
      recheck_issues: parseJson(row.recheck_issues_json, []),
      source_kind: (Number(row.source_published_article_id || 0) || 0) > 0
        ? "published_article"
        : ((Number(row.source_draft_id || 0) || 0) > 0 || (Number(row.source_review_report_id || 0) || 0) > 0)
          ? "legacy_draft_review"
          : "assignment_publishable_source",
    }));
  }

  function markStaleTranslations(sourceContentItemId, latestFingerprint) {
    markStaleTranslationsStmt.run(sourceContentItemId, latestFingerprint);
    clearStaleCurrentFingerprintStmt.run(sourceContentItemId, latestFingerprint);
  }

  function updateTranslationRecheck(sourceContentItemId, lang, payload = {}) {
    const normalizedContentItemId = Number(sourceContentItemId || 0) || 0;
    const normalizedLang = String(lang || "").trim().toLowerCase();
    if (!normalizedContentItemId || !normalizedLang) {
      throw new Error("source_content_item_id and lang are required");
    }
    const result = updateTranslationRecheckStmt.run(
      payload.translation_recheck_status || "not_checked",
      Number.isFinite(Number(payload.translation_recheck_score)) ? Number(payload.translation_recheck_score) : null,
      Number.isFinite(Number(payload.accuracy_score)) ? Number(payload.accuracy_score) : null,
      Number.isFinite(Number(payload.fluency_score)) ? Number(payload.fluency_score) : null,
      Number.isFinite(Number(payload.term_score)) ? Number(payload.term_score) : null,
      payload.back_translation_th || null,
      payload.recheck_summary_th || null,
      payload.recheck_issues_json != null
        ? String(payload.recheck_issues_json || "").trim() || null
        : payload.recheck_issues
          ? JSON.stringify(payload.recheck_issues)
          : null,
      payload.recheck_model || null,
      payload.rechecked_at === null ? null : payload.rechecked_at || new Date().toISOString(),
      Number(payload.repair_attempt_count || 0) || 0,
      normalizedContentItemId,
      normalizedLang
    );
    if (Number(result?.changes || 0) < 1) {
      throw new Error("translation locale not found");
    }
    return getTranslation(normalizedContentItemId, normalizedLang);
  }

  function updateTranslationRepairResult(sourceContentItemId, lang, payload = {}) {
    const normalizedContentItemId = Number(sourceContentItemId || 0) || 0;
    const normalizedLang = String(lang || "").trim().toLowerCase();
    if (!normalizedContentItemId || !normalizedLang) {
      throw new Error("source_content_item_id and lang are required");
    }
    const result = updateTranslationRepairResultStmt.run(
      String(payload.source_fingerprint || "").trim() || null,
      String(payload.translated_title || "").trim() || null,
      String(payload.translated_excerpt || "").trim() || null,
      String(payload.translated_body || "").trim() || null,
      String(payload.translated_meta_title || "").trim() || null,
      String(payload.translated_meta_description || "").trim() || null,
      String(payload.translation_status || "pending").trim().toLowerCase() || "pending",
      String(payload.automatic_check_status || "pending").trim().toLowerCase() || "pending",
      payload.automatic_check_report ? JSON.stringify(payload.automatic_check_report) : null,
      Number(payload.repair_attempt_count || 0) || 0,
      normalizedContentItemId,
      normalizedLang,
    );
    if (Number(result?.changes || 0) < 1) {
      throw new Error("translation locale not found");
    }
    return getTranslation(normalizedContentItemId, normalizedLang);
  }

  function startTranslationRun(stage = "final-prefrontend", inputCount = 0, message = "Translation started") {
    const runUid = randomUUID();
    insertTranslationRunStmt.run(runUid, stage, "running", Number(inputCount || 0), 0, 0, message);
    return runUid;
  }

  function finishTranslationRun(runUid, status, outputCount = 0, failedCount = 0, message = null) {
    finishTranslationRunStmt.run(status, Number(outputCount || 0), Number(failedCount || 0), message || null, runUid);
  }

  function listTranslationRuns(limit = 100) {
    return db.prepare("SELECT * FROM translation_runs ORDER BY id DESC LIMIT ?").all(Number(limit || 100));
  }

  function addEvidenceBlock(contentItemId, payload = {}) {
    const blockType = String(payload.block_type || "").trim();
    if (!blockType) throw new Error("block_type is required");
    if (!EVIDENCE_BLOCK_TYPES.has(blockType)) {
      throw new Error("invalid block_type");
    }

    const sourceType = String(payload.source_type || "manual").trim() || "manual";
    if (!EVIDENCE_SOURCE_TYPES.has(sourceType)) {
      throw new Error("invalid source_type");
    }

    const status = String(payload.status || "active").trim().toLowerCase();
    if (!EVIDENCE_STATUSES.has(status)) {
      throw new Error("invalid evidence status");
    }

    const hasListValueJson = payload.list_value_json != null && payload.list_value_json !== "";
    const hasListValue = payload.list_value != null && payload.list_value !== "";
    const listValueJson = hasListValueJson
      ? JSON.stringify(normalizeJsonListInput(payload.list_value_json))
      : hasListValue
        ? JSON.stringify(normalizeJsonListInput(payload.list_value))
        : null;

    const normalizedPayload = normalizePayloadInput(payload.payload_json);
    const payloadJson = normalizedPayload == null ? null : JSON.stringify(normalizedPayload);

    const result = insertEvidenceBlockStmt.run(
      contentItemId,
      blockType,
      sourceType,
      String(payload.source_record_type || "").trim() || null,
      String(payload.source_record_id || "").trim() || null,
      String(payload.source_url || "").trim() || null,
      String(payload.source_label || "").trim() || null,
      String(payload.lang || "").trim() || null,
      String(payload.attribution_text || "").trim() || null,
      String(payload.text_value || "").trim() || null,
      toNullableNumber(payload.numeric_value, "numeric_value"),
      listValueJson,
      payloadJson,
      status
    );

    const id = Number(result.lastInsertRowid || 0);
    return normalizeEvidenceRow(db.prepare("SELECT * FROM evidence_blocks WHERE id=? LIMIT 1").get(id));
  }

  function listEvidenceBlocks(contentItemId) {
    return listEvidenceBlocksByItemStmt.all(contentItemId).map(normalizeEvidenceRow);
  }

  function addApprovedContextBlock(contentItemId, payload = {}, approvedBy = null) {
    const evidenceBlockId = Number(payload.evidence_block_id || 0);
    if (!evidenceBlockId) throw new Error("evidence_block_id is required");

    const evidence = db.prepare("SELECT id FROM evidence_blocks WHERE id=? AND content_item_id=? LIMIT 1").get(evidenceBlockId, contentItemId);
    if (!evidence) throw new Error("evidence_block not found");

    const contextType = String(payload.context_type || payload.block_type || "fact").trim() || "fact";
    if (!EVIDENCE_BLOCK_TYPES.has(contextType)) {
      throw new Error("invalid context_type");
    }

    const status = String(payload.status || "active").trim().toLowerCase();
    if (!APPROVED_CONTEXT_STATUSES.has(status)) {
      throw new Error("invalid approved context status");
    }

    const hasSelectedListJson = payload.selected_list_json != null && payload.selected_list_json !== "";
    const hasSelectedList = payload.selected_list != null && payload.selected_list !== "";
    const selectedListJson = hasSelectedListJson
      ? JSON.stringify(normalizeJsonListInput(payload.selected_list_json))
      : hasSelectedList
        ? JSON.stringify(normalizeJsonListInput(payload.selected_list))
        : null;

    // Policy: at most one active approved context per evidence block (upsert active row).
    if (status === "active") {
      const existingActive = findActiveApprovedContextByEvidenceStmt.get(contentItemId, evidenceBlockId);
      if (existingActive?.id) {
        return updateApprovedContextBlock(contentItemId, Number(existingActive.id), {
          context_type: contextType,
          selected_text: String(payload.selected_text || "").trim() || null,
          selected_numeric: toNullableNumber(payload.selected_numeric, "selected_numeric"),
          selected_list_json: selectedListJson == null ? null : JSON.parse(selectedListJson),
          note: String(payload.note || "").trim() || null,
          editor_note: String(payload.editor_note || "").trim() || null,
          sort_order: payload.sort_order == null || payload.sort_order === "" ? 0 : toNullableNonNegativeInt(payload.sort_order, "sort_order"),
          confidence: toNullableNumber(payload.confidence, "confidence"),
          status: "active",
        });
      }
    }

    let result;
    try {
      result = insertApprovedContextBlockStmt.run(
        contentItemId,
        evidenceBlockId,
        contextType,
        String(payload.selected_text || "").trim() || null,
        toNullableNumber(payload.selected_numeric, "selected_numeric"),
        selectedListJson,
        String(payload.note || "").trim() || null,
        String(payload.editor_note || "").trim() || null,
        payload.sort_order == null || payload.sort_order === "" ? 0 : toNullableNonNegativeInt(payload.sort_order, "sort_order"),
        toNullableNumber(payload.confidence, "confidence"),
        status,
        String(approvedBy || payload.approved_by || "").trim() || null
      );
    } catch (err) {
      if (isSqliteUniqueConstraintError(err)) {
        throw createConflictError("active approved context already exists for this evidence block");
      }
      throw err;
    }

    const id = Number(result.lastInsertRowid || 0);
    return normalizeApprovedContextRow(getApprovedContextByIdStmt.get(id, contentItemId));
  }

  function listApprovedContextBlocks(contentItemId, options = {}) {
    const onlyActive = options?.onlyActive === true;
    const rows = listApprovedContextByItemStmt.all(contentItemId).map((row) => ({
      ...row,
      selected_list_json: parseJson(row.selected_list_json, []),
    }));
    if (!onlyActive) return rows;
    return rows.filter((row) => String(row.status || "") === "active");
  }

  function updateApprovedContextBlock(contentItemId, contextId, patch = {}) {
    const id = Number(contextId || 0);
    if (!id) throw new Error("invalid context id");

    const status = patch.status == null ? null : String(patch.status).trim().toLowerCase();
    if (status != null && !APPROVED_CONTEXT_STATUSES.has(status)) {
      throw new Error("invalid approved context status");
    }

    const contextType = patch.context_type == null ? null : String(patch.context_type || "").trim() || null;
    if (contextType && !EVIDENCE_BLOCK_TYPES.has(contextType)) {
      throw new Error("invalid context_type");
    }

    const hasSelectedListJson = patch.selected_list_json != null && patch.selected_list_json !== "";
    const hasSelectedList = patch.selected_list != null && patch.selected_list !== "";
    const selectedListJson = hasSelectedListJson
      ? JSON.stringify(normalizeJsonListInput(patch.selected_list_json))
      : hasSelectedList
        ? JSON.stringify(normalizeJsonListInput(patch.selected_list))
        : null;

    try {
      updateApprovedContextByIdStmt.run(
        contextType,
        patch.selected_text == null ? null : String(patch.selected_text || "").trim() || null,
        patch.selected_numeric == null || patch.selected_numeric === "" ? null : toNullableNumber(patch.selected_numeric, "selected_numeric"),
        selectedListJson,
        patch.note == null ? null : String(patch.note || "").trim() || null,
        patch.editor_note == null ? null : String(patch.editor_note || "").trim() || null,
        patch.sort_order == null || patch.sort_order === "" ? null : toNullableNonNegativeInt(patch.sort_order, "sort_order"),
        patch.confidence == null || patch.confidence === "" ? null : toNullableNumber(patch.confidence, "confidence"),
        status,
        id,
        contentItemId
      );
    } catch (err) {
      if (isSqliteUniqueConstraintError(err)) {
        throw createConflictError("active approved context already exists for this evidence block");
      }
      throw err;
    }

    return normalizeApprovedContextRow(getApprovedContextByIdStmt.get(id, contentItemId)) || null;
  }

  function buildDraftInputPreview(contentItemId) {
    return buildCleanStructuredContextFromRepo(
      {
        getItem,
        listApprovedContextBlocks,
        listEvidenceBlocks,
        listReferenceMediaByItem,
        listApprovedLocalImageContext,
      },
      contentItemId
    );
  }

  function createDraftInputSnapshot(contentItemId, inputPayload = {}, createdBy = null, source = "approved_context_preview") {
    const runUid = randomUUID();
    const payloadObject = inputPayload || {};
    const inputJson = JSON.stringify(payloadObject);
    const contextHash = null;
    const sourceName = String(source || "approved_context_preview").trim() || "approved_context_preview";
    if (!SNAPSHOT_SOURCES.has(sourceName)) {
      throw new Error("invalid snapshot source");
    }
    // payload_json and input_json intentionally store the same canonical preview payload for trace/replay.
    const result = insertDraftInputSnapshotStmt.run(
      contentItemId,
      sourceName,
      runUid,
      inputJson,
      inputJson,
      contextHash,
      String(createdBy || "").trim() || null
    );
    return {
      id: Number(result.lastInsertRowid || 0),
      run_uid: runUid,
      content_item_id: contentItemId,
      source: sourceName,
    };
  }

  function listContentAssetsByItem(contentItemId, options = {}) {
    const onlySelected = options?.onlySelected === true;
    const rows = db
      .prepare(`
        SELECT ca.*, a.storage_disk, a.storage_path, a.file_name, a.mime_type, a.size_bytes, a.checksum
        FROM content_assets ca
        JOIN assets a ON a.id = ca.asset_id
        WHERE ca.content_item_id = ?
        ORDER BY CASE WHEN ca.role='cover' THEN 0 ELSE 1 END, ca.sort_order ASC, ca.id ASC
      `)
      .all(contentItemId);

    const mapped = rows.map((row) => ({
      ...row,
      selected_in_clean: Number(row.selected_in_clean || 0),
      is_cover: Number(row.is_cover || 0),
      placement_type: String(row.placement_type || "unused"),
      public_url: parseAssetPublicUrl(row.storage_path),
    }));

    if (!onlySelected) return mapped;
    return mapped.filter((row) => row.selected_in_clean === 1 && row.role !== "unused");
  }

  function getImageWorkflowStatus(contentItemId) {
    const rows = db
      .prepare(`
        SELECT ca.asset_id, ca.role, ca.selected_in_clean, ca.is_cover,
               a.storage_disk, a.storage_path, a.mime_type
        FROM content_assets ca
        LEFT JOIN assets a ON a.id = ca.asset_id
        WHERE ca.content_item_id=?
      `)
      .all(contentItemId);

    const isLocal = (r) => {
      const disk = String(r?.storage_disk || "").trim().toLowerCase();
      const path = String(r?.storage_path || "").trim();
      const mime = String(r?.mime_type || "").trim().toLowerCase();
      if (!["local", "nas"].includes(disk)) return false;
      if (!path || /^https?:\/\//i.test(path)) return false;
      if (mime && !mime.startsWith("image/")) return false;
      return true;
    };

    const selected = rows.filter((r) => Number(r.selected_in_clean || 0) === 1 && String(r.role || "") !== "unused");
    const covers = rows.filter((r) => Number(r.is_cover || 0) === 1 || String(r.role || "") === "cover");
    const selectedReferenceMedia = listReferenceMediaByItem(contentItemId, { selectedOnly: true });

    const localSelected = selected.filter((r) => isLocal(r));
    const localCovers = covers.filter((r) => isLocal(r));

    const missing = [];
    if (selected.length < 1) missing.push("ต้องเลือกภาพอย่างน้อย 1 ภาพ");
    if (covers.length < 1) missing.push("ต้องตั้งภาพปก");
    if (covers.length > 1) missing.push("ต้องมีภาพปกเพียง 1 ภาพ");

    const localMissing = [];
    if (localSelected.length < 1) localMissing.push("ต้องเลือกภาพ local อย่างน้อย 1 ภาพ");
    if (localCovers.length < 1) localMissing.push("ต้องตั้งภาพปกจาก local assets");
    if (localCovers.length > 1) localMissing.push("ต้องมีภาพปก local เพียง 1 ภาพ");

    const isPublishReady = localMissing.length === 0 && missing.length === 0;
    const aiMissing = [];
    if (selectedReferenceMedia.length < 1 && localSelected.length < 1) {
      aiMissing.push("ต้องเลือกภาพอ้างอิงหรือภาพ local อย่างน้อย 1 ภาพสำหรับ Agent");
    }
    const publishMissing = [];
    if (localSelected.length < 1) publishMissing.push("ต้องเลือกภาพ local อย่างน้อย 1 ภาพ");
    if (localCovers.length < 1) publishMissing.push("ต้องตั้งภาพปกจาก local assets");
    if (localCovers.length > 1) publishMissing.push("ต้องมีภาพปก local เพียง 1 ภาพ");

    return {
      content_item_id: Number(contentItemId),
      ai_reference_selected_count: selectedReferenceMedia.length,
      selected_count: selected.length + selectedReferenceMedia.length,
      cover_count: covers.length,
      local_selected_count: localSelected.length,
      local_cover_count: localCovers.length,
      is_ready_for_ai_draft: aiMissing.length === 0,
      is_ready_for_publish: publishMissing.length === 0 && isPublishReady,
      missing_requirements: aiMissing,
      missing_local_requirements: publishMissing,
      cover_asset_id: localCovers[0]?.asset_id || covers[0]?.asset_id || null,
    };
  }

  function setContentAssetRole(contentItemId, assetId, role) {
    const nextRole = String(role || "").trim().toLowerCase();
    const allowed = new Set(["cover", "gallery", "inline", "unused"]);
    if (!allowed.has(nextRole)) {
      throw new Error("Invalid role");
    }

    const target = db
      .prepare("SELECT * FROM content_assets WHERE content_item_id=? AND asset_id=? LIMIT 1")
      .get(contentItemId, assetId);
    if (!target) {
      throw new Error("Asset mapping not found");
    }

    if (nextRole === "cover") {
      db.prepare("UPDATE content_assets SET role='gallery', is_cover=0 WHERE content_item_id=? AND role='cover' AND asset_id<>?").run(contentItemId, assetId);
      db.prepare("UPDATE content_assets SET role='cover', selected_in_clean=1, is_cover=1, placement_type='gallery' WHERE content_item_id=? AND asset_id=?").run(contentItemId, assetId);
    } else if (nextRole === "unused") {
      db.prepare("UPDATE content_assets SET role='unused', selected_in_clean=0, is_cover=0, placement_type='unused' WHERE content_item_id=? AND asset_id=?").run(contentItemId, assetId);
    } else {
      db.prepare("UPDATE content_assets SET role=?, selected_in_clean=1, is_cover=0, placement_type=? WHERE content_item_id=? AND asset_id=?").run(nextRole, nextRole === "inline" ? "inline" : "gallery", contentItemId, assetId);
    }

    return getImageWorkflowStatus(contentItemId);
  }

  function setContentAssetSelected(contentItemId, assetId, selected) {
    const target = db
      .prepare("SELECT * FROM content_assets WHERE content_item_id=? AND asset_id=? LIMIT 1")
      .get(contentItemId, assetId);
    if (!target) {
      throw new Error("Asset mapping not found");
    }

    const yes = selected === true || selected === 1 || selected === "1";
    if (!yes && (Number(target.is_cover || 0) === 1 || String(target.role || "") === "cover")) {
      const fallbackCover = db
        .prepare(`
          SELECT *
          FROM content_assets
          WHERE content_item_id=?
            AND asset_id<>?
            AND selected_in_clean=1
            AND role<>'unused'
          ORDER BY sort_order ASC, id ASC
          LIMIT 1
        `)
        .get(contentItemId, assetId);
      if (!fallbackCover) {
        throw new Error("ต้องเลือกรูปอื่นไว้อย่างน้อย 1 รูปก่อนยกเลิกรูปปก");
      }
      db.prepare("UPDATE content_assets SET role='cover', selected_in_clean=1, is_cover=1, placement_type='gallery' WHERE content_item_id=? AND asset_id=?")
        .run(contentItemId, Number(fallbackCover.asset_id || 0));
    }

    if (yes) {
      const role = String(target.role || "") === "unused" ? "gallery" : String(target.role || "gallery");
      db.prepare("UPDATE content_assets SET selected_in_clean=1, role=?, placement_type=CASE WHEN placement_type='unused' THEN 'gallery' ELSE placement_type END WHERE content_item_id=? AND asset_id=?").run(role, contentItemId, assetId);
    } else {
      db.prepare("UPDATE content_assets SET selected_in_clean=0, role='unused', placement_type='unused', is_cover=0 WHERE content_item_id=? AND asset_id=?").run(contentItemId, assetId);
    }

    return getImageWorkflowStatus(contentItemId);
  }

  function listApprovedImageContext(contentItemId) {
    const rows = listContentAssetsByItem(contentItemId, { onlySelected: true });
    const cover = rows.find((row) => Number(row.is_cover || 0) === 1 || row.role === "cover") || null;
    return {
      cover_url: cover?.public_url || null,
      selected_urls: rows.map((row) => row.public_url).filter(Boolean),
      gallery_urls: rows.filter((row) => row.role === "gallery").map((row) => row.public_url).filter(Boolean),
      inline_urls: rows.filter((row) => row.role === "inline").map((row) => row.public_url).filter(Boolean),
    };
  }

  function isApprovedLocalPublishAssetRow(row) {
    const role = String(row?.role || "").trim().toLowerCase();
    const disk = String(row?.storage_disk || "").trim().toLowerCase();
    const storagePath = String(row?.storage_path || "").trim();
    const mimeType = String(row?.mime_type || "").trim().toLowerCase();
    if (Number(row?.selected_in_clean || 0) !== 1) return false;
    if (!["cover", "gallery", "inline"].includes(role)) return false;
    if (!["local", "nas"].includes(disk)) return false;
    if (!storagePath || /^https?:\/\//i.test(storagePath)) return false;
    if (mimeType && !mimeType.startsWith("image/")) return false;
    return Boolean(parseAssetPublicUrl(storagePath));
  }

  function listApprovedLocalImageContext(contentItemId) {
    const rows = listContentAssetsByItem(contentItemId, { onlySelected: true })
      .filter((row) => isApprovedLocalPublishAssetRow(row));
    const cover = rows.find((row) => Number(row.is_cover || 0) === 1 || row.role === "cover") || null;
    return {
      cover_url: cover?.public_url || null,
      selected_urls: rows.map((row) => row.public_url).filter(Boolean),
      gallery_urls: rows.filter((row) => row.role === "gallery").map((row) => row.public_url).filter(Boolean),
      inline_urls: rows.filter((row) => row.role === "inline").map((row) => row.public_url).filter(Boolean),
      assets: rows.map((row) => ({
        asset_id: Number(row.asset_id || 0) || null,
        role: row.role || "gallery",
        selected_in_clean: Number(row.selected_in_clean || 0),
        is_cover: Number(row.is_cover || 0),
        public_url: row.public_url || "",
        storage_disk: row.storage_disk || "",
        storage_path: row.storage_path || "",
        mime_type: row.mime_type || "",
      })),
    };
  }

  function collectReferenceMediaCandidatesByItem(contentItemId) {
    const itemId = Number(contentItemId || 0) || 0;
    if (!itemId) throw new Error("invalid content_item_id");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const sourceRecords = listSourceRecordsByItem(itemId);
    const matchUrls = new Set(
      [
        String(item?.source_url || "").trim(),
        String(item?.map_url || "").trim(),
        ...sourceRecords.map((row) => String(row?.source_url || "").trim()),
      ].filter(Boolean)
    );
    const matchEntities = new Set(
      [
        String(item?.google_place_id || "").trim(),
        ...sourceRecords.map((row) => String(row?.source_entity_id || "").trim()),
      ].filter(Boolean)
    );

    const candidateByUrl = new Map();
    const sourcePriority = {
      item_image_url: 0,
      evidence_block: 1,
      source_raw_media: 2,
    };
    const maybeAddCandidate = (candidate) => {
      const normalizedUrl = normalizeReferenceMediaUrl(candidate?.url);
      if (!normalizedUrl) return false;
      if (!looksLikeReferenceImageUrl(normalizedUrl, candidate?.metadata || {})) return false;
      const referenceMediaId = getReferenceMediaIdFromUrl(normalizedUrl);
      if (!referenceMediaId) return false;
      const next = {
        reference_media_id: referenceMediaId,
        content_item_id: itemId,
        source_kind: String(candidate?.source_kind || "").trim() || "reference_media",
        source_label: String(candidate?.source_label || candidate?.source_kind || "").trim() || null,
        source_id: candidate?.source_id ?? null,
        url: normalizedUrl,
        preview_url: normalizedUrl,
        file_name: path.basename(normalizedUrl.split("?")[0] || "reference-image.jpg") || "reference-image.jpg",
        selected_for_ai: false,
        is_external: true,
        _priority: Number(sourcePriority[String(candidate?.source_kind || "").trim()] ?? 99),
      };
      const existing = candidateByUrl.get(normalizedUrl);
      if (!existing || next._priority < existing._priority) {
        candidateByUrl.set(normalizedUrl, next);
      }
      return true;
    };

    maybeAddCandidate({
      source_kind: "item_image_url",
      source_label: item?.source_name || "item image",
      source_id: itemId,
      url: item?.image_url,
      metadata: {
        mime_type: inferReferenceMediaMimeType(item?.image_url),
        media_type: "image",
        asset_type: "image",
      },
    });

    const evidenceRows = db.prepare(`
      SELECT
        eb.id,
        eb.source_type,
        eb.source_label,
        eb.text_value,
        eb.payload_json,
        eb.status
      FROM evidence_blocks eb
      WHERE eb.content_item_id = ?
        AND LOWER(COALESCE(eb.status, 'active')) IN ('active', 'approved', 'ready')
      ORDER BY eb.id DESC
    `).all(itemId);

    for (const row of evidenceRows) {
      const payload = parseJson(row?.payload_json, null);
      const evidenceCandidates = [
        {
          url: payload?.media_url,
          metadata: {
            mime_type: payload?.mime_type || "",
            media_type: payload?.media_type || "",
            asset_type: payload?.asset_type || "",
          },
        },
        {
          url: payload?.image_url,
          metadata: {
            mime_type: payload?.mime_type || "",
            media_type: payload?.media_type || "",
            asset_type: payload?.asset_type || "",
          },
        },
        { url: payload?.url, metadata: {} },
        { url: row?.text_value, metadata: {} },
      ];
      for (const candidate of evidenceCandidates) {
        const candidateUrl = String(candidate?.url || "").trim();
        if (!candidateUrl) continue;
        maybeAddCandidate({
          source_kind: "evidence_block",
          source_label: row?.source_label || row?.source_type || "evidence",
          source_id: Number(row?.id || 0) || null,
          url: candidateUrl,
          metadata: {
            mime_type: String(candidate?.metadata?.mime_type || "").trim().toLowerCase() || inferReferenceMediaMimeType(candidateUrl),
            media_type: String(candidate?.metadata?.media_type || "").trim().toLowerCase(),
            asset_type: String(candidate?.metadata?.asset_type || "").trim().toLowerCase(),
          },
        });
      }
    }

    const rawMediaRows = db.prepare(`
      SELECT
        srm.id,
        srm.media_url,
        srm.mime_type,
        srm.metadata_json,
        sri.source_url,
        sri.source_ref,
        sri.normalized_json
      FROM source_raw_media srm
      JOIN source_raw_items sri ON sri.id = srm.raw_item_id
      WHERE srm.media_url IS NOT NULL
        AND srm.media_url <> ''
      ORDER BY srm.id DESC
    `).all();

    for (const row of rawMediaRows) {
      const sourceUrl = String(row?.source_url || "").trim();
      const sourceRef = String(row?.source_ref || "").trim();
      const normalized = parseJson(row?.normalized_json, null);
      const placeId = String(normalized?.google_place_id || "").trim();
      if (!matchUrls.has(sourceUrl) && !matchEntities.has(sourceRef) && !matchEntities.has(placeId)) {
        continue;
      }
      const metadata = parseJson(row?.metadata_json, null);
      maybeAddCandidate({
        source_kind: "source_raw_media",
        source_label: sourceUrl || sourceRef || placeId || "source raw media",
        source_id: Number(row?.id || 0) || null,
        url: row?.media_url,
        metadata: {
          mime_type: String(row?.mime_type || "").trim().toLowerCase() || inferReferenceMediaMimeType(row?.media_url),
          media_type: String(metadata?.media_type || "").trim().toLowerCase(),
          asset_type: String(metadata?.asset_type || "").trim().toLowerCase(),
        },
      });
    }

    return [...candidateByUrl.values()]
      .sort((left, right) => {
        if (left._priority !== right._priority) return left._priority - right._priority;
        return String(left.reference_media_id || "").localeCompare(String(right.reference_media_id || ""));
      })
      .map(({ _priority, ...row }) => row);
  }

  function listReferenceMediaByItem(contentItemId, options = {}) {
    const rows = collectReferenceMediaCandidatesByItem(contentItemId);
    const selectedOnly = options?.selectedOnly === true;
    const selectionRows = db.prepare(`
      SELECT reference_media_id, selected_for_ai
      FROM content_reference_media_selections
      WHERE content_item_id=?
    `).all(Number(contentItemId || 0) || 0);
    const selectedLookup = new Map(
      selectionRows.map((row) => [String(row.reference_media_id || "").trim(), Number(row.selected_for_ai || 0) === 1])
    );

    const mapped = rows.map((row) => ({
      ...row,
      selected_for_ai: selectedLookup.get(String(row.reference_media_id || "").trim()) === true,
    }));
    if (!selectedOnly) return mapped;
    return mapped.filter((row) => row.selected_for_ai === true);
  }

  function setReferenceMediaSelected(contentItemId, referenceMediaId, selected) {
    const itemId = Number(contentItemId || 0) || 0;
    if (!itemId) throw new Error("invalid content_item_id");
    const refId = String(referenceMediaId || "").trim();
    if (!refId) throw new Error("reference media id is required");

    const candidate = collectReferenceMediaCandidatesByItem(itemId).find((row) => String(row.reference_media_id || "").trim() === refId);
    if (!candidate) {
      throw new Error("reference media not found for item");
    }

    const yes = selected === true || selected === 1 || selected === "1";
    if (yes) {
      db.prepare(`
        INSERT INTO content_reference_media_selections (content_item_id, reference_media_id, selected_for_ai)
        VALUES (?, ?, 1)
        ON CONFLICT(content_item_id, reference_media_id)
        DO UPDATE SET selected_for_ai=excluded.selected_for_ai, updated_at=CURRENT_TIMESTAMP
      `).run(itemId, refId);
    } else {
      db.prepare(`
        INSERT INTO content_reference_media_selections (content_item_id, reference_media_id, selected_for_ai)
        VALUES (?, ?, 0)
        ON CONFLICT(content_item_id, reference_media_id)
        DO UPDATE SET selected_for_ai=0, updated_at=CURRENT_TIMESTAMP
      `).run(itemId, refId);
    }

    return {
      ...candidate,
      selected_for_ai: yes,
    };
  }

  function listImportedReferenceAssetsByItem(contentItemId) {
    return listContentAssetsByItem(contentItemId, { onlySelected: false }).filter((row) => {
      const storageDisk = String(row?.storage_disk || "").trim().toLowerCase();
      const storagePath = String(row?.storage_path || "").trim();
      return storageDisk === "remote" && Boolean(normalizeImportedMediaUrl(storagePath));
    });
  }

  function repairImportedReferenceAssetsForItem(contentItemId, options = {}) {
    const itemId = Number(contentItemId || 0) || 0;
    if (!itemId) throw new Error("invalid content_item_id");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const apply = options?.apply === true;
    const limit = Math.max(1, Math.min(50, Number(options?.limit || 25) || 25));
    const actor = String(options?.actorEmail || "system@local").trim() || "system@local";
    const rawItem = options?.rawItem && typeof options.rawItem === "object" ? options.rawItem : null;
    const sourceRecords = listSourceRecordsByItem(itemId);

    const matchUrls = new Set(
      [
        String(item?.source_url || "").trim(),
        String(item?.map_url || "").trim(),
        ...sourceRecords.map((row) => String(row?.source_url || "").trim()),
      ].filter(Boolean)
    );
    const matchEntities = new Set(
      [
        String(item?.google_place_id || "").trim(),
        ...sourceRecords.map((row) => String(row?.source_entity_id || "").trim()),
      ].filter(Boolean)
    );

    const rawMediaRows = db.prepare(`
      SELECT
        srm.media_url,
        srm.checksum,
        srm.mime_type,
        srm.width,
        srm.height,
        srm.metadata_json,
        sri.source_url,
        sri.source_ref,
        sri.normalized_json
      FROM source_raw_media srm
      JOIN source_raw_items sri ON sri.id = srm.raw_item_id
      WHERE srm.media_url IS NOT NULL
        AND srm.media_url <> ''
      ORDER BY srm.id DESC
      LIMIT 2000
    `).all();

    const candidateList = [];
    const seenCandidateUrls = new Set();
    const skipped = [];
    const skip = (url, reason) => {
      const normalizedUrl = normalizeImportedMediaUrl(url);
      skipped.push({
        url: normalizedUrl || String(url || "").trim() || null,
        reason: String(reason || "").trim() || "unknown",
      });
    };

    if (String(item?.image_url || "").trim()) {
      collectImportedMediaCandidate(candidateList, seenCandidateUrls, item.image_url, {
        role_hint: "cover",
        source_kind: "item_image_url",
        source_name: item?.source_name || null,
      });
    }

    if (rawItem) {
      const rawCandidates = [
        ...extractImportedMediaCandidatesFromPayload({ normalized_json: rawItem?.normalized_json || null }, {
          source_kind: "raw_item_payload",
          source_name: rawItem?.source_type || item?.source_name || null,
        }),
        ...((Array.isArray(rawItem?.media) ? rawItem.media : []).map((media) => ({
          url: media?.media_url || media?.url,
          mime_type: media?.mime_type || null,
          width: media?.width,
          height: media?.height,
          checksum: media?.checksum || null,
          role_hint: media?.metadata_json?.role || media?.role || null,
          source_kind: "raw_item_media",
          source_name: rawItem?.source_type || item?.source_name || null,
        }))),
      ];
      for (const candidate of rawCandidates) {
        if (!collectImportedMediaCandidate(candidateList, seenCandidateUrls, candidate.url, candidate)) {
          skip(candidate.url, "duplicate_candidate");
        }
      }
    }

    for (const row of sourceRecords) {
      const extracted = extractImportedMediaCandidatesFromPayload(row?.payload_json, {
        source_kind: "source_record_payload",
        source_name: row?.source_name || row?.source_type || null,
      });
      for (const candidate of extracted) {
        if (!collectImportedMediaCandidate(candidateList, seenCandidateUrls, candidate.url, candidate)) {
          skip(candidate.url, "duplicate_candidate");
        }
      }
    }

    let matchedRawMediaCount = 0;
    for (const row of rawMediaRows) {
      const sourceUrl = String(row?.source_url || "").trim();
      const sourceRef = String(row?.source_ref || "").trim();
      const normalized = parseJson(row?.normalized_json, null);
      const placeId = String(normalized?.google_place_id || "").trim();
      if (
        !matchUrls.has(sourceUrl)
        && !matchEntities.has(sourceRef)
        && !matchEntities.has(placeId)
      ) {
        continue;
      }
      matchedRawMediaCount += 1;
      const metadata = parseJson(row?.metadata_json, null);
      const added = collectImportedMediaCandidate(candidateList, seenCandidateUrls, row?.media_url, {
        mime_type: row?.mime_type,
        width: row?.width,
        height: row?.height,
        checksum: row?.checksum,
        role_hint: metadata?.role,
        source_kind: "source_raw_media",
        source_name: sourceUrl || sourceRef || placeId || null,
      });
      if (!added) {
        skip(row?.media_url, "duplicate_candidate");
      }
    }

    const existingAssets = listContentAssetsByItem(itemId, { onlySelected: false });
    const existingUrlKeys = new Set(
      existingAssets.map((row) => normalizeImportedMediaUrl(row?.public_url || row?.storage_path || "")).filter(Boolean).map((url) => url.toLowerCase())
    );
    const hasExistingCover = existingAssets.some((row) => Number(row?.is_cover || 0) === 1 || String(row?.role || "").trim().toLowerCase() === "cover");
    const importedAssetCountBefore = listImportedReferenceAssetsByItem(itemId).length;

    const insertAssetStmt = db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES (?, 'remote', ?, ?, ?, NULL, ?)
    `);
    const insertContentAssetStmt = db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const nextSortOrder = Number(
      db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM content_assets WHERE content_item_id=?").get(itemId)?.max_sort || 0
    );

    const addedAssets = [];
    let addedCount = 0;
    let rawCoverAssigned = hasExistingCover;
    let sortOrder = nextSortOrder;

    for (const candidate of candidateList.slice(0, limit)) {
      const normalizedUrl = normalizeImportedMediaUrl(candidate.url);
      if (!normalizedUrl) {
        skip(candidate.url, "invalid_media_url");
        continue;
      }
      if (candidate.mime_type && !candidate.mime_type.startsWith("image/")) {
        skip(normalizedUrl, "non_image_mime");
        continue;
      }
      const key = normalizedUrl.toLowerCase();
      if (existingUrlKeys.has(key)) {
        skip(normalizedUrl, "existing_asset");
        continue;
      }

      const shouldBeCover = !rawCoverAssigned && String(item?.image_url || "").trim() === normalizedUrl;
      const role = shouldBeCover ? "cover" : "gallery";
      const selectedInClean = 1;
      const isCover = shouldBeCover ? 1 : 0;
      const placementType = "gallery";

      if (apply) {
        sortOrder += 1;
        const fileName = path.basename(normalizedUrl.split("?")[0] || "remote-image.jpg") || "remote-image.jpg";
        const assetResult = insertAssetStmt.run(
          randomUUID(),
          normalizedUrl,
          fileName,
          candidate.mime_type || null,
          candidate.checksum || null
        );
        const assetId = Number(assetResult.lastInsertRowid || 0) || 0;
        insertContentAssetStmt.run(itemId, assetId, role, selectedInClean, isCover, placementType, sortOrder);
        addedAssets.push({
          asset_id: assetId,
          url: normalizedUrl,
          role,
          selected_in_clean: selectedInClean,
          is_cover: isCover,
        });
        existingUrlKeys.add(key);
        addedCount += 1;
        rawCoverAssigned = rawCoverAssigned || shouldBeCover;
      }
    }

    const importedAssetCountAfter = apply ? listImportedReferenceAssetsByItem(itemId).length : importedAssetCountBefore + addedCount;
    const diagnostics = {
      content_item_id: itemId,
      item_title: String(item?.title || "").trim() || null,
      raw_media_count: matchedRawMediaCount,
      source_record_count: sourceRecords.length,
      imported_asset_count: importedAssetCountAfter,
      imported_asset_count_before: importedAssetCountBefore,
      candidate_count: candidateList.length,
      added_count: addedCount,
      skipped_media: skipped,
      added_assets: addedAssets,
      apply,
    };

    if (apply && addedCount > 0) {
      logAudit(actor, "asset.imported_reference.repair", "content_item", String(itemId), diagnostics);
    }

    return diagnostics;
  }

  function evaluateContentAssetCleanupEligibility(contentItemId, options = {}) {
    const itemId = Number(contentItemId || 0) || 0;
    if (!itemId) throw new Error("invalid content_item_id");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const scope = String(options?.scope || "excluded").trim().toLowerCase();
    if (scope !== "excluded" && scope !== "all") {
      throw new Error("invalid cleanup scope");
    }

    const includeAll = scope === "all";
    const rows = listContentAssetsByItem(itemId, { onlySelected: false });
    const itemImageUrl = String(item.image_url || "").trim();
    const publishedArticle = getPublishedArticleByItem(itemId);
    const hasPublishedOutput = Boolean(publishedArticle?.id) && String(publishedArticle?.status || "").trim().toLowerCase() === "published";
    const countFieldPackRefsStmt = db.prepare(
      "SELECT COUNT(*) AS c FROM field_pack_media_hints WHERE content_asset_id=?"
    );
    const countDeliverableRefsStmt = db.prepare(
      "SELECT COUNT(*) AS c FROM content_assignment_submission_deliverables WHERE content_item_id=? AND source_asset_id=?"
    );

    const assets = [];
    let excludedCount = 0;
    let cleanupReadyCount = 0;
    let protectedCount = 0;

    for (const row of rows) {
      const contentAssetId = Number(row.id || 0) || 0;
      const assetId = Number(row.asset_id || 0) || 0;
      const selectedInClean = Number(row.selected_in_clean || 0) === 1;
      const role = String(row.role || "").trim().toLowerCase();
      const isCover = Number(row.is_cover || 0) === 1 || role === "cover";
      const selectedForAi = selectedInClean && role !== "unused";
      const excludedFromAi = !selectedForAi;
      const publicUrl = String(row.public_url || "").trim();
      const referencedAsItemImage = Boolean(itemImageUrl) && Boolean(publicUrl) && itemImageUrl === publicUrl;

      if (excludedFromAi) excludedCount += 1;
      if (!includeAll && !excludedFromAi) continue;

      const fieldPackHintRefs = Number(countFieldPackRefsStmt.get(contentAssetId)?.c || 0);
      const assignmentDeliverableRefs = Number(countDeliverableRefsStmt.get(itemId, assetId)?.c || 0);

      const blockedReasons = [];
      if (!excludedFromAi) blockedReasons.push("selected_for_ai");
      if (isCover) blockedReasons.push("cover_asset");
      if (referencedAsItemImage) blockedReasons.push("referenced_as_item_image");
      if (referencedAsItemImage && hasPublishedOutput) blockedReasons.push("referenced_in_published_output");
      if (fieldPackHintRefs > 0) blockedReasons.push("referenced_in_field_pack_media_hints");
      if (assignmentDeliverableRefs > 0) blockedReasons.push("referenced_in_assignment_deliverables");

      const cleanupReady = excludedFromAi && blockedReasons.length === 0;
      if (cleanupReady) cleanupReadyCount += 1;
      else protectedCount += 1;

      assets.push({
        content_asset_id: contentAssetId,
        asset_id: assetId,
        file_name: String(row.file_name || "").trim() || null,
        mime_type: String(row.mime_type || "").trim() || null,
        role,
        selected_in_clean: selectedInClean,
        is_cover: isCover,
        excluded_from_ai: excludedFromAi,
        cleanup_ready: cleanupReady,
        blocked_reasons: blockedReasons,
        reference_counts: {
          item_image: referencedAsItemImage ? 1 : 0,
          published_output: referencedAsItemImage && hasPublishedOutput ? 1 : 0,
          field_pack_media_hints: fieldPackHintRefs,
          assignment_deliverables: assignmentDeliverableRefs,
        },
      });
    }

    return {
      content_item_id: itemId,
      scope,
      policy_version: "asset_cleanup_v1",
      summary: {
        total_assets: rows.length,
        excluded_assets: excludedCount,
        evaluated_assets: assets.length,
        cleanup_ready_assets: cleanupReadyCount,
        protected_assets: protectedCount,
      },
      assets,
    };
  }

  function listPostAssignmentAiInputCleanupCandidates(contentItemId, options = {}) {
    const itemId = Number(contentItemId || 0) || 0;
    if (!itemId) throw new Error("invalid content_item_id");
    const item = getItem(itemId);
    if (!item) throw new Error("item not found");

    const includeBlocked = options?.include_blocked !== false;
    const rows = listContentAssetsByItem(itemId, { onlySelected: false });
    const countFieldPackRefsStmt = db.prepare(
      "SELECT COUNT(*) AS c FROM field_pack_media_hints WHERE content_asset_id=?"
    );
    const countDeliverableRefsStmt = db.prepare(
      "SELECT COUNT(*) AS c FROM content_assignment_submission_deliverables WHERE content_item_id=? AND source_asset_id=?"
    );

    const assets = [];
    let eligibleCount = 0;
    let blockedCount = 0;

    for (const row of rows) {
      const contentAssetId = Number(row.id || 0) || 0;
      const assetId = Number(row.asset_id || 0) || 0;
      const role = String(row.role || "").trim().toLowerCase();
      const mimeType = String(row.mime_type || "").trim().toLowerCase();
      const selectedInClean = Number(row.selected_in_clean || 0) === 1;
      const selectedForAi = selectedInClean && role !== "unused" && (!mimeType || mimeType.startsWith("image/"));
      if (!selectedForAi) continue;

      const assignmentSurface = String(row.assignment_surface || "").trim().toLowerCase();
      const fieldPackHintRefs = Number(countFieldPackRefsStmt.get(contentAssetId)?.c || 0);
      const assignmentDeliverableRefs = Number(countDeliverableRefsStmt.get(itemId, assetId)?.c || 0);

      const blockedReasons = [];
      if (Number(row.is_cover || 0) === 1 || role === "cover") blockedReasons.push("article_cover_asset");
      if (role === "inline" || String(row.placement_type || "").trim().toLowerCase() === "inline") {
        blockedReasons.push("article_inline_asset");
      }
      if (assignmentSurface === "assignment_work") blockedReasons.push("assignment_work_surface");
      if (fieldPackHintRefs > 0) blockedReasons.push("referenced_in_field_pack_media_hints");
      if (assignmentDeliverableRefs > 0) blockedReasons.push("referenced_in_assignment_deliverables");

      const eligible = blockedReasons.length === 0;
      if (eligible) eligibleCount += 1;
      else blockedCount += 1;

      if (eligible || includeBlocked) {
        assets.push({
          content_asset_id: contentAssetId,
          asset_id: assetId,
          file_name: String(row.file_name || "").trim() || null,
          mime_type: mimeType || null,
          role,
          selected_in_clean: selectedInClean,
          assignment_surface: assignmentSurface || null,
          eligible_for_cleanup: eligible,
          blocked_reasons: blockedReasons,
          reference_counts: {
            field_pack_media_hints: fieldPackHintRefs,
            assignment_deliverables: assignmentDeliverableRefs,
          },
        });
      }
    }

    return {
      content_item_id: itemId,
      policy_version: "post_assignment_ai_input_cleanup_v1",
      summary: {
        total_assets: rows.length,
        ai_input_assets: eligibleCount + blockedCount,
        eligible_assets: eligibleCount,
        blocked_assets: blockedCount,
      },
      assets,
    };
  }

  function addSearchEnrichmentRecord(contentItemId, payload = {}) {
    const item = getItem(contentItemId);
    if (!item) throw new Error("item not found");

    const query = String(payload.query || "").trim();
    if (!query) throw new Error("query is required");

    const provider = String(payload.provider || "manual").trim().toLowerCase();
    if (!SEARCH_ENRICHMENT_PROVIDERS.has(provider)) {
      throw new Error("invalid provider");
    }

    const ingestionMode = String(payload.ingestion_mode || "manual").trim().toLowerCase();
    if (!ENRICHMENT_INGESTION_MODES.has(ingestionMode)) {
      throw new Error("invalid ingestion_mode");
    }

    const topResults = normalizeTopResultsInput(payload.top_results_json ?? payload.top_results ?? [], "top_results_json");
    const topResultOfficialUrls = topResults
      .filter((row) => row && row.is_official === true && row.url)
      .map((row) => row.url);

    const explicitOfficialUrls = normalizeUrlStringListInput(payload.official_urls_json ?? payload.official_urls ?? [], "official_urls_json");
    const officialUrls = normalizeUrlStringListInput([...explicitOfficialUrls, ...topResultOfficialUrls], "official_urls_json");
    const angleHints = normalizeStringListInput(payload.search_angle_hints_json ?? payload.search_angle_hints ?? [], "search_angle_hints_json");
    const payloadJson = parseJsonInputStrict(payload.payload_json, "payload_json", "any");

    const webPresenceInput = toNullableScore(payload.web_presence_score, "web_presence_score");
    const contentGapInput = toNullableScore(payload.content_gap_score, "content_gap_score");
    const entityConfidenceInput = toNullableScore(payload.entity_confidence_score, "entity_confidence_score");

    const searchSignalSummary = buildSearchSignalSummary({
      top_results_json: topResults,
      official_urls_json: officialUrls,
      search_angle_hints_json: angleHints,
      web_presence_score: webPresenceInput,
      content_gap_score: contentGapInput,
      entity_confidence_score: entityConfidenceInput,
    });

    const storedPayload = payloadJson == null
      ? { search_quality_summary: searchSignalSummary }
      : Array.isArray(payloadJson)
        ? { provider_payload: payloadJson, search_quality_summary: searchSignalSummary }
        : { ...payloadJson, search_quality_summary: searchSignalSummary };

    const result = db.prepare(
      "INSERT INTO search_enrichment_records (" +
        " content_item_id, query, provider, ingestion_mode," +
        " top_results_json, official_urls_json," +
        " web_presence_score, content_gap_score, entity_confidence_score," +
        " search_angle_hints_json, payload_json, updated_at" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
    ).run(
      contentItemId,
      query,
      provider,
      ingestionMode,
      JSON.stringify(topResults),
      JSON.stringify(officialUrls),
      Number(searchSignalSummary.web_presence_score.toFixed(3)),
      Number(searchSignalSummary.content_gap_score.toFixed(3)),
      searchSignalSummary.entity_confidence_score == null ? null : Number(searchSignalSummary.entity_confidence_score.toFixed(3)),
      JSON.stringify(angleHints),
      JSON.stringify(storedPayload)
    );

    const id = Number(result.lastInsertRowid || 0);
    return normalizeSearchEnrichmentRow(
      db.prepare("SELECT * FROM search_enrichment_records WHERE id=? LIMIT 1").get(id)
    );
  }

  function listSearchEnrichmentByItem(contentItemId) {
    return db
      .prepare("SELECT * FROM search_enrichment_records WHERE content_item_id=? ORDER BY id DESC")
      .all(contentItemId)
      .map(normalizeSearchEnrichmentRow);
  }

  function latestSearchEnrichmentByItem(contentItemId) {
    return normalizeSearchEnrichmentRow(
      db
        .prepare("SELECT * FROM search_enrichment_records WHERE content_item_id=? ORDER BY id DESC LIMIT 1")
        .get(contentItemId)
    );
  }

  function latestMomentumSnapshotByItem(contentItemId, platform = "") {
    const p = String(platform || "").trim().toLowerCase();
    if (p) {
      return normalizeMomentumRow(
        db
          .prepare("SELECT * FROM social_momentum_snapshots WHERE content_item_id=? AND platform=? ORDER BY id DESC LIMIT 1")
          .get(contentItemId, p)
      );
    }
    return normalizeMomentumRow(
      db
        .prepare("SELECT * FROM social_momentum_snapshots WHERE content_item_id=? ORDER BY id DESC LIMIT 1")
        .get(contentItemId)
    );
  }

  function recomputePlaceIntelligence(contentItemId) {
    const item = getItem(contentItemId);
    if (!item) throw new Error("item not found");

    const sourceRecords = listSourceRecordsByItem(contentItemId);
    let normalized = null;
    for (const row of sourceRecords) {
      const payload = row?.payload_json;
      const candidate = payload?.normalized_json || payload?.payload_json?.normalized_json;
      if (candidate && typeof candidate === "object") {
        normalized = candidate;
        break;
      }
    }

    const latestSearch = latestSearchEnrichmentByItem(contentItemId);
    const latestMomentum = latestMomentumSnapshotByItem(contentItemId);
    const searchSignalSummary = latestSearch ? buildSearchSignalSummary(latestSearch) : null;

    const rating = Number(normalized?.rating);
    const reviewCount = Number(normalized?.user_rating_count ?? normalized?.review_count);
    const hasImage = Boolean(String(normalized?.image || item?.image_url || "").trim());
    const photoCount = Array.isArray(normalized?.photos) ? normalized.photos.length : 0;

    const ratingScore = Number.isFinite(rating) ? (rating >= 4.5 ? 10 : rating >= 4.2 ? 7 : 4) : 5;
    const reviewVolumeScore = Number.isFinite(reviewCount)
      ? (reviewCount > 500 ? 10 : reviewCount >= 200 ? 7 : reviewCount > 0 ? 5 : 3)
      : 3;
    const visualScore = clampScore((hasImage ? 4.5 : 3.5) + Math.min(3, photoCount * 0.4) + (item.map_url ? 1 : 0), 0, 10);
    const contentGapScore = searchSignalSummary
      ? clampScore(Number(searchSignalSummary.content_gap_score || 0), 0, 10)
      : 5;
    const webPresenceScore = searchSignalSummary
      ? clampScore(Number(searchSignalSummary.web_presence_score || 0), 0, 10)
      : 0;

    const basePriority = (ratingScore * 0.33) + (reviewVolumeScore * 0.27) + (visualScore * 0.2) + (contentGapScore * 0.15) + (webPresenceScore * 0.05);
    const momentumBoost = Number.isFinite(Number(latestMomentum?.momentum_score)) ? Math.min(2, Number(latestMomentum.momentum_score) * 0.2) : 0;
    const priorityScore = clampScore(basePriority + momentumBoost, 0, 10);

    const hasSearch = Boolean(latestSearch);
    const hasMomentum = Boolean(latestMomentum) && ((Number(latestMomentum?.mention_count || 0) > 0) || (Number(latestMomentum?.post_count || 0) > 0) || (Number(latestMomentum?.momentum_score || 0) > 0));
    const scoreMode = hasSearch
      ? (hasMomentum ? "maps_plus_search_plus_social" : "maps_plus_search")
      : (hasMomentum ? "maps_plus_social" : "maps_only");

    const whySelected = [
      `rating_score=${ratingScore}`,
      `review_volume_score=${reviewVolumeScore}`,
      `visual_score=${Number(visualScore.toFixed(1))}`,
      `content_gap_score=${Number(contentGapScore.toFixed(1))}`,
      searchSignalSummary ? `web_presence_score=${Number(webPresenceScore.toFixed(1))}` : null,
      searchSignalSummary?.entity_confidence_score != null
        ? `entity_confidence_score=${Number(Number(searchSignalSummary.entity_confidence_score).toFixed(1))}`
        : null,
      hasMomentum ? `momentum_score=${Number(Number(latestMomentum.momentum_score).toFixed(1))}` : null,
    ].filter(Boolean);

    const bestAngles = [];
    if (Array.isArray(latestSearch?.search_angle_hints_json) && latestSearch.search_angle_hints_json.length > 0) {
      bestAngles.push(...latestSearch.search_angle_hints_json.map((x) => String(x || "").trim()).filter(Boolean));
    }
    if (item.category) bestAngles.push(`local_${String(item.category).trim().toLowerCase()}_spot`);
    if (Number.isFinite(rating) && rating >= 4.5) bestAngles.push("high_rating_social_proof");
    if (Number.isFinite(reviewCount) && reviewCount >= 200) bestAngles.push("popular_local_pick");
    if (contentGapScore >= 6.5) bestAngles.push("search_gap_opportunity");

    const uniqueAngles = Array.from(new Set(bestAngles)).slice(0, 8);

    const recommendedAction = priorityScore >= 8 ? "collect_now" : priorityScore >= 6 ? "monitor" : priorityScore >= 4 ? "hold" : "skip";
    if (!RECOMMENDED_ACTIONS.has(recommendedAction)) {
      throw new Error("invalid recommended_action");
    }

    const payloadJson = {
      source: {
        has_search_enrichment: hasSearch,
        has_momentum: hasMomentum,
        latest_search_enrichment_id: latestSearch?.id || null,
        latest_momentum_snapshot_id: latestMomentum?.id || null,
      },
      raw_signals: {
        rating: Number.isFinite(rating) ? rating : null,
        review_count: Number.isFinite(reviewCount) ? reviewCount : null,
        has_image: hasImage,
        photo_count: photoCount,
      },
      search_quality_summary: searchSignalSummary,
    };

    const result = db.prepare(`
      INSERT INTO place_intelligence_scores (
        content_item_id, rating_score, review_volume_score, visual_score, content_gap_score,
        priority_score, score_mode, why_selected_json, best_content_angles_json,
        recommended_action, payload_json, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      contentItemId,
      Number(ratingScore.toFixed(3)),
      Number(reviewVolumeScore.toFixed(3)),
      Number(visualScore.toFixed(3)),
      Number(contentGapScore.toFixed(3)),
      Number(priorityScore.toFixed(3)),
      scoreMode,
      JSON.stringify(whySelected),
      JSON.stringify(uniqueAngles),
      recommendedAction,
      JSON.stringify(payloadJson)
    );

    const id = Number(result.lastInsertRowid || 0);
    return normalizePlaceIntelligenceRow(
      db.prepare("SELECT * FROM place_intelligence_scores WHERE id=? LIMIT 1").get(id)
    );
  }

  function getPlaceIntelligenceByItem(contentItemId) {
    return normalizePlaceIntelligenceRow(
      db
        .prepare("SELECT * FROM place_intelligence_scores WHERE content_item_id=? ORDER BY id DESC LIMIT 1")
        .get(contentItemId)
    );
  }

  function listTopPlaceIntelligence(limit = 10, category = "") {
    const safeLimit = Math.max(1, Math.min(100, Number(limit || 10)));
    const c = String(category || "").trim().toLowerCase();
    const sql = `
      SELECT pis.*, ci.title, ci.category
      FROM place_intelligence_scores pis
      JOIN content_items ci ON ci.id = pis.content_item_id
      WHERE ci.is_deleted=0
        AND pis.id IN (
          SELECT MAX(id) FROM place_intelligence_scores GROUP BY content_item_id
        )
        ${c ? "AND LOWER(ci.category)=?" : ""}
      ORDER BY pis.priority_score DESC, pis.id DESC
      LIMIT ?
    `;
    const rows = c
      ? db.prepare(sql).all(c, safeLimit)
      : db.prepare(sql).all(safeLimit);
    return rows.map((row) => ({
      ...normalizePlaceIntelligenceRow(row),
      title: row.title,
      category: row.category,
    }));
  }

  function addSocialSignalSource(contentItemId, payload = {}) {
    const item = getItem(contentItemId);
    if (!item) throw new Error("item not found");

    const platform = String(payload.platform || "").trim().toLowerCase();
    if (!SOCIAL_PLATFORMS.has(platform)) {
      throw new Error("invalid platform");
    }

    const ingestionMode = String(payload.ingestion_mode || "manual").trim().toLowerCase();
    if (!SOCIAL_INGESTION_MODES.has(ingestionMode)) {
      throw new Error("invalid ingestion_mode");
    }

    const publishedAtIso = toNullableDateIso(payload.published_at, "published_at");
    const collectedAtIso = toNullableDateIso(payload.collected_at, "collected_at") || new Date().toISOString();
    const payloadJson = parseJsonInputStrict(payload.payload_json, "payload_json", "any");

    const result = db.prepare(`
      INSERT INTO social_signal_sources (
        content_item_id, platform, ingestion_mode, source_url, external_id,
        published_at, collected_at, author_label, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contentItemId,
      platform,
      ingestionMode,
      String(payload.source_url || "").trim() || null,
      String(payload.external_id || "").trim() || null,
      publishedAtIso,
      collectedAtIso,
      String(payload.author_label || "").trim() || null,
      payloadJson == null ? null : JSON.stringify(payloadJson)
    );

    const id = Number(result.lastInsertRowid || 0);
    return normalizeSocialSignalRow(
      db.prepare("SELECT * FROM social_signal_sources WHERE id=? LIMIT 1").get(id)
    );
  }

  function listSocialSignalSourcesByItem(contentItemId) {
    return db
      .prepare("SELECT * FROM social_signal_sources WHERE content_item_id=? ORDER BY id DESC")
      .all(contentItemId)
      .map(normalizeSocialSignalRow);
  }

  function listMomentumSnapshotsByItem(contentItemId, platform = "") {
    const p = String(platform || "").trim().toLowerCase();
    if (p) {
      return db
        .prepare("SELECT * FROM social_momentum_snapshots WHERE content_item_id=? AND platform=? ORDER BY id DESC")
        .all(contentItemId, p)
        .map(normalizeMomentumRow);
    }
    return db
      .prepare("SELECT * FROM social_momentum_snapshots WHERE content_item_id=? ORDER BY id DESC")
      .all(contentItemId)
      .map(normalizeMomentumRow);
  }

  function recomputeMomentumScore(contentItemId, platform = "facebook") {
    const item = getItem(contentItemId);
    if (!item) throw new Error("item not found");

    const p = String(platform || "").trim().toLowerCase();
    if (!SOCIAL_PLATFORMS.has(p)) {
      throw new Error("invalid platform");
    }

    const rows = db
      .prepare("SELECT * FROM social_signal_sources WHERE content_item_id=? AND platform=? ORDER BY id DESC")
      .all(contentItemId, p)
      .map(normalizeSocialSignalRow);

    const mentionCount = rows.length;
    const postKeys = new Set(rows.map((row) => String(row.external_id || row.source_url || row.id)).filter(Boolean));
    const postCount = postKeys.size;

    let engagementTotal = 0;
    let engagementWeight = 0;
    let newestTs = 0;

    for (const row of rows) {
      const payload = row.payload_json || {};
      const direct = Number(payload.engagement_score);
      let engagement = Number.isFinite(direct) ? direct : null;
      if (engagement == null) {
        const like = Number(payload.like_count || 0);
        const comment = Number(payload.comment_count || 0);
        const share = Number(payload.share_count || 0);
        const view = Number(payload.view_count || 0);
        const raw = Math.max(0, like + (comment * 2) + (share * 3) + (view * 0.02));
        engagement = clampScore(Math.log10(raw + 1) * 2.5, 0, 10);
      }
      engagementTotal += clampScore(engagement, 0, 10);
      engagementWeight += 1;

      const ts = Date.parse(String(row.published_at || row.collected_at || ""));
      if (Number.isFinite(ts) && ts > newestTs) newestTs = ts;
    }

    const mentionScore = mentionCount >= 40 ? 10 : mentionCount >= 20 ? 8 : mentionCount >= 10 ? 6 : mentionCount >= 4 ? 4 : mentionCount > 0 ? 3 : 0;
    const postScore = postCount >= 30 ? 10 : postCount >= 15 ? 8 : postCount >= 8 ? 6 : postCount >= 3 ? 4 : postCount > 0 ? 3 : 0;
    const engagementScore = engagementWeight > 0 ? clampScore(engagementTotal / engagementWeight, 0, 10) : 0;

    let recencyScore = 0;
    if (newestTs > 0) {
      const ageDays = (Date.now() - newestTs) / (1000 * 60 * 60 * 24);
      recencyScore = ageDays <= 1 ? 10 : ageDays <= 3 ? 9 : ageDays <= 7 ? 8 : ageDays <= 14 ? 6 : ageDays <= 30 ? 4 : 2;
    }

    const platformWeight = p === "tiktok" ? 1.1 : 1.0;
    const base = (mentionScore * 0.30) + (postScore * 0.25) + (engagementScore * 0.30) + (recencyScore * 0.15);
    const momentumScore = clampScore(base * platformWeight, 0, 10);

    const reason = {
      platform: p,
      mention_count: mentionCount,
      post_count: postCount,
      engagement_score: Number(engagementScore.toFixed(3)),
      recency_score: Number(recencyScore.toFixed(3)),
      drivers: [
        `mention_score=${mentionScore}`,
        `post_score=${postScore}`,
        `engagement_score=${Number(engagementScore.toFixed(1))}`,
        `recency_score=${Number(recencyScore.toFixed(1))}`,
      ],
    };

    const payloadJson = {
      platform_weight: platformWeight,
      sample_size: mentionCount,
      computed_from: "social_signal_sources",
    };

    const snapshotDate = new Date().toISOString().slice(0, 10);
    const result = db.prepare(`
      INSERT INTO social_momentum_snapshots (
        content_item_id, platform, snapshot_date, mention_count, post_count,
        engagement_score, recency_score, momentum_score, momentum_reason, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contentItemId,
      p,
      snapshotDate,
      mentionCount,
      postCount,
      Number(engagementScore.toFixed(3)),
      Number(recencyScore.toFixed(3)),
      Number(momentumScore.toFixed(3)),
      JSON.stringify(reason),
      JSON.stringify(payloadJson)
    );

    const id = Number(result.lastInsertRowid || 0);
    return normalizeMomentumRow(
      db.prepare("SELECT * FROM social_momentum_snapshots WHERE id=? LIMIT 1").get(id)
    );
  }

  function recomputeContentDirectionByItem(contentItemId) {
    const item = getItem(contentItemId);
    if (!item) throw new Error("item not found");

    let intelligence = getPlaceIntelligenceByItem(contentItemId);
    if (!intelligence) {
      intelligence = recomputePlaceIntelligence(contentItemId);
    }

    const latestSearch = latestSearchEnrichmentByItem(contentItemId);
    const latestMomentum = latestMomentumSnapshotByItem(contentItemId);
    const searchSignalSummary = latestSearch ? buildSearchSignalSummary(latestSearch) : null;

    const priorityScore = clampScore(Number(intelligence?.priority_score || 0), 0, 10);
    const reviewVolumeScore = clampScore(Number(intelligence?.review_volume_score || 0), 0, 10);
    const visualScore = clampScore(Number(intelligence?.visual_score || 0), 0, 10);
    const contentGapScore = clampScore(Number(intelligence?.content_gap_score || 0), 0, 10);
    const momentumScore = Number.isFinite(Number(latestMomentum?.momentum_score))
      ? clampScore(Number(latestMomentum.momentum_score), 0, 10)
      : null;
    const entityConfidenceScore = searchSignalSummary?.entity_confidence_score == null
      ? null
      : clampScore(Number(searchSignalSummary.entity_confidence_score), 0, 10);

    const hasSearch = Boolean(latestSearch);
    const hasSocial = Boolean(latestMomentum) && ((Number(latestMomentum?.mention_count || 0) > 0) || (Number(latestMomentum?.post_count || 0) > 0) || (Number(momentumScore || 0) > 0));

    const computedFromMode = hasSearch
      ? (hasSocial ? "maps_plus_search_plus_social" : "maps_plus_search")
      : (hasSocial ? "maps_plus_social" : "maps_only");

    const gaps = [];
    if (!hasSearch) gaps.push("missing_search_presence");
    if (!hasSocial) gaps.push("missing_social_signal");
    if (reviewVolumeScore < 4) gaps.push("low_review_volume");
    if (visualScore < 4) gaps.push("weak_visual_signal");
    if (!Array.isArray(latestSearch?.official_urls_json) || latestSearch.official_urls_json.length === 0) gaps.push("missing_official_url");
    if (hasSearch && Number(searchSignalSummary?.normalized_result_count || 0) < 2) gaps.push("weak_search_signal");
    if (entityConfidenceScore != null && entityConfidenceScore < 4) gaps.push("low_entity_confidence");

    let priorityBand = "low";
    if (priorityScore >= 7.5) priorityBand = "high";
    else if (priorityScore >= 5) priorityBand = "medium";

    let directionStatus = "weak_signal";
    if (priorityBand === "high" && gaps.length <= 1) directionStatus = "ready";
    else if (priorityBand === "medium" && gaps.length <= 2) directionStatus = "monitor";
    else if (priorityBand !== "low") directionStatus = "needs_more_data";

    let primaryAngle = "new_discovery_candidate";
    if (momentumScore != null && momentumScore >= 6) primaryAngle = "rising_social_attention";
    else if (hasSearch && contentGapScore >= 6.5 && Number(searchSignalSummary?.official_url_count || 0) >= 1) primaryAngle = "search_gap_opportunity";
    else if (reviewVolumeScore >= 7) primaryAngle = "popular_local_pick";
    else if (visualScore >= 6) primaryAngle = "visual_spot";
    else if (clampScore(Number(intelligence?.rating_score || 0), 0, 10) >= 7) primaryAngle = "high_rating_local_pick";

    const secondaryAngles = [];
    if (Array.isArray(intelligence?.best_content_angles_json)) {
      secondaryAngles.push(...intelligence.best_content_angles_json.map((x) => String(x || "").trim()).filter(Boolean));
    }
    if (primaryAngle !== "search_gap_opportunity" && contentGapScore >= 6) secondaryAngles.push("search_gap_opportunity");
    if (primaryAngle !== "visual_spot" && visualScore >= 5) secondaryAngles.push("visual_spot");
    if (primaryAngle !== "popular_local_pick" && reviewVolumeScore >= 5) secondaryAngles.push("popular_local_pick");

    const whyNow = [];
    if (priorityBand === "high") whyNow.push("priority_score_high");
    if (reviewVolumeScore >= 5) whyNow.push("demand_signal_present");
    if (visualScore >= 5) whyNow.push("visual_material_ready");
    if (momentumScore != null && momentumScore >= 5) whyNow.push("momentum_signal_present");
    if (hasSearch && Number(searchSignalSummary?.normalized_result_count || 0) >= 3) whyNow.push("search_signal_structured");

    const whyNotNow = [];
    if (directionStatus !== "ready") {
      whyNotNow.push(...gaps);
      if (priorityScore < 5) whyNotNow.push("priority_score_low");
      if (!hasSearch) whyNotNow.push("needs_search_enrichment");
    }

    let recommendedNextAction = "hold";
    if (directionStatus === "ready") recommendedNextAction = "collect_now";
    else if (!hasSearch) recommendedNextAction = "enrich_search";
    else if (!hasSocial) recommendedNextAction = "watch_social";
    else if (priorityBand === "low") recommendedNextAction = "skip";

    if (!DIRECTION_PRIORITY_BANDS.has(priorityBand)) throw new Error("invalid priority_band");
    if (!DIRECTION_STATUSES.has(directionStatus)) throw new Error("invalid direction_status");
    if (!DIRECTION_NEXT_ACTIONS.has(recommendedNextAction)) throw new Error("invalid recommended_next_action");

    const capturePlan = [
      {
        action: directionStatus === "ready" ? "go_capture" : "prepare_capture",
        best_time_window: "late_afternoon_or_early_evening",
        focus: primaryAngle,
      },
      {
        action: "collect_evidence",
        needs: gaps,
      },
    ];

    const contentFormats = [
      { format: "short_video", priority: primaryAngle === "rising_social_attention" ? "high" : "medium" },
      { format: "photo_carousel", priority: visualScore >= 5 ? "high" : "medium" },
      { format: "seo_article", priority: contentGapScore >= 6 ? "high" : "medium" },
    ];

    const signalSummary = {
      priority_score: Number(priorityScore.toFixed(3)),
      score_mode: String(intelligence?.score_mode || "maps_only"),
      computed_from_mode: computedFromMode,
      rating_score: Number(clampScore(Number(intelligence?.rating_score || 0), 0, 10).toFixed(3)),
      review_volume_score: Number(reviewVolumeScore.toFixed(3)),
      visual_score: Number(visualScore.toFixed(3)),
      content_gap_score: Number(contentGapScore.toFixed(3)),
      momentum_score: momentumScore == null ? null : Number(momentumScore.toFixed(3)),
      has_search_enrichment: hasSearch,
      has_social_momentum: hasSocial,
      latest_intelligence_id: intelligence?.id || null,
      latest_search_enrichment_id: latestSearch?.id || null,
      latest_momentum_snapshot_id: latestMomentum?.id || null,
      search_quality_summary: searchSignalSummary,
    };

    if (gaps.length >= 4) gaps.push("missing_direction_confidence");

    const payload = {
      source_refs: {
        place_intelligence_id: intelligence?.id || null,
        search_enrichment_id: latestSearch?.id || null,
        momentum_snapshot_id: latestMomentum?.id || null,
      },
      item_meta: {
        title: item.title || "",
        category: item.category || "",
      },
    };

    const result = db.prepare(`
      INSERT INTO content_direction_reports (
        content_item_id, priority_band, direction_status, primary_angle,
        secondary_angles_json, why_now_json, why_not_now_json,
        recommended_next_action, recommended_capture_plan_json, recommended_content_formats_json,
        signal_summary_json, gaps_json, payload_json, computed_from_mode, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      contentItemId,
      priorityBand,
      directionStatus,
      primaryAngle,
      JSON.stringify(Array.from(new Set(secondaryAngles)).slice(0, 8)),
      JSON.stringify(Array.from(new Set(whyNow))),
      JSON.stringify(Array.from(new Set(whyNotNow))),
      recommendedNextAction,
      JSON.stringify(capturePlan),
      JSON.stringify(contentFormats),
      JSON.stringify(signalSummary),
      JSON.stringify(Array.from(new Set(gaps))),
      JSON.stringify(payload),
      computedFromMode
    );

    const id = Number(result.lastInsertRowid || 0);
    return normalizeContentDirectionRow(
      db.prepare("SELECT * FROM content_direction_reports WHERE id=? LIMIT 1").get(id)
    );
  }

  function getLatestContentDirectionByItem(contentItemId) {
    return normalizeContentDirectionRow(
      db
        .prepare("SELECT * FROM content_direction_reports WHERE content_item_id=? ORDER BY id DESC LIMIT 1")
        .get(contentItemId)
    );
  }

  function listTopContentDirectionReports(limit = 10, priorityBand = "", directionStatus = "") {
    const safeLimit = Math.max(1, Math.min(100, Number(limit || 10)));
    const pb = String(priorityBand || "").trim().toLowerCase();
    const ds = String(directionStatus || "").trim().toLowerCase();

    if (pb && !DIRECTION_PRIORITY_BANDS.has(pb)) {
      throw new Error("invalid priority_band");
    }
    if (ds && !DIRECTION_STATUSES.has(ds)) {
      throw new Error("invalid direction_status");
    }

    let sql = `
      SELECT cdr.*, ci.title, ci.category
      FROM content_direction_reports cdr
      JOIN content_items ci ON ci.id = cdr.content_item_id
      WHERE ci.is_deleted=0
        AND cdr.id IN (
          SELECT MAX(id) FROM content_direction_reports GROUP BY content_item_id
        )
    `;
    const params = [];
    if (pb) {
      sql += " AND cdr.priority_band=?";
      params.push(pb);
    }
    if (ds) {
      sql += " AND cdr.direction_status=?";
      params.push(ds);
    }

    sql += `
      ORDER BY CASE cdr.priority_band
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        ELSE 3
      END ASC, cdr.computed_at DESC
      LIMIT ?
    `;
    params.push(safeLimit);

    const rows = db.prepare(sql).all(...params);
    return rows.map((row) => ({
      ...normalizeContentDirectionRow(row),
      title: row.title,
      category: row.category,
    }));
  }

  function getDeletedItemReferenceGroups(itemId) {
    const id = Number(itemId || 0) || 0;
    if (!id) {
      const err = new Error("invalid item id");
      err.statusCode = 400;
      throw err;
    }
    const item = db.prepare(`
      SELECT id, item_uid, type, category, title, slug, is_deleted
      FROM content_items
      WHERE id=?
      LIMIT 1
    `).get(id);
    if (!item || Number(item.is_deleted || 0) !== 1) {
      const err = new Error("deleted item not found");
      err.statusCode = 404;
      throw err;
    }

    const groups = [];
    for (const def of REFERENCE_CLEANUP_CANDIDATE_DEFS) {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${def.table} WHERE ${def.where}`).get(id);
      const count = Number(row?.c || 0) || 0;
      if (count < 1) continue;
      const group = {
        key: def.key,
        label_th: def.label_th,
        count,
        category: "cleanup_candidate",
        cleanup_action: def.key === "content_assets" ? "delete_assets" : "delete_rows",
      };
      if (def.key === "content_assets") {
        const assetRows = db
          .prepare("SELECT asset_id FROM content_assets WHERE content_item_id=? ORDER BY id ASC LIMIT 25")
          .all(id);
        group.asset_ids = assetRows
          .map((entry) => Number(entry?.asset_id || 0) || 0)
          .filter((value) => value > 0);
      }
      groups.push(group);
    }

    for (const def of REFERENCE_HARD_BLOCKER_DEFS) {
      const row = db.prepare(def.sql).get(id);
      const count = Number(row?.c || 0) || 0;
      if (count < 1) continue;
      groups.push({
        key: def.key,
        label_th: def.label_th,
        count,
        category: "hard_blocker",
        cleanup_action: null,
        resolution_hint: def.hint,
      });
    }

    const cleanupCandidateCount = groups
      .filter((entry) => entry.category === "cleanup_candidate")
      .reduce((sum, entry) => sum + (Number(entry.count || 0) || 0), 0);
    const hardBlockerCount = groups
      .filter((entry) => entry.category === "hard_blocker")
      .reduce((sum, entry) => sum + (Number(entry.count || 0) || 0), 0);

    return {
      item: {
        id: Number(item.id || 0) || 0,
        item_uid: item.item_uid || null,
        type: item.type || null,
        category: item.category || null,
        title: item.title || null,
        slug: item.slug || null,
        is_deleted: Number(item.is_deleted || 0) || 0,
      },
      groups,
      summary: {
        total_references: cleanupCandidateCount + hardBlockerCount,
        cleanup_candidate_count: cleanupCandidateCount,
        hard_blocker_count: hardBlockerCount,
      },
    };
  }

  function cleanupDeletedItemReferenceGroups({ itemId, groups, actorEmail, reason }) {
    const id = Number(itemId || 0) || 0;
    if (!id) {
      const err = new Error("invalid item id");
      err.statusCode = 400;
      throw err;
    }
    const item = db.prepare("SELECT id, is_deleted FROM content_items WHERE id=? LIMIT 1").get(id);
    if (!item || Number(item.is_deleted || 0) !== 1) {
      const err = new Error("deleted item not found");
      err.statusCode = 404;
      throw err;
    }

    const selectedGroups = Array.isArray(groups)
      ? [...new Set(groups.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean))]
      : [];
    if (!selectedGroups.length) {
      const err = new Error("groups is required");
      err.statusCode = 400;
      throw err;
    }
    for (const key of selectedGroups) {
      if (!REFERENCE_CLEANUP_CANDIDATE_KEYS.has(key)) {
        const err = new Error("group not eligible for cleanup");
        err.statusCode = 400;
        err.group = key;
        err.category = REFERENCE_ALL_GROUP_KEYS.has(key) ? "hard_blocker" : "invalid_group";
        throw err;
      }
    }

    const cleaned = {};
    const deletedAssetIds = [];
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const key of selectedGroups) {
        if (key === "drafts") {
          db.prepare(`
            UPDATE content_workflow_models
            SET current_draft_id=NULL
            WHERE content_item_id=?
              AND current_draft_id IN (
                SELECT id FROM content_drafts WHERE content_item_id=?
              )
          `).run(id, id);
        } else if (key === "review_reports") {
          db.prepare(`
            UPDATE content_workflow_models
            SET current_review_report_id=NULL
            WHERE content_item_id=?
              AND current_review_report_id IN (
                SELECT id FROM review_reports WHERE content_item_id=?
              )
          `).run(id, id);
        } else if (key === "field_packs") {
          db.prepare(`
            UPDATE content_workflow_models
            SET current_field_pack_id=NULL
            WHERE content_item_id=?
              AND current_field_pack_id IN (
                SELECT id FROM field_packs WHERE content_item_id=?
              )
          `).run(id, id);
        }
        if (key === "content_assets") {
          const rows = db.prepare("SELECT id, asset_id FROM content_assets WHERE content_item_id=?").all(id);
          for (const row of rows) {
            const assetId = Number(row?.asset_id || 0) || 0;
            if (assetId > 0) deletedAssetIds.push(assetId);
          }
          const result = db.prepare("DELETE FROM content_assets WHERE content_item_id=?").run(id);
          cleaned[key] = Number(result?.changes || 0) || 0;
          continue;
        }
        const def = REFERENCE_CLEANUP_CANDIDATE_DEFS.find((entry) => entry.key === key);
        if (!def) continue;
        const result = db.prepare(`DELETE FROM ${def.table} WHERE ${def.where}`).run(id);
        cleaned[key] = Number(result?.changes || 0) || 0;
      }

      logAudit(actorEmail, "item.reference.cleanup", "content_item", String(id), {
        groups: selectedGroups,
        reason: String(reason || "").trim() || null,
        counts: cleaned,
        content_assets_removed: cleaned.content_assets || 0,
      });
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw error;
    }

    return {
      ok: true,
      item_id: id,
      cleaned,
      deleted_asset_ids: [...new Set(deletedAssetIds)],
    };
  }

  function logAudit(actorEmail, action, targetType, targetId, details, metadata = {}) {
    const assignmentId = metadata?.assignment_id == null ? null : Number(metadata.assignment_id || 0) || null;
    const createdAt = toBangkokSqlTimestamp();
    insertAuditStmt.run(
      actorEmail,
      action,
      targetType,
      targetId,
      assignmentId,
      details ? JSON.stringify(details) : null,
      createdAt
    );
  }

  return {
    saveItem,
    updateItemWithWorkflowHead,
    createItemWithWorkflowHead,
    advanceWorkflowHead,
    saveItemWithFieldPack,
    listItems,
    listItemsByStatus,
    getItem,
    deleteItem,
    getRawOnlyHardDeleteEligibility,
    hardDeleteRawOnlyItem,
    bulkDeleteItems,
    updateItemsCategory,
    setWorkflowStatus,
    ensureWorkflowModel,
    upsertWorkflowModel,
    getWorkflowHeadByItem,
    getWorkflowModelByItem,
    syncWorkflowHeadPointers,
    backfillWorkflowHeads,
    listItemsByWorkflowHead,
    getWorkflowStateDriftByItem,
    listWorkflowTransitionsByItem,
    listWorkflowTransitionsByAssignment,
    listAuditByTarget,
    createAssignment,
    createAssignmentFromReadiness,
    repairAssignmentHandoffSnapshotForAssignment,
    getAssignmentById,
    getLatestAssignmentHandoffByAssignment,
    listAssignmentsByItem,
    listAssignments,
    listAssignmentsByScopeUserIds,
    listAssignmentsByAssignee,
    listExternalAssignmentsByAssigner,
    buildAssignmentHandoffPreview,
    buildPublishableSourceByItem,
    buildFieldReturnEvidenceByItem,
    buildGovernanceSummaryByItem,
    updateAssignmentState,
    updateAssignmentMediaResetPolicy,
    requestAssignmentRevisionWithReset,
    addAssignmentSubmission,
    setAssignmentLatestSubmission,
    getAssignmentSubmissionById,
    listAssignmentSubmissions,
    upsertAssignmentSubmissionDraft,
    getAssignmentSubmissionDraft,
    getAssignmentSubmissionDraftPrefill,
    deleteAssignmentSubmissionDraft,
    deleteAssignmentSubmissionDraftsByAssignment,
    purgeExpiredAssignmentSubmissionDrafts,
    listAssignmentRoundAssetsByType,
    deleteAssignmentRoundAssetsByType,
    createAssignmentSubmissionDeliverable,
    listAssignmentSubmissionDeliverablesBySubmission,
    listAssignmentSubmissionDeliverablesByAssignment,
    summarizeAssignmentDeliverables,
    evaluateAssignmentDeliverablesReadiness,
    getLatestAssignmentDeliverablesBundle,
    evaluateAssignmentDeliverablesUtilityReadiness,
    evaluateAssignmentHandoffUtilityByAssignment,
    evaluateAssignmentDeliverablesReviewDecisionByAssignment,
    evaluateAssignmentSubmissionDecisionByAssignment,
    evaluateAssignmentDeliverablesGovernanceSummaryByAssignment,
    evaluateAssignmentHandoffGovernanceByAssignment,
    addIntelligenceModel,
    getLatestIntelligenceModelByItem,
    recomputeReadinessBriefByItem,
    getLatestReadinessBriefByItem,
    recomputeExecutionControlsByItem,
    getLatestExecutionControlsByItem,
    createExecutionChannelRecord,
    listExecutionChannelsByItem,
    getLatestExecutionChannelByItemAndChannel,
    getExecutionChannelCoverageByItem,
    evaluateExecutionReadinessByItem,
    validateLatestExecutionChannelByItemAndChannel,
    replaceQualityChecks,
    listQualityChecks,
    addVersion,
    stageItem,
    listStaging,
    createPipelineRun,
    finishPipelineRun,
    createExportJob,
    finishExportJob,
    listExports,
    startSourceIngestion,
    finishSourceIngestion,
    addRawSourceItem,
    addRawSourceMedia,
    listSourceIngestions,
    listRawSourceItems,
    listSourceRecordsByItem,
    getOfficialReferenceByItem,
    startGenerationRun,
    finishGenerationRun,
    saveDraft,
    latestDraftByItem,
    listDrafts,
    addReviewReport,
    latestReviewByItem,
    latestApprovedReviewByItem,
    createFieldPack,
    updateFieldPack,
    getFieldPackBundleById,
    getCurrentFieldPackByItem,
    listFieldPacksByItem,
    deleteFieldPackById,
    returnFieldPackToCleanAtomic,
    listAgentProfiles,
    getAgentProfile,
    upsertAgentProfile,
    listAiFeaturePolicies,
    getAiFeaturePolicy,
    upsertAiFeaturePolicy,
    replaceFieldPackChecklists,
    replaceFieldPackReferences,
    replaceFieldPackMediaHints,
    replaceFieldPackAssignments,
    listReviewQueue,
    addReviewAction,
    setReviewStatus,
    saveInternalLinkSuggestions,
    listInternalLinkSuggestions,
    reviewInternalLinkSuggestion,
    startPublishRun,
    finishPublishRun,
    savePublishedArticle,
    backfillInvalidSlugs,
    listPublishedArticles,
    getPublishedArticleByItem,
    setPublishedArticleStatusByItem,
    deletePublishedArticleByItem,
    restorePublishedArticleByItem,
    getTranslation,
    upsertTranslation,
    listTranslations,
    markStaleTranslations,
    updateTranslationRecheck,
    updateTranslationRepairResult,
    startTranslationRun,
    finishTranslationRun,
    listTranslationRuns,
    addEvidenceBlock,
    listEvidenceBlocks,
    addApprovedContextBlock,
    listApprovedContextBlocks,
    updateApprovedContextBlock,
    buildDraftInputPreview,
    createDraftInputSnapshot,
    listContentAssetsByItem,
    getImageWorkflowStatus,
    setContentAssetRole,
    setContentAssetSelected,
    listApprovedImageContext,
    listApprovedLocalImageContext,
    normalizeReferenceMediaUrl,
    getReferenceMediaIdFromUrl,
    looksLikeReferenceImageUrl,
    collectReferenceMediaCandidatesByItem,
    listReferenceMediaByItem,
    setReferenceMediaSelected,
    listImportedReferenceAssetsByItem,
    repairImportedReferenceAssetsForItem,
    evaluateContentAssetCleanupEligibility,
    listPostAssignmentAiInputCleanupCandidates,
    getDeletedItemReferenceGroups,
    cleanupDeletedItemReferenceGroups,
    addSearchEnrichmentRecord,
    listSearchEnrichmentByItem,
    latestSearchEnrichmentByItem,
    recomputePlaceIntelligence,
    getPlaceIntelligenceByItem,
    listTopPlaceIntelligence,
    addSocialSignalSource,
    listSocialSignalSourcesByItem,
    recomputeMomentumScore,
    listMomentumSnapshotsByItem,
    latestMomentumSnapshotByItem,
    recomputeContentDirectionByItem,
    getLatestContentDirectionByItem,
    listTopContentDirectionReports,
    claimItem,
    releaseItemClaim,
    takeOverItemClaim,
    logAudit,
  };
}

function normalizeWorkflowActorRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (!role) return null;
  if (!WORKFLOW_ACTOR_ROLES.has(role)) return null;
  return role;
}

function normalizeSubmissionStateValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return ASSIGNMENT_SUBMISSION_STATES.has(normalized) ? normalized : "";
}

function normalizeAssignmentDeliverableTypeValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return ASSIGNMENT_DELIVERABLE_TYPES.has(normalized) ? normalized : "";
}

function normalizeAssignmentKindValue(value, fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ASSIGNMENT_KINDS.has(normalized) ? normalized : fallback;
}

function assetMimeMatchesDeliverableType(deliverableType, mimeType) {
  const normalizedType = normalizeAssignmentDeliverableTypeValue(deliverableType);
  const normalizedMime = String(mimeType || "").trim().toLowerCase();
  if (!normalizedType || !normalizedMime) return false;
  if (normalizedType === "photos") return normalizedMime.startsWith("image/");
  if (normalizedType === "videos") return normalizedMime.startsWith("video/");
  return true;
}

function normalizeAssignmentDeliverableStatusValue(value) {
  const normalized = String(value || "draft").trim().toLowerCase();
  if (!normalized) return "";
  return ASSIGNMENT_DELIVERABLE_STATUSES.has(normalized) ? normalized : "";
}

function isFulfilledAssignmentDeliverableStatus(value) {
  const normalized = normalizeAssignmentDeliverableStatusValue(value);
  return ASSIGNMENT_FULFILLED_DELIVERABLE_STATUSES.has(normalized);
}

function normalizeAssignmentDeliverableTypeList(values) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const normalized = normalizeAssignmentDeliverableTypeValue(raw);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function deriveExpectedDeliverablesFromHandoff(handoffPackage) {
  if (!handoffPackage || typeof handoffPackage !== "object") return [];
  const derived = [];
  if (Array.isArray(handoffPackage.shot_list_suggestions) && handoffPackage.shot_list_suggestions.length > 0) {
    derived.push("photos", "videos");
  }
  if (Array.isArray(handoffPackage.caption_suggestions) && handoffPackage.caption_suggestions.length > 0) {
    derived.push("caption_draft");
  }
  if (Array.isArray(handoffPackage.script_suggestions) && handoffPackage.script_suggestions.length > 0) {
    derived.push("script_draft");
  }
  if (String(handoffPackage.brief_summary || "").trim()) {
    derived.push("raw_notes");
  }
  return normalizeAssignmentDeliverableTypeList(derived);
}


















