import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { advancePlaceProductionState } from "./test-helpers/fixture-ladder.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "PrevChecked!Test1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-prev-checked-"));
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

  function createUser(suffix = "prev-checked") {
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
      { key: "facebook_url", requested: true, label: "Facebook", answer_type: "url" },
    ],
  }],
};

test("handoff payload sets previous_confirmed_checked=true for keys confirmed in prior round (with value)", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Confirmed With Value");
    const assignee = ctx.createUser("with-val");
    ctx.createReadinessBrief(item.id);
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      ai_summary: "Field pack",
      requested_checks_json: ctaChecksFixture,
    });
    const firstAssignment = ctx.createFieldAssignment(item.id, assignee.id);

    ctx.submitWithReturns(firstAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
      "cta_contact.line_url": { checked: true, value: "https://line.me/ti/p/@test" },
      "cta_contact.website_url": { checked: false },
    });
    ctx.repo.updateAssignmentState(firstAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const rework = ctx.repo.returnFieldAssignmentForRework(firstAssignment, "reviewer@local", { note: "ตรวจใหม่", actor_role: "admin" });
    const ctaGroup = rework.handoff.handoff_package_json.requested_checks.groups
      .find((group) => group.group_key === "cta_contact");

    const phone = ctaGroup.checks.find((check) => check.key === "phone");
    assert.equal(phone.previous_confirmed_checked, true, "phone was confirmed in prior round");
    assert.equal(phone.previous_confirmed_value, "0812345678", "phone value carried forward");

    const lineUrl = ctaGroup.checks.find((check) => check.key === "line_url");
    assert.equal(lineUrl.previous_confirmed_checked, true, "line_url was confirmed in prior round");
    assert.equal(lineUrl.previous_confirmed_value, "https://line.me/ti/p/@test", "line_url value carried forward");

    const websiteUrl = ctaGroup.checks.find((check) => check.key === "website_url");
    assert.equal(websiteUrl.previous_confirmed_checked || false, false, "website_url was NOT confirmed (unchecked)");
  } finally {
    ctx.cleanup();
  }
});

test("handoff payload sets previous_confirmed_checked=true for 'verified: none' (checked but no value)", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Confirmed Absent");
    const assignee = ctx.createUser("absent");
    ctx.createReadinessBrief(item.id);
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      ai_summary: "Field pack",
      requested_checks_json: ctaChecksFixture,
    });
    const firstAssignment = ctx.createFieldAssignment(item.id, assignee.id);

    ctx.submitWithReturns(firstAssignment, assignee.id, {
      "cta_contact.phone": { checked: true, value: null },
      "cta_contact.facebook_url": { checked: false },
    });
    ctx.repo.updateAssignmentState(firstAssignment, "accepted", "reviewer@local", { actor_role: "admin", reason_code: "accepted" });

    const rework = ctx.repo.returnFieldAssignmentForRework(firstAssignment, "reviewer@local", { note: "ตรวจอีกครั้ง", actor_role: "admin" });
    const ctaGroup = rework.handoff.handoff_package_json.requested_checks.groups
      .find((group) => group.group_key === "cta_contact");

    const phone = ctaGroup.checks.find((check) => check.key === "phone");
    assert.equal(phone.previous_confirmed_checked, true, "phone was verified as absent (checked=true, value=null)");
    assert.equal(phone.previous_confirmed_value ?? null, null, "phone value is null (verified: none)");

    const facebookUrl = ctaGroup.checks.find((check) => check.key === "facebook_url");
    assert.equal(facebookUrl.previous_confirmed_checked || false, false, "facebook_url was NOT confirmed (unchecked)");
  } finally {
    ctx.cleanup();
  }
});

test("revert proof: removing previous_confirmed_checked from handoff payload causes test to fail", () => {
  const repositorySource = fs.readFileSync(path.join(root, "db", "repository.mjs"), "utf8");
  const marker = "previous_confirmed_checked: true";
  assert.ok(
    repositorySource.includes(marker),
    `revert proof requires '${marker}' to exist in repository.mjs — if this fails after revert, the field was removed`
  );
});
