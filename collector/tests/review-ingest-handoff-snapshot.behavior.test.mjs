import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { resolveReviewIngestPayloadSourceContext, resolveReviewIngestSourceContext } from "../server/review-ingest-mapping.mjs";

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

  function createEventItem(title) {
    return repo.createItemWithWorkflowHead({
      type: "event",
      category: "event",
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
            {
              group_key: "taxonomy",
              group_label: "Taxonomy",
              checks: [
                {
                  key: "parking",
                  label: "Parking",
                  answer_type: "boolean",
                  requested: true,
                  required: false,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
                {
                  key: "price_level",
                  label: "Price level",
                  answer_type: "select",
                  requested: true,
                  required: false,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
                {
                  key: "service_scope",
                  label: "Service scope",
                  answer_type: "multi_select",
                  requested: true,
                  required: false,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
                {
                  key: "category",
                  label: "Category",
                  answer_type: "select",
                  requested: true,
                  required: false,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
                {
                  key: "subtype",
                  label: "Subtype",
                  answer_type: "select",
                  requested: true,
                  required: false,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
                {
                  key: "tags",
                  label: "Tags",
                  answer_type: "multi_select",
                  requested: true,
                  required: false,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
                {
                  key: "custom_legacy_flag",
                  label: "Custom legacy flag",
                  answer_type: "boolean",
                  requested: true,
                  required: false,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
                {
                  key: "unknown_key",
                  label: "Unknown key",
                  answer_type: "text",
                  requested: true,
                  required: false,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
                {
                  key: "booking_required",
                  label: "Booking required",
                  answer_type: "boolean",
                  requested: true,
                  required: false,
                  activation_mode: "required",
                  categories: ["attractions"],
                  item_types: ["place"],
                },
                {
                  key: "pet_friendly",
                  label: "Pet friendly",
                  answer_type: "boolean",
                  requested: true,
                  required: false,
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

    const acceptedFieldReturnPayload = {
      requested_check_returns: {
        "cta_contact.phone": {
          checked: true,
          found: true,
          value: "0812345678",
          evidence: "confirmed by phone",
          note: "worker note",
        },
        "taxonomy.parking": {
          checked: true,
          found: true,
          value: false,
          note: "taxonomy",
        },
        "taxonomy.price_level": {
          checked: true,
          found: true,
          value: "standard",
          note: "taxonomy",
        },
        "taxonomy.service_scope": {
          checked: true,
          found: true,
          value: ["city", "airport"],
          note: "taxonomy",
        },
        "taxonomy.category": {
          checked: true,
          found: true,
          value: "cafes",
          note: "legacy classification",
        },
        "taxonomy.subtype": {
          checked: true,
          found: true,
          value: "coffee_shop",
          note: "legacy classification",
        },
        "taxonomy.tags": {
          checked: true,
          found: true,
          value: ["coffee"],
          note: "legacy classification",
        },
        "taxonomy.custom_legacy_flag": {
          checked: true,
          found: true,
          value: true,
          note: "custom legacy",
        },
        "taxonomy.unknown_key": {
          checked: true,
          found: true,
          value: "drop-me",
          note: "unknown",
        },
        "taxonomy.booking_required": {
          checked: false,
          found: true,
          value: true,
          note: "unchecked",
        },
        "taxonomy.pet_friendly": {
          checked: true,
          found: true,
          note: "missing value",
        },
      },
      taxonomy_return: {
        category: { checked: true, value: "cafes", note: "taxonomy" },
        subtype: { checked: true, value: "coffee_shop", note: "taxonomy" },
        tags: { checked: true, value: ["coffee"], note: "taxonomy" },
      },
    };

    const submission = repo.addAssignmentSubmission({
      assignment_id: assignment.id,
      source_handoff_snapshot_id: handoffId,
      submitted_by_user_id: userId,
      submission_state: "submitted",
      field_return_payload_json: acceptedFieldReturnPayload,
    });
    db.prepare("UPDATE content_assignment_submissions SET field_return_payload_json=? WHERE id=?").run(
      JSON.stringify(acceptedFieldReturnPayload),
      submission.id
    );
    const acceptedSubmission = repo.getAssignmentSubmissionById(submission.id);

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
    db.prepare(`
      UPDATE content_assignments
      SET state='accepted',
          accepted_at=CURRENT_TIMESTAMP,
          accepted_handoff_snapshot_id=?,
          accepted_submission_id=?,
          latest_submission_id=?
      WHERE id=?
    `).run(handoffId, acceptedSubmission.id, acceptedSubmission.id, assignment.id);
    const accepted = repo.getAssignmentById(assignment.id);

    return {
      accepted,
      handoffId,
      submission: acceptedSubmission,
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
    createEventItem,
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
    assert.deepEqual(snapshotBefore.confirmed_taxonomy_json, {
      parking: false,
      price_level: "standard",
      service_scope: ["city", "airport"],
    });
    assert.equal(Object.hasOwn(snapshotBefore.confirmed_taxonomy_json, "category"), false);
    assert.equal(Object.hasOwn(snapshotBefore.confirmed_taxonomy_json, "subtype"), false);
    assert.equal(Object.hasOwn(snapshotBefore.confirmed_taxonomy_json, "tags"), false);
    assert.equal(Object.hasOwn(snapshotBefore.confirmed_taxonomy_json, "custom.legacy_flag"), false);
    assert.equal(Object.hasOwn(snapshotBefore.confirmed_taxonomy_json, "unknown_key"), false);
    assert.equal(Object.hasOwn(snapshotBefore.confirmed_taxonomy_json, "booking_required"), false);
    assert.equal(Object.hasOwn(snapshotBefore.confirmed_taxonomy_json, "pet_friendly"), false);
    assert.equal(snapshotBefore.field_return_payload_json.requested_check_returns["cta_contact.phone"].value, "0812345678");
    assert.equal(snapshotBefore.field_return_payload_json.requested_check_returns["cta_contact.phone"].status, "reported");
    assert.equal(submission.field_return_payload_json.requested_check_returns["taxonomy.parking"].value, false);
    assert.equal(submission.field_return_payload_json.requested_check_returns["taxonomy.price_level"].value, "standard");
    assert.deepEqual(submission.field_return_payload_json.requested_check_returns["taxonomy.service_scope"].value, ["city", "airport"]);
    const storedSubmissionRow = ctx.db.prepare("SELECT field_return_payload_json FROM content_assignment_submissions WHERE id=?").get(submission.id);
    const storedSubmissionPayload = JSON.parse(storedSubmissionRow.field_return_payload_json);
    assert.equal(Object.hasOwn(storedSubmissionPayload.requested_check_returns["taxonomy.pet_friendly"], "value"), false);

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
          "taxonomy.parking": {
            checked: true,
            found: true,
            value: true,
          },
          "taxonomy.price_level": {
            checked: true,
            found: true,
            value: "premium",
          },
          "taxonomy.service_scope": {
            checked: true,
            found: true,
            value: ["city"],
          },
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

test("event review ingest provenance resolves to event queue without assignments", () => {
  const ctx = createContext();
  try {
    const eventItem = ctx.createEventItem("Event Queue Item");

    const eventSource = resolveReviewIngestPayloadSourceContext({
      repo: ctx.repo,
      contentItemId: eventItem.id,
      contentType: "event",
    });

    assert.equal(eventSource.review_source_kind, "event_editorial_queue");
    assert.equal(eventSource.handoff_snapshot_json, null);
  } finally {
    ctx.cleanup();
  }
});
