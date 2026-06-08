import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

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
    createContentAsset,
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

test("buildAssignmentHandoffPreview falls back to readiness snapshot when current field pack is still draft", () => {
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

test("resubmitted assignment reuses latest submission row and preserves media when no new media payload is sent", () => {
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
      submitted_by_user_id: assignee.id,
      submission_state: "resubmitted",
      article_payload_json: { summary: "revised submission" },
      contributor_note: "revised text only",
    });

    assert.equal(resubmitted.id, submission.id);
    assert.equal(resubmitted.submission_state, "resubmitted");
    assert.equal(resubmitted.article_payload_json?.summary, "revised submission");
    assert.equal(Array.isArray(resubmitted.media_payload_json?.assets), true);
    assert.equal(resubmitted.media_payload_json.assets.length, 1);
    assert.equal(resubmitted.media_payload_json.assets[0]?.public_url, "/media/uploads/keep-media.jpg");

    const assignmentAfter = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(Number(assignmentAfter.latest_submission_id || 0), submission.id);

    const latestBundle = ctx.repo.getLatestAssignmentDeliverablesBundle(assignmentId);
    assert.equal(Number(latestBundle.latest_submission_id || 0), submission.id);
    assert.equal(Array.isArray(latestBundle.deliverables_by_type?.photos), true);
    assert.equal(latestBundle.deliverables_by_type.photos.length, 1);
  } finally {
    ctx.cleanup();
  }
});

test("resubmitted assignment merges incoming media payload into the existing submission package", () => {
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

    assert.equal(resubmitted.id, submission.id);
    assert.equal(Array.isArray(resubmitted.media_payload_json?.assets), true);
    assert.equal(resubmitted.media_payload_json.assets.length, 2);
    assert.deepEqual(
      resubmitted.media_payload_json.assets.map((asset) => asset.public_url),
      ["/media/uploads/photo-one.jpg", "/media/uploads/video-two.mp4"]
    );
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
