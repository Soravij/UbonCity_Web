import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { buildCleanStructuredContext } from "../services/clean-context.mjs";
import { buildPromptInput, normalizeFieldPack } from "../services/agent-generation.mjs";
import { deriveCtaContactCandidatesFromStructuredContext } from "../server/cta-contact-normalizer.mjs";
import { buildFieldPackUpdatePayloadFromAgent } from "../server/endpoint-schema-mapping.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "FieldPack!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-field-pack-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve("D:\\UbonCity_Web\\collector\\database\\schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem(title) {
    const created = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title,
      description_raw: `${title} raw`,
      source_type: "manual",
      source_name: "manual",
      source_url: `https://${title.toLowerCase().replace(/\s+/g, "-")}.example.com`,
    });
    return created.item;
  }

  function createDraft(itemId, suffix = "A") {
    return repo.saveDraft(itemId, `run-${itemId}-${suffix}`, {
      draft_title: `Draft ${suffix}`,
      excerpt: `Excerpt ${suffix}`,
      body: `Body ${suffix}`,
      status: "generated",
    });
  }

  function createReview(itemId, draftId, suffix = "A") {
    const reviewId = repo.addReviewReport(itemId, draftId, {
      duplication_score: 1,
      seo_risk_score: 1,
      metadata_score: 1,
      grounding_score: 1,
      ai_quality_score: 1,
      total_score: 5,
      issues: [],
      report: { summary: `Review ${suffix}` },
      status: "approved",
    });
    return repo.latestReviewByItem(itemId) ?? { id: reviewId };
  }

  function createSnapshot(itemId, suffix = "A") {
    return repo.createDraftInputSnapshot(itemId, {
      meta: { label: `Snapshot ${suffix}` },
      approved_context: [],
    }, "tester@local", "approved_context_preview");
  }

  function createReadinessBrief(itemId, suffix = "A") {
    const result = db.prepare(`
      INSERT INTO content_readiness_briefs (
        content_item_id,
        readiness_json,
        brief_json,
        reasons_json,
        blockers_json,
        missing_requirements_json,
        computed_by
      )
      VALUES (?, ?, ?, '[]', '[]', '[]', 'tester@local')
    `).run(
      itemId,
      JSON.stringify({
        ready_for_content: true,
        ready_for_publish: false,
        blockers: [],
        missing_requirements: [],
        label: `Readiness ${suffix}`,
      }),
      JSON.stringify({
        brief_summary: `Readiness brief ${suffix}`,
        niche: "test-niche",
        gaps: ["need_more_visuals"],
        next_actions: ["collect_more_photos"],
        evidence_summary: { summary: `Evidence ${suffix}` },
        recommended_angle: `Angle ${suffix}`,
        recommended_hook: `Hook ${suffix}`,
        script_suggestions: [`Script ${suffix}`],
        caption_suggestions: [`Caption ${suffix}`],
        shot_list_suggestions: [`Shot ${suffix}`],
      })
    );
    return Number(result.lastInsertRowid || 0);
  }

  const tableColumnCache = new Map();

  function getTableColumns(table) {
    if (tableColumnCache.has(table)) return tableColumnCache.get(table);
    const columns = new Set(
      db.prepare(`PRAGMA table_info(${table})`).all().map((column) => String(column?.name || "").trim())
    );
    tableColumnCache.set(table, columns);
    return columns;
  }

  function setRowTimestamps(table, id, createdAt, updatedAt = createdAt) {
    const columns = getTableColumns(table);
    if (columns.has("updated_at")) {
      db.prepare(`UPDATE ${table} SET created_at=?, updated_at=? WHERE id=?`).run(createdAt, updatedAt, id);
      return;
    }
    db.prepare(`UPDATE ${table} SET created_at=? WHERE id=?`).run(createdAt, id);
  }

  function createExecutionControls(itemId, readinessBriefId, suffix = "A") {
    const result = db.prepare(`
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
      ) VALUES (?, ?, NULL, '[]', '[]', '[]', '[]', '{}', ?, 'tester@local')
    `).run(
      itemId,
      readinessBriefId == null ? null : Number(readinessBriefId || 0) || null,
      JSON.stringify({ label: `controls-${suffix}` })
    );
    return Number(result.lastInsertRowid || 0) || 0;
  }

  function createExecutionChannel(itemId, readinessBriefId, channel, suffix = "A") {
    const result = db.prepare(`
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
      ) VALUES (?, ?, ?, 'th', '{}', ?, '[]', '{}', 'generated', 'tester@local')
    `).run(
      itemId,
      readinessBriefId == null ? null : Number(readinessBriefId || 0) || null,
      String(channel || "").trim().toLowerCase(),
      JSON.stringify({ label: `${channel}-${suffix}` })
    );
    return Number(result.lastInsertRowid || 0) || 0;
  }

  function createContentAsset(itemId, suffix = "A", options = {}) {
    const mimeType = String(options.mime_type || "image/jpeg");
    const extension = String(options.extension || (mimeType.startsWith("video/") ? "mp4" : "jpg"));
    const assetResult = db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES (?, 'local', ?, ?, ?, 100, ?)
    `).run(
      `asset-${itemId}-${suffix}`,
      `uploads/${itemId}-${suffix}.${extension}`,
      `${itemId}-${suffix}.${extension}`,
      mimeType,
      `checksum-${itemId}-${suffix}`
    );
    const assetId = Number(assetResult.lastInsertRowid || 0);
    const contentAssetResult = db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, 'gallery', 1, 0, 'gallery', 0)
    `).run(itemId, assetId);
    return {
      asset_id: assetId,
      content_asset_id: Number(contentAssetResult.lastInsertRowid || 0),
    };
  }

  function createRawOnlyAutoDependencies(itemId, suffix = "raw") {
    const item = repo.getItem(itemId);
    const sourceResult = db.prepare(`
      INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
      VALUES (?, 'google_search', 'raw-import', ?, ?, '{}')
    `).run(
      itemId,
      `https://example.com/raw-${suffix}`,
      `entity-${suffix}`
    );
    const sourceRecordId = Number(sourceResult.lastInsertRowid || 0) || 0;
    db.prepare(`
      INSERT INTO evidence_blocks (
        content_item_id, block_type, source_type, source_record_type, source_record_id,
        source_url, source_label, lang, attribution_text, text_value, payload_json, status
      ) VALUES (?, 'fact', 'import', 'source_records', ?, ?, 'raw-import', 'th', 'Collected source signal', ?, '{}', 'active')
    `).run(
      itemId,
      String(sourceRecordId),
      `https://example.com/raw-${suffix}`,
      `Raw evidence ${suffix}`
    );
    db.prepare(`
      INSERT INTO content_workflow_transitions (
        content_item_id, assignment_id, state_group, from_state, to_state, actor_email, actor_role, reason_code, note
      ) VALUES (?, NULL, 'production', NULL, 'collected', 'system@local', 'system', 'collect_import_created', 'raw import created')
    `).run(itemId);
    const linkedAsset = createContentAsset(itemId, `raw-${suffix}`);
    return {
      source_record_id: sourceRecordId,
      asset_id: linkedAsset.asset_id,
      content_asset_id: linkedAsset.content_asset_id,
      item_title: item?.title || "",
    };
  }

  function createRawReview(itemId, suffix = "raw-review") {
    const result = db.prepare(`
      INSERT INTO reviews_raw (content_item_id, review_text, source_name, source_url)
      VALUES (?, ?, 'test-review', ?)
    `).run(itemId, `Review ${suffix}`, `https://example.com/review-${suffix}`);
    return Number(result.lastInsertRowid || 0) || 0;
  }

  function createQualityCheck(itemId, suffix = "quality") {
    const result = db.prepare(`
      INSERT INTO quality_checks (content_item_id, check_name, status, reason)
      VALUES (?, ?, 'needs_review', ?)
    `).run(itemId, `check-${suffix}`, `reason-${suffix}`);
    return Number(result.lastInsertRowid || 0) || 0;
  }

  function createApprovedContextBlock(itemId, suffix = "context") {
    const evidenceResult = db.prepare(`
      INSERT INTO evidence_blocks (
        content_item_id, block_type, source_type, source_url, source_label, lang,
        attribution_text, text_value, payload_json, status
      ) VALUES (?, 'fact', 'manual', ?, ?, 'th', 'tester', ?, '{}', 'active')
    `).run(
      itemId,
      `https://example.com/context-${suffix}`,
      `Context ${suffix}`,
      `Evidence ${suffix}`
    );
    const evidenceBlockId = Number(evidenceResult.lastInsertRowid || 0) || 0;
    const approvedResult = db.prepare(`
      INSERT INTO approved_context_blocks (
        content_item_id, evidence_block_id, context_type, selected_text, note, editor_note,
        sort_order, confidence, status, approved_by
      ) VALUES (?, ?, 'fact', ?, NULL, NULL, 0, 0.9, 'active', 'tester@local')
    `).run(itemId, evidenceBlockId, `Selected ${suffix}`);
    return {
      evidence_block_id: evidenceBlockId,
      approved_context_block_id: Number(approvedResult.lastInsertRowid || 0) || 0,
    };
  }

  function createInternalLinkSuggestion(sourceItemId, targetItemId, suffix = "link") {
    repo.saveInternalLinkSuggestions(sourceItemId, [
      {
        target_content_item_id: targetItemId,
        anchor_text: `Anchor ${suffix}`,
        relevance_score: 5,
        reason: `Reason ${suffix}`,
        status: "suggested",
      },
    ]);
    return repo.listInternalLinkSuggestions(sourceItemId);
  }

  function createUser(suffix = "field-pack") {
    const email = `${suffix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role)
      VALUES (?, ?, 'hash', 'user')
    `).run(email, `User ${suffix}`);
    return {
      id: Number(result.lastInsertRowid || 0),
      email,
    };
  }

  return {
    db,
    repo,
    cleanup,
    createItem,
    createDraft,
    createReview,
    createSnapshot,
    createReadinessBrief,
    createExecutionControls,
    createExecutionChannel,
    setRowTimestamps,
    createContentAsset,
    createRawOnlyAutoDependencies,
    createRawReview,
    createQualityCheck,
    createApprovedContextBlock,
    createInternalLinkSuggestion,
    createUser,
  };
}

function toBangkokSqlTimestampForTest(value = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(value).replace("T", " ");
}

function buildValidAttractionRequestedCheckReturns(overrides = {}) {
  const base = {
    "cta_contact.phone": { checked: true, value: "0811111111", evidence: "storefront signage" },
    "cta_contact.line_url": { checked: true, value: "" },
    "cta_contact.facebook_url": { checked: true, value: "" },
    "cta_contact.website_url": { checked: true, value: "" },
    "cta_contact.primary_cta": { checked: true, value: "map" },
    "taxonomy.parking": { checked: true, value: false, condition_note: "No dedicated parking" },
    "taxonomy.pet_friendly": { checked: true, value: false, evidence: "No pet signage" },
    "taxonomy.wheelchair_accessible": { checked: true, value: false, evidence: "Front stairs only" },
    "taxonomy.toilet_available": { checked: true, value: true },
    "taxonomy.entry_fee_required": { checked: true, value: false },
    "taxonomy.setting_type": { checked: true, value: "outdoor" },
  };
  const next = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete next[key];
      continue;
    }
    next[key] = value;
  }
  return next;
}

function buildRequestedReturnsFromHandoff(handoffPackage, overrides = {}) {
  const result = {};
  const groups = Array.isArray(handoffPackage?.requested_checks?.groups) ? handoffPackage.requested_checks.groups : [];
  for (const group of groups) {
    const groupKey = String(group?.group_key || "").trim().toLowerCase();
    for (const check of Array.isArray(group?.checks) ? group.checks : []) {
      const checkKey = String(check?.key || "").trim().toLowerCase();
      const returnKey = `${groupKey}.${checkKey}`;
      if (Object.prototype.hasOwnProperty.call(overrides, returnKey)) {
        if (overrides[returnKey] !== null) result[returnKey] = overrides[returnKey];
        continue;
      }
      if (groupKey === "cta_contact") {
        if (checkKey === "phone") result[returnKey] = { checked: true, value: "0811111111", evidence: "storefront signage" };
        else if (checkKey === "primary_cta") result[returnKey] = { checked: true, value: "map" };
        else result[returnKey] = { checked: true, value: "" };
        continue;
      }
      const answerType = String(check?.answer_type || "").trim().toLowerCase();
      if (answerType === "boolean" || answerType === "boolean_with_conditions") {
        result[returnKey] = {
          checked: true,
          value: false,
          ...(check?.evidence_required === true ? { evidence: `${checkKey} evidence` } : {}),
        };
      } else if (answerType === "select") {
        result[returnKey] = { checked: true, value: Array.isArray(check?.allowed_values) ? check.allowed_values[0] || null : null };
      } else if (answerType === "multi_select") {
        result[returnKey] = { checked: true, value: [] };
      } else if (answerType === "number_with_unit") {
        result[returnKey] = { checked: true, value: { number: 1, unit: Array.isArray(check?.unit_options) ? check.unit_options[0] || null : null } };
      } else if (answerType === "note_only") {
        result[returnKey] = { checked: true, note: "verified" };
      } else {
        result[returnKey] = { checked: true, value: "verified" };
      }
    }
  }
  return result;
}

function captureAssignmentAtomicState(ctx, assignmentId) {
  const assignment = ctx.repo.getAssignmentById(assignmentId);
  const itemId = Number(assignment?.content_item_id || 0) || 0;
  const workflow = itemId ? ctx.repo.ensureWorkflowModel(itemId) : null;
  const workflowTransitionCount = itemId
    ? Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_workflow_transitions WHERE content_item_id=?").get(itemId)?.c || 0)
    : 0;
  return {
    assignment: {
      id: Number(assignment?.id || 0) || 0,
      state: assignment?.state || null,
      accepted_at: assignment?.accepted_at || null,
      accepted_handoff_snapshot_id: assignment?.accepted_handoff_snapshot_id ?? null,
      accepted_submission_id: assignment?.accepted_submission_id ?? null,
      revision_round: Number(assignment?.revision_round || 0) || 0,
      latest_submission_id: assignment?.latest_submission_id ?? null,
      accepted_binding_status: assignment?.accepted_binding_status || null,
    },
    workflow_assignment_state: workflow?.assignment_state || null,
    workflow_transition_count: workflowTransitionCount,
  };
}

function currentHandoffSnapshotId(ctx, assignmentId) {
  return Number(ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId)?.id || 0) || 0;
}

function insertLegacyAssignmentSubmission(ctx, {
  assignmentId,
  handoffSnapshotId,
  submittedByUserId,
  submissionState = "submitted",
  articlePayloadJson = null,
  mediaPayloadJson = null,
  fieldReturnPayloadJson = null,
} = {}) {
  const createdAt = toBangkokSqlTimestampForTest(new Date("2026-06-22T03:00:00.000Z"));
  const assignment = ctx.repo.getAssignmentById(assignmentId);
  assert.ok(assignment, "assignment should exist for legacy submission insert");
  const result = ctx.db.prepare(`
    INSERT INTO content_assignment_submissions (
      assignment_id, content_item_id, source_handoff_snapshot_id, submitted_by_user_id, submission_state,
      article_payload_json, media_payload_json, field_return_payload_json,
      contributor_note, reviewer_note, created_at, updated_at, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)
  `).run(
    assignmentId,
    Number(assignment.content_item_id || 0) || 0,
    handoffSnapshotId || null,
    submittedByUserId,
    submissionState,
    articlePayloadJson == null ? null : JSON.stringify(articlePayloadJson),
    mediaPayloadJson == null ? null : JSON.stringify(mediaPayloadJson),
    fieldReturnPayloadJson == null ? null : JSON.stringify(fieldReturnPayloadJson),
    createdAt,
    createdAt
  );
  const submissionId = Number(result.lastInsertRowid || 0) || 0;
  ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=? WHERE id=?").run(submissionId, assignmentId);
  return ctx.repo.getAssignmentSubmissionById(submissionId);
}

function assertAssignmentAtomicStateEqual(actual, expected) {
  assert.deepEqual(actual, expected);
}

test("createFieldPack rejects source draft/review/snapshot from another item", () => {
  const ctx = createTestContext();
  try {
    const itemA = ctx.createItem("Alpha Place");
    const itemB = ctx.createItem("Beta Place");

    const draftB = ctx.createDraft(itemB.id, "B");
    const reviewB = ctx.createReview(itemB.id, draftB.id, "B");
    const snapshotB = ctx.createSnapshot(itemB.id, "B");

    assert.throws(() => {
      ctx.repo.createFieldPack({
        content_item_id: itemA.id,
        source_draft_id: draftB.id,
        source_review_report_id: reviewB.id,
        source_draft_input_snapshot_id: snapshotB.id,
        ai_summary: "Cross-item source should fail",
      });
    }, /belongs to another content item/);
  } finally {
    ctx.cleanup();
  }
});

test("createFieldPack rejects media hints that point to content assets from another item", () => {
  const ctx = createTestContext();
  try {
    const itemA = ctx.createItem("Gamma Place");
    const itemB = ctx.createItem("Delta Place");
    const mediaB = ctx.createContentAsset(itemB.id, "B");

    assert.throws(() => {
      ctx.repo.createFieldPack({
        content_item_id: itemA.id,
        ai_summary: "Wrong media hint should fail",
        field_pack_media_hints: [
          {
            content_asset_id: mediaB.content_asset_id,
            url: "https://example.com/photo.jpg",
            kind: "gallery",
            selected: true,
          },
        ],
      });
    }, /belongs to another content item/);
  } finally {
    ctx.cleanup();
  }
});

test("updateFieldPack rejects cross-item source and media regressions", () => {
  const ctx = createTestContext();
  try {
    const itemA = ctx.createItem("Epsilon Place");
    const itemB = ctx.createItem("Zeta Place");

    const draftA = ctx.createDraft(itemA.id, "A");
    const reviewA = ctx.createReview(itemA.id, draftA.id, "A");
    const snapshotA = ctx.createSnapshot(itemA.id, "A");
    const draftB = ctx.createDraft(itemB.id, "B");
    ctx.createReview(itemB.id, draftB.id, "B");
    const snapshotB = ctx.createSnapshot(itemB.id, "B");
    const mediaB = ctx.createContentAsset(itemB.id, "B");

    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: itemA.id,
      source_draft_id: draftA.id,
      source_review_report_id: reviewA.id,
      source_draft_input_snapshot_id: snapshotA.id,
      ai_summary: "Valid initial pack",
    });

    assert.throws(() => {
      ctx.repo.updateFieldPack(fieldPack.id, {
        source_draft_id: draftB.id,
      });
    }, /belongs to another content item/);

    assert.throws(() => {
      ctx.repo.updateFieldPack(fieldPack.id, {
        source_draft_input_snapshot_id: snapshotB.id,
      });
    }, /belongs to another content item/);

    assert.throws(() => {
      ctx.repo.updateFieldPack(fieldPack.id, {
        field_pack_media_hints: [
          {
            content_asset_id: mediaB.content_asset_id,
            url: "https://example.com/wrong-photo.jpg",
            kind: "reference",
            selected: false,
          },
        ],
      });
    }, /belongs to another content item/);
  } finally {
    ctx.cleanup();
  }
});

test("saveItemWithFieldPack rejects field pack id from another item", () => {
  const ctx = createTestContext();
  try {
    const itemA = ctx.createItem("Theta Place");
    const itemB = ctx.createItem("Iota Place");

    const fieldPackB = ctx.repo.createFieldPack({
      content_item_id: itemB.id,
      ai_summary: "Pack B",
    });

    assert.throws(() => {
      ctx.repo.saveItemWithFieldPack(
        {
          ...itemA,
          id: itemA.id,
          title: "Theta Place Updated",
          description_raw: "Theta raw updated",
        },
        {
          id: fieldPackB.id,
          ai_summary: "Should fail",
        },
        "tester@local"
      );
    }, /belongs to another content item/);

    const stillItemA = ctx.repo.getItem(itemA.id);
    assert.equal(stillItemA.title, itemA.title);
  } finally {
    ctx.cleanup();
  }
});

test("saveDraft preserves intentionally cleared string fields", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Draft Empty String Place");
    const saved = ctx.repo.saveDraft(item.id, "run-empty-fields", {
      draft_title: "",
      excerpt: "",
      body: "",
      meta_title: "",
      meta_description: "",
      status: "generated",
    });

    assert.equal(saved.draft_title, "");
    assert.equal(saved.excerpt, "");
    assert.equal(saved.body, "");
    assert.equal(saved.meta_title, "");
    assert.equal(saved.meta_description, "");

    const row = ctx.db.prepare(`
      SELECT draft_title, excerpt, body, meta_title, meta_description
      FROM content_drafts
      WHERE content_item_id=? AND generation_run_uid=?
    `).get(item.id, "run-empty-fields");

    assert.equal(row?.draft_title, "");
    assert.equal(row?.excerpt, "");
    assert.equal(row?.body, "");
    assert.equal(row?.meta_title, "");
    assert.equal(row?.meta_description, "");
  } finally {
    ctx.cleanup();
  }
});

test("saveDraft round-trips confirmed metadata json and status fields", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Draft Confirmed Metadata Place");
    const reviewer = ctx.createUser("draft-confirmed");
    const saved = ctx.repo.saveDraft(item.id, "run-confirmed-metadata", {
      draft_title: "Draft confirmed metadata",
      excerpt: "excerpt",
      body: "body",
      status: "generated",
      confirmed_cta_contact_json: {
        phone: "0812345678",
        line_url: "https://line.me/ti/p/test-line",
        facebook_url: "https://facebook.com/test-place",
        website_url: "https://example.com/test-place",
        primary_cta: "phone",
      },
      confirmed_taxonomy_json: {
        category: "attractions",
        subtype: "museum",
        tags: ["family", "art", "family"],
      },
      confirmed_meta_status: "confirmed",
      confirmed_by_user_id: reviewer.id,
      confirmed_at: "2026-06-11T10:30:00.000Z",
      confirmed_note: "editor confirmed",
    });

    assert.deepEqual(saved.confirmed_cta_contact_json, {
      phone: "0812345678",
      line_url: "https://line.me/ti/p/test-line",
      facebook_url: "https://facebook.com/test-place",
      website_url: "https://example.com/test-place",
      primary_cta: "phone",
    });
    assert.deepEqual(saved.confirmed_taxonomy_json, {
      category: "attractions",
      subtype: "museum",
      tags: ["family", "art"],
    });
    assert.equal(saved.confirmed_meta_status, "confirmed");
    assert.equal(saved.confirmed_by_user_id, reviewer.id);
    assert.equal(saved.confirmed_at, "2026-06-11T10:30:00.000Z");
    assert.equal(saved.confirmed_note, "editor confirmed");
  } finally {
    ctx.cleanup();
  }
});

test("createFieldPack round-trips AI and curated metadata with curation state", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Field Pack Metadata Place");
    const curator = ctx.createUser("field-pack-curator");
    const pack = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      ai_summary: "metadata pack",
      ai_cta_contact_json: {
        phone: "0822222222",
        line_url: "https://line.me/ti/p/field-pack",
        facebook_url: "https://facebook.com/field-pack",
        website_url: "https://example.com/field-pack",
        primary_cta: "line",
        source: ["official_site", "staff_chat", "official_site"],
        confidence: "verified",
        note: "ai suggestion",
      },
      ai_taxonomy_json: {
        category: "restaurants",
        subtype: "noodle-shop",
        tags: ["late-night", "local", "late-night"],
        source: ["ai_profile"],
        confidence: "medium",
        note: "taxonomy suggestion",
      },
      curated_cta_contact_json: {
        phone: { checked: true, found: false, value: "0822222222", source: ["call"], note: "curated phone" },
        line_url: { checked: true, found: false, value: "https://line.me/ti/p/field-pack", source: ["line"], note: null },
        facebook_url: { checked: false, found: true, value: null, source: [], note: null },
        website_url: { checked: true, found: true, value: "https://example.com/field-pack", source: ["web"], note: null },
        primary_cta: { checked: true, found: false, value: "line", note: "best CTA" },
      },
      curated_taxonomy_json: {
        category: { checked: true, found: false, value: "restaurants", note: null },
        subtype: { checked: true, found: false, value: "noodle-shop", note: "confirmed subtype" },
        tags: { checked: true, found: false, value: ["local", "late-night", "local"], note: null },
      },
      curation_status: "curated",
      curated_by_user_id: curator.id,
      curated_at: "2026-06-11T11:00:00.000Z",
      curation_note: "curation complete",
    });

    assert.equal(pack.curation_status, "curated");
    assert.equal(pack.curated_by_user_id, curator.id);
    assert.equal(pack.curated_at, "2026-06-11T11:00:00.000Z");
    assert.equal(pack.curation_note, "curation complete");
    assert.equal(pack.ai_cta_contact_json.primary_cta, "line");
    assert.deepEqual(pack.ai_cta_contact_json.source, ["official_site", "staff_chat"]);
    assert.deepEqual(pack.ai_taxonomy_json.tags, ["late-night", "local"]);
    assert.equal(pack.curated_cta_contact_json.phone.found, true);
    assert.equal(pack.curated_cta_contact_json.facebook_url.found, false);
    assert.equal(pack.curated_cta_contact_json.primary_cta.found, true);
    assert.equal(pack.curated_taxonomy_json.category.found, true);
    assert.deepEqual(pack.curated_taxonomy_json.tags.value, ["local", "late-night"]);
    assert.equal(pack.curated_taxonomy_json.tags.found, true);
    const preview = ctx.repo.buildAssignmentHandoffPreview(item.id);
    assert.equal(Object.prototype.hasOwnProperty.call(preview.handoff_package || {}, "ai_cta_contact_json"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(preview.handoff_package || {}, "curated_cta_contact_json"), false);
  } finally {
    ctx.cleanup();
  }
});

test("field pack metadata defaults stay safe on legacy-style null or invalid values", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Field Pack Metadata Defaults");
    const result = ctx.db.prepare(`
      INSERT INTO field_packs (
        content_item_id, status, is_current, ai_summary, ai_highlights_json, ai_unknowns_json,
        editor_summary, verified_facts_json, uncertain_facts_json, story_angle, field_notes,
        social_hook, social_shot_emphasis_json, social_on_camera_points_json, social_caption_angle,
        writer_ready, writer_angle, writer_key_points_json, writer_notes, updated_by,
        ai_cta_contact_json, ai_taxonomy_json, curated_cta_contact_json, curated_taxonomy_json
      ) VALUES (?, 'draft', 1, NULL, '[]', '[]', NULL, '[]', '[]', NULL, NULL, NULL, '[]', '[]', NULL, 0, NULL, '[]', NULL, NULL, ?, ?, ?, ?)
    `).run(item.id, "{bad", "{bad", "[]", "not-json");
    const bundle = ctx.repo.getFieldPackBundleById(Number(result.lastInsertRowid || 0));
    assert.deepEqual(bundle.ai_cta_contact_json, {
      phone: null,
      line_url: null,
      facebook_url: null,
      website_url: null,
      primary_cta: null,
      source: [],
      confidence: "unknown",
      note: null,
    });
    assert.deepEqual(bundle.ai_taxonomy_json, {
      category: null,
      subtype: null,
      tags: [],
      suggested_checks: [],
      source: [],
      confidence: "unknown",
      note: null,
    });
    assert.equal(bundle.curation_status, "not_started");
    assert.equal(bundle.curated_by_user_id, null);
    assert.equal(bundle.curated_at, null);
    assert.equal(bundle.curation_note, null);
    assert.equal(bundle.curated_cta_contact_json.phone.found, false);
    assert.equal(bundle.curated_taxonomy_json.tags.found, false);
  } finally {
    ctx.cleanup();
  }
});

test("raw-only item with automatic import dependencies can be hard deleted safely", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Raw Only Delete Candidate");
    const linked = ctx.createRawOnlyAutoDependencies(item.id, "safe-delete");

    const eligibility = ctx.repo.getRawOnlyHardDeleteEligibility(item.id);
    assert.equal(eligibility.eligible, true);

    const result = ctx.repo.hardDeleteRawOnlyItem(item.id, "tester@local");
    assert.equal(result.ok, true);
    assert.deepEqual(result.deleted_asset_ids, [linked.asset_id]);
    assert.equal(ctx.repo.getItem(item.id), null);

    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_items WHERE id=?").get(item.id)?.c, 0);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS c FROM source_records WHERE content_item_id=?").get(item.id)?.c, 0);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS c FROM evidence_blocks WHERE content_item_id=?").get(item.id)?.c, 0);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_workflow_models WHERE content_item_id=?").get(item.id)?.c, 0);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_workflow_transitions WHERE content_item_id=?").get(item.id)?.c, 0);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE content_item_id=?").get(item.id)?.c, 0);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(linked.asset_id)?.c, 1);
  } finally {
    ctx.cleanup();
  }
});

test("raw-only hard delete eligibility is blocked by drafts field packs reviews published translations claims and assignments", () => {
  const ctx = createTestContext();
  try {
    const draftItem = ctx.createItem("Draft Blocker");
    ctx.repo.saveDraft(draftItem.id, "run-draft-blocker", {
      draft_title: "Draft blocker",
      excerpt: "excerpt",
      body: "body",
      status: "generated",
    });
    assert.equal(ctx.repo.getRawOnlyHardDeleteEligibility(draftItem.id).eligible, false);
    assert.equal(
      ctx.repo.getRawOnlyHardDeleteEligibility(draftItem.id).blockers.some((entry) => entry.key === "content_drafts"),
      true
    );

    const reviewItem = ctx.createItem("Review Blocker");
    const reviewDraft = ctx.createDraft(reviewItem.id, "review");
    ctx.repo.addReviewReport(reviewItem.id, reviewDraft.id, {
      duplication_score: 1,
      seo_risk_score: 1,
      metadata_score: 1,
      grounding_score: 1,
      ai_quality_score: 1,
      total_score: 5,
      issues: [],
      report: { summary: "review blocker" },
      status: "pending",
    });
    assert.equal(
      ctx.repo.getRawOnlyHardDeleteEligibility(reviewItem.id).blockers.some((entry) => entry.key === "review_reports"),
      true
    );

    const fieldPackItem = ctx.createItem("Field Pack Blocker");
    ctx.repo.createFieldPack({
      content_item_id: fieldPackItem.id,
      ai_summary: "field pack blocker",
    });
    assert.equal(
      ctx.repo.getRawOnlyHardDeleteEligibility(fieldPackItem.id).blockers.some((entry) => entry.key === "field_packs"),
      true
    );

    const publishedItem = ctx.createItem("Published Blocker");
    ctx.repo.savePublishedArticle({
      content_item_id: publishedItem.id,
      draft_id: null,
      review_report_id: null,
      slug: "published-blocker",
      title: "Published Blocker",
      excerpt: "excerpt",
      body: "body",
      meta_title: "Published Blocker",
      meta_description: "desc",
      related: [],
      internal_links: [],
      status: "published",
    });
    ctx.db.prepare(`
      INSERT INTO content_translations (
        source_content_item_id, source_published_article_id, source_draft_id, source_review_report_id,
        source_fingerprint, lang, translated_title, translated_excerpt, translated_body,
        translated_meta_title, translated_meta_description, translation_status, automatic_check_status
      ) VALUES (?, NULL, NULL, NULL, 'fp', 'en', 't', 'e', 'b', 'mt', 'md', 'ready', 'passed')
    `).run(publishedItem.id);
    const publishedEligibility = ctx.repo.getRawOnlyHardDeleteEligibility(publishedItem.id);
    assert.equal(publishedEligibility.blockers.some((entry) => entry.key === "published_articles"), true);
    assert.equal(publishedEligibility.blockers.some((entry) => entry.key === "content_translations"), true);

    const claimedItem = ctx.createItem("Claimed Blocker");
    const claimedUser = ctx.createUser("claimed-blocker");
    ctx.db.prepare("UPDATE content_items SET claimed_by_user_id=? WHERE id=?").run(claimedUser.id, claimedItem.id);
    assert.equal(
      ctx.repo.getRawOnlyHardDeleteEligibility(claimedItem.id).blockers.some((entry) => entry.key === "claimed_item"),
      true
    );

    const assignmentItem = ctx.createItem("Assignment Blocker");
    ctx.createReadinessBrief(assignmentItem.id, "assignment");
    const assignee = ctx.createUser("assignment-blocker");
    ctx.repo.createAssignmentFromReadiness(
      assignmentItem.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    assert.equal(
      ctx.repo.getRawOnlyHardDeleteEligibility(assignmentItem.id).blockers.some((entry) => entry.key === "content_assignments"),
      true
    );
  } finally {
    ctx.cleanup();
  }
});

test("raw-only hard delete eligibility is blocked by reviews_raw quality_checks approved_context draft_input_snapshots and internal_link_suggestions", () => {
  const ctx = createTestContext();
  try {
    const reviewItem = ctx.createItem("Raw Review Blocker");
    ctx.createRawReview(reviewItem.id, "review-block");
    assert.equal(
      ctx.repo.getRawOnlyHardDeleteEligibility(reviewItem.id).blockers.some((entry) => entry.key === "reviews_raw"),
      true
    );

    const qualityItem = ctx.createItem("Quality Check Blocker");
    ctx.createQualityCheck(qualityItem.id, "quality-block");
    assert.equal(
      ctx.repo.getRawOnlyHardDeleteEligibility(qualityItem.id).blockers.some((entry) => entry.key === "quality_checks"),
      true
    );

    const approvedContextItem = ctx.createItem("Approved Context Blocker");
    ctx.createApprovedContextBlock(approvedContextItem.id, "context-block");
    assert.equal(
      ctx.repo.getRawOnlyHardDeleteEligibility(approvedContextItem.id).blockers.some((entry) => entry.key === "approved_context_blocks"),
      true
    );

    const snapshotItem = ctx.createItem("Snapshot Blocker");
    ctx.createSnapshot(snapshotItem.id, "snapshot-block");
    assert.equal(
      ctx.repo.getRawOnlyHardDeleteEligibility(snapshotItem.id).blockers.some((entry) => entry.key === "draft_input_snapshots"),
      true
    );

    const sourceItem = ctx.createItem("Link Source Blocker");
    const targetItem = ctx.createItem("Link Target Blocker");
    ctx.createInternalLinkSuggestion(sourceItem.id, targetItem.id, "link-block");

    const sourceEligibility = ctx.repo.getRawOnlyHardDeleteEligibility(sourceItem.id);
    const targetEligibility = ctx.repo.getRawOnlyHardDeleteEligibility(targetItem.id);
    assert.equal(sourceEligibility.blockers.some((entry) => entry.key === "internal_link_sources"), true);
    assert.equal(targetEligibility.blockers.some((entry) => entry.key === "internal_link_targets"), true);
  } finally {
    ctx.cleanup();
  }
});

test("buildAssignmentHandoffPreview prefers current field pack over readiness brief fallback", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Kappa Place");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      ai_summary: "AI says this is promising",
      editor_summary: "Editor confirmed this place should go to field",
      verified_facts: ["เปิดทุกวัน", "มีที่จอดรถ"],
      uncertain_facts: ["เวลาเปิดจริงวันหยุดยังไม่ชัด"],
      story_angle: "จุดแวะที่มีข้อมูลพร้อมลงพื้นที่",
      social_hook: "แวะที่นี่ก่อนคนอื่นรู้",
      social_on_camera_points: ["พูดเรื่องที่จอดรถ", "พูดเรื่องเวลาเปิด"],
      social_caption_angle: "เช็กก่อนออกเดินทาง",
      field_pack_checklists: [
        { checklist_type: "must_verify_fact", item_text: "ยืนยันเวลาเปิดจริง" },
        { checklist_type: "must_capture", item_text: "ถ่ายหน้าร้านและป้าย", capture_type: "both" },
        { checklist_type: "must_ask_question", item_text: "ถามช่วงเวลาคนเยอะ" },
      ],
      field_pack_references: [
        { reference_scope: "general", label: "Official", url: "https://kappa.example.com", source_family: "official" },
      ],
    });

    const preview = ctx.repo.buildAssignmentHandoffPreview(item.id);
    assert.equal(preview.source_of_truth, "field_pack");
    assert.equal(preview.brief_source, "field_pack");
    assert.equal(preview.ready_for_handoff, true);
    assert.equal(preview.field_pack?.id, fieldPack.id);
    assert.equal(preview.handoff_package?.brief_summary, "Editor confirmed this place should go to field");
    assert.equal(preview.handoff_package?.recommended_angle, "จุดแวะที่มีข้อมูลพร้อมลงพื้นที่");
    assert.equal(preview.handoff_package?.recommended_hook, "แวะที่นี่ก่อนคนอื่นรู้");
    assert.deepEqual(preview.handoff_package?.next_actions, ["ยืนยันเวลาเปิดจริง", "ถามช่วงเวลาคนเยอะ"]);
    assert.deepEqual(preview.handoff_package?.shot_list_suggestions, ["ถ่ายหน้าร้านและป้าย"]);
    assert.deepEqual(preview.handoff_package?.expected_deliverables, ["photos", "videos", "caption_draft", "script_draft", "raw_notes"]);
    assert.equal(preview.handoff_package?.source?.field_pack_id, fieldPack.id);
  } finally {
    ctx.cleanup();
  }
});

test("field pack requested_checks_json round-trips and preserves curator-owned configuration", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Checks Round Trip");
    const pack = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "draft",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA/ติดต่อ",
            checks: [
              {
                key: "phone",
                requested: true,
                label: "เบอร์โทร",
                instruction: "ขอเบอร์ที่ติดต่อได้จริง",
                answer_type: "phone",
                suggested_value: "0812345678",
                condition_prompt: "",
                evidence_required: true,
                source: { kind: "ai", confidence: "medium" },
                found: true,
              },
            ],
          },
          {
            group_key: "custom",
            group_label: "เช็กเพิ่ม",
            checks: [
              {
                key: "parking",
                requested: false,
                label: "ที่จอดรถ",
                instruction: "ถ้ามีให้ระบุจำนวนคร่าว ๆ",
                answer_type: "boolean_with_conditions",
                suggested_value: { available: true },
                condition_prompt: "ถ้ามีจำกัดให้ระบุเงื่อนไข",
                evidence_required: false,
              },
            ],
          },
        ],
      },
    });

    assert.deepEqual(pack.requested_checks_json, {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/ติดต่อ",
          checks: [
            {
              key: "phone",
              requested: true,
              label: "เบอร์โทร",
              instruction: "ขอเบอร์ที่ติดต่อได้จริง",
              answer_type: "phone",
              suggested_value: "0812345678",
              condition_prompt: null,
              evidence_required: true,
              source: { kind: "ai", confidence: "medium" },
            },
          ],
        },
        {
          group_key: "custom",
          group_label: "เช็กเพิ่ม",
          checks: [
            {
              key: "parking",
              requested: false,
              label: "ที่จอดรถ",
              instruction: "ถ้ามีให้ระบุจำนวนคร่าว ๆ",
              answer_type: "boolean_with_conditions",
              suggested_value: { available: true },
              condition_prompt: "ถ้ามีจำกัดให้ระบุเงื่อนไข",
              evidence_required: false,
              source: null,
            },
          ],
        },
      ],
    });

    const updated = ctx.repo.updateFieldPack(pack.id, {
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA/ติดต่อ",
            checks: [
              {
                key: "phone",
                requested: true,
                label: "เบอร์โทร",
                instruction: "ยืนยันเบอร์ล่าสุด",
                answer_type: "phone",
                suggested_value: "0899999999",
                evidence_required: true,
              },
            ],
          },
        ],
      },
      updated_by: "tester@local",
    });

    assert.equal(updated.requested_checks_json.groups[0].checks[0].instruction, "ยืนยันเบอร์ล่าสุด");
    assert.equal(updated.requested_checks_json.groups[0].checks[0].requested, true);
    assert.equal(Object.prototype.hasOwnProperty.call(updated.requested_checks_json.groups[0].checks[0], "found"), false);
  } finally {
    ctx.cleanup();
  }
});

test("field pack does not auto-create requested checks from AI suggestions", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("AI Suggestion Ownership");
    const pack = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "draft",
      ai_cta_contact_json: {
        phone: "0811111111",
        line_url: "https://line.me/ti/p/test",
        primary_cta: "line",
      },
      ai_taxonomy_json: {
        category: "attractions",
        subtype: "museum",
        tags: ["family"],
      },
    });

    assert.deepEqual(pack.requested_checks_json, {
      version: 1,
      groups: [],
    });
  } finally {
    ctx.cleanup();
  }
});

test("buildAssignmentHandoffPreview includes only requested=true requested checks", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Checks Handoff");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "พร้อมลงพื้นที่",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA/ติดต่อ",
            checks: [
              {
                key: "phone",
                requested: true,
                label: "เบอร์โทร",
                instruction: "ยืนยันเบอร์",
                answer_type: "phone",
                suggested_value: "0812345678",
                evidence_required: true,
                source: { kind: "ai", confidence: "medium" },
              },
              {
                key: "line_url",
                requested: false,
                label: "ลิงก์ LINE",
                instruction: "มีหรือไม่",
                answer_type: "url",
                suggested_value: "https://line.me/ti/p/example",
                evidence_required: false,
              },
            ],
          },
          {
            group_key: "custom",
            group_label: "เช็กเพิ่ม",
            checks: [
              {
                key: "parking",
                requested: true,
                label: "ที่จอดรถ",
                instruction: "ดูว่าจอดรถได้กี่คัน",
                answer_type: "boolean_with_conditions",
                condition_prompt: "ถ้ามีจำกัดให้ระบุเงื่อนไข",
                evidence_required: false,
              },
            ],
          },
        ],
      },
    });

    const preview = ctx.repo.buildAssignmentHandoffPreview(item.id);
    const requestedChecks = preview.handoff_package?.requested_checks;
    assert.equal(requestedChecks?.version, 1);
    assert.deepEqual(requestedChecks?.groups?.map((group) => group.group_key), ["cta_contact", "taxonomy"]);
    assert.equal(requestedChecks?.groups?.find((group) => group.group_key === "cta_contact")?.checks?.length, 5);
    assert.equal(requestedChecks?.groups?.find((group) => group.group_key === "cta_contact")?.checks?.[0]?.key, "phone");
    assert.equal(requestedChecks?.groups?.find((group) => group.group_key === "cta_contact")?.checks?.every((check) => check.requested === true), true);
    assert.equal(requestedChecks?.groups?.find((group) => group.group_key === "cta_contact")?.checks?.[0]?.suggested_value, "0812345678");
    assert.equal(requestedChecks?.groups?.find((group) => group.group_key === "taxonomy")?.checks?.length, 6);
    assert.equal(requestedChecks?.groups?.find((group) => group.group_key === "taxonomy")?.checks?.every((check) => check.requested === true), true);
  } finally {
    ctx.cleanup();
  }
});

test("buildAssignmentHandoffPreview excludes legacy cta_contact checks for non-place items", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.repo.createItemWithWorkflowHead({
      type: "event",
      category: "activities",
      lang: "th",
      title: "Event Requested Checks Handoff",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://example.com/event-requested-checks",
    }).item;
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "event ready",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA/contact",
            checks: [
              {
                key: "phone",
                requested: true,
                label: "Phone",
                instruction: "Confirm phone",
                answer_type: "phone",
                suggested_value: "0812345678",
                evidence_required: true,
                source: { kind: "ai", confidence: "medium" },
              },
            ],
          },
          {
            group_key: "taxonomy",
            group_label: "Taxonomy",
            checks: [
              {
                key: "category",
                requested: true,
                label: "Category",
                instruction: "Confirm category",
                answer_type: "text",
                suggested_value: "festival",
                evidence_required: false,
              },
            ],
          },
        ],
      },
    });
    const preview = ctx.repo.buildAssignmentHandoffPreview(item.id);
    assert.equal(preview.handoff_package?.requested_checks, undefined);
  } finally {
    ctx.cleanup();
  }
});test("buildAssignmentHandoffPreview falls back to readiness snapshot when current field pack is still draft", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Mu Place");
    ctx.createReadinessBrief(item.id, "Mu");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "draft",
      editor_summary: "Draft field pack should not block readiness fallback",
      story_angle: "Draft angle",
    });

    const preview = ctx.repo.buildAssignmentHandoffPreview(item.id);
    assert.equal(preview.source_of_truth, "readiness_snapshot");
    assert.equal(preview.brief_source, "readiness_snapshot");
    assert.equal(preview.handoff_package?.brief_summary, "Readiness brief Mu");
    assert.equal(preview.handoff_package?.recommended_angle, "Angle Mu");
  } finally {
    ctx.cleanup();
  }
});

test("createAssignmentFromReadiness uses field pack handoff without readiness snapshot", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Lambda Place");
    const assignee = ctx.createUser("assignee");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "พร้อมส่งลงหน้างานจาก field pack",
      story_angle: "เก็บภาพและเช็กข้อเท็จจริงหน้างาน",
      social_hook: "ไปดูของจริงก่อนตัดสินใจ",
      social_on_camera_points: ["พูดเรื่องจุดเด่น", "พูดเรื่องข้อควรเช็ก"],
      social_caption_angle: "สรุปก่อนลงพื้นที่",
      verified_facts: ["มีข้อมูลตั้งต้นครบ"],
      uncertain_facts: ["ต้องเช็กเวลาเปิดจริง"],
      field_pack_checklists: [
        { checklist_type: "must_verify_fact", item_text: "เช็กเวลาเปิดจริง" },
        { checklist_type: "must_capture", item_text: "ถ่ายบรรยากาศรวม", capture_type: "both" },
        { checklist_type: "must_ask_question", item_text: "ถามเจ้าของเรื่องช่วงพีค" },
      ],
    });

    const result = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id },
      assignee.id,
      "tester@local",
      "admin"
    );

    assert.equal(result.guard.source_of_truth, "field_pack");
    assert.equal(result.guard.brief_source, "field_pack");
    assert.equal(result.guard.mode, "field_pack");
    assert.equal(result.assignment.workflow_sync?.reason_code, "assignment_created_sync_from_field_pack");
    assert.equal(result.assignment.content_item_id, item.id);
    assert.equal(result.assignment.assignee_user_id, assignee.id);
    assert.equal(result.assignment.brief_json?.brief_summary, "พร้อมส่งลงหน้างานจาก field pack");
    assert.equal(result.assignment.brief_json?.recommended_angle, "เก็บภาพและเช็กข้อเท็จจริงหน้างาน");
    assert.equal(result.assignment.brief_json?.recommended_hook, "ไปดูของจริงก่อนตัดสินใจ");
    assert.deepEqual(result.assignment.brief_json?.expected_deliverables, ["photos", "videos", "caption_draft", "script_draft", "raw_notes"]);
    assert.equal(result.handoff.readiness_brief_id, null);
    assert.equal(result.handoff.handoff_package_json?.source?.field_pack_id > 0, true);
  } finally {
    ctx.cleanup();
  }
});

test("createAssignmentFromReadiness remains strict by default when readiness fallback is not ready_for_handoff", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Strict Readiness Guard");
    const assignee = ctx.createUser("strict-guard");
    ctx.createReadinessBrief(item.id, "strict");

    assert.throws(
      () => ctx.repo.createAssignmentFromReadiness(
        item.id,
        { assignee_user_id: assignee.id },
        assignee.id,
        "tester@local",
        "admin"
      ),
      /item is not ready_for_handoff; use force_override with force_reason/
    );
  } finally {
    ctx.cleanup();
  }
});

test("createAssignmentFromReadiness can bypass ready_for_handoff when explicitly allowed", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Relaxed Readiness Guard");
    const assignee = ctx.createUser("relaxed-guard");
    const readiness = ctx.createReadinessBrief(item.id, "relaxed");

    const result = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id },
      assignee.id,
      "tester@local",
      "admin",
      { requireReadyForHandoff: false }
    );

    assert.equal(Number(result?.assignment?.id || 0) > 0, true);
    assert.equal(Number(result?.handoff?.id || 0) > 0, true);
    assert.equal(result?.preview?.source_of_truth, "readiness_snapshot");
    assert.equal(result?.preview?.ready_for_handoff, false);
    assert.equal(result?.guard?.force_override, false);
    assert.equal(result?.guard?.force_reason, null);
    assert.equal(result?.handoff?.readiness_brief_id, readiness);
    const snapshotCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assignment_handoff_snapshots WHERE assignment_id=?").get(result.assignment.id)?.c || 0;
    assert.equal(snapshotCount, 1);
  } finally {
    ctx.cleanup();
  }
});

test("repairAssignmentHandoffSnapshotForAssignment backfills a missing handoff snapshot idempotently", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Repair Snapshot Target");
    const assignee = ctx.createUser("repair-target");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "พร้อมส่งงาน",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA / ข้อมูลติดต่อ",
            checks: [
              {
                key: "phone",
                requested: true,
                label: "โทรศัพท์",
                instruction: "ตรวจเบอร์",
                answer_type: "phone",
                suggested_value: "080-111-2222",
                condition_prompt: null,
                evidence_required: false,
                source: "ai",
              },
            ],
          },
          {
            group_key: "taxonomy",
            group_label: "Taxonomy / ข้อมูลจัดหมวด",
            checks: [
              {
                key: "tags",
                requested: true,
                label: "แท็ก",
                instruction: "ตรวจแท็ก",
                answer_type: "multi_select",
                suggested_value: ["family"],
                condition_prompt: null,
                evidence_required: false,
                source: "ai",
              },
            ],
          },
        ],
      },
    });

    const createdAssignment = ctx.repo.createAssignment(
      {
        content_item_id: item.id,
        assignee_user_id: assignee.id,
        assignment_kind: "field",
      },
      assignee.id,
      {
        actor_email: "tester@local",
        actor_role: "admin",
        reason_code: "assignment_created_sync_manual",
        note: "manual assignment without handoff snapshot",
      }
    );

    assert.equal(ctx.repo.getLatestAssignmentHandoffByAssignment(createdAssignment.id), null);

    const dryRun = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPack.id, {
      apply: false,
      actorEmail: "tester@local",
    });
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.apply_requested, false);
    assert.equal(dryRun.created, false);
    assert.equal(dryRun.reason, "dry_run");
    assert.equal(dryRun.would_apply, true);
    assert.equal(dryRun.applied, false);
    assert.equal(dryRun.historical_cutoff_at, createdAssignment.created_at);
    assert.equal(dryRun.historical_readiness_brief_id, null);
    assert.equal(dryRun.historical_execution_controls_id, null);
    assert.deepEqual(dryRun.historical_execution_channels, { facebook: null, tiktok: null });
    assert.equal(dryRun.warnings.includes("historical_readiness_snapshot_missing"), true);
    assert.equal(dryRun.warnings.includes("historical_execution_controls_missing"), true);
    assert.equal(dryRun.warnings.includes("historical_execution_channel_missing:facebook"), true);
    assert.equal(dryRun.warnings.includes("historical_execution_channel_missing:tiktok"), true);
    assert.equal(dryRun.handoff, null);

    const repaired = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPack.id, {
      apply: true,
      actorEmail: "tester@local",
    });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.apply_requested, true);
    assert.equal(repaired.created, true);
    assert.equal(repaired.repaired, true);
    assert.equal(repaired.would_apply, true);
    assert.equal(repaired.applied, true);
    assert.equal(repaired.source_generated_at, createdAssignment.created_at);
    assert.equal(repaired.handoff?.assignment_id, createdAssignment.id);
    assert.deepEqual(
      repaired.handoff?.handoff_package_json?.requested_checks?.groups?.map((group) => group.group_key),
      ["cta_contact", "taxonomy"]
    );
    assert.equal(repaired.handoff?.handoff_package_json?.requested_checks?.groups?.[0]?.checks?.[0]?.requested, true);

    const secondRepair = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPack.id, {
      apply: true,
      actorEmail: "tester@local",
    });
    assert.equal(secondRepair.ok, true);
    assert.equal(secondRepair.apply_requested, true);
    assert.equal(secondRepair.created, false);
    assert.equal(secondRepair.reason, "already_exists");
    assert.equal(secondRepair.would_apply, false);
    assert.equal(secondRepair.applied, false);
    assert.equal(ctx.repo.getLatestAssignmentHandoffByAssignment(createdAssignment.id)?.id, repaired.handoff?.id);
    const snapshotCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assignment_handoff_snapshots WHERE assignment_id=?").get(createdAssignment.id)?.c || 0;
    assert.equal(snapshotCount, 1);
  } finally {
    ctx.cleanup();
  }
});
test("createAssignmentFromReadiness snapshots CTA and taxonomy requested checks through existing handoff package", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Checks Snapshot Expanded");
    const assignee = ctx.createUser("requested-checks-expanded");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready for field handoff",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA / Contact",
            checks: [
              { key: "phone", requested: true, label: "Phone", instruction: "Confirm phone", answer_type: "phone", suggested_value: "080-111-2222", evidence_required: false },
              { key: "line_url", requested: true, label: "LINE", instruction: "Confirm LINE", answer_type: "url", suggested_value: "https://line.me/example", evidence_required: false },
              { key: "facebook_url", requested: true, label: "Facebook", instruction: "Confirm Facebook", answer_type: "url", suggested_value: "https://facebook.com/example", evidence_required: false },
              { key: "website_url", requested: true, label: "Website", instruction: "Confirm website", answer_type: "url", suggested_value: "https://example.com", evidence_required: false },
              { key: "primary_cta", requested: true, label: "Primary CTA", instruction: "Confirm CTA", answer_type: "text", suggested_value: "Call now", evidence_required: false },
            ],
          },
          {
            group_key: "taxonomy",
            group_label: "Taxonomy",
            checks: [
              { key: "tags", requested: true, label: "Tags", instruction: "Confirm tags", answer_type: "multi_select", suggested_value: ["family", "late-night"], evidence_required: false },
              { key: "business_type", requested: true, label: "Business type", instruction: "Confirm business type", answer_type: "text", suggested_value: "restaurant", evidence_required: false },
              { key: "price_level", requested: true, label: "Price level", instruction: "Confirm price level", answer_type: "text", suggested_value: null, evidence_required: false },
            ],
          },
        ],
      },
    });

    const result = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id },
      assignee.id,
      "tester@local",
      "admin"
    );

    const requestedChecks = result.handoff.handoff_package_json?.requested_checks;
    const taxonomyGroup = requestedChecks?.groups?.find((group) => group.group_key === "taxonomy");
    const parkingCheck = taxonomyGroup?.checks?.find((check) => check.key === "parking");
    const petFriendlyCheck = taxonomyGroup?.checks?.find((check) => check.key === "pet_friendly");
    assert.deepEqual(requestedChecks?.groups?.map((group) => group.group_key), ["cta_contact", "taxonomy"]);
    assert.equal(
      requestedChecks?.groups?.reduce((sum, group) => sum + (Array.isArray(group?.checks) ? group.checks.length : 0), 0),
      11
    );
    assert.equal(requestedChecks?.groups?.[0]?.checks?.[0]?.suggested_value, "0801112222");
    assert.equal(parkingCheck?.condition_prompt, "ถ้าที่จอดจำกัด ร่วมใช้ หรือมีค่าใช้จ่าย ให้ระบุเงื่อนไข");
    assert.equal(parkingCheck?.source, null);
    assert.equal(petFriendlyCheck?.key, "pet_friendly");
    assert.equal(petFriendlyCheck?.suggested_value, null);
    assert.equal(petFriendlyCheck?.requested, true);
    assert.equal(taxonomyGroup?.checks?.some((check) => check.key === "price_level"), false);
  } finally {
    ctx.cleanup();
  }
});
test("buildAssignmentHandoffPreview always includes the required CTA checklist for place items", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("CTA Suggestions Stay Advisory");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: {
        version: 1,
        groups: [],
      },
      ai_cta_contact_json: {
        phone: "0812345678",
        line_url: "https://line.me/example",
        facebook_url: "https://facebook.com/example",
        website_url: "https://example.com",
        primary_cta: "phone",
        confidence: "high",
      },
    });

    const preview = ctx.repo.buildAssignmentHandoffPreview(item.id);
    const ctaGroup = preview.handoff_package?.requested_checks?.groups?.find((group) => group.group_key === "cta_contact");
    assert.ok(ctaGroup);
    assert.equal(ctaGroup.checks.length, 5);
    assert.equal(ctaGroup.checks.every((check) => check.requested === true), true);
    assert.equal(ctaGroup.checks.find((check) => check.key === "phone")?.suggested_value, "0812345678");
    assert.equal(ctaGroup.checks.find((check) => check.key === "facebook_url")?.suggested_value, "https://facebook.com/example");
  } finally {
    ctx.cleanup();
  }
});

test("workflow CTA candidates survive prompt input normalize save and reload without re-reading structured_context later", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Golden Hour Coffee");
    const evidence = ctx.repo.addEvidenceBlock(item.id, {
      block_type: "mention",
      text_value: "Phone: 080 441 5224",
      source_url: "https://example.com/golden-hour-phone",
      status: "active",
    });
    ctx.repo.addApprovedContextBlock(item.id, {
      evidence_block_id: evidence.id,
      context_type: "mention",
      selected_text: "Phone: 080 441 5224",
      status: "active",
      provenance_json: {
        evidence_source_url: "https://example.com/golden-hour-phone",
      },
    });

    const cleanContext = buildCleanStructuredContext(ctx.repo, item.id);
    const ctaCandidates = deriveCtaContactCandidatesFromStructuredContext(cleanContext);
    const promptInput = buildPromptInput({
      ...item,
      structured_context: cleanContext,
      cta_contact_candidates: ctaCandidates,
    });

    assert.equal(promptInput.cta_contact_candidates.phone, "0804415224");

    const normalized = normalizeFieldPack({
      field_pack: {
        status: "draft",
        ai_summary: "field brief",
        story_angle: "sunset cafe angle",
        social_hook: "golden hour coffee stop",
      },
    }, {
      item: {
        ...item,
        cta_contact_candidates: ctaCandidates,
      },
      ctaCandidates,
    });

    assert.equal(normalized.ai_cta_contact_json.phone, "0804415224");

    const payload = buildFieldPackUpdatePayloadFromAgent({
      ...normalized,
      content_item_id: item.id,
    });
    assert.equal(payload.ai_cta_contact_json.phone, "0804415224");

    ctx.repo.createFieldPack({
      ...payload,
      content_item_id: item.id,
      updated_by: "tester@local",
    });

    const reloaded = ctx.repo.getCurrentFieldPackByItem(item.id);
    assert.equal(reloaded.ai_cta_contact_json.phone, "0804415224");
  } finally {
    ctx.cleanup();
  }
});

test("existing assignment handoff snapshot remains immutable after newer field pack changes", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Immutable Requested Checks Snapshot");
    const assignee = ctx.createUser("immutable-snapshot");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "snapshot source A",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA / Contact",
            checks: [
              { key: "phone", requested: true, label: "Phone", instruction: "Check phone A", answer_type: "phone", suggested_value: "080-111-2222", evidence_required: false },
            ],
          },
        ],
      },
    });

    const assignment = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id },
      assignee.id,
      "tester@local",
      "admin"
    );
    const originalRequestedChecks = assignment.handoff?.handoff_package_json?.requested_checks;

    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "snapshot source B",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA / Contact",
            checks: [
              { key: "line_url", requested: true, label: "LINE", instruction: "Check line B", answer_type: "url", suggested_value: "https://line.me/example", evidence_required: false },
            ],
          },
        ],
      },
    });

    const frozen = ctx.repo.getLatestAssignmentHandoffByAssignment(assignment.assignment.id);
    assert.equal(frozen?.id, assignment.handoff?.id);
    const frozenCtaGroup = frozen?.handoff_package_json?.requested_checks?.groups?.find((group) => group.group_key === "cta_contact");
    assert.equal(
      frozenCtaGroup?.checks?.[0]?.key,
      "phone"
    );
    assert.deepEqual(frozen?.handoff_package_json?.requested_checks, originalRequestedChecks);
  } finally {
    ctx.cleanup();
  }
});

test("createAssignmentFromReadiness keeps legacy custom rows at rest but filters them from the new immutable handoff snapshot", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Checks Legacy Custom Filter");
    const assignee = ctx.createUser("requested-checks-legacy-custom");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready for field handoff",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA / Contact",
            checks: [
              { key: "phone", requested: true, label: "Phone", instruction: "Confirm phone", answer_type: "phone", suggested_value: "080-111-2222", evidence_required: true },
            ],
          },
          {
            group_key: "taxonomy",
            group_label: "Taxonomy",
            checks: [
              { key: "waterfront", requested: true, requested_decision: "selected", label: "Waterfront", instruction: "Confirm waterfront", answer_type: "boolean_with_conditions", evidence_required: false },
              { key: "legacy_unknown", requested: true, label: "Legacy unknown", instruction: "Legacy unknown", answer_type: "text", evidence_required: false },
            ],
          },
          {
            group_key: "custom",
            group_label: "Custom checks",
            checks: [
              { key: "wifi_password", requested: true, label: "Wi-Fi password", instruction: "Ask for Wi-Fi password", answer_type: "text", evidence_required: false },
            ],
          },
        ],
      },
    });

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id },
      assignee.id,
      "tester@local",
      "admin"
    );

    const savedFieldPack = ctx.repo.getFieldPackBundleById(fieldPack.id);
    const savedCustomGroup = savedFieldPack.requested_checks_json.groups.find((group) => group.group_key === "custom");
    const savedTaxonomyGroup = savedFieldPack.requested_checks_json.groups.find((group) => group.group_key === "taxonomy");
    const handoffRequestedChecks = assignmentResult.handoff?.handoff_package_json?.requested_checks;
    const handoffCustomGroup = handoffRequestedChecks?.groups?.find((group) => group.group_key === "custom");
    const handoffTaxonomyGroup = handoffRequestedChecks?.groups?.find((group) => group.group_key === "taxonomy");
    const handoffCtaGroup = handoffRequestedChecks?.groups?.find((group) => group.group_key === "cta_contact");

    assert.ok(savedCustomGroup);
    assert.equal(savedCustomGroup.checks[0]?.key, "wifi_password");
    assert.equal(savedTaxonomyGroup?.checks?.some((check) => check.key === "legacy_unknown"), true);
    assert.equal(handoffCustomGroup, undefined);
    assert.ok(handoffCtaGroup);
    assert.equal(handoffCtaGroup.checks.some((check) => check.key === "phone"), true);
    assert.ok(handoffTaxonomyGroup);
    assert.equal(handoffTaxonomyGroup.checks.some((check) => check.key === "waterfront"), true);
    assert.equal(handoffTaxonomyGroup.checks.some((check) => check.key === "legacy_unknown"), false);
  } finally {
    ctx.cleanup();
  }
});

test("createAssignmentFromReadiness rolls back assignment workflow and snapshot when snapshot insert fails", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Atomic Snapshot Failure");
    const assignee = ctx.createUser("atomic-snapshot");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready for atomic test",
      requested_checks_json: { version: 1, groups: [] },
    });

    const assignmentCountBefore = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assignments").get()?.c || 0;
    const snapshotCountBefore = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assignment_handoff_snapshots").get()?.c || 0;
    const workflowBefore = ctx.repo.ensureWorkflowModel(item.id);

    ctx.db.exec(`
      CREATE TRIGGER fail_assignment_handoff_snapshot_insert
      BEFORE INSERT ON content_assignment_handoff_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'forced snapshot insert failure');
      END;
    `);

    assert.throws(() => {
      ctx.repo.createAssignmentFromReadiness(
        item.id,
        { assignee_user_id: assignee.id },
        assignee.id,
        "tester@local",
        "admin"
      );
    }, /forced snapshot insert failure/);

    const assignmentCountAfter = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assignments").get()?.c || 0;
    const snapshotCountAfter = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assignment_handoff_snapshots").get()?.c || 0;
    const workflowAfter = ctx.repo.ensureWorkflowModel(item.id);
    assert.equal(assignmentCountAfter, assignmentCountBefore);
    assert.equal(snapshotCountAfter, snapshotCountBefore);
    assert.equal(workflowAfter.assignment_state, workflowBefore.assignment_state);
  } finally {
    ctx.cleanup();
  }
});

test("repairAssignmentHandoffSnapshotForAssignment uses assignment-time readiness controls and channels instead of newer records", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Historical Repair Source Resolution");
    const assignee = ctx.createUser("historical-source");
    const fieldPackA = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "field pack A",
      requested_checks_json: { version: 1, groups: [] },
    });
    ctx.setRowTimestamps("field_packs", fieldPackA.id, "2026-01-02 09:00:00");

    const readinessA = ctx.createReadinessBrief(item.id, "A");
    ctx.setRowTimestamps("content_readiness_briefs", readinessA, "2026-01-02 09:10:00");
    const controlsA = ctx.createExecutionControls(item.id, readinessA, "A");
    ctx.setRowTimestamps("content_execution_controls", controlsA, "2026-01-02 09:20:00");
    const facebookA = ctx.createExecutionChannel(item.id, readinessA, "facebook", "A");
    ctx.setRowTimestamps("content_execution_channels", facebookA, "2026-01-02 09:30:00");
    const tiktokA = ctx.createExecutionChannel(item.id, readinessA, "tiktok", "A");
    ctx.setRowTimestamps("content_execution_channels", tiktokA, "2026-01-02 09:31:00");

    const createdAssignment = ctx.repo.createAssignment(
      {
        content_item_id: item.id,
        assignee_user_id: assignee.id,
        assignment_kind: "field",
      },
      assignee.id,
      {
        actor_email: "tester@local",
        actor_role: "admin",
        reason_code: "assignment_created_sync_manual",
        note: "manual assignment without handoff snapshot",
      }
    );
    ctx.setRowTimestamps("content_assignments", createdAssignment.id, "2026-01-02 09:40:00");

    const readinessB = ctx.createReadinessBrief(item.id, "B");
    ctx.setRowTimestamps("content_readiness_briefs", readinessB, "2026-01-02 10:10:00");
    const controlsB = ctx.createExecutionControls(item.id, readinessB, "B");
    ctx.setRowTimestamps("content_execution_controls", controlsB, "2026-01-02 10:20:00");
    const facebookB = ctx.createExecutionChannel(item.id, readinessB, "facebook", "B");
    ctx.setRowTimestamps("content_execution_channels", facebookB, "2026-01-02 10:30:00");
    const tiktokB = ctx.createExecutionChannel(item.id, readinessB, "tiktok", "B");
    ctx.setRowTimestamps("content_execution_channels", tiktokB, "2026-01-02 10:31:00");

    const dryRun = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPackA.id, {
      apply: false,
      actorEmail: "tester@local",
    });
    assert.equal(dryRun.historical_cutoff_at, "2026-01-02 09:40:00");
    assert.equal(dryRun.historical_readiness_brief_id, readinessA);
    assert.equal(dryRun.historical_execution_controls_id, controlsA);
    assert.deepEqual(dryRun.historical_execution_channels, { facebook: facebookA, tiktok: tiktokA });
    assert.equal(dryRun.warnings.length, 0);
    assert.equal(dryRun.would_apply, true);

    const repaired = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPackA.id, {
      apply: true,
      actorEmail: "tester@local",
    });
    const source = repaired.handoff?.handoff_package_json?.source || null;
    assert.equal(repaired.handoff?.readiness_brief_id, readinessA);
    assert.equal(source?.field_pack_id, fieldPackA.id);
    assert.equal(source?.readiness_brief_id, readinessA);
    assert.equal(source?.execution_controls_id, controlsA);
    assert.deepEqual(source?.execution_channels, { facebook: facebookA, tiktok: tiktokA });
    assert.equal(source?.generated_at, "2026-01-02 09:40:00");
    assert.notEqual(repaired.handoff?.readiness_brief_id, readinessB);
    assert.notEqual(source?.readiness_brief_id, readinessB);
    assert.notEqual(source?.execution_controls_id, controlsB);
    assert.notEqual(source?.execution_channels?.facebook, facebookB);
    assert.notEqual(source?.execution_channels?.tiktok, tiktokB);
  } finally {
    ctx.cleanup();
  }
});

test("repairAssignmentHandoffSnapshotForAssignment keeps historical governance null when only newer records exist", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Historical Repair Missing Context");
    const assignee = ctx.createUser("historical-missing");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "field pack",
      requested_checks_json: { version: 1, groups: [] },
    });
    const createdAssignment = ctx.repo.createAssignment(
      {
        content_item_id: item.id,
        assignee_user_id: assignee.id,
        assignment_kind: "field",
      },
      assignee.id,
      {
        actor_email: "tester@local",
        actor_role: "admin",
        reason_code: "assignment_created_sync_manual",
        note: "manual assignment without handoff snapshot",
      }
    );
    ctx.setRowTimestamps("content_assignments", createdAssignment.id, "2026-02-03 09:00:00");

    const readinessNew = ctx.createReadinessBrief(item.id, "new");
    ctx.setRowTimestamps("content_readiness_briefs", readinessNew, "2026-02-03 10:00:00");
    const controlsNew = ctx.createExecutionControls(item.id, readinessNew, "new");
    ctx.setRowTimestamps("content_execution_controls", controlsNew, "2026-02-03 10:05:00");
    const facebookNew = ctx.createExecutionChannel(item.id, readinessNew, "facebook", "new");
    ctx.setRowTimestamps("content_execution_channels", facebookNew, "2026-02-03 10:10:00");
    const tiktokNew = ctx.createExecutionChannel(item.id, readinessNew, "tiktok", "new");
    ctx.setRowTimestamps("content_execution_channels", tiktokNew, "2026-02-03 10:11:00");

    const dryRun = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPack.id, {
      apply: false,
      actorEmail: "tester@local",
    });
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.would_apply, true);
    assert.equal(dryRun.applied, false);
    assert.equal(dryRun.historical_readiness_brief_id, null);
    assert.equal(dryRun.historical_execution_controls_id, null);
    assert.deepEqual(dryRun.historical_execution_channels, { facebook: null, tiktok: null });
    assert.equal(dryRun.warnings.includes("historical_readiness_snapshot_missing"), true);
    assert.equal(dryRun.warnings.includes("historical_execution_controls_missing"), true);
    assert.equal(dryRun.warnings.includes("historical_execution_channel_missing:facebook"), true);
    assert.equal(dryRun.warnings.includes("historical_execution_channel_missing:tiktok"), true);
    assert.equal(ctx.repo.getLatestAssignmentHandoffByAssignment(createdAssignment.id), null);

    const repaired = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPack.id, {
      apply: true,
      actorEmail: "tester@local",
    });
    assert.equal(repaired.applied, true);
    assert.equal(repaired.handoff?.readiness_brief_id, null);
    assert.equal(repaired.handoff?.handoff_package_json?.source?.readiness_brief_id, null);
    assert.equal(repaired.handoff?.handoff_package_json?.source?.execution_controls_id, null);
    assert.deepEqual(repaired.handoff?.handoff_package_json?.source?.execution_channels, { facebook: null, tiktok: null });
  } finally {
    ctx.cleanup();
  }
});

test("repairAssignmentHandoffSnapshotForAssignment matches the normal handoff source shape and provenance fields", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Historical Repair Source Parity");
    const assignee = ctx.createUser("historical-parity");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "field pack",
      requested_checks_json: { version: 1, groups: [] },
    });
    const readinessId = ctx.createReadinessBrief(item.id, "parity");
    const controlsId = ctx.createExecutionControls(item.id, readinessId, "parity");
    const facebookId = ctx.createExecutionChannel(item.id, readinessId, "facebook", "parity");
    const tiktokId = ctx.createExecutionChannel(item.id, readinessId, "tiktok", "parity");

    const normal = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id },
      assignee.id,
      "tester@local",
      "admin"
    );
    const normalSource = normal.handoff?.handoff_package_json?.source || null;

    const missingSnapshotAssignment = ctx.repo.createAssignment(
      {
        content_item_id: item.id,
        assignee_user_id: assignee.id,
        assignment_kind: "field",
      },
      assignee.id,
      {
        actor_email: "tester@local",
        actor_role: "admin",
        reason_code: "assignment_created_sync_manual",
        note: "manual assignment without handoff snapshot",
      }
    );
    ctx.setRowTimestamps("content_assignments", missingSnapshotAssignment.id, normalSource.generated_at, normalSource.generated_at);

    const repaired = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(missingSnapshotAssignment.id, fieldPack.id, {
      apply: true,
      actorEmail: "tester@local",
    });
    const repairedSource = repaired.handoff?.handoff_package_json?.source || null;

    assert.deepEqual(Object.keys(repairedSource || {}).sort(), Object.keys(normalSource || {}).sort());
    assert.equal(repairedSource?.field_pack_id, fieldPack.id);
    assert.equal(repairedSource?.field_pack_status, normalSource?.field_pack_status);
    assert.equal(repairedSource?.readiness_brief_id, readinessId);
    assert.equal(repairedSource?.execution_controls_id, controlsId);
    assert.deepEqual(repairedSource?.execution_channels, { facebook: facebookId, tiktok: tiktokId });
    assert.equal(repairedSource?.content_item_id, item.id);
    assert.equal(repairedSource?.generated_at, normalSource?.generated_at);
  } finally {
    ctx.cleanup();
  }
});

test("repairAssignmentHandoffSnapshotForAssignment uses the explicit historical field pack and is idempotent", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Repair Snapshot Historical Source");
    const assignee = ctx.createUser("repair-historical");
    const fieldPackA = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "field pack A",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA / Contact",
            checks: [
              { key: "phone", requested: true, label: "Phone", instruction: "Check phone A", answer_type: "phone", suggested_value: "080-111-2222", evidence_required: false },
            ],
          },
        ],
      },
    });

    const createdAssignment = ctx.repo.createAssignment(
      {
        content_item_id: item.id,
        assignee_user_id: assignee.id,
        assignment_kind: "field",
      },
      assignee.id,
      {
        actor_email: "tester@local",
        actor_role: "admin",
        reason_code: "assignment_created_sync_manual",
        note: "manual assignment without handoff snapshot",
      }
    );

    const fieldPackB = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "field_done",
      editor_summary: "field pack B",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "taxonomy",
            group_label: "Taxonomy",
            checks: [
              { key: "tags", requested: true, label: "Tags", instruction: "Check tags B", answer_type: "multi_select", suggested_value: ["family"], evidence_required: false },
            ],
          },
        ],
      },
    });

    const dryRun = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPackA.id, {
      apply: false,
      actorEmail: "tester@local",
    });
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.apply_requested, false);
    assert.equal(dryRun.created, false);
    assert.equal(dryRun.reason, "dry_run");
    assert.equal(dryRun.field_pack_id, fieldPackA.id);
    assert.equal(dryRun.requested_check_group_count, 2);
    assert.equal(dryRun.requested_check_count, 11);
    assert.equal(dryRun.would_apply, true);
    assert.equal(dryRun.applied, false);

    const repaired = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPackA.id, {
      apply: true,
      actorEmail: "tester@local",
    });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.apply_requested, true);
    assert.equal(repaired.created, true);
    assert.equal(repaired.repaired, true);
    assert.equal(repaired.would_apply, true);
    assert.equal(repaired.applied, true);
    assert.equal(repaired.mode, "repair_from_explicit_field_pack");
    assert.deepEqual(
      repaired.handoff?.handoff_package_json?.requested_checks?.groups?.map((group) => group.group_key),
      ["cta_contact", "taxonomy"]
    );
    assert.equal(
      repaired.handoff?.handoff_package_json?.requested_checks?.groups?.[0]?.checks?.[0]?.instruction,
      "Confirm the real phone number people can use now."
    );

    const secondRepair = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPackB.id, {
      apply: true,
      actorEmail: "tester@local",
    });
    assert.equal(secondRepair.ok, true);
    assert.equal(secondRepair.apply_requested, true);
    assert.equal(secondRepair.created, false);
    assert.equal(secondRepair.reason, "already_exists");
    assert.equal(secondRepair.would_apply, false);
    assert.equal(secondRepair.applied, false);
    const snapshotCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assignment_handoff_snapshots WHERE assignment_id=?").get(createdAssignment.id)?.c || 0;
    assert.equal(snapshotCount, 1);
  } finally {
    ctx.cleanup();
  }
});

test("repairAssignmentHandoffSnapshotForAssignment rejects wrong-item and missing field pack ids", () => {
  const ctx = createTestContext();
  try {
    const itemA = ctx.createItem("Repair Snapshot Item A");
    const itemB = ctx.createItem("Repair Snapshot Item B");
    const assignee = ctx.createUser("repair-validation");
    const fieldPackA = ctx.repo.createFieldPack({
      content_item_id: itemA.id,
      status: "ready_for_field",
      editor_summary: "field pack A",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA / Contact",
            checks: [
              { key: "phone", requested: true, label: "Phone", instruction: "Check phone", answer_type: "phone", suggested_value: "080-111-2222", evidence_required: false },
            ],
          },
        ],
      },
    });
    const fieldPackB = ctx.repo.createFieldPack({
      content_item_id: itemB.id,
      status: "ready_for_field",
      editor_summary: "field pack B",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "taxonomy",
            group_label: "Taxonomy",
            checks: [
              { key: "tags", requested: true, label: "Tags", instruction: "Check tags", answer_type: "multi_select", suggested_value: ["late-night"], evidence_required: false },
            ],
          },
        ],
      },
    });

    const createdAssignment = ctx.repo.createAssignment(
      {
        content_item_id: itemA.id,
        assignee_user_id: assignee.id,
        assignment_kind: "field",
      },
      assignee.id,
      {
        actor_email: "tester@local",
        actor_role: "admin",
        reason_code: "assignment_created_sync_manual",
        note: "manual assignment without handoff snapshot",
      }
    );

    const missingFieldPack = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, null, {
      apply: false,
      actorEmail: "tester@local",
    });
    assert.equal(missingFieldPack.ok, false);
    assert.equal(missingFieldPack.apply_requested, false);
    assert.equal(missingFieldPack.reason, "rejected");
    assert.equal(missingFieldPack.would_apply, false);
    assert.equal(missingFieldPack.applied, false);
    assert.equal(missingFieldPack.errors.includes("field_pack_id is required"), true);

    const wrongItemRepair = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPackB.id, {
      apply: true,
      actorEmail: "tester@local",
    });
    assert.equal(wrongItemRepair.ok, false);
    assert.equal(wrongItemRepair.apply_requested, true);
    assert.equal(wrongItemRepair.would_apply, false);
    assert.equal(wrongItemRepair.applied, false);
    assert.equal(wrongItemRepair.errors.includes("field pack belongs to another content item"), true);
    assert.equal(ctx.repo.getLatestAssignmentHandoffByAssignment(createdAssignment.id), null);

    const validDryRun = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(createdAssignment.id, fieldPackA.id, {
      apply: false,
      actorEmail: "tester@local",
    });
    assert.equal(validDryRun.ok, true);
    assert.equal(validDryRun.reason, "dry_run");
    assert.equal(validDryRun.apply_requested, false);
    assert.equal(validDryRun.would_apply, true);
    assert.equal(validDryRun.applied, false);
  } finally {
    ctx.cleanup();
  }
});

test("repairAssignmentHandoffSnapshotForAssignment is a no-op for existing snapshot and rejects non-field assignments", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Repair Snapshot Existing Snapshot");
    const assignee = ctx.createUser("repair-existing");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA / Contact",
            checks: [
              { key: "phone", requested: true, label: "Phone", instruction: "Check phone", answer_type: "phone", suggested_value: "080-111-2222", evidence_required: false },
            ],
          },
        ],
      },
    });

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id },
      assignee.id,
      "tester@local",
      "admin"
    );

    const existingSnapshotRepair = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(
      assignmentResult.assignment.id,
      fieldPack.id,
      {
        apply: true,
        actorEmail: "tester@local",
      }
    );
    assert.equal(existingSnapshotRepair.ok, true);
    assert.equal(existingSnapshotRepair.apply_requested, true);
    assert.equal(existingSnapshotRepair.created, false);
    assert.equal(existingSnapshotRepair.reason, "already_exists");
    assert.equal(existingSnapshotRepair.would_apply, false);
    assert.equal(existingSnapshotRepair.applied, false);

    const editorialAssignment = ctx.repo.createAssignment(
      {
        content_item_id: item.id,
        assignee_user_id: assignee.id,
        assignment_kind: "editorial",
        brief_json: { brief_summary: "Editorial brief" },
        requirements_json: { priority: "normal" },
      },
      assignee.id,
      {
        actor_email: "tester@local",
        actor_role: "admin",
        reason_code: "assignment_created_sync_manual",
        note: "editorial assignment",
      }
    );

    const editorialRepair = ctx.repo.repairAssignmentHandoffSnapshotForAssignment(editorialAssignment.id, fieldPack.id, {
      apply: true,
      actorEmail: "tester@local",
    });
    assert.equal(editorialRepair.ok, false);
    assert.equal(editorialRepair.apply_requested, true);
    assert.equal(editorialRepair.would_apply, false);
    assert.equal(editorialRepair.applied, false);
    assert.equal(editorialRepair.errors.includes("repair is supported only for field assignments"), true);
    const editorialSnapshotCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assignment_handoff_snapshots WHERE assignment_id=?").get(editorialAssignment.id)?.c || 0;
    assert.equal(editorialSnapshotCount, 0);
  } finally {
    ctx.cleanup();
  }
});

test("createAssignmentSubmissionDeliverable rejects source_asset_id from another item", () => {
  const ctx = createTestContext();
  try {
    const itemA = ctx.createItem("Nu Place");
    const itemB = ctx.createItem("Xi Place");
    const assignee = ctx.createUser("deliverable");
    const foreignAsset = ctx.createContentAsset(itemB.id, "foreign");
    ctx.createReadinessBrief(itemA.id, "Nu");

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      itemA.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const submissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state,
        article_payload_json, media_payload_json, contributor_note, reviewer_note, reviewed_at
      ) VALUES (?, ?, ?, 'submitted', NULL, NULL, ?, NULL, NULL)
    `).run(
      assignmentId,
      itemA.id,
      assignee.id,
      "submission for deliverable test"
    );
    const submission = { id: Number(submissionResult.lastInsertRowid || 0) };

    assert.throws(() => {
      ctx.repo.createAssignmentSubmissionDeliverable({
        assignment_id: assignmentId,
        submission_id: submission.id,
        content_item_id: itemA.id,
        deliverable_type: "photos",
        source_asset_id: foreignAsset.asset_id,
      }, "tester@local");
    }, /source_asset_id does not belong to content item/);
  } finally {
    ctx.cleanup();
  }
});

test("resubmitted assignment creates a new immutable submission row and preserves prior media when no new media payload is sent", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Resubmit Keep Media");
    const assignee = ctx.createUser("resubmit-keep-media");
    const photoAsset = ctx.createContentAsset(item.id, "photo-a", { mime_type: "image/jpeg", extension: "jpg" });
    ctx.createReadinessBrief(item.id, "resubmit-keep-media");

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      article_payload_json: { summary: "first submission" },
      media_payload_json: {
        assets: [
          {
            id: photoAsset.asset_id,
            file_name: "keep-media.jpg",
            mime_type: "image/jpeg",
            public_url: "/media/uploads/keep-media.jpg",
          },
        ],
      },
      contributor_note: "initial submit",
    });
    ctx.repo.updateAssignmentState(
      assignmentId,
      "submitted",
      "submitter@local",
      { actor_role: "user", reason_code: "submission_created" }
    );
    ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignmentId,
      submission_id: submission.id,
      deliverable_type: "photos",
      status: "submitted",
      source_asset_id: photoAsset.asset_id,
      title: "Photo A",
    });

    ctx.repo.updateAssignmentState(
      assignmentId,
      "revision_requested",
      "reviewer@local",
      { actor_role: "user", reason_code: "needs_revision" }
    );

    const resubmitted = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "resubmitted",
      article_payload_json: { summary: "revised submission" },
      contributor_note: "revised text only",
    });

    assert.notEqual(resubmitted.id, submission.id);
    assert.equal(resubmitted.submission_state, "resubmitted");
    assert.equal(resubmitted.article_payload_json?.summary, "revised submission");
    assert.equal(Array.isArray(resubmitted.media_payload_json?.assets), true);
    assert.equal(resubmitted.media_payload_json.assets.length, 1);
    assert.equal(resubmitted.media_payload_json.assets[0]?.public_url, "/media/uploads/keep-media.jpg");
    assert.equal(Number(resubmitted.source_handoff_snapshot_id || 0) > 0, true);
    assert.equal(Number(submission.source_handoff_snapshot_id || 0) > 0, true);

    const assignmentAfter = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(Number(assignmentAfter.latest_submission_id || 0), resubmitted.id);

    const latestBundle = ctx.repo.getLatestAssignmentDeliverablesBundle(assignmentId);
    assert.equal(Number(latestBundle.latest_submission_id || 0), resubmitted.id);
    const originalSubmissionReloaded = ctx.repo.getAssignmentSubmissionById(submission.id);
    assert.equal(originalSubmissionReloaded.article_payload_json?.summary, "first submission");
    assert.equal(Array.isArray(originalSubmissionReloaded.media_payload_json?.assets), true);
    assert.equal(originalSubmissionReloaded.media_payload_json.assets.length, 1);
    const originalDeliverables = ctx.repo.listAssignmentSubmissionDeliverablesBySubmission(assignmentId, submission.id);
    assert.equal(originalDeliverables.length, 1);
  } finally {
    ctx.cleanup();
  }
});

test("resubmitted assignment creates a new row and merges incoming media payload from the previous submission package", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Resubmit Merge Media");
    const assignee = ctx.createUser("resubmit-merge-media");
    ctx.createReadinessBrief(item.id, "resubmit-merge-media");

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      media_payload_json: {
        assets: [
          {
            id: 101,
            file_name: "photo-one.jpg",
            mime_type: "image/jpeg",
            public_url: "/media/uploads/photo-one.jpg",
          },
        ],
      },
    });
    ctx.repo.updateAssignmentState(
      assignmentId,
      "submitted",
      "submitter@local",
      { actor_role: "user", reason_code: "submission_created" }
    );

    ctx.repo.updateAssignmentState(
      assignmentId,
      "revision_requested",
      "reviewer@local",
      { actor_role: "user", reason_code: "needs_revision" }
    );

    const resubmitted = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "resubmitted",
      media_payload_json: {
        assets: [
          {
            id: 102,
            file_name: "video-two.mp4",
            mime_type: "video/mp4",
            public_url: "/media/uploads/video-two.mp4",
          },
        ],
      },
    });

    assert.notEqual(resubmitted.id, submission.id);
    assert.equal(Array.isArray(resubmitted.media_payload_json?.assets), true);
    assert.equal(resubmitted.media_payload_json.assets.length, 2);
    assert.deepEqual(
      resubmitted.media_payload_json.assets.map((asset) => asset.public_url),
      ["/media/uploads/photo-one.jpg", "/media/uploads/video-two.mp4"]
    );
    const originalSubmissionReloaded = ctx.repo.getAssignmentSubmissionById(submission.id);
    assert.equal(originalSubmissionReloaded.media_payload_json.assets.length, 1);
    assert.deepEqual(
      originalSubmissionReloaded.media_payload_json.assets.map((asset) => asset.public_url),
      ["/media/uploads/photo-one.jpg"]
    );
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission round-trips normalized field return payload and ignores client found", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Field Return Payload");
    const assignee = ctx.createUser("field-return-payload");
    ctx.createReadinessBrief(item.id, "field-return-payload");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      field_pack_checklists: [
        { checklist_type: "must_verify_fact", item_text: "verify phone" },
        { checklist_type: "must_capture", item_text: "capture storefront", capture_type: "photo" },
      ],
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const verifyChecklistId = Number(fieldPack.checklists[0]?.id || 0);
    const captureChecklistId = Number(fieldPack.checklists[1]?.id || 0);

    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        checklist_results: [
          {
            checklist_id: verifyChecklistId,
            checked: true,
            found: false,
            value: "0811111111",
            note: "confirmed phone",
          },
          {
            checklist_id: captureChecklistId,
            checked: true,
            found: false,
            value: null,
            evidence_source_url: "https://example.com/evidence/photo-1",
          },
        ],
        cta_return: {
          phone: { checked: true, found: false, value: "0811111111" },
        },
        taxonomy_return: {
          category: { checked: true, found: false, value: "attractions" },
        },
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: "0811111111", evidence: "storefront signage" },
          "cta_contact.line_url": { checked: true, value: "" },
          "cta_contact.facebook_url": { checked: true, value: "" },
          "cta_contact.website_url": { checked: true, value: "" },
          "cta_contact.primary_cta": { checked: true, value: "map" },
          "taxonomy.parking": { checked: true, value: false, condition_note: "No dedicated parking" },
          "taxonomy.pet_friendly": { checked: true, value: false, evidence: "No pet signage" },
          "taxonomy.wheelchair_accessible": { checked: true, value: false, evidence: "Front stairs only" },
          "taxonomy.toilet_available": { checked: true, value: true },
          "taxonomy.entry_fee_required": { checked: true, value: false },
          "taxonomy.setting_type": { checked: true, value: "outdoor" },
        },
        note: "field return note",
      },
    });

    assert.equal(Array.isArray(submission.field_return_payload_json?.checklist_results), true);
    assert.equal(submission.field_return_payload_json.checklist_results[0].found, true);
    assert.equal(submission.field_return_payload_json.checklist_results[1].found, true);
    assert.equal(
      submission.field_return_payload_json.checklist_results[1].evidence_source_url,
      "https://example.com/evidence/photo-1"
    );

    const fetched = ctx.repo.getAssignmentSubmissionById(submission.id);
    assert.equal(fetched.field_return_payload_json.checklist_results[0].found, true);
    assert.equal(fetched.field_return_payload_json.note, "field return note");
  } finally {
    ctx.cleanup();
  }
});

test("resubmitted assignment creates a new row and retains prior complete field returns when no replacement field_return_payload_json is supplied", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Resubmit Keep Field Return");
    const assignee = ctx.createUser("resubmit-keep-field-return");
    ctx.createReadinessBrief(item.id, "resubmit-keep-field-return");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      field_pack_checklists: [{ checklist_type: "must_verify_fact", item_text: "verify phone" }],
    });

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: "0811111111", evidence: "storefront signage" },
          "cta_contact.line_url": { checked: true, value: "" },
          "cta_contact.facebook_url": { checked: true, value: "" },
          "cta_contact.website_url": { checked: true, value: "" },
          "cta_contact.primary_cta": { checked: true, value: "map" },
          "taxonomy.parking": { checked: true, value: false, condition_note: "No parking" },
          "taxonomy.pet_friendly": { checked: true, value: false, evidence: "No pets sign" },
          "taxonomy.wheelchair_accessible": { checked: true, value: false, evidence: "Steps only" },
          "taxonomy.toilet_available": { checked: true, value: true },
          "taxonomy.entry_fee_required": { checked: true, value: false },
          "taxonomy.setting_type": { checked: true, value: "outdoor" },
        },
      },
      article_payload_json: { summary: "first submission" },
    });
    ctx.repo.updateAssignmentState(
      assignmentId,
      "submitted",
      "submitter@local",
      { actor_role: "user", reason_code: "submission_created" }
    );
    ctx.repo.updateAssignmentState(
      assignmentId,
      "revision_requested",
      "reviewer@local",
      { actor_role: "user", reason_code: "needs_revision" }
    );

    const resubmitted = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "resubmitted",
      article_payload_json: { summary: "revised without replacing field return" },
    });

    assert.notEqual(resubmitted.id, submission.id);
    assert.equal(resubmitted.article_payload_json?.summary, "revised without replacing field return");
    assert.deepEqual(resubmitted.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, "0811111111");
    assert.deepEqual(resubmitted.field_return_payload_json.requested_check_returns["taxonomy.setting_type"].value, "outdoor");
    const originalSubmissionReloaded = ctx.repo.getAssignmentSubmissionById(submission.id);
    assert.equal(originalSubmissionReloaded.article_payload_json?.summary, "first submission");

    const resubmittedWithoutReplacement = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "resubmitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: "0811111111", evidence: "storefront signage" },
        },
      },
    });
    assert.deepEqual(resubmittedWithoutReplacement.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, "0811111111");
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission draft persists requested-check returns with explicit false and not_found values", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Draft Requested Check Persistence");
    const assignee = ctx.createUser("draft-requested-check-persistence");
    ctx.createReadinessBrief(item.id, "draft-requested-check-persistence");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            checks: [
              { key: "phone", requested: true, answer_type: "phone" },
            ],
          },
          {
            group_key: "taxonomy",
            checks: [
              { key: "parking", requested: true, answer_type: "boolean" },
            ],
          },
        ],
      },
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const revisionRound = Number(assignmentResult.assignment.revision_round || 0) + 1;

    const saved = ctx.repo.upsertAssignmentSubmissionDraft({
      assignment_id: assignmentId,
      user_id: assignee.id,
      revision_round: revisionRound,
      article_payload_json: { additional_text: "saved draft" },
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: null, condition_note: "", evidence: "", note: "" },
          "taxonomy.parking": { checked: true, value: false, condition_note: "", evidence: "", note: "" },
        },
      },
      expires_at: "2099-01-01T00:00:00.000Z",
    });

    assert.equal(saved.article_payload_json.additional_text, "saved draft");
    assert.equal(saved.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, null);
    assert.equal(saved.field_return_payload_json.requested_check_returns["taxonomy.parking"].value, false);

    const loaded = ctx.repo.getAssignmentSubmissionDraft(assignmentId, assignee.id, {
      revision_round: revisionRound,
      now: "2098-01-01T00:00:00.000Z",
    });
    assert.equal(loaded.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, null);
    assert.equal(loaded.field_return_payload_json.requested_check_returns["taxonomy.parking"].value, false);
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission draft prefill falls back to latest submission field returns when current revision has no requested-check draft", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Draft Requested Check Fallback");
    const assignee = ctx.createUser("draft-requested-check-fallback");
    ctx.createReadinessBrief(item.id, "draft-requested-check-fallback");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            checks: [
              { key: "phone", requested: true, answer_type: "phone" },
            ],
          },
          {
            group_key: "taxonomy",
            checks: [
              { key: "parking", requested: true, answer_type: "boolean" },
            ],
          },
        ],
      },
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const handoffSnapshotId = currentHandoffSnapshotId(ctx, assignmentId);
    const firstSubmission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: handoffSnapshotId,
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      article_payload_json: { additional_text: "first revision" },
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: "0811111111", evidence: "signage" },
          "taxonomy.parking": { checked: true, value: false },
        },
      },
    });
    ctx.repo.updateAssignmentState(
      assignmentId,
      "submitted",
      "submitter@local",
      { actor_role: "user", reason_code: "submission_created" }
    );
    ctx.repo.updateAssignmentState(
      assignmentId,
      "revision_requested",
      "reviewer@local",
      { actor_role: "user", reason_code: "needs_revision" }
    );
    const assignment = ctx.repo.getAssignmentById(assignmentId);
    const prefill = ctx.repo.getAssignmentSubmissionDraftPrefill(assignmentId, assignee.id, {
      revision_round: Number(assignment.revision_round || 0) + 1,
      now: "2098-01-01T00:00:00.000Z",
    });

    assert.equal(prefill.source, "latest_submission_fallback");
    assert.equal(prefill.draft.article_payload_json.additional_text, "first revision");
    assert.equal(prefill.draft.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, "0811111111");
    assert.equal(prefill.draft.field_return_payload_json.requested_check_returns["taxonomy.parking"].value, false);
    assert.equal(firstSubmission.field_return_payload_json.requested_check_returns["taxonomy.parking"].value, false);
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission draft updates preserve omitted sections and keep explicit false and null values", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Draft Partial Preserve");
    const assignee = ctx.createUser("draft-partial-preserve");
    ctx.createReadinessBrief(item.id, "draft-partial-preserve");
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const revisionRound = Number(assignmentResult.assignment.revision_round || 0) + 1;

    const saved = ctx.repo.upsertAssignmentSubmissionDraft({
      assignment_id: assignmentId,
      user_id: assignee.id,
      revision_round: revisionRound,
      article_payload_json: { additional_text: "first article" },
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: null, evidence: "" },
          "taxonomy.parking": { checked: true, value: false },
        },
      },
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    assert.equal(saved.article_payload_json.additional_text, "first article");
    assert.equal(saved.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, null);
    assert.equal(saved.field_return_payload_json.requested_check_returns["taxonomy.parking"].value, false);

    const articleOnly = ctx.repo.upsertAssignmentSubmissionDraft({
      assignment_id: assignmentId,
      user_id: assignee.id,
      revision_round: revisionRound,
      article_payload_json: { additional_text: "article only update" },
      expires_at: "2099-01-02T00:00:00.000Z",
    });
    assert.equal(articleOnly.article_payload_json.additional_text, "article only update");
    assert.equal(articleOnly.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, null);
    assert.equal(articleOnly.field_return_payload_json.requested_check_returns["taxonomy.parking"].value, false);

    const fieldReturnOnly = ctx.repo.upsertAssignmentSubmissionDraft({
      assignment_id: assignmentId,
      user_id: assignee.id,
      revision_round: revisionRound,
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: "0812345678", evidence: "storefront sign" },
          "taxonomy.parking": { checked: true, value: false },
        },
      },
      expires_at: "2099-01-03T00:00:00.000Z",
    });
    assert.equal(fieldReturnOnly.article_payload_json.additional_text, "article only update");
    assert.equal(fieldReturnOnly.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, "0812345678");
    assert.equal(fieldReturnOnly.field_return_payload_json.requested_check_returns["taxonomy.parking"].value, false);
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission draft prefill prefers latest saved draft across revisions over latest submission fallback", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Draft Cross Revision Prefill");
    const assignee = ctx.createUser("draft-cross-revision-prefill");
    ctx.createReadinessBrief(item.id, "draft-cross-revision-prefill");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            checks: [
              { key: "phone", requested: true, answer_type: "phone" },
            ],
          },
          {
            group_key: "taxonomy",
            checks: [
              { key: "pet_friendly", requested: true, answer_type: "boolean" },
            ],
          },
        ],
      },
      field_input_json: {
        must_verify: ["Verify phone"],
        must_ask: ["Ask owner"],
        must_capture: ["Storefront shot"],
      },
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const firstRound = Number(assignmentResult.assignment.revision_round || 0) + 1;
    const handoffSnapshotId = currentHandoffSnapshotId(ctx, assignmentId);

    ctx.repo.upsertAssignmentSubmissionDraft({
      assignment_id: assignmentId,
      user_id: assignee.id,
      revision_round: firstRound,
      article_payload_json: {
        verified_answers: [{ prompt: "Verify phone", answer: "draft verify" }],
        capture_answers: [{ prompt: "Storefront shot", answer: "draft capture" }],
        question_answers: [{ prompt: "Ask owner", answer: "draft ask" }],
        additional_text: "draft note",
      },
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: false, value: "0800000000", condition_note: "", evidence: "", note: "" },
          "taxonomy.pet_friendly": { checked: false, value: false, condition_note: "", evidence: "", note: "" },
        },
      },
      expires_at: "2099-01-01T00:00:00.000Z",
    });

    ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: handoffSnapshotId,
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      article_payload_json: {
        verified_answers: [],
        capture_answers: [],
        question_answers: [],
        additional_text: "submitted note only",
      },
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: null },
          "taxonomy.pet_friendly": { checked: true, value: false },
        },
      },
    });
    ctx.repo.updateAssignmentState(
      assignmentId,
      "submitted",
      "submitter@local",
      { actor_role: "user", reason_code: "submission_created" }
    );
    ctx.repo.updateAssignmentState(
      assignmentId,
      "revision_requested",
      "reviewer@local",
      { actor_role: "user", reason_code: "needs_revision" }
    );

    const assignment = ctx.repo.getAssignmentById(assignmentId);
    const secondRound = Number(assignment.revision_round || 0) + 1;
    const prefill = ctx.repo.getAssignmentSubmissionDraftPrefill(assignmentId, assignee.id, {
      revision_round: secondRound,
      now: "2098-01-01T00:00:00.000Z",
    });

    assert.equal(prefill.source, "latest_saved_draft_fallback");
    assert.equal(prefill.draft.article_payload_json.verified_answers[0]?.answer, "draft verify");
    assert.equal(prefill.draft.article_payload_json.capture_answers[0]?.answer, "draft capture");
    assert.equal(prefill.draft.article_payload_json.question_answers[0]?.answer, "draft ask");
    assert.equal(prefill.draft.article_payload_json.additional_text, "draft note");
    assert.equal(prefill.draft.field_return_payload_json.requested_check_returns["cta_contact.phone"].checked, false);
    assert.equal(prefill.draft.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, "0800000000");
    assert.equal(prefill.draft.field_return_payload_json.requested_check_returns["taxonomy.pet_friendly"].checked, false);
    assert.equal(prefill.draft.field_return_payload_json.requested_check_returns["taxonomy.pet_friendly"].value, false);
  } finally {
    ctx.cleanup();
  }
});

test("listAssignmentRoundAssetsByType preserves assignment slot metadata for assignment-work validation", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Assignment Slot Metadata");
    const assignee = ctx.createUser("assignment-slot-meta");
    const assignmentInsert = ctx.db.prepare(`
      INSERT INTO content_assignments (
        assignment_uid, content_item_id, assignment_kind, assignee_user_id, assigned_by_user_id, state, revision_round
      ) VALUES (?, ?, 'field', ?, ?, 'in_progress', 2)
    `).run(`assignment-slot-meta-${Date.now()}`, item.id, assignee.id, assignee.id);
    const assignmentId = Number(assignmentInsert.lastInsertRowid || 0) || 0;
    const assetInsert = ctx.db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES (?, 'local', ?, ?, 'image/jpeg', 123, ?)
    `).run(
      `asset-slot-meta-${Date.now()}`,
      "uploads/assignment-slot.jpg",
      "assignment-slot.jpg",
      "checksum-slot-meta"
    );
    const assetId = Number(assetInsert.lastInsertRowid || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO content_assets (
        content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order,
        assignment_id, assignment_round, assignment_media_type, assignment_slot_key, assignment_surface, assignment_sync_batch_id
      ) VALUES (?, ?, 'unused', 0, 0, 'unused', 0, ?, 2, 'image', ?, 'assignment_work', 'batch-slot-meta')
    `).run(item.id, assetId, assignmentId, "shot-1-storefront-hero");

    const rows = ctx.repo.listAssignmentRoundAssetsByType(assignmentId, 2, "image");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].assignment_slot_key, "shot-1-storefront-hero");
    assert.equal(rows[0].assignment_media_type, "image");
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission draft migration backfills requested-check column idempotently after legacy rebuild", () => {
  const ctx = createTestContext();
  try {
    ctx.db.exec("PRAGMA foreign_keys = OFF;");
    ctx.db.exec("DROP INDEX IF EXISTS idx_assignment_submission_drafts_expiry;");
    ctx.db.exec("DROP INDEX IF EXISTS idx_assignment_submission_drafts_assignment;");
    ctx.db.exec("ALTER TABLE content_assignment_submission_drafts RENAME TO content_assignment_submission_drafts_modern;");
    ctx.db.exec(`
      CREATE TABLE content_assignment_submission_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content_item_id INTEGER NOT NULL,
        article_payload_json TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(assignment_id, user_id),
        FOREIGN KEY(assignment_id) REFERENCES content_assignments(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
      );
    `);
    ctx.db.exec(`
      INSERT INTO content_assignment_submission_drafts (
        id, assignment_id, user_id, content_item_id, article_payload_json, expires_at, created_at, updated_at
      )
      SELECT id, assignment_id, user_id, content_item_id, article_payload_json, expires_at, created_at, updated_at
      FROM content_assignment_submission_drafts_modern;
    `);
    ctx.db.exec("DROP TABLE content_assignment_submission_drafts_modern;");
    ctx.db.exec("PRAGMA foreign_keys = ON;");

    createRepository(ctx.db);
    createRepository(ctx.db);

    const columns = ctx.db.prepare("PRAGMA table_info(content_assignment_submission_drafts)").all();
    assert.equal(columns.filter((column) => String(column?.name || "").trim() === "revision_round").length, 1);
    assert.equal(columns.filter((column) => String(column?.name || "").trim() === "field_return_payload_json").length, 1);
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission draft migration adds requested-check column once when revision_round already exists", () => {
  const ctx = createTestContext();
  try {
    ctx.db.exec("PRAGMA foreign_keys = OFF;");
    ctx.db.exec("DROP INDEX IF EXISTS idx_assignment_submission_drafts_expiry;");
    ctx.db.exec("DROP INDEX IF EXISTS idx_assignment_submission_drafts_assignment;");
    ctx.db.exec("ALTER TABLE content_assignment_submission_drafts RENAME TO content_assignment_submission_drafts_with_round;");
    ctx.db.exec(`
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
    ctx.db.exec(`
      INSERT INTO content_assignment_submission_drafts (
        id, assignment_id, user_id, revision_round, content_item_id, article_payload_json, expires_at, created_at, updated_at
      )
      SELECT id, assignment_id, user_id, revision_round, content_item_id, article_payload_json, expires_at, created_at, updated_at
      FROM content_assignment_submission_drafts_with_round;
    `);
    ctx.db.exec("DROP TABLE content_assignment_submission_drafts_with_round;");
    ctx.db.exec("PRAGMA foreign_keys = ON;");

    createRepository(ctx.db);
    createRepository(ctx.db);

    const columns = ctx.db.prepare("PRAGMA table_info(content_assignment_submission_drafts)").all();
    assert.equal(columns.filter((column) => String(column?.name || "").trim() === "revision_round").length, 1);
    assert.equal(columns.filter((column) => String(column?.name || "").trim() === "field_return_payload_json").length, 1);
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission allows missing requested return entries from the immutable handoff snapshot", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Return Missing");
    const assignee = ctx.createUser("requested-return-missing");
    ctx.createReadinessBrief(item.id, "requested-return-missing");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );

    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentResult.assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentResult.assignment.id),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {},
      },
    });
    assert.deepEqual(submission.field_return_payload_json.requested_check_returns, {});
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission allows unchecked required requested return rows at submit time", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Return Unchecked");
    const assignee = ctx.createUser("requested-return-unchecked");
    ctx.createReadinessBrief(item.id, "requested-return-unchecked");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );

    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentResult.assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentResult.assignment.id),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: buildValidAttractionRequestedCheckReturns({
          "cta_contact.phone": { checked: false, value: "0812345678", evidence: "signboard" },
        }),
      },
    });
    assert.equal(submission.field_return_payload_json.requested_check_returns["cta_contact.phone"].checked, false);
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission accepts requested boolean false and requested phone empty when explicitly checked with required evidence", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Return Explicit Verification");
    const assignee = ctx.createUser("requested-return-explicit-verification");
    ctx.createReadinessBrief(item.id, "requested-return-explicit-verification");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );

    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentResult.assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentResult.assignment.id),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: "", evidence: "No phone number on storefront" },
          "cta_contact.line_url": { checked: true, value: "", evidence: "" },
          "cta_contact.facebook_url": { checked: true, value: "", evidence: "" },
          "cta_contact.website_url": { checked: true, value: "", evidence: "" },
          "cta_contact.primary_cta": { checked: true, value: "map", evidence: "" },
          "taxonomy.parking": { checked: true, value: false, condition_note: "No customer parking" },
          "taxonomy.pet_friendly": { checked: true, value: false, evidence: "Pets not allowed sign" },
          "taxonomy.wheelchair_accessible": { checked: true, value: false, evidence: "Steps at entrance" },
          "taxonomy.toilet_available": { checked: true, value: false },
          "taxonomy.entry_fee_required": { checked: true, value: false },
          "taxonomy.setting_type": { checked: true, value: "outdoor" },
        },
      },
    });

    assert.equal(submission.field_return_payload_json.requested_check_returns["cta_contact.phone"].checked, true);
    assert.equal(submission.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, null);
    assert.equal(submission.field_return_payload_json.requested_check_returns["taxonomy.parking"].value, false);
    assert.equal(submission.field_return_payload_json.requested_check_returns["taxonomy.setting_type"].value, "outdoor");
  } finally {
    ctx.cleanup();
  }
});

test("assignment acceptance still blocks legacy malformed canonical number_with_unit values injected after submit validation", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Return Number With Unit");
    ctx.db.prepare("UPDATE content_items SET category='activities' WHERE id=?").run(item.id);
    const assignee = ctx.createUser("requested-return-number-with-unit");
    ctx.createReadinessBrief(item.id, "requested-return-number-with-unit");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = assignmentResult.assignment.id;
    const existingHandoff = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
    const immutableSnapshot = {
      ...existingHandoff.handoff_package_json,
      requested_checks: {
        version: 1,
        groups: [
          {
            group_key: "taxonomy",
            group_label: "Taxonomy",
            checks: [
              {
                key: "typical_duration",
                requested: true,
                label: "Typical duration",
                instruction: "Confirm typical duration",
                answer_type: "number_with_unit",
                unit_options: ["minutes", "hours"],
              },
            ],
          },
        ],
      },
    };
    ctx.db.prepare(`
      UPDATE content_assignment_handoff_snapshots
      SET handoff_package_json=?
      WHERE id=?
    `).run(JSON.stringify(immutableSnapshot), existingHandoff.id);

    const buildPayload = (submissionState, value) => ({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: submissionState,
      field_return_payload_json: {
        requested_check_returns: {
          "taxonomy.typical_duration": { checked: true, value },
        },
      },
    });

    const submittedMalformedDuration = ctx.repo.addAssignmentSubmission(buildPayload("submitted", { number: 120, unit: null }));
    assert.deepEqual(
      submittedMalformedDuration.field_return_payload_json.requested_check_returns["taxonomy.typical_duration"].value,
      { number: 120, unit: null }
    );

    insertLegacyAssignmentSubmission(ctx, {
      assignmentId,
      handoffSnapshotId: currentHandoffSnapshotId(ctx, assignmentId),
      submittedByUserId: assignee.id,
      submissionState: "submitted",
      fieldReturnPayloadJson: {
        requested_check_returns: {
          "taxonomy.typical_duration": { checked: true, value: { number: 120, unit: null } },
        },
      },
    });
    ctx.repo.updateAssignmentState(assignmentId, "submitted", "tester@local", { actor_role: "user", reason_code: "submission_created" });
    assert.throws(() => ctx.repo.updateAssignmentState(assignmentId, "accepted", "tester@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    }), /malformed|typical_duration/i);
    ctx.repo.updateAssignmentState(assignmentId, "revision_requested", "tester@local", { actor_role: "admin", reason_code: "needs_revision" });

    const accepted = ctx.repo.addAssignmentSubmission(buildPayload("resubmitted", { number: 120, unit: "minutes" }));
    assert.deepEqual(accepted.field_return_payload_json.requested_check_returns["taxonomy.typical_duration"].value, { number: 120, unit: "minutes" });
  } finally {
    ctx.cleanup();
  }
});

test("assignment acceptance preserves invalid object phone text hours and url values only for legacy injected rows and blocks them as malformed", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Return Invalid Typed Raw Values");
    const assignee = ctx.createUser("requested-return-invalid-typed-raw-values");
    ctx.createReadinessBrief(item.id, "requested-return-invalid-typed-raw-values");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignment = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    ).assignment;
    const assignmentId = Number(assignment.id || 0) || 0;
    const handoff = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
    const mutatedSnapshot = {
      ...handoff.handoff_package_json,
      requested_checks: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA / Contact",
            checks: [
              { key: "phone", requested: true, label: "Phone", instruction: "Confirm phone", answer_type: "phone", required: true, evidence_required: true },
              { key: "website_url", requested: true, label: "Website", instruction: "Confirm website", answer_type: "url", required: false },
              { key: "hours_raw", requested: true, label: "Hours", instruction: "Confirm hours", answer_type: "hours", required: false },
              { key: "summary_note", requested: true, label: "Summary", instruction: "Confirm summary", answer_type: "text", required: false },
            ],
          },
        ],
      },
    };
    ctx.db.prepare("UPDATE content_assignment_handoff_snapshots SET handoff_package_json=? WHERE id=?").run(
      JSON.stringify(mutatedSnapshot),
      handoff.id
    );

    const submittedMalformedTypedValues = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: { raw: "08123" }, evidence: "signboard" },
          "cta_contact.website_url": { checked: true, value: "not-a-valid-url" },
          "cta_contact.hours_raw": { checked: true, value: { open: "8" } },
          "cta_contact.summary_note": { checked: true, value: { unexpected: true } },
        },
      },
    });
    assert.deepEqual(submittedMalformedTypedValues.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, { raw: "08123" });

    const submission = insertLegacyAssignmentSubmission(ctx, {
      assignmentId,
      handoffSnapshotId: currentHandoffSnapshotId(ctx, assignmentId),
      submittedByUserId: assignee.id,
      submissionState: "submitted",
      fieldReturnPayloadJson: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: { raw: "08123" }, evidence: "signboard" },
          "cta_contact.website_url": { checked: true, value: "not-a-valid-url" },
          "cta_contact.hours_raw": { checked: true, value: { open: "8" } },
          "cta_contact.summary_note": { checked: true, value: { unexpected: true } },
        },
      },
    });
    assert.deepEqual(submission.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, { raw: "08123" });
    assert.equal(submission.field_return_payload_json.requested_check_returns["cta_contact.website_url"].value, "not-a-valid-url");
    assert.deepEqual(submission.field_return_payload_json.requested_check_returns["cta_contact.hours_raw"].value, { open: "8" });
    assert.deepEqual(submission.field_return_payload_json.requested_check_returns["cta_contact.summary_note"].value, { unexpected: true });
    ctx.repo.updateAssignmentState(assignmentId, "submitted", "submitter@local", { actor_role: "user", reason_code: "submission_created" });
    assert.throws(() => ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    }), /malformed|phone|website_url|hours_raw|summary_note/i);
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission allows invalid select values at submit time and acceptance still blocks legacy malformed select rows", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Return Invalid Select");
    const assignee = ctx.createUser("requested-return-invalid-select");
    ctx.createReadinessBrief(item.id, "requested-return-invalid-select");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );

    const submittedInvalidSelect = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentResult.assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentResult.assignment.id),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: "0812345678" },
          "cta_contact.line_url": { checked: true, value: "" },
          "cta_contact.facebook_url": { checked: true, value: "" },
          "cta_contact.website_url": { checked: true, value: "" },
          "cta_contact.primary_cta": { checked: true, value: "email" },
          "taxonomy.parking": { checked: true, value: false },
          "taxonomy.pet_friendly": { checked: true, value: false },
          "taxonomy.wheelchair_accessible": { checked: true, value: false },
          "taxonomy.toilet_available": { checked: true, value: false },
          "taxonomy.entry_fee_required": { checked: true, value: false },
          "taxonomy.setting_type": { checked: true, value: "outdoor" },
        },
      },
    });
    assert.equal(submittedInvalidSelect.field_return_payload_json.requested_check_returns["cta_contact.primary_cta"].value, "email");

    const invalidSelectSubmission = insertLegacyAssignmentSubmission(ctx, {
      assignmentId: assignmentResult.assignment.id,
      handoffSnapshotId: currentHandoffSnapshotId(ctx, assignmentResult.assignment.id),
      submittedByUserId: assignee.id,
      submissionState: "submitted",
      fieldReturnPayloadJson: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: "0812345678" },
          "cta_contact.line_url": { checked: true, value: "" },
          "cta_contact.facebook_url": { checked: true, value: "" },
          "cta_contact.website_url": { checked: true, value: "" },
          "cta_contact.primary_cta": { checked: true, value: "email" },
          "taxonomy.parking": { checked: true, value: false },
          "taxonomy.pet_friendly": { checked: true, value: false },
          "taxonomy.wheelchair_accessible": { checked: true, value: false },
          "taxonomy.toilet_available": { checked: true, value: false },
          "taxonomy.entry_fee_required": { checked: true, value: false },
          "taxonomy.setting_type": { checked: true, value: "outdoor" },
        },
      },
    });
    assert.equal(invalidSelectSubmission.field_return_payload_json.requested_check_returns["cta_contact.primary_cta"].value, "email");
    ctx.repo.updateAssignmentState(assignmentResult.assignment.id, "submitted", "submitter@local", { actor_role: "user", reason_code: "submission_created" });
    assert.throws(() => ctx.repo.updateAssignmentState(assignmentResult.assignment.id, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    }), /malformed|primary_cta/i);
    ctx.repo.updateAssignmentState(assignmentResult.assignment.id, "revision_requested", "reviewer@local", { actor_role: "admin", reason_code: "needs_revision" });

    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentResult.assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentResult.assignment.id),
      submitted_by_user_id: assignee.id,
      submission_state: "resubmitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": { checked: true, value: "0812345678", evidence: "storefront sign" },
          "cta_contact.line_url": { checked: true, value: "" },
          "cta_contact.facebook_url": { checked: true, value: "" },
          "cta_contact.website_url": { checked: true, value: "" },
          "cta_contact.primary_cta": { checked: true, value: "map" },
          "taxonomy.parking": { checked: true, value: false },
          "taxonomy.pet_friendly": { checked: true, value: false, evidence: "No pets sign" },
          "taxonomy.wheelchair_accessible": { checked: true, value: false, evidence: "Steps only" },
          "taxonomy.toilet_available": { checked: true, value: false },
          "taxonomy.entry_fee_required": { checked: true, value: false },
          "taxonomy.setting_type": { checked: true, value: "outdoor" },
        },
      },
    });
    ctx.repo.updateAssignmentState(assignmentResult.assignment.id, "resubmitted", "submitter@local", { actor_role: "user", reason_code: "submission_resubmitted" });
    const accepted = ctx.repo.updateAssignmentState(assignmentResult.assignment.id, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    });
    assert.equal(Array.isArray(accepted.acceptance_validation?.warnings), true);
    assert.equal(submission.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, "0812345678");
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission accepts valid select values with required evidence and preserves old custom snapshots unchanged", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Requested Return Legacy Snapshot");
    const assignee = ctx.createUser("requested-return-legacy-snapshot");
    ctx.createReadinessBrief(item.id, "requested-return-legacy-snapshot");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const existingHandoff = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentResult.assignment.id);
    const legacySnapshot = {
      ...existingHandoff.handoff_package_json,
      requested_checks: {
        version: 1,
        groups: [
          {
            group_key: "custom",
            group_label: "Custom",
            checks: [
              {
                key: "legacy_flag",
                requested: true,
                label: "Legacy flag",
                instruction: "Confirm legacy flag",
                answer_type: "boolean_with_conditions",
              },
            ],
          },
        ],
      },
    };
    ctx.db.prepare(`
      UPDATE content_assignment_handoff_snapshots
      SET handoff_package_json=?
      WHERE id=?
    `).run(JSON.stringify(legacySnapshot), existingHandoff.id);

    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentResult.assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentResult.assignment.id),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {
          "custom.legacy_flag": {
            checked: true,
            value: false,
            condition_note: "Legacy row still supported",
          },
        },
      },
    });

    const frozenAfterSubmit = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentResult.assignment.id);
    assert.equal(submission.field_return_payload_json.requested_check_returns["custom.legacy_flag"].value, false);
    assert.deepEqual(frozenAfterSubmit.handoff_package_json.requested_checks, legacySnapshot.requested_checks);
  } finally {
    ctx.cleanup();
  }
});

test("assignment acceptance pins exact handoff snapshot and submission ids across lifecycle transitions", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accepted Binding Lifecycle");
    const assignee = ctx.createUser("accepted-binding-lifecycle");
    ctx.createReadinessBrief(item.id, "accepted-binding-lifecycle");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignment = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    ).assignment;
    const assignmentId = Number(assignment.id || 0);
    const issuedHandoff = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
    const firstSubmission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: buildValidAttractionRequestedCheckReturns(),
      },
    });

    ctx.repo.updateAssignmentState(assignmentId, "submitted", "submitter@local", {
      actor_role: "user",
      reason_code: "submission_created",
    });
    const accepted = ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    });
    assert.equal(accepted.accepted_handoff_snapshot_id, issuedHandoff.id);
    assert.equal(accepted.accepted_submission_id, firstSubmission.id);
    assert.equal(Boolean(accepted.accepted_at), true);
    const acceptedAgain = ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    });
    assert.equal(acceptedAgain.accepted_handoff_snapshot_id, issuedHandoff.id);
    assert.equal(acceptedAgain.accepted_submission_id, firstSubmission.id);

    const reopened = ctx.repo.updateAssignmentState(assignmentId, "revision_requested", "reviewer@local", {
      actor_role: "admin",
      reason_code: "needs_revision",
    });
    assert.equal(reopened.accepted_handoff_snapshot_id, null);
    assert.equal(reopened.accepted_submission_id, null);
    assert.equal(reopened.accepted_at, null);

    const secondHandoffJson = {
      ...issuedHandoff.handoff_package_json,
      source: {
        ...(issuedHandoff.handoff_package_json?.source || {}),
        revision_label: "second-round",
      },
    };
    const secondHandoffInsert = ctx.db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, created_by
      ) VALUES (?, ?, ?, ?, 'ready', 'tester@local')
    `).run(
      assignmentId,
      item.id,
      issuedHandoff.readiness_brief_id == null ? null : Number(issuedHandoff.readiness_brief_id || 0) || null,
      JSON.stringify(secondHandoffJson)
    );
    const secondHandoffId = Number(secondHandoffInsert.lastInsertRowid || 0) || 0;
    const secondSubmission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: secondHandoffId,
      submitted_by_user_id: assignee.id,
      submission_state: "resubmitted",
      field_return_payload_json: {
        requested_check_returns: buildValidAttractionRequestedCheckReturns({
          "cta_contact.phone": { checked: true, value: "0822222222", evidence: "updated storefront signage" },
        }),
      },
    });
    ctx.repo.updateAssignmentState(assignmentId, "resubmitted", "submitter@local", {
      actor_role: "user",
      reason_code: "submission_resubmitted",
    });

    const reaccepted = ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    });
    assert.equal(reaccepted.accepted_handoff_snapshot_id, secondHandoffId);
    assert.equal(reaccepted.accepted_submission_id, secondSubmission.id);
    assert.equal(Boolean(reaccepted.accepted_at), true);

    const closed = ctx.repo.updateAssignmentState(assignmentId, "closed", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_closed",
    });
    assert.equal(closed.accepted_handoff_snapshot_id, secondHandoffId);
    assert.equal(closed.accepted_submission_id, secondSubmission.id);
    assert.equal(Boolean(closed.accepted_at), true);

    const sameStateAccepted = ctx.repo.updateAssignmentState(assignmentId, "closed", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_closed",
    });
    assert.equal(sameStateAccepted.accepted_handoff_snapshot_id, secondHandoffId);
    assert.equal(sameStateAccepted.accepted_submission_id, secondSubmission.id);

    ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=? WHERE id=?").run(firstSubmission.id, assignmentId);
    const driftAfterSubmissionPointerChange = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(driftAfterSubmissionPointerChange.accepted_submission_id, secondSubmission.id);

    const postAcceptHandoffInsert = ctx.db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, created_by
      ) VALUES (?, ?, ?, ?, 'ready', 'tester@local')
    `).run(
      assignmentId,
      item.id,
      issuedHandoff.readiness_brief_id == null ? null : Number(issuedHandoff.readiness_brief_id || 0) || null,
      JSON.stringify({
        ...secondHandoffJson,
        source: {
          ...(secondHandoffJson.source || {}),
          revision_label: "post-accept-drift",
        },
      })
    );
    assert.equal(Number(postAcceptHandoffInsert.lastInsertRowid || 0) > 0, true);
    const driftAfterHandoffInsert = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(driftAfterHandoffInsert.accepted_handoff_snapshot_id, secondHandoffId);

    const reopenedFromClosed = ctx.repo.updateAssignmentState(assignmentId, "revision_requested", "reviewer@local", {
      actor_role: "admin",
      reason_code: "needs_revision",
    });
    assert.equal(reopenedFromClosed.accepted_handoff_snapshot_id, null);
    assert.equal(reopenedFromClosed.accepted_submission_id, null);
    assert.equal(reopenedFromClosed.accepted_at, null);
  } finally {
    ctx.cleanup();
  }
});

test("submission and acceptance stay bound to the worker-loaded handoff snapshot even when a newer handoff appears before submit", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accepted Binding Uses Submission Source");
    ctx.db.prepare("UPDATE content_items SET category='activities' WHERE id=?").run(item.id);
    const assignee = ctx.createUser("accepted-binding-submission-source");
    ctx.createReadinessBrief(item.id, "accepted-binding-submission-source");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignment = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    ).assignment;
    const assignmentId = Number(assignment.id || 0) || 0;
    const handoffA = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
    const handoffBInsert = ctx.db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, created_by
      ) VALUES (?, ?, ?, ?, 'ready', 'tester@local')
    `).run(
      assignmentId,
      item.id,
      handoffA.readiness_brief_id == null ? null : Number(handoffA.readiness_brief_id || 0) || null,
      JSON.stringify({
        ...handoffA.handoff_package_json,
        source: {
          ...(handoffA.handoff_package_json?.source || {}),
          revision_label: "handoff-b",
        },
      })
    );
    const handoffBId = Number(handoffBInsert.lastInsertRowid || 0) || 0;
    assert.notEqual(handoffBId, handoffA.id);

    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: handoffA.id,
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: buildRequestedReturnsFromHandoff(handoffA.handoff_package_json),
      },
    });
    assert.equal(submission.source_handoff_snapshot_id, handoffA.id);
    assert.notEqual(submission.source_handoff_snapshot_id, handoffBId);
    ctx.repo.updateAssignmentState(assignmentId, "submitted", "submitter@local", { actor_role: "user", reason_code: "submission_created" });

    const accepted = ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    });
    assert.equal(accepted.accepted_submission_id, submission.id);
    assert.equal(accepted.accepted_handoff_snapshot_id, handoffA.id);
    assert.notEqual(accepted.accepted_handoff_snapshot_id, handoffBId);
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission rejects missing dangling and cross-owned source handoff snapshot ids", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Source Handoff Validation");
    const assignee = ctx.createUser("source-handoff-validation");
    ctx.createReadinessBrief(item.id, "source-handoff-validation");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignment = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    ).assignment;
    const assignmentId = Number(assignment.id || 0) || 0;
    const validReturns = buildValidAttractionRequestedCheckReturns();

    assert.throws(() => ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: validReturns,
      },
    }), /source_handoff_snapshot_id is required/i);

    assert.throws(() => ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: 999999,
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: validReturns,
      },
    }), /handoff snapshot not found/i);

    const otherItem = ctx.createItem("Source Handoff Validation Other");
    const otherAssignee = ctx.createUser("source-handoff-validation-other");
    ctx.createReadinessBrief(otherItem.id, "source-handoff-validation-other");
    ctx.repo.createFieldPack({
      content_item_id: otherItem.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const otherAssignment = ctx.repo.createAssignmentFromReadiness(
      otherItem.id,
      { assignee_user_id: otherAssignee.id, force_override: true, force_reason: "test" },
      otherAssignee.id,
      "tester@local",
      "admin"
    ).assignment;
    const otherHandoff = ctx.repo.getLatestAssignmentHandoffByAssignment(otherAssignment.id);

    assert.throws(() => ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: otherHandoff.id,
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: validReturns,
      },
    }), /belongs to another assignment|another content item/i);
  } finally {
    ctx.cleanup();
  }
});

test("editorial assignment submissions remain valid without a handoff snapshot binding", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Editorial Submission Without Handoff");
    const assignee = ctx.createUser("editorial-submission-without-handoff");
    const editorialAssignment = ctx.repo.createAssignment(
      {
        content_item_id: item.id,
        assignee_user_id: assignee.id,
        assignment_kind: "editorial",
        brief_json: { brief_summary: "Editorial brief" },
        requirements_json: { priority: "normal" },
      },
      assignee.id,
      {
        actor_email: "tester@local",
        actor_role: "admin",
        reason_code: "assignment_created_sync_manual",
      }
    );

    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: editorialAssignment.id,
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      contributor_note: "editorial submit",
    });
    assert.equal(submission.source_handoff_snapshot_id, null);

    ctx.repo.updateAssignmentState(editorialAssignment.id, "submitted", "submitter@local", {
      actor_role: "user",
      reason_code: "submission_created",
    });
    ctx.repo.updateAssignmentState(editorialAssignment.id, "revision_requested", "reviewer@local", {
      actor_role: "admin",
      reason_code: "needs_revision",
    });

    const resubmission = ctx.repo.addAssignmentSubmission({
      assignment_id: editorialAssignment.id,
      submitted_by_user_id: assignee.id,
      submission_state: "resubmitted",
      contributor_note: "editorial resubmit",
    });
    assert.equal(resubmission.source_handoff_snapshot_id, null);
    assert.notEqual(resubmission.id, submission.id);
  } finally {
    ctx.cleanup();
  }
});

test("editorial accepted binding stays pinned from accepted through close and becomes invalid when the accepted submission is corrupted", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Editorial Accepted Binding");
    const assignee = ctx.createUser("editorial-accepted-binding");
    const editorialAssignment = ctx.repo.createAssignment(
      {
        content_item_id: item.id,
        assignee_user_id: assignee.id,
        assignment_kind: "editorial",
        brief_json: { brief_summary: "Editorial brief" },
        requirements_json: { priority: "normal" },
      },
      assignee.id,
      {
        actor_email: "tester@local",
        actor_role: "admin",
        reason_code: "assignment_created_sync_manual",
      }
    );
    const assignmentId = Number(editorialAssignment.id || 0) || 0;

    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      contributor_note: "editorial submit",
    });
    assert.equal(submission.source_handoff_snapshot_id, null);

    ctx.repo.updateAssignmentState(assignmentId, "submitted", "submitter@local", {
      actor_role: "user",
      reason_code: "submission_created",
    });
    const accepted = ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    });
    assert.equal(accepted.accepted_binding_status, "pinned");
    assert.equal(accepted.accepted_submission_id, submission.id);
    assert.equal(accepted.accepted_handoff_snapshot_id, null);

    const closed = ctx.repo.updateAssignmentState(assignmentId, "closed", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_closed",
    });
    assert.equal(closed.accepted_binding_status, "pinned");
    assert.equal(closed.accepted_submission_id, submission.id);
    assert.equal(closed.accepted_handoff_snapshot_id, null);

    ctx.db.prepare("DELETE FROM content_assignment_submissions WHERE id=?").run(submission.id);
    const corrupted = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(corrupted.accepted_binding_status, "invalid_binding");
    assert.equal(corrupted.accepted_submission_id, submission.id);
    assert.equal(corrupted.accepted_handoff_snapshot_id, null);
  } finally {
    ctx.cleanup();
  }
});

test("assignment binding status distinguishes pinned legacy and invalid pointer states", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accepted Binding Status");
    const assignee = ctx.createUser("accepted-binding-status");
    ctx.createReadinessBrief(item.id, "accepted-binding-status");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignment = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    ).assignment;
    const assignmentId = Number(assignment.id || 0) || 0;
    const handoff = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: buildValidAttractionRequestedCheckReturns(),
      },
    });
    ctx.repo.updateAssignmentState(assignmentId, "submitted", "submitter@local", { actor_role: "user", reason_code: "submission_created" });
    const accepted = ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    });
    assert.equal(accepted.accepted_binding_status, "pinned");

    ctx.db.prepare("UPDATE content_assignments SET accepted_handoff_snapshot_id=NULL WHERE id=?").run(assignmentId);
    assert.equal(ctx.repo.getAssignmentById(assignmentId).accepted_binding_status, "invalid_binding");

    ctx.db.prepare("UPDATE content_assignments SET accepted_handoff_snapshot_id=?, accepted_submission_id=NULL WHERE id=?").run(handoff.id, assignmentId);
    assert.equal(ctx.repo.getAssignmentById(assignmentId).accepted_binding_status, "invalid_binding");

    ctx.db.prepare("UPDATE content_assignments SET accepted_handoff_snapshot_id=?, accepted_submission_id=? WHERE id=?").run(handoff.id, submission.id, assignmentId);
    assert.equal(ctx.repo.getAssignmentById(assignmentId).accepted_binding_status, "pinned");

    ctx.db.prepare("DELETE FROM content_assignment_handoff_snapshots WHERE id=?").run(handoff.id);
    assert.equal(ctx.repo.getAssignmentById(assignmentId).accepted_binding_status, "invalid_binding");

    const replacementHandoff = ctx.db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, created_by
      ) VALUES (?, ?, ?, ?, 'ready', 'tester@local')
    `).run(assignmentId, item.id, null, JSON.stringify({ version: 1, requested_checks: { version: 1, groups: [] } }));
    ctx.db.prepare("UPDATE content_assignments SET accepted_handoff_snapshot_id=? WHERE id=?").run(Number(replacementHandoff.lastInsertRowid || 0), assignmentId);
    ctx.db.prepare("DELETE FROM content_assignment_submissions WHERE id=?").run(submission.id);
    assert.equal(ctx.repo.getAssignmentById(assignmentId).accepted_binding_status, "invalid_binding");

    const replacementSubmissionInsert = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, source_handoff_snapshot_id, submitted_by_user_id, submission_state, field_return_payload_json
      ) VALUES (?, ?, ?, ?, 'resubmitted', ?)
    `).run(
      assignmentId,
      item.id,
      Number(replacementHandoff.lastInsertRowid || 0),
      assignee.id,
      JSON.stringify({ requested_check_returns: buildValidAttractionRequestedCheckReturns() })
    );
    const replacementSubmission = ctx.repo.getAssignmentSubmissionById(Number(replacementSubmissionInsert.lastInsertRowid || 0));
    ctx.db.prepare("UPDATE content_assignments SET accepted_submission_id=? WHERE id=?").run(replacementSubmission.id, assignmentId);
    assert.equal(ctx.repo.getAssignmentById(assignmentId).accepted_binding_status, "pinned");

    const otherItem = ctx.createItem("Accepted Binding Status Other");
    const otherUser = ctx.createUser("accepted-binding-status-other");
    ctx.createReadinessBrief(otherItem.id, "accepted-binding-status-other");
    ctx.repo.createFieldPack({
      content_item_id: otherItem.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const otherAssignment = ctx.repo.createAssignmentFromReadiness(
      otherItem.id,
      { assignee_user_id: otherUser.id, force_override: true, force_reason: "test" },
      otherUser.id,
      "tester@local",
      "admin"
    ).assignment;
    const otherHandoff = ctx.repo.getLatestAssignmentHandoffByAssignment(otherAssignment.id);
    ctx.db.prepare("UPDATE content_assignments SET accepted_handoff_snapshot_id=? WHERE id=?").run(otherHandoff.id, assignmentId);
    assert.equal(ctx.repo.getAssignmentById(assignmentId).accepted_binding_status, "invalid_binding");

    ctx.db.prepare("UPDATE content_assignments SET state='assigned', accepted_handoff_snapshot_id=?, accepted_submission_id=? WHERE id=?").run(
      Number(replacementHandoff.lastInsertRowid || 0),
      replacementSubmission.id,
      assignmentId
    );
    assert.equal(ctx.repo.getAssignmentById(assignmentId).accepted_binding_status, "not_accepted");
  } finally {
    ctx.cleanup();
  }
});

test("assignment acceptance failures roll back assignment and workflow state", () => {
  const ctx = createTestContext();
  try {
    const itemA = ctx.createItem("Acceptance Binding A");
    const userA = ctx.createUser("acceptance-binding-a");
    ctx.createReadinessBrief(itemA.id, "acceptance-binding-a");
    ctx.repo.createFieldPack({
      content_item_id: itemA.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignmentA = ctx.repo.createAssignmentFromReadiness(
      itemA.id,
      { assignee_user_id: userA.id, force_override: true, force_reason: "test" },
      userA.id,
      "tester@local",
      "admin"
    ).assignment;
    const assignmentAId = Number(assignmentA.id || 0);
    const handoffA = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentAId);
    const submissionA = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentAId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentAId),
      submitted_by_user_id: userA.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: buildValidAttractionRequestedCheckReturns(),
      },
    });
    void submissionA;
    ctx.repo.updateAssignmentState(assignmentAId, "submitted", "submitter@local", { actor_role: "user", reason_code: "submission_created" });

    const beforeMissingHandoff = captureAssignmentAtomicState(ctx, assignmentAId);
    ctx.db.prepare("DELETE FROM content_assignment_handoff_snapshots WHERE id=?").run(handoffA.id);
    assert.throws(() => ctx.repo.updateAssignmentState(assignmentAId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    }), /handoff snapshot/i);
    assertAssignmentAtomicStateEqual(captureAssignmentAtomicState(ctx, assignmentAId), beforeMissingHandoff);

    ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=NULL WHERE id=?").run(assignmentAId);
    const restoredMissingSubmission = ctx.db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, created_by
      ) VALUES (?, ?, ?, ?, 'ready', 'tester@local')
    `).run(
      assignmentAId,
      itemA.id,
      handoffA.readiness_brief_id == null ? null : Number(handoffA.readiness_brief_id || 0) || null,
      JSON.stringify(handoffA.handoff_package_json)
    );
    assert.equal(Number(restoredMissingSubmission.lastInsertRowid || 0) > 0, true);
    const beforeMissingSubmission = captureAssignmentAtomicState(ctx, assignmentAId);
    assert.throws(() => ctx.repo.updateAssignmentState(assignmentAId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    }), /latest submission|missing latest submission|missing submission/i);
    assertAssignmentAtomicStateEqual(captureAssignmentAtomicState(ctx, assignmentAId), beforeMissingSubmission);

    ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=? WHERE id=?").run(submissionA.id, assignmentAId);

    const itemB = ctx.createItem("Acceptance Binding B");
    const userB = ctx.createUser("acceptance-binding-b");
    ctx.createReadinessBrief(itemB.id, "acceptance-binding-b");
    ctx.repo.createFieldPack({
      content_item_id: itemB.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignmentB = ctx.repo.createAssignmentFromReadiness(
      itemB.id,
      { assignee_user_id: userB.id, force_override: true, force_reason: "test" },
      userB.id,
      "tester@local",
      "admin"
    ).assignment;
    const assignmentBId = Number(assignmentB.id || 0);
    const submissionB = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentBId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentBId),
      submitted_by_user_id: userB.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: buildValidAttractionRequestedCheckReturns(),
      },
    });
    ctx.repo.updateAssignmentState(assignmentBId, "submitted", "submitter@local", { actor_role: "user", reason_code: "submission_created" });

    const handoffB = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentBId);
    const beforeCrossItemHandoff = captureAssignmentAtomicState(ctx, assignmentBId);
    ctx.db.prepare("UPDATE content_assignment_handoff_snapshots SET content_item_id=? WHERE id=?").run(itemA.id, handoffB.id);
    assert.throws(() => ctx.repo.updateAssignmentState(assignmentBId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    }), /belongs to another assignment|content item/i);
    assertAssignmentAtomicStateEqual(captureAssignmentAtomicState(ctx, assignmentBId), beforeCrossItemHandoff);

    ctx.db.prepare("UPDATE content_assignment_handoff_snapshots SET content_item_id=? WHERE id=?").run(itemB.id, handoffB.id);
    ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=? WHERE id=?").run(submissionB.id, assignmentAId);
    const restoredHandoffA = ctx.db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, created_by
      ) VALUES (?, ?, ?, ?, 'ready', 'tester@local')
    `).run(
      assignmentAId,
      itemA.id,
      null,
      JSON.stringify(handoffB.handoff_package_json)
    );
    assert.equal(Number(restoredHandoffA.lastInsertRowid || 0) > 0, true);
    const beforeCrossAssignmentSubmission = captureAssignmentAtomicState(ctx, assignmentAId);
    assert.throws(() => ctx.repo.updateAssignmentState(assignmentAId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    }), /submission belongs to another assignment|content item/i);
    assertAssignmentAtomicStateEqual(captureAssignmentAtomicState(ctx, assignmentAId), beforeCrossAssignmentSubmission);

    const beforeCrossAssignmentHandoff = captureAssignmentAtomicState(ctx, assignmentAId);
    ctx.db.prepare("UPDATE content_assignment_handoff_snapshots SET assignment_id=? WHERE id=?").run(assignmentBId, Number(restoredHandoffA.lastInsertRowid || 0));
    assert.throws(() => ctx.repo.updateAssignmentState(assignmentAId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    }), /another assignment|handoff snapshot/i);
    assertAssignmentAtomicStateEqual(captureAssignmentAtomicState(ctx, assignmentAId), beforeCrossAssignmentHandoff);
  } finally {
    ctx.cleanup();
  }
});

test("assignment acceptance enforces required completeness, allows optional unanswered warnings, and keeps legacy accepted rows readable", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Acceptance Validation Statuses");
    ctx.db.prepare("UPDATE content_items SET category='cafe' WHERE id=?").run(item.id);
    const assignee = ctx.createUser("acceptance-validation-statuses");
    ctx.createReadinessBrief(item.id, "acceptance-validation-statuses");
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      editor_summary: "ready",
      requested_checks_json: { version: 1, groups: [] },
    });
    const assignment = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    ).assignment;
    const assignmentId = Number(assignment.id || 0);
    const handoff = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
    const baseRequestedReturns = buildRequestedReturnsFromHandoff(handoff.handoff_package_json);
    const mutatedSnapshot = {
      ...handoff.handoff_package_json,
      requested_checks: {
        version: 1,
        groups: [
          ...(Array.isArray(handoff.handoff_package_json?.requested_checks?.groups)
            ? handoff.handoff_package_json.requested_checks.groups
            : []),
          {
            group_key: "taxonomy",
            group_label: "Taxonomy",
            checks: [
              {
                key: "waterfront",
                requested: true,
                label: "Waterfront",
                instruction: "Confirm waterfront access",
              answer_type: "boolean_with_conditions",
              activation_mode: "agent_triggered",
              required: false,
              categories: ["cafes"],
              item_types: ["place"],
            },
          ],
        },
      ],
      },
    };
    ctx.db.prepare("UPDATE content_assignment_handoff_snapshots SET handoff_package_json=? WHERE id=?").run(
      JSON.stringify(mutatedSnapshot),
      handoff.id
    );

    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {
          ...baseRequestedReturns,
          "cta_contact.phone": { checked: false, value: "0811111111", evidence: "unchecked" },
          "taxonomy.waterfront": null,
        },
      },
    });
    assert.equal(submission.field_return_payload_json.requested_check_returns["cta_contact.phone"].checked, false);

    insertLegacyAssignmentSubmission(ctx, {
      assignmentId,
      handoffSnapshotId: currentHandoffSnapshotId(ctx, assignmentId),
      submittedByUserId: assignee.id,
      submissionState: "submitted",
      fieldReturnPayloadJson: {
        requested_check_returns: {
          ...baseRequestedReturns,
          "cta_contact.phone": { checked: true, value: "", evidence: "No public phone found" },
          "taxonomy.waterfront": { checked: false, value: null },
        },
      },
    });
    ctx.repo.updateAssignmentState(assignmentId, "submitted", "submitter@local", { actor_role: "user", reason_code: "submission_created" });

    const accepted = ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    });
    assert.equal(Array.isArray(accepted.acceptance_validation?.warnings), true);
    assert.equal(
      accepted.acceptance_validation.warnings.some((entry) => String(entry?.status || "").trim() === "not_found"),
      true
    );
    assert.equal(
      accepted.acceptance_validation.warnings.some((entry) => String(entry?.status || "").trim() === "unanswered"),
      true
    );
    assert.equal(accepted.acceptance_validation.category_context, "cafes");

    ctx.db.prepare(`
      INSERT INTO content_assignments (
        assignment_uid, content_item_id, assignment_kind, assignee_user_id, assigned_by_user_id, state, accepted_at
      ) VALUES ('legacy-unpinned-assignment', ?, 'field', ?, ?, 'accepted', ?)
    `).run(item.id, assignee.id, assignee.id, toBangkokSqlTimestampForTest(new Date("2026-06-22T03:00:00.000Z")));
    const legacyId = Number(ctx.db.prepare("SELECT id FROM content_assignments WHERE assignment_uid='legacy-unpinned-assignment'").get()?.id || 0);
    const legacy = ctx.repo.getAssignmentById(legacyId);
    assert.equal(legacy.accepted_binding_status, "legacy_unpinned");
    assert.equal(legacy.accepted_handoff_snapshot_id, null);
    assert.equal(legacy.accepted_submission_id, null);
  } finally {
    ctx.cleanup();
  }
});

test("assignment acceptance ignores legacy CTA and taxonomy evidence requirements but still blocks malformed rows", () => {
  const ctx = createTestContext();
  try {
    function seedAcceptanceSubmission({
      itemTitle,
      assigneeSlug,
      overrides,
      mutateHandoff,
    }) {
      const item = ctx.createItem(itemTitle);
      ctx.db.prepare("UPDATE content_items SET category='cafe' WHERE id=?").run(item.id);
      const assignee = ctx.createUser(assigneeSlug);
      ctx.createReadinessBrief(item.id, assigneeSlug);
      ctx.repo.createFieldPack({
        content_item_id: item.id,
        status: "ready_for_field",
        editor_summary: "ready",
        requested_checks_json: { version: 1, groups: [] },
      });
      const assignment = ctx.repo.createAssignmentFromReadiness(
        item.id,
        { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
        assignee.id,
        "tester@local",
        "admin"
      ).assignment;
      const assignmentId = Number(assignment.id || 0);
      const handoff = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
      if (typeof mutateHandoff === "function") {
        const nextPackage = JSON.parse(JSON.stringify(handoff.handoff_package_json || {}));
        mutateHandoff(nextPackage);
        ctx.db.prepare("UPDATE content_assignment_handoff_snapshots SET handoff_package_json=? WHERE id=?")
          .run(JSON.stringify(nextPackage), handoff.id);
      }
      const currentHandoff = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
      const requestedCheckReturns = {
        ...buildRequestedReturnsFromHandoff(currentHandoff.handoff_package_json),
        ...overrides,
      };
      ctx.repo.addAssignmentSubmission({
        assignment_id: assignmentId,
        source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
        submitted_by_user_id: assignee.id,
        submission_state: "submitted",
        field_return_payload_json: {
          requested_check_returns: requestedCheckReturns,
        },
      });
      ctx.repo.updateAssignmentState(assignmentId, "submitted", "submitter@local", {
        actor_role: "user",
        reason_code: "submission_created",
      });
      return assignmentId;
    }

    const phoneLegacyEvidenceAssignmentId = seedAcceptanceSubmission({
      itemTitle: "Acceptance Legacy CTA Evidence",
      assigneeSlug: "acceptance-legacy-cta-evidence",
      overrides: {
        "cta_contact.phone": {
          checked: true,
          value: "0804415224",
        },
      },
      mutateHandoff(nextPackage) {
        const ctaGroup = nextPackage?.requested_checks?.groups?.find((group) => group.group_key === "cta_contact");
        const phoneCheck = ctaGroup?.checks?.find((check) => check.key === "phone");
        if (phoneCheck) phoneCheck.evidence_required = true;
      },
    });
    assert.doesNotThrow(() => {
      ctx.repo.updateAssignmentState(phoneLegacyEvidenceAssignmentId, "accepted", "reviewer@local", {
        actor_role: "admin",
        reason_code: "assignment_submission_accepted",
      });
    });

    const falseLegacyEvidenceAssignmentId = seedAcceptanceSubmission({
      itemTitle: "Acceptance Legacy Taxonomy False",
      assigneeSlug: "acceptance-legacy-taxonomy-false",
      overrides: {
        "taxonomy.pet_friendly": {
          checked: true,
          value: false,
        },
      },
      mutateHandoff(nextPackage) {
        const taxonomyGroup = nextPackage?.requested_checks?.groups?.find((group) => group.group_key === "taxonomy");
        const petFriendly = taxonomyGroup?.checks?.find((check) => check.key === "pet_friendly");
        if (petFriendly) petFriendly.evidence_required = true;
      },
    });
    assert.doesNotThrow(() => {
      ctx.repo.updateAssignmentState(falseLegacyEvidenceAssignmentId, "accepted", "reviewer@local", {
        actor_role: "admin",
        reason_code: "assignment_submission_accepted",
      });
    });

    const trueLegacyEvidenceAssignmentId = seedAcceptanceSubmission({
      itemTitle: "Acceptance Legacy Taxonomy True",
      assigneeSlug: "acceptance-legacy-taxonomy-true",
      overrides: {
        "taxonomy.pet_friendly": {
          checked: true,
          value: true,
        },
      },
      mutateHandoff(nextPackage) {
        const taxonomyGroup = nextPackage?.requested_checks?.groups?.find((group) => group.group_key === "taxonomy");
        const petFriendly = taxonomyGroup?.checks?.find((check) => check.key === "pet_friendly");
        if (petFriendly) petFriendly.evidence_required = true;
      },
    });
    assert.doesNotThrow(() => {
      ctx.repo.updateAssignmentState(trueLegacyEvidenceAssignmentId, "accepted", "reviewer@local", {
        actor_role: "admin",
        reason_code: "assignment_submission_accepted",
      });
    });

    const malformedPhoneAssignmentId = seedAcceptanceSubmission({
      itemTitle: "Acceptance Malformed Phone",
      assigneeSlug: "acceptance-malformed-phone",
      overrides: {
        "cta_contact.phone": {
          checked: true,
          value: { number: "0804415224", unit: null },
        },
      },
    });
    assert.throws(() => {
      ctx.repo.updateAssignmentState(malformedPhoneAssignmentId, "accepted", "reviewer@local", {
        actor_role: "admin",
        reason_code: "assignment_submission_accepted",
      });
    }, /cta_contact\.phone is malformed/);

    const malformedBooleanAssignmentId = seedAcceptanceSubmission({
      itemTitle: "Acceptance Malformed Boolean",
      assigneeSlug: "acceptance-malformed-boolean",
      overrides: {
        "taxonomy.pet_friendly": {
          checked: true,
          value: "false",
          evidence: "pet signage",
        },
      },
    });
    assert.throws(() => {
      ctx.repo.updateAssignmentState(malformedBooleanAssignmentId, "accepted", "reviewer@local", {
        actor_role: "admin",
        reason_code: "assignment_submission_accepted",
      });
    }, /taxonomy\.pet_friendly is malformed/);

    const unrelatedEvidenceAssignmentId = seedAcceptanceSubmission({
      itemTitle: "Acceptance Custom Evidence Required",
      assigneeSlug: "acceptance-custom-evidence-required",
      overrides: {
        "custom.proof": {
          checked: true,
          value: "verified",
        },
      },
      mutateHandoff(nextPackage) {
        const groups = Array.isArray(nextPackage?.requested_checks?.groups) ? nextPackage.requested_checks.groups : [];
        groups.push({
          group_key: "custom",
          group_label: "Custom",
          checks: [
            {
              key: "proof",
              requested: true,
              requested_decision: null,
              label: "Proof",
              instruction: "Attach proof",
              answer_type: "text",
              condition_prompt: null,
              evidence_required: true,
              required: true,
              activation_mode: "required",
            },
          ],
        });
      },
    });
    assert.throws(() => {
      ctx.repo.updateAssignmentState(unrelatedEvidenceAssignmentId, "accepted", "reviewer@local", {
        actor_role: "admin",
        reason_code: "assignment_submission_accepted",
      });
    }, /custom\.proof has valid answer but is missing required evidence/);
  } finally {
    ctx.cleanup();
  }
});

test("text-like deliverables update the latest submission row instead of creating duplicate rows on resubmit", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Resubmit Text Deliverable");
    const assignee = ctx.createUser("resubmit-text-deliverable");
    ctx.createReadinessBrief(item.id, "resubmit-text-deliverable");

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignmentId),
      submitted_by_user_id: assignee.id,
      submission_state: "submitted",
    });

    const created = ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignmentId,
      submission_id: submission.id,
      deliverable_type: "raw_notes",
      title: "Round 1 notes",
      text_content: "first note",
      status: "submitted",
    });

    const updated = ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignmentId,
      submission_id: submission.id,
      deliverable_type: "raw_notes",
      title: "Round 2 notes",
      text_content: "second note",
      status: "submitted",
    });

    assert.equal(updated.id, created.id);
    assert.equal(updated.title, "Round 2 notes");
    assert.equal(updated.text_content, "second note");

    const latestRows = ctx.repo
      .listAssignmentSubmissionDeliverablesBySubmission(assignmentId, submission.id)
      .filter((row) => row.deliverable_type === "raw_notes");
    assert.equal(latestRows.length, 1);
    assert.equal(latestRows[0]?.text_content, "second note");
  } finally {
    ctx.cleanup();
  }
});

test("audit logs and workflow transitions store new timestamps in Bangkok local time", () => {
  const ctx = createTestContext();
  try {
    const before = new Date();
    const item = ctx.createItem("Bangkok Timestamp");
    const assignee = ctx.createUser("bangkok-timestamp");
    ctx.createReadinessBrief(item.id, "bangkok-timestamp");

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    ctx.repo.logAudit("tester@local", "assignment.audit.test", "assignment", String(assignmentId), { ok: true }, {
      assignment_id: assignmentId,
    });

    const after = new Date();
    const transitions = ctx.repo.listWorkflowTransitionsByAssignment(assignmentId, 10);
    const audits = ctx.repo.listAuditByTarget("assignment", String(assignmentId), 10, { action: "assignment.audit.test" });

    assert.equal(transitions.length > 0, true);
    assert.equal(audits.length > 0, true);

    const expectedBefore = toBangkokSqlTimestampForTest(before).slice(0, 16);
    const expectedAfter = toBangkokSqlTimestampForTest(after).slice(0, 16);
    assert.equal(
      transitions.some((row) => String(row.created_at || "").startsWith(expectedBefore) || String(row.created_at || "").startsWith(expectedAfter)),
      true
    );
    assert.equal(
      audits.some((row) => String(row.created_at || "").startsWith(expectedBefore) || String(row.created_at || "").startsWith(expectedAfter)),
      true
    );
  } finally {
    ctx.cleanup();
  }
});

test("createAssignmentSubmissionDeliverable rejects text-like deliverables that only carry source_asset_id", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Omicron Place");
    const assignee = ctx.createUser("text-like");
    const linkedAsset = ctx.createContentAsset(item.id, "linked");
    ctx.createReadinessBrief(item.id, "Omicron");

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const submissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state,
        article_payload_json, media_payload_json, contributor_note, reviewer_note, reviewed_at
      ) VALUES (?, ?, ?, 'submitted', NULL, NULL, ?, NULL, NULL)
    `).run(
      assignmentId,
      item.id,
      assignee.id,
      "submission for text-like deliverable test"
    );
    const submissionId = Number(submissionResult.lastInsertRowid || 0);

    assert.throws(() => {
      ctx.repo.createAssignmentSubmissionDeliverable({
        assignment_id: assignmentId,
        submission_id: submissionId,
        content_item_id: item.id,
        deliverable_type: "caption_draft",
        source_asset_id: linkedAsset.asset_id,
      }, "tester@local");
    }, /text-like deliverables require text_content or source_url/);

    const createdPhotoDeliverable = ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignmentId,
      submission_id: submissionId,
      content_item_id: item.id,
      deliverable_type: "photos",
      source_asset_id: linkedAsset.asset_id,
    }, "tester@local");
    assert.equal(createdPhotoDeliverable.deliverable_type, "photos");
    assert.equal(Number(createdPhotoDeliverable.source_asset_id || 0), linkedAsset.asset_id);
  } finally {
    ctx.cleanup();
  }
});

test("createAssignmentSubmissionDeliverable rejects asset-backed deliverables when asset mime_type does not match deliverable_type", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Pi Place");
    const assignee = ctx.createUser("asset-kind");
    const imageAsset = ctx.createContentAsset(item.id, "image", { mime_type: "image/jpeg", extension: "jpg" });
    const videoAsset = ctx.createContentAsset(item.id, "video", { mime_type: "video/mp4", extension: "mp4" });
    ctx.createReadinessBrief(item.id, "Pi");

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const submissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state,
        article_payload_json, media_payload_json, contributor_note, reviewer_note, reviewed_at
      ) VALUES (?, ?, ?, 'submitted', NULL, NULL, ?, NULL, NULL)
    `).run(
      assignmentId,
      item.id,
      assignee.id,
      "submission for asset mime validation test"
    );
    const submissionId = Number(submissionResult.lastInsertRowid || 0);

    assert.throws(() => {
      ctx.repo.createAssignmentSubmissionDeliverable({
        assignment_id: assignmentId,
        submission_id: submissionId,
        content_item_id: item.id,
        deliverable_type: "videos",
        source_asset_id: imageAsset.asset_id,
      }, "tester@local");
    }, /mime_type does not match deliverable_type/);

    assert.throws(() => {
      ctx.repo.createAssignmentSubmissionDeliverable({
        assignment_id: assignmentId,
        submission_id: submissionId,
        content_item_id: item.id,
        deliverable_type: "photos",
        source_asset_id: videoAsset.asset_id,
      }, "tester@local");
    }, /mime_type does not match deliverable_type/);

    const createdVideoDeliverable = ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignmentId,
      submission_id: submissionId,
      content_item_id: item.id,
      deliverable_type: "videos",
      source_asset_id: videoAsset.asset_id,
    }, "tester@local");
    assert.equal(createdVideoDeliverable.deliverable_type, "videos");
    assert.equal(Number(createdVideoDeliverable.source_asset_id || 0), videoAsset.asset_id);
  } finally {
    ctx.cleanup();
  }
});

test("summarizeAssignmentDeliverables counts only fulfilled deliverables for readiness", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Rho Place");
    const assignee = ctx.createUser("fulfilled-status");
    const linkedAsset = ctx.createContentAsset(item.id, "fulfilled");
    ctx.createReadinessBrief(item.id, "Rho");

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const submissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state,
        article_payload_json, media_payload_json, contributor_note, reviewer_note, reviewed_at
      ) VALUES (?, ?, ?, 'submitted', NULL, NULL, ?, NULL, NULL)
    `).run(
      assignmentId,
      item.id,
      assignee.id,
      "submission for readiness status filtering test"
    );
    const submissionId = Number(submissionResult.lastInsertRowid || 0);
    ctx.db.prepare(`
      UPDATE content_assignments
      SET latest_submission_id=?
      WHERE id=?
    `).run(submissionId, assignmentId);

    ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignmentId,
      submission_id: submissionId,
      content_item_id: item.id,
      deliverable_type: "photos",
      source_asset_id: linkedAsset.asset_id,
      status: "draft",
    }, "tester@local");

    let summary = ctx.repo.summarizeAssignmentDeliverables(assignmentId, { expected_deliverables: ["photos"] });
    assert.deepEqual(summary.submitted_deliverable_types, []);
    assert.deepEqual(summary.latest_submission_deliverable_types, []);
    assert.deepEqual(summary.missing_deliverable_types, ["photos"]);
    assert.equal(Number(summary.fulfilled_deliverables_count || 0), 0);

    let readiness = ctx.repo.evaluateAssignmentDeliverablesReadiness(assignmentId, { expected_deliverables: ["photos"] });
    assert.equal(readiness.ready_for_review, false);
    assert.deepEqual(readiness.missing_deliverable_types, ["photos"]);

    let utility = ctx.repo.evaluateAssignmentDeliverablesUtilityReadiness(assignmentId, { expected_deliverables: ["photos"] });
    assert.equal(utility.review_usable, false);
    assert.equal(utility.handoff_usable, false);
    assert.deepEqual(utility.available_deliverable_types, []);
    assert.deepEqual(utility.missing_deliverable_types, ["photos"]);

    ctx.db.prepare(`
      UPDATE content_assignment_submission_deliverables
      SET status='submitted'
      WHERE assignment_id=? AND submission_id=? AND deliverable_type='photos'
    `).run(assignmentId, submissionId);

    summary = ctx.repo.summarizeAssignmentDeliverables(assignmentId, { expected_deliverables: ["photos"] });
    assert.deepEqual(summary.submitted_deliverable_types, ["photos"]);
    assert.deepEqual(summary.latest_submission_deliverable_types, ["photos"]);
    assert.deepEqual(summary.missing_deliverable_types, []);
    assert.equal(Number(summary.fulfilled_deliverables_count || 0), 1);

    readiness = ctx.repo.evaluateAssignmentDeliverablesReadiness(assignmentId, { expected_deliverables: ["photos"] });
    assert.equal(readiness.ready_for_review, true);
    assert.deepEqual(readiness.missing_deliverable_types, []);

    utility = ctx.repo.evaluateAssignmentDeliverablesUtilityReadiness(assignmentId, { expected_deliverables: ["photos"] });
    assert.equal(utility.review_usable, true);
    assert.equal(utility.handoff_usable, true);
    assert.deepEqual(utility.available_deliverable_types, ["photos"]);
    assert.deepEqual(utility.missing_deliverable_types, []);
  } finally {
    ctx.cleanup();
  }
});

test("createAssignmentSubmissionDeliverable rejects stale submission even when it belongs to the same assignment", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Sigma Place");
    const assignee = ctx.createUser("stale-submission");
    const linkedAsset = ctx.createContentAsset(item.id, "stale");
    ctx.createReadinessBrief(item.id, "Sigma");

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);

    const oldSubmissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state,
        article_payload_json, media_payload_json, contributor_note, reviewer_note, reviewed_at
      ) VALUES (?, ?, ?, 'submitted', NULL, NULL, ?, NULL, NULL)
    `).run(
      assignmentId,
      item.id,
      assignee.id,
      "old submission"
    );
    const oldSubmissionId = Number(oldSubmissionResult.lastInsertRowid || 0);

    const latestSubmissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state,
        article_payload_json, media_payload_json, contributor_note, reviewer_note, reviewed_at
      ) VALUES (?, ?, ?, 'submitted', NULL, NULL, ?, NULL, NULL)
    `).run(
      assignmentId,
      item.id,
      assignee.id,
      "latest submission"
    );
    const latestSubmissionId = Number(latestSubmissionResult.lastInsertRowid || 0);
    ctx.db.prepare(`
      UPDATE content_assignments
      SET latest_submission_id=?
      WHERE id=?
    `).run(latestSubmissionId, assignmentId);

    assert.throws(() => {
      ctx.repo.createAssignmentSubmissionDeliverable({
        assignment_id: assignmentId,
        submission_id: oldSubmissionId,
        content_item_id: item.id,
        deliverable_type: "photos",
        source_asset_id: linkedAsset.asset_id,
      }, "tester@local");
    }, /submission is not latest for assignment/);

    const createdDeliverable = ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignmentId,
      submission_id: latestSubmissionId,
      content_item_id: item.id,
      deliverable_type: "photos",
      source_asset_id: linkedAsset.asset_id,
    }, "tester@local");
    assert.equal(Number(createdDeliverable.submission_id || 0), latestSubmissionId);
  } finally {
    ctx.cleanup();
  }
});

test("evaluateContentAssetCleanupEligibility blocks excluded asset referenced by field pack media hints", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Tau Place");
    const linkedAsset = ctx.createContentAsset(item.id, "cleanup-field-pack");
    ctx.repo.setContentAssetSelected(item.id, linkedAsset.asset_id, false);

    ctx.repo.createFieldPack({
      content_item_id: item.id,
      ai_summary: "cleanup test",
      field_pack_media_hints: [
        {
          content_asset_id: linkedAsset.content_asset_id,
          url: "https://example.com/cleanup-field-pack.jpg",
          kind: "reference",
          selected: true,
        },
      ],
    });

    const report = ctx.repo.evaluateContentAssetCleanupEligibility(item.id, { scope: "excluded" });
    assert.equal(report.summary.evaluated_assets, 1);
    assert.equal(report.assets[0]?.cleanup_ready, false);
    assert.ok(report.assets[0]?.blocked_reasons.includes("referenced_in_field_pack_media_hints"));
    assert.equal(Number(report.assets[0]?.reference_counts?.field_pack_media_hints || 0), 1);
  } finally {
    ctx.cleanup();
  }
});

test("evaluateContentAssetCleanupEligibility blocks excluded asset referenced by assignment deliverables", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Upsilon Place");
    const assignee = ctx.createUser("cleanup-assignment");
    const linkedAsset = ctx.createContentAsset(item.id, "cleanup-assignment");
    ctx.repo.setContentAssetSelected(item.id, linkedAsset.asset_id, false);
    ctx.createReadinessBrief(item.id, "Upsilon");

    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "cleanup-test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0);
    const submissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state,
        article_payload_json, media_payload_json, contributor_note, reviewer_note, reviewed_at
      ) VALUES (?, ?, ?, 'submitted', NULL, NULL, ?, NULL, NULL)
    `).run(
      assignmentId,
      item.id,
      assignee.id,
      "submission for cleanup eligibility"
    );
    const submissionId = Number(submissionResult.lastInsertRowid || 0);

    ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignmentId,
      submission_id: submissionId,
      content_item_id: item.id,
      deliverable_type: "photos",
      source_asset_id: linkedAsset.asset_id,
    }, "tester@local");

    const report = ctx.repo.evaluateContentAssetCleanupEligibility(item.id, { scope: "excluded" });
    assert.equal(report.summary.evaluated_assets, 1);
    assert.equal(report.assets[0]?.cleanup_ready, false);
    assert.ok(report.assets[0]?.blocked_reasons.includes("referenced_in_assignment_deliverables"));
    assert.equal(Number(report.assets[0]?.reference_counts?.assignment_deliverables || 0), 1);
  } finally {
    ctx.cleanup();
  }
});

test("evaluateContentAssetCleanupEligibility blocks excluded asset referenced by item image and published output", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Phi Place");
    const linkedAsset = ctx.createContentAsset(item.id, "cleanup-published");
    ctx.repo.setContentAssetSelected(item.id, linkedAsset.asset_id, false);

    const publicUrl = ctx.repo.listContentAssetsByItem(item.id, { onlySelected: false })[0]?.public_url;
    assert.ok(publicUrl);

    ctx.repo.saveItem({ ...item, id: item.id, image_url: publicUrl }, "tester@local");
    ctx.repo.savePublishedArticle({
      content_item_id: item.id,
      draft_id: null,
      review_report_id: null,
      slug: "phi-place",
      title: "Phi Place",
      excerpt: "excerpt",
      body: "body",
      meta_title: "Phi Place",
      meta_description: "desc",
      related: [],
      internal_links: [],
      status: "published",
    });

    const report = ctx.repo.evaluateContentAssetCleanupEligibility(item.id, { scope: "excluded" });
    assert.equal(report.summary.evaluated_assets, 1);
    assert.equal(report.assets[0]?.cleanup_ready, false);
    assert.ok(report.assets[0]?.blocked_reasons.includes("referenced_as_item_image"));
    assert.ok(report.assets[0]?.blocked_reasons.includes("referenced_in_published_output"));
    assert.equal(Number(report.assets[0]?.reference_counts?.item_image || 0), 1);
    assert.equal(Number(report.assets[0]?.reference_counts?.published_output || 0), 1);
  } finally {
    ctx.cleanup();
  }
});

test("saveItem update accepts event and location fields without throwing", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.repo.saveItem({
      type: "event",
      category: "activities",
      lang: "th",
      title: "Songkran Test Event",
      description_raw: "draft description",
      event_period_text: "13-15 April 2026",
      location_text: "Ubon city center",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://example.com/songkran-test",
    }, "tester@local");

    const updated = ctx.repo.saveItem({
      ...item,
      id: item.id,
      description_clean: "cleaned description",
      event_period_text: "13-16 April 2026",
      location_text: "Thung Si Mueang",
    }, "tester@local");

    assert.equal(updated.event_period_text, "13-16 April 2026");
    assert.equal(updated.location_text, "Thung Si Mueang");
    assert.equal(updated.description_clean, "cleaned description");
  } finally {
    ctx.cleanup();
  }
});
