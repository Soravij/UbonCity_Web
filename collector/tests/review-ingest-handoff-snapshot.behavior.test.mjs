import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { resolveReviewIngestSourceContext } from "../server/review-ingest-mapping.mjs";

function createContext() {
  const db = openDatabase(":memory:", "D:/UbonCity_Web/collector/database/schema.sql");
  const repo = createRepository(db);

  function cleanup() {
    try {
      db.close();
    } catch {}
  }

  function createUser(emailSuffix) {
    const email = `${emailSuffix}-${Date.now()}@local.test`;
    const result = db.prepare(
      "INSERT INTO users (email, display_name, password_hash, role) VALUES (?, ?, 'hash', 'user')"
    ).run(email, `User ${emailSuffix}`);
    return Number(result.lastInsertRowid || 0) || 0;
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

  function createAcceptedFieldAssignment(item, userId) {
    const assignment = repo.createAssignment({
      content_item_id: item.id,
      assignee_user_id: userId,
      assigned_by_user_id: userId,
      assignment_kind: "field",
      state: "assigned",
      brief_json: { summary: "field review" },
      requirements_json: { expected_deliverables: [] },
    }, userId, { actor_role: "admin", reason_code: "test_assignment" });

    const handoffResult = db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, created_by
      ) VALUES (?, ?, NULL, ?, 'ready', 'tester@local')
    `).run(
      assignment.id,
      item.id,
      JSON.stringify({
        version: 1,
        requested_checks: {
          version: 1,
          groups: [
            {
              group_key: "cta_contact",
              group_label: "CTA / Contact",
              checks: [
                {
                  key: "phone",
                  label: "Phone",
                  answer_type: "phone",
                  requested: true,
                  required: true,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
              ],
            },
          ],
        },
      })
    );
    const handoffId = Number(handoffResult.lastInsertRowid || 0) || 0;

    const submission = repo.addAssignmentSubmission({
      assignment_id: assignment.id,
      source_handoff_snapshot_id: handoffId,
      submitted_by_user_id: userId,
      submission_state: "submitted",
      field_return_payload_json: {
        requested_check_returns: {
          "cta_contact.phone": {
            checked: true,
            found: true,
            value: "0812345678",
            evidence: "confirmed by phone",
            note: "worker note",
          },
        },
        taxonomy_return: {
          category: { checked: true, value: "cafes", note: "taxonomy" },
          subtype: { checked: true, value: "coffee_shop", note: "taxonomy" },
          tags: { checked: true, value: ["coffee"], note: "taxonomy" },
        },
      },
    });

    repo.updateAssignmentState(assignment.id, "submitted", "tester@local", {
      actor_role: "user",
      reason_code: "submission_created",
    });
    repo.saveDraft(item.id, "run-1", {
      draft_title: "Draft title",
      excerpt: "Draft excerpt",
      body: "<p>Draft body</p>",
      meta_title: "Draft meta",
      meta_description: "Draft meta description",
      confirmed_cta_contact_json: {
        phone: "0812345678",
        line_url: "https://line.me/ti/p/test",
        facebook_url: "https://facebook.com/test",
        website_url: "https://example.com/test",
        primary_cta: "phone",
      },
      confirmed_taxonomy_json: {
        category: "cafes",
        subtype: "coffee_shop",
        tags: ["coffee"],
      },
    });
    const accepted = repo.updateAssignmentState(assignment.id, "accepted", "tester@local", {
      actor_role: "admin",
      reason_code: "assignment_submission_accepted",
    });

    return {
      accepted,
      handoffId,
      submission,
      item,
      assignmentId: assignment.id,
      userId,
    };
  }

  function createEditorialAssignment(item, userId, state = "assigned") {
    const assignment = repo.createAssignment({
      content_item_id: item.id,
      assignee_user_id: userId,
      assigned_by_user_id: userId,
      assignment_kind: "editorial",
      state,
      brief_json: { summary: "editorial review" },
      requirements_json: { expected_deliverables: [] },
    }, userId, { actor_role: "admin", reason_code: "test_assignment" });
    return assignment;
  }

  function createLegacyUnpinnedFieldAssignment(item, userId) {
    const assignment = repo.createAssignment({
      content_item_id: item.id,
      assignee_user_id: userId,
      assigned_by_user_id: userId,
      assignment_kind: "field",
      state: "accepted",
      brief_json: { summary: "legacy field review" },
      requirements_json: { expected_deliverables: [] },
    }, userId, { actor_role: "admin", reason_code: "test_assignment" });
    db.prepare(`
      UPDATE content_assignments
      SET accepted_at=CURRENT_TIMESTAMP, accepted_handoff_snapshot_id=NULL, accepted_submission_id=NULL
      WHERE id=?
    `).run(assignment.id);
    return assignment;
  }

  return {
    db,
    repo,
    cleanup,
    createUser,
    createItem,
    createAcceptedFieldAssignment,
    createEditorialAssignment,
    createLegacyUnpinnedFieldAssignment,
  };
}

test("accepted field review snapshot freezes accepted binding and ignores later handoff or submission drift", () => {
  const ctx = createContext();
  try {
    const userId = ctx.createUser("snapshot");
    const item = ctx.createItem("Snapshot Place");
    const { accepted, handoffId, submission, assignmentId } = ctx.createAcceptedFieldAssignment(item, userId);

    assert.equal(accepted.accepted_binding_status, "pinned");

    const snapshotBefore = ctx.repo.buildAcceptedFieldReviewSnapshotByItem(item.id);
    assert.equal(snapshotBefore.assignment_id, assignmentId);
    assert.equal(snapshotBefore.accepted_handoff_snapshot_id, handoffId);
    assert.equal(snapshotBefore.accepted_submission_id, submission.id);
    assert.equal(snapshotBefore.confirmed_cta_contact_json.phone, "0812345678");
    assert.equal(snapshotBefore.confirmed_taxonomy_json.category, "cafes");
    assert.equal(snapshotBefore.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, "0812345678");
    assert.equal(snapshotBefore.field_return_payload_json.requested_check_returns["cta_contact.phone"].status, "reported");

    const handoffResult = ctx.db.prepare(`
      INSERT INTO content_assignment_handoff_snapshots (
        assignment_id, content_item_id, readiness_brief_id, handoff_package_json, guard_status, created_by
      ) VALUES (?, ?, NULL, ?, 'ready', 'tester@local')
    `).run(
      assignmentId,
      item.id,
      JSON.stringify({
        version: 1,
        requested_checks: {
          version: 1,
          groups: [
            {
              group_key: "cta_contact",
              group_label: "CTA / Contact",
              checks: [
                {
                  key: "phone",
                  label: "Phone",
                  answer_type: "phone",
                  requested: true,
                  required: true,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
              ],
            },
          ],
        },
      })
    );
    const nextSubmissionId = Number(ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, source_handoff_snapshot_id, submitted_by_user_id, submission_state,
        field_return_payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'submitted', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      assignmentId,
      item.id,
      Number(handoffResult.lastInsertRowid || 0) || 0,
      userId,
      JSON.stringify({
        requested_check_returns: {
          "cta_contact.phone": {
            checked: true,
            found: true,
            value: "0999999999",
            evidence: "updated by later submission",
          },
        },
        taxonomy_return: {
          category: { checked: true, value: "restaurants" },
          subtype: { checked: true, value: "cafe" },
          tags: { checked: true, value: ["coffee", "dessert"] },
        },
      })
    ).lastInsertRowid || 0);
    ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=? WHERE id=?").run(Number(nextSubmissionId || 0) || 0, assignmentId);

    const snapshotAfter = ctx.repo.buildAcceptedFieldReviewSnapshotByItem(item.id);
    assert.deepEqual(snapshotAfter, snapshotBefore);
  } finally {
    ctx.cleanup();
  }
});

test("invalid accepted field binding returns no review snapshot", () => {
  const ctx = createContext();
  try {
    const userId = ctx.createUser("snapshot-invalid");
    const item = ctx.createItem("Invalid Snapshot Place");
    const { assignmentId } = ctx.createAcceptedFieldAssignment(item, userId);

    ctx.db.prepare("UPDATE content_assignments SET accepted_handoff_snapshot_id=NULL WHERE id=?").run(assignmentId);
    assert.equal(ctx.repo.buildAcceptedFieldReviewSnapshotByItem(item.id), null);
  } finally {
    ctx.cleanup();
  }
});

test("review ingest provenance resolves field snapshot, editorial null, and blocks invalid field fallback", () => {
  const ctx = createContext();
  try {
    const fieldUserId = ctx.createUser("provenance-field");
    const editorialUserId = ctx.createUser("provenance-editorial");

    const fieldItem = ctx.createItem("Field Provenance Place");
    const fieldAssignment = ctx.createAcceptedFieldAssignment(fieldItem, fieldUserId);
    const fieldSource = resolveReviewIngestSourceContext({ repo: ctx.repo, contentItemId: fieldItem.id });
    assert.equal(fieldSource.review_source_kind, "field_accepted_binding");
    assert.ok(fieldSource.handoff_snapshot_json);
    assert.equal(fieldSource.handoff_snapshot_json.accepted_submission_id, fieldAssignment.submission.id);

    const editorialItem = ctx.createItem("Editorial Provenance Place");
    ctx.createEditorialAssignment(editorialItem, editorialUserId, "submitted");
    const editorialSource = resolveReviewIngestSourceContext({ repo: ctx.repo, contentItemId: editorialItem.id });
    assert.equal(editorialSource.review_source_kind, "editorial_article_workspace");
    assert.equal(editorialSource.handoff_snapshot_json, null);

    const blockedItem = ctx.createItem("Blocked Provenance Place");
    ctx.createLegacyUnpinnedFieldAssignment(blockedItem, fieldUserId);
    ctx.createEditorialAssignment(blockedItem, editorialUserId, "submitted");
    assert.throws(
      () => resolveReviewIngestSourceContext({ repo: ctx.repo, contentItemId: blockedItem.id }),
      /pinned accepted field assignment is required before admin review/
    );
  } finally {
    ctx.cleanup();
  }
});
