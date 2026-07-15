import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { mergeConfirmedDraftMetadata } from "../server/endpoint-schema-mapping.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "AcceptMeta!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-accept-meta-"));
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

  function createItem(title, type = "place", category = "attractions") {
    const created = repo.createItemWithWorkflowHead({
      type,
      category,
      title,
      description_raw: `${title} raw`,
      source_type: "manual",
      source_name: "manual",
      source_url: `https://${title.toLowerCase().replace(/\s+/g, "-")}.example.com`,
    });
    return created.item;
  }

  function createUser(suffix = "accept-meta") {
    const email = `${suffix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role)
      VALUES (?, ?, 'hash', 'user')
    `).run(email, `User ${suffix}`);
    return { id: Number(result.lastInsertRowid || 0), email };
  }

  function createReadinessBrief(itemId, suffix = "A") {
    const result = db.prepare(`
      INSERT INTO content_readiness_briefs (
        content_item_id, readiness_json, brief_json, reasons_json, blockers_json, missing_requirements_json, computed_by
      ) VALUES (?, ?, ?, '[]', '[]', '[]', 'tester@local')
    `).run(
      itemId,
      JSON.stringify({ ready_for_content: true, ready_for_publish: false, blockers: [], missing_requirements: [], label: `Readiness ${suffix}` }),
      JSON.stringify({ brief_summary: `Readiness brief ${suffix}` })
    );
    return Number(result.lastInsertRowid || 0);
  }

  function createFieldAssignment(itemId, assigneeId, payload = {}) {
    const assignmentResult = repo.createAssignmentFromReadiness(
      itemId,
      { assignee_user_id: assigneeId, force_override: true, force_reason: "test", ...payload },
      assigneeId,
      "tester@local",
      "admin"
    );
    return Number(assignmentResult.assignment.id || 0);
  }

  function submitWithReturns(assignmentId, assigneeId, requestedCheckReturns, submissionState = "submitted") {
    const submission = repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      submitted_by_user_id: assigneeId,
      submission_state: submissionState,
      field_return_payload_json: { requested_check_returns: requestedCheckReturns },
    });
    repo.updateAssignmentState(assignmentId, submissionState, "submitter@local", {
      actor_role: "user",
      reason_code: "submission_created",
    });
    return submission;
  }

  function draftCount(itemId) {
    return Number(db.prepare("SELECT COUNT(*) AS n FROM content_drafts WHERE content_item_id=?").get(itemId)?.n || 0);
  }

  return { db, repo, cleanup, createItem, createUser, createReadinessBrief, createFieldAssignment, submitWithReturns, draftCount };
}

test("accept maps checked CTA returns, stamps category/status, and records both accepted provenance pointers", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept CTA Mapping");
    const assignee = ctx.createUser("cta-map");
    const reviewer = ctx.createUser("cta-map-reviewer");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.repo.saveDraft(item.id, `run-${item.id}-base`, {
      draft_title: "Existing draft",
      excerpt: "Excerpt",
      body: "Body",
      status: "generated",
    });

    const submission = ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
      "cta_contact.line_url": { checked: true, value: "https://line.me/R/ti/p/@ubontest" },
      "cta_contact.website_url": { checked: false },
    });

    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", {
      actor_role: "admin",
      reason_code: "accepted",
      actor_user_id: reviewer.id,
    });

    const assignment = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(Number(assignment.accepted_submission_id || 0), submission.id);
    assert.ok(Number(assignment.accepted_handoff_snapshot_id || 0) > 0);

    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(draft.confirmed_cta_contact_json.phone, "0812345678");
    assert.equal(draft.confirmed_cta_contact_json.line_url, "https://line.me/R/ti/p/@ubontest");
    assert.equal(draft.confirmed_cta_contact_json.website_url, null);
    assert.equal(draft.confirmed_cta_contact_json.facebook_url, null);
    assert.equal(draft.confirmed_taxonomy_json.category, "attractions");
    assert.equal(draft.confirmed_meta_status, "confirmed");
    assert.equal(Number(draft.confirmed_by_user_id || 0), reviewer.id);
    assert.ok(draft.confirmed_at);
    assert.match(String(draft.confirmed_note || ""), new RegExp(`assignment #${assignmentId} .* submission #${submission.id}`));
  } finally {
    ctx.cleanup();
  }
});

test("checked-but-not-found and unchecked CTA returns both persist as null", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept CTA Not Found");
    const assignee = ctx.createUser("cta-notfound");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);

    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: null },
      "cta_contact.facebook_url": { checked: false, value: "https://facebook.com/should-be-ignored" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(draft.confirmed_cta_contact_json.phone, null);
    assert.equal(draft.confirmed_cta_contact_json.facebook_url, null);
    assert.equal(draft.confirmed_meta_status, "confirmed");
  } finally {
    ctx.cleanup();
  }
});

test("non-place item maps no CTA returns and does not confirm unverified draft CTA values", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Event Item", "event", "events");
    const assignee = ctx.createUser("event-accept");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.repo.saveDraft(item.id, `run-${item.id}-base`, {
      draft_title: "Event draft",
      confirmed_cta_contact_json: { phone: "0999999999" },
      status: "generated",
    });

    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(draft.confirmed_cta_contact_json.phone, null, "CTA returns are not mapped for non-place items");
    assert.equal(draft.confirmed_taxonomy_json.category, "events");
    assert.equal(draft.confirmed_meta_status, "confirmed");
  } finally {
    ctx.cleanup();
  }
});

test("a draft value that never passed an accepted round is not laundered into confirmed metadata", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Legacy Draft");
    const assignee = ctx.createUser("legacy-draft");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    // a writer self-set these in the old editable Article Workspace, before §7A closed that path
    ctx.repo.saveDraft(item.id, `run-${item.id}-legacy`, {
      draft_title: "Legacy draft",
      confirmed_cta_contact_json: {
        phone: "0999999999",
        website_url: "https://writer-typed.example.com",
      },
      confirmed_taxonomy_json: { category: "attractions", subtype: "writer-subtype", tags: ["writer-tag"] },
      confirmed_meta_status: "confirmed",
      status: "generated",
    });

    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.line_url": { checked: true, value: "https://line.me/R/ti/p/@verified" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(draft.confirmed_cta_contact_json.line_url, "https://line.me/R/ti/p/@verified", "the ticked check is confirmed");
    assert.equal(draft.confirmed_cta_contact_json.phone, null, "an unticked writer-typed phone is not confirmed");
    assert.equal(draft.confirmed_cta_contact_json.website_url, null, "an unticked writer-typed website is not confirmed");
    assert.equal(draft.confirmed_taxonomy_json.subtype, null, "writer-typed taxonomy is not confirmed either");
    assert.deepEqual(draft.confirmed_taxonomy_json.tags, []);
    assert.equal(draft.confirmed_taxonomy_json.category, "attractions", "category still comes from the Clean-owned item");
  } finally {
    ctx.cleanup();
  }
});

test("an accepted editorial assignment does not open the door for unverified draft CTA/taxonomy on the item's first field round", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Editorial Then Field");
    const assignee = ctx.createUser("editorial-then-field");
    // a writer self-set these in the old editable Article Workspace, before §7A closed that path
    ctx.repo.saveDraft(item.id, `run-${item.id}-legacy`, {
      draft_title: "Legacy draft",
      confirmed_cta_contact_json: { phone: "0999999999", website_url: "https://writer-typed.example.com" },
      confirmed_taxonomy_json: { category: "attractions", subtype: "writer-subtype", tags: ["writer-tag"] },
      confirmed_meta_status: "confirmed",
      status: "generated",
    });

    // an unrelated editorial assignment gets accepted first; it must not count as a "previous accepted round"
    // for the purposes of the CTA/taxonomy patch baseline, which only ever applies to field rounds
    const editorialAssignment = ctx.repo.createAssignment({
      content_item_id: item.id,
      assignee_user_id: assignee.id,
      assignment_kind: "editorial",
      state: "assigned",
    }, assignee.id, { actor_email: "tester@local", actor_role: "admin", reason_code: "test" });
    ctx.submitWithReturns(Number(editorialAssignment.id), assignee.id, {});
    ctx.repo.updateAssignmentState(Number(editorialAssignment.id), "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    ctx.createReadinessBrief(item.id);
    const fieldAssignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(fieldAssignmentId, assignee.id, {
      "cta_contact.line_url": { checked: true, value: "https://line.me/R/ti/p/@verified" },
    });
    ctx.repo.updateAssignmentState(fieldAssignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(draft.confirmed_cta_contact_json.line_url, "https://line.me/R/ti/p/@verified", "the ticked check is confirmed");
    assert.equal(draft.confirmed_cta_contact_json.phone, null, "an unticked writer-typed phone is not confirmed by an editorial accept");
    assert.equal(draft.confirmed_cta_contact_json.website_url, null, "an unticked writer-typed website is not confirmed by an editorial accept");
    assert.equal(draft.confirmed_taxonomy_json.subtype, null, "writer-typed taxonomy is not confirmed by an editorial accept either");
    assert.deepEqual(draft.confirmed_taxonomy_json.tags, []);
  } finally {
    ctx.cleanup();
  }
});

test("re-accepting the same assignment after a revision keeps values its earlier accepted round confirmed", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Revision Keep");
    const assignee = ctx.createUser("revision-keep");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0810000001" },
      "cta_contact.website_url": { checked: true, value: "https://round-one.example.com" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    ctx.repo.updateAssignmentState(assignmentId, "revision_requested", "reviewer@local", { actor_role: "admin", reason_code: "needs_revision" });
    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0820000002" },
      "cta_contact.website_url": { checked: false },
    }, "resubmitted");
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const confirmed = ctx.repo.latestDraftByItem(item.id).confirmed_cta_contact_json;
    assert.equal(confirmed.phone, "0820000002");
    assert.equal(confirmed.website_url, "https://round-one.example.com", "confirmed by this assignment's earlier accept");
  } finally {
    ctx.cleanup();
  }
});

test("accept without a draft creates deterministic accepted-meta row; re-accept after revision overwrites the same row and updates provenance", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept No Draft");
    const assignee = ctx.createUser("nodraft");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);

    const firstSubmission = ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0810000001" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    assert.equal(ctx.draftCount(item.id), 1);
    const firstDraft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(firstDraft.generation_run_uid, `accepted-meta-${assignmentId}`);
    assert.equal(firstDraft.confirmed_cta_contact_json.phone, "0810000001");
    assert.equal(Number(ctx.repo.getAssignmentById(assignmentId).accepted_submission_id || 0), firstSubmission.id);

    ctx.repo.updateAssignmentState(assignmentId, "revision_requested", "reviewer@local", { actor_role: "admin", reason_code: "needs_revision" });
    const secondSubmission = ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0810000002" },
    }, "resubmitted");
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    assert.equal(ctx.draftCount(item.id), 1);
    const secondDraft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(secondDraft.generation_run_uid, `accepted-meta-${assignmentId}`);
    assert.equal(secondDraft.confirmed_cta_contact_json.phone, "0810000002");
    assert.equal(Number(ctx.repo.getAssignmentById(assignmentId).accepted_submission_id || 0), secondSubmission.id);
  } finally {
    ctx.cleanup();
  }
});

test("unchecked CTA returns keep the previously confirmed value instead of wiping it", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Patch Semantics");
    const assignee = ctx.createUser("patch-semantics");
    ctx.createReadinessBrief(item.id);
    const firstAssignment = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(firstAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0810000001" },
      "cta_contact.website_url": { checked: true, value: "https://round-one.example.com" },
      "cta_contact.line_url": { checked: true, value: "https://line.me/R/ti/p/@roundone" },
    });
    ctx.repo.updateAssignmentState(firstAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    // rework round: only the phone is re-verified; line_url is explicitly verified as not found
    const rework = ctx.repo.returnFieldAssignmentForRework(firstAssignment, "reviewer@local", {
      note: "เบอร์โทรเปลี่ยน",
      actor_role: "admin",
    });
    const secondAssignment = Number(rework.assignment.id || 0);
    ctx.submitWithReturns(secondAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0820000002" },
      "cta_contact.line_url": { checked: true, value: null },
      "cta_contact.website_url": { checked: false },
    });
    ctx.repo.updateAssignmentState(secondAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const confirmed = ctx.repo.latestDraftByItem(item.id).confirmed_cta_contact_json;
    assert.equal(confirmed.phone, "0820000002", "re-verified value is overwritten");
    assert.equal(confirmed.line_url, null, "checked + not found clears the value");
    assert.equal(confirmed.website_url, "https://round-one.example.com", "unchecked keeps the previously confirmed value");
  } finally {
    ctx.cleanup();
  }
});

test("accept maps checked taxonomy returns into confirmed_taxonomy_json.checks as a curation signal", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Taxonomy Mapping", "place", "cafes");
    const assignee = ctx.createUser("tax-map");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);

    ctx.submitWithReturns(assignmentId, assignee.id, {
      // §7A: a yes/no check's tick IS the answer, so `found` is recomputed server-side from
      // answer_type + checked, not trusted off the wire — an explicit answer_type is required here
      // for a ticked-but-empty-qualifier boolean row to recompute as found (see normalizeRequestedCheckReturnEntry).
      "taxonomy.parking": { checked: true, answer_type: "boolean", value: "" },
      "taxonomy.price_level": { checked: true, value: "budget" },
      "taxonomy.wifi_available": { checked: true, found: false },
      "taxonomy.pet_friendly": { checked: false },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const checks = ctx.repo.latestDraftByItem(item.id).confirmed_taxonomy_json.checks;
    assert.equal(checks.parking, true, "checked + found with no qualifier collapses to a plain true signal");
    assert.equal(checks.price_level, "budget", "checked + found with a value keeps the value");
    assert.equal(checks.wifi_available, false, "checked + not found is confirmed absent");
    assert.equal(Object.hasOwn(checks, "pet_friendly"), false, "unchecked with nothing confirmed before stays unset");
  } finally {
    ctx.cleanup();
  }
});

test("unchecked taxonomy returns keep the previously confirmed check instead of wiping it", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Taxonomy Patch Semantics", "place", "cafes");
    const assignee = ctx.createUser("tax-patch");
    ctx.createReadinessBrief(item.id);
    const firstAssignment = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(firstAssignment, assignee.id, {
      "taxonomy.parking": { checked: true, answer_type: "boolean", value: "" },
      "taxonomy.wifi_available": { checked: true, answer_type: "boolean", value: "" },
    });
    ctx.repo.updateAssignmentState(firstAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    // rework round: only wifi is re-verified (now absent); parking is not touched this round
    const rework = ctx.repo.returnFieldAssignmentForRework(firstAssignment, "reviewer@local", { note: "ตรวจใหม่", actor_role: "admin" });
    const secondAssignment = Number(rework.assignment.id || 0);
    ctx.submitWithReturns(secondAssignment, assignee.id, {
      "taxonomy.wifi_available": { checked: true, found: false },
      "taxonomy.parking": { checked: false },
    });
    ctx.repo.updateAssignmentState(secondAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const checks = ctx.repo.latestDraftByItem(item.id).confirmed_taxonomy_json.checks;
    assert.equal(checks.wifi_available, false, "re-verified as absent overwrites the earlier confirmed true");
    assert.equal(checks.parking, true, "unchecked keeps the previously confirmed value");
  } finally {
    ctx.cleanup();
  }
});

test("a suggestion that contradicts a confirmed value is dropped from the next round's handoff", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Suggestion Versus Confirmed");
    const assignee = ctx.createUser("suggest-vs-confirmed");
    ctx.createReadinessBrief(item.id);
    // A stale AI suggestion sits on the field pack: the Work Return form prefills suggested_value into
    // the worker's input, so if it survived it would be one tick away from overwriting the confirmed answer.
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      // the handoff is only built from the field pack once it is ready for the field
      status: "ready_for_field",
      ai_summary: "Field pack with a CTA suggestion",
      requested_checks_json: {
        version: 1,
        groups: [{
          group_key: "cta_contact",
          group_label: "CTA/ติดต่อ",
          checks: [
            { key: "phone", requested: true, label: "เบอร์โทร", answer_type: "phone", suggested_value: "0899999999" },
            { key: "line_url", requested: true, label: "ลิงก์ LINE", answer_type: "url", suggested_value: "https://line.me/ti/p/keep" },
          ],
        }],
      },
    });

    const firstAssignment = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(firstAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0810000001" },
    });
    ctx.repo.updateAssignmentState(firstAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });
    assert.equal(ctx.repo.latestDraftByItem(item.id).confirmed_cta_contact_json.phone, "0810000001");

    const rework = ctx.repo.returnFieldAssignmentForRework(firstAssignment, "reviewer@local", { note: "แก้เบอร์", actor_role: "admin" });
    const checks = rework.handoff.handoff_package_json.requested_checks.groups
      .find((group) => group.group_key === "cta_contact").checks;

    const phone = checks.find((check) => check.key === "phone");
    assert.equal(phone.suggested_value, null, "the suggestion contradicts what a human confirmed, so it is dropped");
    assert.equal(phone.source, null);
    assert.equal(phone.previous_confirmed_value, "0810000001", "the confirmed answer stays as read-only reference");

    // A check nobody confirmed keeps its suggestion: the point of a suggestion is to save the worker typing.
    const lineUrl = checks.find((check) => check.key === "line_url");
    assert.equal(lineUrl.suggested_value, "https://line.me/ti/p/keep");
  } finally {
    ctx.cleanup();
  }
});

test("a suggestion is dropped even when the confirmed answer was 'verified: none' (not just a different value)", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Suggestion Versus Confirmed Absent");
    const assignee = ctx.createUser("suggest-vs-absent");
    ctx.createReadinessBrief(item.id);
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      ai_summary: "Field pack with a stale phone suggestion",
      requested_checks_json: {
        version: 1,
        groups: [{
          group_key: "cta_contact",
          group_label: "CTA/ติดต่อ",
          checks: [
            { key: "phone", requested: true, label: "เบอร์โทร", answer_type: "phone", suggested_value: "0899999999" },
          ],
        }],
      },
    });

    const firstAssignment = ctx.createFieldAssignment(item.id, assignee.id);
    // checked + no value: the worker verified there is no phone, not that they skipped the question.
    ctx.submitWithReturns(firstAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: null },
    });
    ctx.repo.updateAssignmentState(firstAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });
    assert.equal(ctx.repo.latestDraftByItem(item.id).confirmed_cta_contact_json.phone, null);

    const rework = ctx.repo.returnFieldAssignmentForRework(firstAssignment, "reviewer@local", { note: "double-check", actor_role: "admin" });
    const phone = rework.handoff.handoff_package_json.requested_checks.groups
      .find((group) => group.group_key === "cta_contact").checks
      .find((check) => check.key === "phone");
    assert.equal(phone.suggested_value, null, "a human already verified there is no phone; the stale suggestion must not survive");
    assert.equal(phone.source, null);
  } finally {
    ctx.cleanup();
  }
});

test("returnFieldAssignmentForRework closes the accepted round and issues a new field round with its own handoff", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Rework Round");
    const assignee = ctx.createUser("rework");
    ctx.createReadinessBrief(item.id);
    const firstAssignment = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(firstAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0810000001" },
    });
    ctx.repo.updateAssignmentState(firstAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });
    const firstHandoffId = Number(ctx.repo.getAssignmentById(firstAssignment).accepted_handoff_snapshot_id || 0);

    const result = ctx.repo.returnFieldAssignmentForRework(firstAssignment, "reviewer@local", {
      note: "ต้องเก็บข้อมูลเพิ่ม",
      actor_role: "admin",
    });

    const closed = ctx.repo.getAssignmentById(firstAssignment);
    assert.equal(closed.state, "closed");
    // the finished round keeps its provenance untouched
    assert.equal(Number(closed.accepted_handoff_snapshot_id || 0), firstHandoffId);

    const created = ctx.repo.getAssignmentById(Number(result.assignment.id || 0));
    assert.equal(created.assignment_kind, "field");
    assert.equal(created.state, "assigned");
    assert.equal(Number(created.assignee_user_id || 0), assignee.id);
    assert.ok(Number(result.handoff?.id || 0) > 0);
    assert.notEqual(Number(result.handoff.id), firstHandoffId, "the new round gets its own handoff snapshot");

    // confirmed values survive until the new round is accepted
    assert.equal(ctx.repo.latestDraftByItem(item.id).confirmed_cta_contact_json.phone, "0810000001");
  } finally {
    ctx.cleanup();
  }
});

test("returnFieldAssignmentForRework refuses assignments that are not an accepted field round", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Rework Guard");
    const assignee = ctx.createUser("rework-guard");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(assignmentId, assignee.id, { "cta_contact.phone": { checked: true, value: "0810000001" } });

    assert.throws(
      () => ctx.repo.returnFieldAssignmentForRework(assignmentId, "reviewer@local", { note: "ยังไม่รับงาน", actor_role: "admin" }),
      /must be accepted/
    );
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });
    assert.throws(
      () => ctx.repo.returnFieldAssignmentForRework(assignmentId, "reviewer@local", { note: "", actor_role: "admin" }),
      /note is required/
    );
    assert.equal(ctx.repo.getAssignmentById(assignmentId).state, "accepted", "a rejected rework leaves the round untouched");
  } finally {
    ctx.cleanup();
  }
});

test("field return evidence keeps only the newest round per check key", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Evidence Rounds");
    const assignee = ctx.createUser("evidence-rounds");
    ctx.createReadinessBrief(item.id);
    const firstAssignment = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(firstAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0810000001" },
    });
    ctx.repo.updateAssignmentState(firstAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const rework = ctx.repo.returnFieldAssignmentForRework(firstAssignment, "reviewer@local", { note: "แก้เบอร์", actor_role: "admin" });
    const secondAssignment = Number(rework.assignment.id || 0);
    ctx.submitWithReturns(secondAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0820000002" },
    });
    ctx.repo.updateAssignmentState(secondAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const rows = ctx.repo.buildFieldReturnEvidenceByItem(item.id).items.filter((row) => row.key === "cta_contact.phone");
    assert.equal(rows.length, 1, "the superseded round must not shadow the current one");
    assert.equal(rows[0].value, "0820000002");
    assert.equal(Number(rows[0].assignment_id), secondAssignment);
  } finally {
    ctx.cleanup();
  }
});

test("an unaccepted rework submission never shadows the accepted round it supersedes", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Evidence Pending Round");
    const assignee = ctx.createUser("evidence-pending");
    ctx.createReadinessBrief(item.id);
    const firstAssignment = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(firstAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0810000001" },
    });
    ctx.repo.updateAssignmentState(firstAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const rework = ctx.repo.returnFieldAssignmentForRework(firstAssignment, "reviewer@local", { note: "แก้เบอร์", actor_role: "admin" });
    const secondAssignment = Number(rework.assignment.id || 0);
    // submitted but NOT yet accepted: the accepted round is still the authoritative answer
    ctx.submitWithReturns(secondAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0820000002" },
    });

    const rows = ctx.repo.buildFieldReturnEvidenceByItem(item.id).items.filter((row) => row.key === "cta_contact.phone");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].submission_source, "accepted");
    assert.equal(rows[0].value, "0810000001");
    assert.equal(Number(rows[0].assignment_id), firstAssignment);
  } finally {
    ctx.cleanup();
  }
});

test("opening a rework round resets the workflow model assignment state to the new round", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Rework Workflow State");
    const assignee = ctx.createUser("rework-workflow");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(assignmentId, assignee.id, { "cta_contact.phone": { checked: true, value: "0810000001" } });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });
    assert.equal(ctx.repo.ensureWorkflowModel(item.id).assignment_state, "accepted");

    ctx.repo.returnFieldAssignmentForRework(assignmentId, "reviewer@local", { note: "เก็บข้อมูลเพิ่ม", actor_role: "admin" });

    assert.equal(ctx.repo.ensureWorkflowModel(item.id).assignment_state, "assigned");
  } finally {
    ctx.cleanup();
  }
});

test("an item cannot carry two open field rounds; the rework flow is the only way to supersede one", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("One Open Round");
    const assignee = ctx.createUser("one-open-round");
    ctx.createReadinessBrief(item.id);
    const firstAssignment = ctx.createFieldAssignment(item.id, assignee.id);

    assert.throws(() => ctx.createFieldAssignment(item.id, assignee.id), /open field round already exists/);

    ctx.submitWithReturns(firstAssignment, assignee.id, { "cta_contact.phone": { checked: true, value: "0810000001" } });
    ctx.repo.updateAssignmentState(firstAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });
    // still blocked while the accepted round is open
    assert.throws(() => ctx.createFieldAssignment(item.id, assignee.id), /open field round already exists/);

    // the rework flow closes the accepted round first, so it is allowed
    const rework = ctx.repo.returnFieldAssignmentForRework(firstAssignment, "reviewer@local", { note: "รอบใหม่", actor_role: "admin" });
    assert.ok(Number(rework.assignment.id || 0) > 0);
    assert.equal(ctx.repo.getAssignmentById(firstAssignment).state, "closed");
  } finally {
    ctx.cleanup();
  }
});

test("accept while already accepted is a no-op and does not rewrite confirmed metadata", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Idempotent");
    const assignee = ctx.createUser("idempotent");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0810000001" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });
    const before = ctx.repo.latestDraftByItem(item.id);

    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });
    const after = ctx.repo.latestDraftByItem(item.id);
    assert.deepEqual(after.confirmed_cta_contact_json, before.confirmed_cta_contact_json);
    assert.equal(after.confirmed_at, before.confirmed_at);
    assert.equal(after.confirmed_note, before.confirmed_note);
  } finally {
    ctx.cleanup();
  }
});

test("editorial-kind acceptance records provenance pointers but performs no confirmed mapping", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Editorial");
    const assignee = ctx.createUser("editorial");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id, { assignment_kind: "editorial" });
    const assignmentBefore = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(assignmentBefore.assignment_kind, "editorial");

    const submission = ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const assignment = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(Number(assignment.accepted_submission_id || 0), submission.id);
    assert.equal(ctx.draftCount(item.id), 0);
  } finally {
    ctx.cleanup();
  }
});

test("editorial assignment created without a handoff snapshot can still be accepted", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Editorial No Handoff");
    const assignee = ctx.createUser("editorial-no-handoff");
    const assignment = ctx.repo.createAssignment({
      content_item_id: item.id,
      assignee_user_id: assignee.id,
      assignment_kind: "editorial",
      state: "assigned",
    }, assignee.id, { actor_email: "tester@local", actor_role: "admin", reason_code: "test" });
    const assignmentId = Number(assignment.id || 0);
    assert.equal(
      Number(ctx.db.prepare("SELECT COUNT(*) AS n FROM content_assignment_handoff_snapshots WHERE assignment_id=?").get(assignmentId)?.n || 0),
      0
    );

    const submission = ctx.submitWithReturns(assignmentId, assignee.id, {});
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const accepted = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(accepted.state, "accepted");
    assert.equal(Number(accepted.accepted_submission_id || 0), submission.id);
    assert.equal(accepted.accepted_handoff_snapshot_id, null);
    assert.equal(ctx.draftCount(item.id), 0);
  } finally {
    ctx.cleanup();
  }
});

test("accepted CTA answers that fail confirmed-field validation persist as null instead of blocking acceptance", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Free Text CTA");
    const assignee = ctx.createUser("free-text-cta");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);

    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
      "cta_contact.line_url": { checked: true, value: "@ubonshop" },
      "cta_contact.primary_cta": { checked: true, value: "messenger" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    assert.equal(ctx.repo.getAssignmentById(assignmentId).state, "accepted");
    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(draft.confirmed_cta_contact_json.phone, "0812345678");
    assert.equal(draft.confirmed_cta_contact_json.line_url, null);
    assert.equal(draft.confirmed_cta_contact_json.primary_cta, null);
    assert.equal(draft.confirmed_meta_status, "confirmed");

    // the raw answer stays readable in the accepted submission's returns
    const evidence = ctx.repo.buildFieldReturnEvidenceByItem(item.id);
    const lineRow = evidence.items.find((row) => row.key === "cta_contact.line_url");
    assert.equal(lineRow.value, "@ubonshop");
    assert.equal(lineRow.submission_source, "accepted");
  } finally {
    ctx.cleanup();
  }
});

test("accept without a draft names the synthetic confirmed row after the item, not 'Untitled draft'", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Synthetic Title");
    const assignee = ctx.createUser("synthetic-title");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(draft.draft_title, "Accept Synthetic Title");
    assert.equal(draft.status, "draft");
  } finally {
    ctx.cleanup();
  }
});

test("existing draft content fields survive the accept-time confirmed upsert", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Keep Content");
    const assignee = ctx.createUser("keep-content");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.repo.saveDraft(item.id, `run-${item.id}-content`, {
      draft_title: "Original title",
      excerpt: "Original excerpt",
      body: "Original body",
      meta_title: "Original meta title",
      meta_description: "Original meta description",
      suggested_related: [{ slug: "related-a" }],
      ai_quality_score: 87,
      status: "generated",
    });

    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    assert.equal(ctx.draftCount(item.id), 1);
    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(draft.draft_title, "Original title");
    assert.equal(draft.excerpt, "Original excerpt");
    assert.equal(draft.body, "Original body");
    assert.equal(draft.meta_title, "Original meta title");
    assert.equal(draft.meta_description, "Original meta description");
    assert.deepEqual(draft.suggested_related, [{ slug: "related-a" }]);
    assert.equal(Number(draft.ai_quality_score || 0), 87);
    assert.equal(draft.confirmed_cta_contact_json.phone, "0812345678");
  } finally {
    ctx.cleanup();
  }
});

test("regenerated draft carries accepted confirmed metadata forward via mergeConfirmedDraftMetadata", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Carry Forward");
    const assignee = ctx.createUser("carry-forward");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    // mirror the workflow.mjs AI-draft save path: new run uid + confirmed carry-forward spread
    ctx.repo.saveDraft(item.id, `run-${item.id}-regen`, {
      draft_title: "Regenerated title",
      excerpt: "Regenerated excerpt",
      body: "Regenerated body",
      status: "generated",
      ...mergeConfirmedDraftMetadata({}, ctx.repo.latestDraftByItem(item.id)),
    });

    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(draft.generation_run_uid, `run-${item.id}-regen`);
    assert.equal(draft.draft_title, "Regenerated title");
    assert.equal(draft.confirmed_cta_contact_json.phone, "0812345678");
    assert.equal(draft.confirmed_meta_status, "confirmed");
  } finally {
    ctx.cleanup();
  }
});

test("acceptance is atomic: a failure while persisting confirmed metadata rolls back the state transition", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Atomic Rollback");
    const assignee = ctx.createUser("atomic");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.repo.saveDraft(item.id, `run-${item.id}-base`, {
      draft_title: "Draft before failure",
      status: "generated",
    });
    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });

    ctx.db.exec(`
      CREATE TRIGGER force_draft_update_failure BEFORE UPDATE ON content_drafts
      BEGIN
        SELECT RAISE(ABORT, 'forced draft failure');
      END;
    `);
    assert.throws(() => {
      ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });
    }, /forced draft failure/);
    ctx.db.exec("DROP TRIGGER force_draft_update_failure;");

    const assignment = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(assignment.state, "submitted");
    assert.equal(assignment.accepted_at, null);
    assert.equal(assignment.accepted_submission_id, null);
    assert.equal(assignment.accepted_handoff_snapshot_id, null);
    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.equal(draft.confirmed_meta_status, "not_started");

    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });
    assert.equal(ctx.repo.getAssignmentById(assignmentId).state, "accepted");
    assert.equal(ctx.repo.latestDraftByItem(item.id).confirmed_meta_status, "confirmed");
  } finally {
    ctx.cleanup();
  }
});

test("accept fails and rolls back when the submission has no matching handoff", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Missing Handoff");
    const assignee = ctx.createUser("missing-handoff");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });
    ctx.db.prepare("DELETE FROM content_assignment_handoff_snapshots WHERE assignment_id=?").run(assignmentId);

    assert.throws(
      () => ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" }),
      /no matching handoff snapshot/
    );
    const assignment = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(assignment.state, "submitted");
    assert.equal(assignment.accepted_at, null);
    assert.equal(assignment.accepted_submission_id, null);
    assert.equal(assignment.accepted_handoff_snapshot_id, null);
  } finally {
    ctx.cleanup();
  }
});

test("accept fails and rolls back when the handoff belongs to another content item", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Wrong Handoff");
    const otherItem = ctx.createItem("Other Handoff Item");
    const assignee = ctx.createUser("wrong-handoff");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });
    ctx.db.prepare("UPDATE content_assignment_handoff_snapshots SET content_item_id=? WHERE assignment_id=?").run(otherItem.id, assignmentId);

    assert.throws(
      () => ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" }),
      /no matching handoff snapshot/
    );
    const assignment = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(assignment.state, "submitted");
    assert.equal(assignment.accepted_at, null);
    assert.equal(assignment.accepted_submission_id, null);
    assert.equal(assignment.accepted_handoff_snapshot_id, null);
  } finally {
    ctx.cleanup();
  }
});
test("a handoff snapshot backfilled after the Work Return still allows acceptance", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Repaired Handoff");
    const assignee = ctx.createUser("repaired-handoff");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    const submission = ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });

    // simulate the repair tool: the original snapshot is missing and is rebuilt AFTER the submission
    ctx.db.prepare("DELETE FROM content_assignment_handoff_snapshots WHERE assignment_id=?").run(assignmentId);
    ctx.db.prepare("UPDATE content_assignment_submissions SET created_at='2026-07-01 10:00:00' WHERE id=?").run(submission.id);
    const repaired = ctx.db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, force_reason, created_by, created_at
      ) VALUES (?, ?, NULL, '{}', 'ready', NULL, 'repair@local', '2026-07-05 09:00:00')
    `).run(assignmentId, item.id);
    const repairedHandoffId = Number(repaired.lastInsertRowid || 0);

    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const assignment = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(assignment.state, "accepted");
    assert.equal(Number(assignment.accepted_handoff_snapshot_id || 0), repairedHandoffId);
    assert.equal(Number(assignment.accepted_submission_id || 0), submission.id);
    assert.equal(ctx.repo.latestDraftByItem(item.id).confirmed_cta_contact_json.phone, "0812345678");
  } finally {
    ctx.cleanup();
  }
});

test("a legacy submission row stored in UTC still resolves its handoff instead of blocking acceptance", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Legacy Utc Submission");
    const assignee = ctx.createUser("legacy-utc");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);
    const handoffId = Number(ctx.db.prepare(
      "SELECT id FROM content_assignment_handoff_snapshots WHERE assignment_id=? ORDER BY id DESC LIMIT 1"
    ).get(assignmentId)?.id || 0);
    const submission = ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });

    // submissions created before the Bangkok-timestamp change stored UTC, only 1h after the handoff
    ctx.db.prepare("UPDATE content_assignment_handoff_snapshots SET created_at='2026-06-01 02:00:00' WHERE id=?").run(handoffId);
    ctx.db.prepare("UPDATE content_assignment_submissions SET created_at='2026-06-01 03:00:00' WHERE id=?").run(submission.id);

    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const assignment = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(assignment.state, "accepted");
    assert.equal(Number(assignment.accepted_handoff_snapshot_id || 0), handoffId);
  } finally {
    ctx.cleanup();
  }
});

test("accepted handoff pointer resolves the snapshot in effect at submission time, not a later reissue", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Accept Handoff Round");
    const assignee = ctx.createUser("handoff-round");
    ctx.createReadinessBrief(item.id);
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);

    const firstHandoffId = Number(ctx.db.prepare(
      "SELECT id FROM content_assignment_handoff_snapshots WHERE assignment_id=? ORDER BY id DESC LIMIT 1"
    ).get(assignmentId)?.id || 0);
    assert.ok(firstHandoffId > 0);
    // handoff created_at is stored in UTC (SQLite CURRENT_TIMESTAMP)
    ctx.db.prepare("UPDATE content_assignment_handoff_snapshots SET created_at='2026-07-01 00:00:00' WHERE id=?").run(firstHandoffId);

    const submission = ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
    });
    // submission created_at is stored in Asia/Bangkok local time (+07:00) => 03:00 UTC
    ctx.db.prepare("UPDATE content_assignment_submissions SET created_at='2026-07-01 10:00:00' WHERE id=?").run(submission.id);

    // reissued handoff AFTER the submission (05:00 UTC > 03:00 UTC) must not win
    const reissue = ctx.db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, force_reason, created_by, created_at
      ) VALUES (?, ?, NULL, '{}', 'ready', NULL, 'tester@local', '2026-07-01 05:00:00')
    `).run(assignmentId, item.id);
    const reissuedHandoffId = Number(reissue.lastInsertRowid || 0);

    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const assignment = ctx.repo.getAssignmentById(assignmentId);
    assert.equal(Number(assignment.accepted_handoff_snapshot_id || 0), firstHandoffId);
    assert.notEqual(Number(assignment.accepted_handoff_snapshot_id || 0), reissuedHandoffId);
  } finally {
    ctx.cleanup();
  }
});
