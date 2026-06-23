import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const indexSource = fs.readFileSync(path.resolve("D:/UbonCity_Web/collector/server/index.mjs"), "utf8");

function extractFunctionBlock(source, name) {
  const signature = `function ${name}`;
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function block: ${name}`);
}

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-article-process-evidence-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve("D:/UbonCity_Web/collector/database/schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem(title = "Evidence Place", type = "place") {
    return repo.createItemWithWorkflowHead({
      type,
      category: "attractions",
      title,
      description_raw: `${title} raw`,
      source_type: "manual",
      source_name: "manual",
      source_url: `https://${title.toLowerCase().replace(/\s+/g, "-")}.example.com`,
    }).item;
  }

  function createUser(suffix = "worker") {
    const email = `${suffix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role)
      VALUES (?, ?, 'hash', 'user')
    `).run(email, `User ${suffix}`);
    return {
      id: Number(result.lastInsertRowid || 0),
      email,
      display_name: `User ${suffix}`,
    };
  }

  function createAssignment(itemId, assigneeUserId) {
    const assignment = repo.createAssignment({
      content_item_id: itemId,
      assignee_user_id: assigneeUserId,
      assigned_by_user_id: assigneeUserId,
      assignment_kind: "field",
      state: "assigned",
      brief_json: { summary: "check fields" },
      requirements_json: { expected_deliverables: [] },
    });
    db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, created_by
      ) VALUES (?, ?, NULL, ?, 'ready', 'tester@local')
    `).run(
      assignment.id,
      itemId,
      JSON.stringify({
        version: 1,
        requested_checks: {
          version: 1,
          groups: [
            {
              group_key: "cta_contact",
              group_label: "CTA / Contact",
              checks: [
                { key: "phone", requested: true, label: "Phone", answer_type: "phone", evidence_required: false },
              ],
            },
          ],
        },
      })
    );
    return assignment;
  }

  return { db, repo, cleanup, createItem, createUser, createAssignment };
}

function loadBuildArticleProcessPayload(ctx) {
  const context = {
    repo: ctx.repo,
    process: { env: { NODE_ENV: "test" } },
    actorPolicyRole() {
      return "user";
    },
    canReadArticleProcess() {
      return true;
    },
    hasEditorialAssignmentEditAccess() {
      return true;
    },
    canManageArticleEditorialAssignments() {
      return true;
    },
    listEditorialAssignmentsByItem() {
      return [];
    },
    getPrimaryEditorialAssignment() {
      return null;
    },
    deriveArticleProcessStatus() {
      return "drafting";
    },
    deriveQueuedArticleProcessStatus(_item, _workflowModel, _workflowTransitions, baseStatus) {
      return baseStatus;
    },
    buildArticleProcessDraftPreview() {
      return null;
    },
    canTransitionArticleProcess() {
      return false;
    },
    canTransitionArticleProcessByRole() {
      return false;
    },
    ARTICLE_PROCESS_STATUSES: new Set(["drafting"]),
    listUsersByIds(ids = []) {
      if (!ids.length) return [];
      const placeholders = ids.map(() => "?").join(", ");
      return ctx.db.prepare(`SELECT id, email, display_name, role FROM users WHERE id IN (${placeholders})`).all(...ids);
    },
  };
  context.globalThis = context;
  vm.runInNewContext(`
${extractFunctionBlock(indexSource, "buildArticleProcessPayload")}
globalThis.__hooks = { buildArticleProcessPayload };
`, context, { filename: "article-process-field-return-evidence.js" });
  return context.__hooks.buildArticleProcessPayload;
}

function currentHandoffSnapshotId(ctx, assignmentId) {
  return Number(ctx.repo.getLatestAssignmentHandoffByAssignment(assignmentId)?.id || 0) || 0;
}

test("repo field return evidence helper returns safe defaults with no submissions", () => {
  const ctx = createContext();
  try {
    const item = ctx.createItem("No Evidence Place");
    assert.deepEqual(ctx.repo.buildFieldReturnEvidenceByItem(item.id), { version: 1, items: [] });
  } finally {
    ctx.cleanup();
  }
});

test("repo field return evidence helper returns normalized evidence without raw submission internals", () => {
  const ctx = createContext();
  try {
    const item = ctx.createItem("Evidence Place");
    const user = ctx.createUser("evidence");
    const assignment = ctx.createAssignment(item.id, user.id);
    const submission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignment.id),
      submitted_by_user_id: user.id,
      submission_state: "submitted",
      article_payload_json: { title: "should stay hidden" },
      media_payload_json: { assets: ["should stay hidden"] },
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": {
            checked: true,
            found: false,
            value: "0812345678",
            evidence: "call confirmed",
          },
        },
      },
    });
    const evidence = ctx.repo.buildFieldReturnEvidenceByItem(item.id);

    assert.equal(evidence.version, 1);
    assert.equal(evidence.items.length, 1);
    assert.deepEqual(evidence.items[0], {
      key: "cta_contact.phone",
      group_key: "cta_contact",
      check_key: "phone",
      label: "เบอร์โทร",
      checked: true,
      found: true,
      value: "0812345678",
      condition_note: null,
      evidence: "call confirmed",
      note: null,
      submitted_at: submission.created_at,
      submitted_by_user_id: user.id,
      assignment_id: assignment.id,
      submission_id: submission.id,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(evidence.items[0], "article_payload_json"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(evidence.items[0], "media_payload_json"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(evidence.items[0], "field_return_payload_json"), false);
  } finally {
    ctx.cleanup();
  }
});

test("article-process payload exposes summarized field return evidence with submitter display names only", () => {
  const ctx = createContext();
  try {
    const item = ctx.createItem("Payload Evidence Place");
    const user = ctx.createUser("payload");
    const assignment = ctx.createAssignment(item.id, user.id);
    ctx.repo.addAssignmentSubmission({
      assignment_id: assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignment.id),
      submitted_by_user_id: user.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": {
            checked: true,
            found: false,
            value: "0812345678",
            evidence: "call confirmed",
          },
        },
      },
    });

    const buildArticleProcessPayload = loadBuildArticleProcessPayload(ctx);
    const payload = buildArticleProcessPayload({}, item);

    assert.deepEqual(JSON.parse(JSON.stringify(payload.field_return_evidence)), {
      version: 1,
      items: [
        {
          key: "cta_contact.phone",
          group_key: "cta_contact",
          check_key: "phone",
          label: "เบอร์โทร",
          checked: true,
          found: true,
          value: "0812345678",
          condition_note: null,
          evidence: "call confirmed",
          note: null,
          submitted_at: payload.field_return_evidence.items[0].submitted_at,
          submitted_by: "User payload",
          assignment_id: assignment.id,
        },
      ],
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload.field_return_evidence.items[0], "submitted_by_user_id"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.field_return_evidence.items[0], "submission_id"), false);
  } finally {
    ctx.cleanup();
  }
});

test("article-process payload returns safe empty field return evidence for event content", () => {
  const ctx = createContext();
  try {
    const item = ctx.createItem("Event Evidence", "event");
    const user = ctx.createUser("event");
    const assignment = ctx.createAssignment(item.id, user.id);
    ctx.repo.addAssignmentSubmission({
      assignment_id: assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignment.id),
      submitted_by_user_id: user.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": {
            checked: true,
            value: "0812345678",
            evidence: "event should not expose place CTA",
          },
        },
      },
    });

    const buildArticleProcessPayload = loadBuildArticleProcessPayload(ctx);
    const payload = buildArticleProcessPayload({}, item);

    assert.deepEqual(JSON.parse(JSON.stringify(payload.field_return_evidence)), {
      version: 1,
      items: [],
    });
  } finally {
    ctx.cleanup();
  }
});

test("field return evidence submitted_at uses updated_at after resubmission", () => {
  const ctx = createContext();
  try {
    const item = ctx.createItem("Resubmission Evidence Place");
    const user = ctx.createUser("resubmit");
    const assignment = ctx.createAssignment(item.id, user.id);
    const initialSubmission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignment.id),
      submitted_by_user_id: user.id,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": {
            checked: true,
            value: "0811111111",
            evidence: "initial call",
          },
        },
      },
    });
    const initialEvidence = ctx.repo.buildFieldReturnEvidenceByItem(item.id);
    assert.equal(initialEvidence.items[0].submitted_at, initialSubmission.updated_at || initialSubmission.created_at);

    ctx.db.prepare("UPDATE content_assignments SET state='revision_requested' WHERE id=?").run(assignment.id);
    const resubmission = ctx.repo.addAssignmentSubmission({
      assignment_id: assignment.id,
      source_handoff_snapshot_id: currentHandoffSnapshotId(ctx, assignment.id),
      submitted_by_user_id: user.id,
      submission_state: "resubmitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": {
            checked: true,
            value: "0822222222",
            evidence: "updated call",
          },
        },
      },
    });
    const refreshedEvidence = ctx.repo.buildFieldReturnEvidenceByItem(item.id);

    assert.notEqual(resubmission.id, initialSubmission.id);
    assert.notEqual(String(resubmission.updated_at || ""), "");
    assert.equal(refreshedEvidence.items[0].submitted_at, resubmission.updated_at);
    assert.equal(refreshedEvidence.items[0].value, "0822222222");
  } finally {
    ctx.cleanup();
  }
});
