import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { advancePlaceProductionState } from "./test-helpers/fixture-ladder.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "RevisionSnap!Test1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-revision-snap-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.join(root, "database", "schema.sql");
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

  function createUser(suffix = "rev-snap") {
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
    const assignment = repo.getAssignmentById(assignmentId);
    advancePlaceProductionState(repo, assignment.content_item_id, "field_working");
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

  return { db, repo, cleanup, createItem, createUser, createReadinessBrief, createFieldAssignment, submitWithReturns };
}

const ctaChecksFixture = {
  version: 1,
  groups: [{
    group_key: "cta_contact",
    group_label: "CTA/ติดต่อ",
    checks: [
      { key: "phone", requested: true, label: "เบอร์โทร", answer_type: "phone" },
      { key: "line_url", requested: true, label: "ลิงก์ LINE", answer_type: "url" },
      { key: "website_url", requested: true, label: "เว็บไซต์", answer_type: "url" },
    ],
  }],
};

test("request_revision creates a new handoff snapshot with previous_confirmed_checked for confirmed CTA keys", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Revision Snapshot");
    const assignee = ctx.createUser("rev-snap");
    ctx.createReadinessBrief(item.id);
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      ai_summary: "Field pack",
      requested_checks_json: ctaChecksFixture,
    });
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);

    // Count snapshots before
    const snapshotsBefore = ctx.db.prepare(
      "SELECT COUNT(*) AS n FROM content_assignment_handoff_snapshots WHERE assignment_id=?"
    ).get(assignmentId)?.n || 0;

    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
      "cta_contact.line_url": { checked: true, value: "https://line.me/ti/p/@test" },
      "cta_contact.website_url": { checked: false },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    // Request revision
    ctx.repo.requestAssignmentRevisionWithReset(assignmentId, "reviewer@local", {
      actor_role: "admin",
      reason_code: "revision_requested",
    });

    // Count snapshots after
    const snapshotsAfter = ctx.db.prepare(
      "SELECT COUNT(*) AS n FROM content_assignment_handoff_snapshots WHERE assignment_id=?"
    ).get(assignmentId)?.n || 0;
    assert.ok(snapshotsAfter > snapshotsBefore, "a new snapshot row was inserted");

    // Get the latest snapshot
    const latest = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
    assert.ok(latest, "latest snapshot exists");
    assert.ok(latest.handoff_package_json, "snapshot has handoff_package_json");

    const ctaGroup = latest.handoff_package_json.requested_checks.groups
      .find((group) => group.group_key === "cta_contact");
    assert.ok(ctaGroup, "CTA group exists in snapshot");

    const phone = ctaGroup.checks.find((check) => check.key === "phone");
    assert.equal(phone.previous_confirmed_checked, true, "phone has previous_confirmed_checked=true");
    assert.equal(phone.previous_confirmed_value, "0812345678", "phone value carried forward");

    const lineUrl = ctaGroup.checks.find((check) => check.key === "line_url");
    assert.equal(lineUrl.previous_confirmed_checked, true, "line_url has previous_confirmed_checked=true");
    assert.equal(lineUrl.previous_confirmed_value, "https://line.me/ti/p/@test", "line_url value carried forward");

    const websiteUrl = ctaGroup.checks.find((check) => check.key === "website_url");
    assert.equal(websiteUrl.previous_confirmed_checked || false, false, "website_url was NOT confirmed (unchecked)");
  } finally {
    ctx.cleanup();
  }
});

test("request_revision snapshot preserves 'verified: none' as previous_confirmed_checked=true with null value", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Revision Verified None");
    const assignee = ctx.createUser("rev-none");
    ctx.createReadinessBrief(item.id);
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      ai_summary: "Field pack",
      requested_checks_json: ctaChecksFixture,
    });
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);

    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: null },
      "cta_contact.line_url": { checked: false },
    });
    ctx.repo.updateAssignmentState(assignmentId, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    ctx.repo.requestAssignmentRevisionWithReset(assignmentId, "reviewer@local", {
      actor_role: "admin",
      reason_code: "revision_requested",
    });

    const latest = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
    const ctaGroup = latest.handoff_package_json.requested_checks.groups
      .find((group) => group.group_key === "cta_contact");

    const phone = ctaGroup.checks.find((check) => check.key === "phone");
    assert.equal(phone.previous_confirmed_checked, true, "phone verified as absent has previous_confirmed_checked=true");
    assert.equal(phone.previous_confirmed_value ?? null, null, "phone value is null (verified: none)");

    const lineUrl = ctaGroup.checks.find((check) => check.key === "line_url");
    assert.equal(lineUrl.previous_confirmed_checked || false, false, "line_url was NOT confirmed");
  } finally {
    ctx.cleanup();
  }
});

test("revert proof: requestAssignmentRevisionWithReset must insert a snapshot after state flip", () => {
  const repositorySource = fs.readFileSync(path.join(root, "db", "repository.mjs"), "utf8");
  const marker = "insertAssignmentHandoffSnapshotStmt.run";
  // Find the marker inside requestAssignmentRevisionWithReset
  const fnStart = repositorySource.indexOf("function requestAssignmentRevisionWithReset");
  assert.ok(fnStart >= 0, "requestAssignmentRevisionWithReset must exist");
  const fnBody = repositorySource.slice(fnStart, fnStart + 5000);
  assert.ok(
    fnBody.includes(marker),
    `revert proof: requestAssignmentRevisionWithReset must call ${marker} — if this fails after revert, the call was removed`
  );
});
