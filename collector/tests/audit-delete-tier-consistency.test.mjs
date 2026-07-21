import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import {
  createRepository,
  REFERENCE_HARD_BLOCKER_DEFS,
} from "../db/repository.mjs";
import { getNeverOverrideBlockersForItem, classifyPurgeGroups } from "../services/raw-delete.mjs";

// Audit gate for root PROJECT_POLICY.md §3 Delete Tier Contract, written while verifying the diff that
// moved the assignment family from hard_blocker to confirm_required. Two properties are asserted that
// no other test covered end-to-end:
//   1. the soft-delete NEVER gate did not widen or narrow as a side effect of that move;
//   2. the three read paths (blocker-summary, purge gate, soft-delete gate) agree on one item that
//      carries several blockers of different tiers at once.
// Both are pure repository/service level — no server, no live DB.

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "AuditTier!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-audit-tier-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve(process.cwd(), "collector", "database", "schema.sql");
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
      description_raw: title,
      description_clean: "",
      summary: "",
      meta_title: "",
      meta_description: "",
      image_url: "",
      tags: [],
      lang: "th",
    });
    return Number(created?.item?.id || 0) || 0;
  }

  function createUser(email) {
    return Number(
      db.prepare("INSERT INTO users (email, display_name, role) VALUES (?,?,?)").run(email, email, "editor")
        .lastInsertRowid
    );
  }

  return { db, repo, cleanup, createItem, createUser };
}

// One writer per blocker kind, so each fixture below states exactly one dependency and nothing else.
const BLOCKER_WRITERS = Object.freeze({
  published_articles: (db, id) => {
    db.prepare("INSERT INTO published_articles (content_item_id, slug, title, body) VALUES (?,?,?,?)").run(
      id,
      `slug-${id}`,
      "Published title",
      "Published body"
    );
  },
  review_actions: (db, id) => {
    db.prepare("INSERT INTO review_actions (content_item_id, action) VALUES (?,?)").run(id, "approve");
  },
  // The published article is hung off a *different* item on purpose: the def keys on
  // source_published_article_id IS NOT NULL, so this isolates translations_published from
  // published_articles instead of tripping both at once.
  translations_published: (db, id, userId, foreignArticleId) => {
    db.prepare(
      "INSERT INTO content_translations (source_content_item_id, source_published_article_id, source_fingerprint, lang) VALUES (?,?,?,?)"
    ).run(id, foreignArticleId, `fp-${id}`, "en");
  },
  assignments: (db, id) => {
    db.prepare("INSERT INTO content_assignments (assignment_uid, content_item_id) VALUES (?,?)").run(
      `asg-${id}`,
      id
    );
  },
  content_assignment_submissions: (db, id, userId) => {
    const assignmentId = insertAssignment(db, id);
    db.prepare(
      "INSERT INTO content_assignment_submissions (assignment_id, content_item_id, submitted_by_user_id) VALUES (?,?,?)"
    ).run(assignmentId, id, userId);
  },
  content_assignment_submission_deliverables: (db, id, userId) => {
    const assignmentId = insertAssignment(db, id);
    const submissionId = Number(
      db
        .prepare(
          "INSERT INTO content_assignment_submissions (assignment_id, content_item_id, submitted_by_user_id) VALUES (?,?,?)"
        )
        .run(assignmentId, id, userId).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO content_assignment_submission_deliverables
         (assignment_id, submission_id, content_item_id, deliverable_type, created_by)
       VALUES (?,?,?,?,?)`
    ).run(assignmentId, submissionId, id, "article", "audit@local");
  },
  content_assignment_handoff_snapshots: (db, id) => {
    const assignmentId = insertAssignment(db, id);
    db.prepare(
      `INSERT INTO content_assignment_handoff_snapshots
         (assignment_id, content_item_id, handoff_package_json, created_by)
       VALUES (?,?,?,?)`
    ).run(assignmentId, id, "{}", "audit@local");
  },
});

function insertAssignment(db, itemId) {
  return Number(
    db
      .prepare("INSERT INTO content_assignments (assignment_uid, content_item_id) VALUES (?,?)")
      .run(`asg-${itemId}-${Math.random().toString(36).slice(2)}`, itemId).lastInsertRowid
  );
}

// The keys the soft-delete gate is contractually allowed to report. Anything else appearing here means
// a reversible delete started being barred by something a workflow action could have cleared.
const EXPECTED_NEVER_KEYS = Object.freeze(["published_articles", "review_actions", "translations_published"]);
const ASSIGNMENT_FAMILY_KEYS = Object.freeze([
  "assignments",
  "content_assignment_submissions",
  "content_assignment_submission_deliverables",
  "content_assignment_handoff_snapshots",
]);

test("soft-delete NEVER gate: only the three permanent groups block, each in isolation", () => {
  const ctx = createTestContext();
  try {
    const userId = ctx.createUser("submitter@local");
    // Owned by a throwaway item so translations_published can be tripped without published_articles.
    const carrierId = ctx.createItem("Carrier For Foreign Published Article");
    const foreignArticleId = Number(
      ctx.db
        .prepare("INSERT INTO published_articles (content_item_id, slug, title, body) VALUES (?,?,?,?)")
        .run(carrierId, `slug-carrier-${carrierId}`, "Carrier", "Body").lastInsertRowid
    );

    for (const [key, write] of Object.entries(BLOCKER_WRITERS)) {
      const id = ctx.createItem(`Item Carrying Only ${key}`);
      write(ctx.db, id, userId, foreignArticleId);

      const keys = getNeverOverrideBlockersForItem(ctx.db, id).map((entry) => entry.key);
      if (EXPECTED_NEVER_KEYS.includes(key)) {
        assert.deepEqual(keys, [key], `${key} alone must block soft delete`);
      } else {
        assert.deepEqual(keys, [], `${key} must NOT block a reversible soft delete`);
      }
    }
  } finally {
    ctx.cleanup();
  }
});

test("soft-delete NEVER gate: the assignment family never appears, even all four at once", () => {
  const ctx = createTestContext();
  try {
    const userId = ctx.createUser("fieldworker@local");
    const id = ctx.createItem("Item Carrying The Whole Assignment Family");
    for (const key of ASSIGNMENT_FAMILY_KEYS) BLOCKER_WRITERS[key](ctx.db, id, userId);

    const keys = getNeverOverrideBlockersForItem(ctx.db, id).map((entry) => entry.key);
    assert.deepEqual(keys, [], "assignment work must stay soft-deletable — the row is recoverable");
  } finally {
    ctx.cleanup();
  }
});

// The gate derives itself from REFERENCE_HARD_BLOCKER_DEFS by key. That derivation fails *silently* if a
// remediation key stops matching a def (e.g. a def is renamed or moved to another tier), so assert the
// mapping resolves rather than trusting the count.
test("every NEVER key still resolves to a live hard_blocker def", () => {
  const hardKeys = new Set(REFERENCE_HARD_BLOCKER_DEFS.map((def) => def.key));
  for (const key of EXPECTED_NEVER_KEYS) {
    assert.ok(hardKeys.has(key), `${key} must still exist in REFERENCE_HARD_BLOCKER_DEFS or the gate drops it`);
  }
  assert.equal(hardKeys.size, EXPECTED_NEVER_KEYS.length, "hard_blocker tier must not carry non-NEVER groups");
});

test("blocker-summary, purge gate and soft-delete gate agree on one item carrying every tier", () => {
  const ctx = createTestContext();
  try {
    const userId = ctx.createUser("mixed@local");
    const id = ctx.createItem("Item With Three Assignments And A Published Article");

    // createItemWithWorkflowHead already writes workflow rows that are themselves cleanup_candidate
    // groups, so the cleanup tier is asserted as a delta rather than an absolute.
    const cleanupBefore = ctx.repo.getItemReferenceBlockerCounts([id]).get(id).cleanup_candidate_count;

    // 3 open assignments, plus one group from each of the other two tiers.
    for (let i = 0; i < 3; i += 1) insertAssignment(ctx.db, id);
    BLOCKER_WRITERS.published_articles(ctx.db, id); // hard_blocker + NEVER
    ctx.db
      .prepare("INSERT INTO source_records (content_item_id, source_type, source_url) VALUES (?,?,?)")
      .run(id, "manual", "https://example.test/audit"); // cleanup_candidate
    ctx.repo.deleteItem(id, "audit@local");

    const summary = ctx.repo.getItemReferenceBlockerCounts([id]).get(id);
    const groups = ctx.repo.getDeletedItemReferenceGroups(id)?.groups || [];
    const classified = classifyPurgeGroups(groups);
    const purgeAssignments = classified.confirm_required.find((entry) => entry.key === "assignments");

    // 1. the scalar and the purge-gate group are the same rows read two ways
    assert.equal(summary.assignments_open, 3, "blocker-summary reports 3 open assignments");
    assert.ok(purgeAssignments, "purge gate classifies assignments as confirm_required");
    assert.equal(purgeAssignments.count, 3, "purge gate reports the same 3 rows");
    const summaryAssignments = summary.confirm_required.find((entry) => entry.key === "assignments");
    assert.equal(summaryAssignments?.count, 3, "confirm_required list carries the same count as the scalar");

    // 2. tiers stay separate — an assignment must never be folded into the cleanup_candidate total
    assert.equal(
      summary.cleanup_candidate_count - cleanupBefore,
      1,
      "the 3 assignments must not leak into the cleanup_candidate total — only source_records did"
    );
    assert.ok(
      classified.hard_blockers.some((entry) => entry.key === "published_articles"),
      "published_articles stays a hard blocker at purge"
    );

    // 3. the soft-delete gate sees only the NEVER subset of the above
    assert.deepEqual(
      getNeverOverrideBlockersForItem(ctx.db, id).map((entry) => entry.key),
      ["published_articles"],
      "soft delete blocks on the published article only, not on the assignments"
    );
  } finally {
    ctx.cleanup();
  }
});
