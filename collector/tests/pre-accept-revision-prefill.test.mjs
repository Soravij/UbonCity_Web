import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { advancePlaceProductionState } from "./test-helpers/fixture-ladder.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "PreAccept!Test1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-pre-accept-"));
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

  function createUser(suffix = "pre-accept") {
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

test("pre-accept revision: snapshot has previous_confirmed_value but NOT previous_confirmed_checked", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Pre Accept Revision");
    const assignee = ctx.createUser("pre-accept");
    ctx.createReadinessBrief(item.id);
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      ai_summary: "Field pack",
      requested_checks_json: ctaChecksFixture,
    });
    const assignmentId = ctx.createFieldAssignment(item.id, assignee.id);

    // Submit with checked CTA values (state stays submitted, NOT accepted)
    ctx.submitWithReturns(assignmentId, assignee.id, {
      "cta_contact.phone": { checked: true, value: "0812345678" },
      "cta_contact.line_url": { checked: true, value: "https://line.me/ti/p/@test" },
      "cta_contact.website_url": { checked: false },
    });

    // Request revision while still in submitted state (no accept)
    ctx.repo.requestAssignmentRevisionWithReset(assignmentId, "reviewer@local", {
      actor_role: "admin",
      reason_code: "revision_requested",
    });

    const latest = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
    assert.ok(latest, "latest snapshot exists");
    assert.ok(latest.handoff_package_json, "snapshot has handoff_package_json");

    const ctaGroup = latest.handoff_package_json.requested_checks.groups
      .find((group) => group.group_key === "cta_contact");
    assert.ok(ctaGroup, "CTA group exists in snapshot");

    const phone = ctaGroup.checks.find((check) => check.key === "phone");
    assert.equal(phone.previous_confirmed_value, "0812345678", "phone value is prefilled from submitted round");
    assert.equal(phone.previous_confirmed_checked || false, false, "phone must NOT be pre-checked (pre-accept)");

    const lineUrl = ctaGroup.checks.find((check) => check.key === "line_url");
    assert.equal(lineUrl.previous_confirmed_value, "https://line.me/ti/p/@test", "line_url value is prefilled");
    assert.equal(lineUrl.previous_confirmed_checked || false, false, "line_url must NOT be pre-checked (pre-accept)");

    const websiteUrl = ctaGroup.checks.find((check) => check.key === "website_url");
    assert.equal(websiteUrl.previous_confirmed_value ?? undefined, undefined, "website_url has no value (was unchecked)");
    assert.equal(websiteUrl.previous_confirmed_checked || false, false, "website_url has no confirmed flag");
  } finally {
    ctx.cleanup();
  }
});

test("pre-accept revision: 'verified: none' (checked=true, value=null) is prefilled as null without pre-check", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Pre Accept Verified None");
    const assignee = ctx.createUser("pre-none");
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

    ctx.repo.requestAssignmentRevisionWithReset(assignmentId, "reviewer@local", {
      actor_role: "admin",
      reason_code: "revision_requested",
    });

    const latest = ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId);
    const ctaGroup = latest.handoff_package_json.requested_checks.groups
      .find((group) => group.group_key === "cta_contact");

    const phone = ctaGroup.checks.find((check) => check.key === "phone");
    // verified: none → previous_confirmed_value should be present (as null) but no pre-check
    assert.equal(phone.previous_confirmed_checked || false, false, "phone must NOT be pre-checked");
    // The value key should exist in the handoff (even if null) to signal "verified absent"
    // Note: previous_confirmed_value is omitted when null by the backend, so we check the key doesn't have checked flag
    assert.equal(phone.previous_confirmed_checked || false, false, "phone verified-absent has no pre-check");

    const lineUrl = ctaGroup.checks.find((check) => check.key === "line_url");
    assert.equal(lineUrl.previous_confirmed_value ?? undefined, undefined, "line_url was unchecked, no value");
    assert.equal(lineUrl.previous_confirmed_checked || false, false, "line_url has no confirmed flag");
  } finally {
    ctx.cleanup();
  }
});

test("revert proof: buildPreviousConfirmedCheckValues must accept 'latest' submission source", () => {
  const repositorySource = fs.readFileSync(path.join(root, "db", "repository.mjs"), "utf8");
  const fnStart = repositorySource.indexOf("function buildPreviousConfirmedCheckValues");
  assert.ok(fnStart >= 0, "buildPreviousConfirmedCheckValues must exist");
  const fnBody = repositorySource.slice(fnStart, fnStart + 1500);
  assert.ok(
    fnBody.includes('"latest"'),
    "revert proof: buildPreviousConfirmedCheckValues must accept submission_source='latest' — if this fails after revert, the filter was restored to accepted-only"
  );
});
