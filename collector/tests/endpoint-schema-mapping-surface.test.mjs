import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAssignmentSubmissionPayload,
  buildFieldPackUpdatePayloadFromAgent,
  mergeConfirmedDraftMetadata,
} from "../server/endpoint-schema-mapping.mjs";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createRepoContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-endpoint-schema-"));
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
    return repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title,
      description_raw: `${title} raw`,
      source_type: "manual",
      source_name: "manual",
      source_url: `https://${title.toLowerCase().replace(/\s+/g, "-")}.example.com`,
    }).item;
  }

  function createUser(handle) {
    const result = db.prepare(`
      INSERT INTO users (email, password_hash, role, display_name)
      VALUES (?, 'hash', 'user', ?)
    `).run(`${handle}@example.com`, handle);
    return { id: Number(result.lastInsertRowid || 0) };
  }

  return { db, repo, cleanup, createItem, createUser };
}

test("agent field-pack mapping forwards AI suggestion fields only and ignores curated fields", () => {
  const payload = buildFieldPackUpdatePayloadFromAgent({
    status: "ready_for_field",
    ai_cta_contact_json: { phone: "0811111111", primary_cta: "phone" },
    ai_taxonomy_json: { category: "attractions", tags: ["museum"] },
    curated_cta_contact_json: { phone: { checked: true, value: "should-not-pass" } },
    curated_taxonomy_json: { category: { checked: true, value: "should-not-pass" } },
    curation_status: "confirmed",
    curated_by_user_id: 99,
    curated_at: "2026-06-11T10:30:00.000Z",
    curation_note: "should-not-pass",
  });

  assert.deepEqual(payload.ai_cta_contact_json, { phone: "0811111111", primary_cta: "phone" });
  assert.deepEqual(payload.ai_taxonomy_json, { category: "attractions", tags: ["museum"] });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "curated_cta_contact_json"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "curated_taxonomy_json"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "curation_status"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "curated_by_user_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "curated_at"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "curation_note"), false);
});

test("regenerate-style update preserves existing curated metadata because agent mapping omits curator-owned fields", () => {
  const ctx = createRepoContext();
  try {
    const item = ctx.createItem("Regenerate Preserve Curated");
    const curator = ctx.createUser("curator-regenerate");
    const original = ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      curated_cta_contact_json: {
        phone: { checked: true, found: true, value: "0822222222", source: ["call"], note: "kept" },
      },
      curated_taxonomy_json: {
        category: { checked: true, found: true, value: "attractions", note: "kept" },
      },
      curation_status: "curated",
      curated_by_user_id: curator.id,
      curated_at: "2026-06-11T10:30:00.000Z",
      curation_note: "human-owned",
    });

    const updated = ctx.repo.updateFieldPack(original.id, {
      ...buildFieldPackUpdatePayloadFromAgent({
        status: "ready_for_field",
        ai_cta_contact_json: { phone: "0811111111", primary_cta: "phone" },
        ai_taxonomy_json: { category: "restaurants", tags: ["late-night"] },
        curated_cta_contact_json: { phone: { checked: true, value: "should-not-overwrite" } },
        curation_status: "not_started",
      }),
      updated_by: "agent@local",
    });

    assert.deepEqual(updated.ai_cta_contact_json, {
      phone: "0811111111",
      line_url: null,
      facebook_url: null,
      website_url: null,
      primary_cta: "phone",
      source: [],
      confidence: "unknown",
      note: null,
    });
    assert.equal(updated.curated_cta_contact_json.phone.value, "0822222222");
    assert.equal(updated.curated_taxonomy_json.category.value, "attractions");
    assert.equal(updated.curation_status, "curated");
    assert.equal(updated.curated_by_user_id, curator.id);
    assert.equal(updated.curated_at, "2026-06-11T10:30:00.000Z");
    assert.equal(updated.curation_note, "human-owned");
  } finally {
    ctx.cleanup();
  }
});

test("assignment submission mapping keeps field_return_payload_json separate from article and media payloads", () => {
  const payload = buildAssignmentSubmissionPayload({
    assignmentId: 12,
    submittedByUserId: 34,
    submissionState: "submitted",
    articlePayloadJson: { title: "Article payload" },
    mediaPayloadJson: { assets: [{ id: 88 }] },
    fieldReturnPayloadJson: { note: "field return", taxonomy_return: { category: { checked: true, value: "attractions" } } },
  });

  assert.deepEqual(payload.article_payload_json, { title: "Article payload" });
  assert.deepEqual(payload.media_payload_json, { assets: [{ id: 88 }] });
  assert.deepEqual(payload.field_return_payload_json, {
    note: "field return",
    taxonomy_return: { category: { checked: true, value: "attractions" } },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload.article_payload_json, "field_return_payload_json"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.media_payload_json, "field_return_payload_json"), false);
});

test("assignment submission repository path still works with and without field_return_payload_json", () => {
  const ctx = createRepoContext();
  try {
    const item = ctx.createItem("Assignment Field Return Mapping");
    const assignee = ctx.createUser("field-return-mapping");
    ctx.db.prepare(`
      INSERT INTO content_readiness_briefs (
        content_item_id, readiness_json, brief_json, reasons_json, blockers_json, missing_requirements_json, computed_by
      ) VALUES (?, ?, ?, '[]', '[]', '[]', 'tester@local')
    `).run(
      item.id,
      JSON.stringify({ ready_for_content: true, ready_for_publish: false, blockers: [], missing_requirements: [] }),
      JSON.stringify({ brief_summary: "ready" })
    );
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      field_pack_checklists: [{ checklist_type: "must_verify_fact", item_text: "verify phone" }],
    });
    const assignment = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    ).assignment;

    const first = ctx.repo.addAssignmentSubmission(buildAssignmentSubmissionPayload({
      assignmentId: assignment.id,
      submittedByUserId: assignee.id,
      submissionState: "submitted",
      articlePayloadJson: { body: "draft body" },
      mediaPayloadJson: null,
      fieldReturnPayloadJson: null,
    }));
    assert.deepEqual(first.field_return_payload_json, {
      checklist_results: [],
      cta_return: {},
      taxonomy_return: {},
      requested_check_returns: {},
      note: null,
    });
    assert.deepEqual(first.article_payload_json, { body: "draft body" });

    ctx.repo.updateAssignmentState(assignment.id, "submitted", "tester@local", { actor_role: "user", reason_code: "test" });
    ctx.repo.updateAssignmentState(assignment.id, "revision_requested", "tester@local", { actor_role: "admin", reason_code: "test" });
    const resubmitted = ctx.repo.addAssignmentSubmission(buildAssignmentSubmissionPayload({
      assignmentId: assignment.id,
      submittedByUserId: assignee.id,
      submissionState: "resubmitted",
      articlePayloadJson: { body: "draft body revised" },
      mediaPayloadJson: null,
      fieldReturnPayloadJson: {
        note: "field return",
        cta_return: { phone: { checked: true, found: false, value: "0811111111" } },
      },
    }));
    assert.equal(resubmitted.article_payload_json.field_return_payload_json, undefined);
    assert.deepEqual(resubmitted.field_return_payload_json.cta_return.phone.value, "0811111111");
  } finally {
    ctx.cleanup();
  }
});

test("confirmed draft metadata merge ignores client payload entirely and always returns stored values", () => {
  const latestDraft = {
    confirmed_cta_contact_json: { phone: "0812345678", primary_cta: "phone" },
    confirmed_taxonomy_json: { category: "attractions", subtype: "museum", tags: ["family"] },
    confirmed_meta_status: "confirmed",
    confirmed_by_user_id: 44,
    confirmed_at: "2026-06-11T10:30:00.000Z",
    confirmed_note: "keep me",
  };

  const preserved = mergeConfirmedDraftMetadata({ draft_title: "new title" }, latestDraft);
  assert.deepEqual(preserved.confirmed_cta_contact_json, latestDraft.confirmed_cta_contact_json);
  assert.deepEqual(preserved.confirmed_taxonomy_json, latestDraft.confirmed_taxonomy_json);
  assert.equal(preserved.confirmed_meta_status, "confirmed");
  assert.equal(preserved.confirmed_note, "keep me");

  // forged client payload must never win over the stored acceptance data (§7A)
  const forged = mergeConfirmedDraftMetadata({
    confirmed_cta_contact_json: { phone: "0899999999", primary_cta: "line" },
    confirmed_taxonomy_json: { category: "restaurants", subtype: "cafe", tags: ["coffee"] },
    confirmed_meta_status: "in_review",
    confirmed_by_user_id: 55,
    confirmed_at: "2026-06-12T09:00:00.000Z",
    confirmed_note: "forged",
  }, latestDraft);
  assert.deepEqual(forged.confirmed_cta_contact_json, latestDraft.confirmed_cta_contact_json);
  assert.deepEqual(forged.confirmed_taxonomy_json, latestDraft.confirmed_taxonomy_json);
  assert.equal(forged.confirmed_meta_status, "confirmed");
  assert.equal(forged.confirmed_by_user_id, 44);
  assert.equal(forged.confirmed_at, "2026-06-11T10:30:00.000Z");
  assert.equal(forged.confirmed_note, "keep me");

  // no stored draft yet — every key stays undefined so saveDraft applies its own defaults
  const empty = mergeConfirmedDraftMetadata({ confirmed_meta_status: "confirmed" }, null);
  assert.equal(empty.confirmed_cta_contact_json, undefined);
  assert.equal(empty.confirmed_taxonomy_json, undefined);
  assert.equal(empty.confirmed_meta_status, undefined);
  assert.equal(empty.confirmed_by_user_id, undefined);
  assert.equal(empty.confirmed_at, undefined);
  assert.equal(empty.confirmed_note, undefined);
});
