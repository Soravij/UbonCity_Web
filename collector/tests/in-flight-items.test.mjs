import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "InFlight!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-in-flight-"));
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

  function createItem(title, workflowPatch = null) {
    const result = repo.createItemWithWorkflowHead({
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
    const itemId = Number(result?.item?.id || 0) || 0;
    if (workflowPatch) {
      // Written straight to the head table on purpose: this suite tests the in-flight *filter*, not the
      // transition graph, so it must be able to place an item in any terminal/intermediate state
      // without walking a legal path there.
      db.prepare(`
        UPDATE content_workflow_models
        SET production_state=?, publication_state=?, assignment_state=?
        WHERE content_item_id=?
      `).run(
        String(workflowPatch.production_state || "collected"),
        String(workflowPatch.publication_state || "draft"),
        workflowPatch.assignment_state ? String(workflowPatch.assignment_state) : null,
        itemId
      );
    }
    return repo.getItem(itemId);
  }

  return { db, repo, cleanup, createItem };
}

function idsOf(items) {
  return (Array.isArray(items) ? items : []).map((item) => Number(item?.id || 0)).sort((a, b) => a - b);
}

test("listInFlightItems excludes raw (collected) items", (t) => {
  const ctx = createTestContext();
  t.after(ctx.cleanup);

  const raw = ctx.createItem("raw item", { production_state: "collected", publication_state: "draft" });
  const inProgress = ctx.createItem("in progress", { production_state: "generated", publication_state: "draft" });

  const result = ctx.repo.listInFlightItems();
  assert.deepEqual(idsOf(result), [Number(inProgress.id)]);
  assert.ok(!idsOf(result).includes(Number(raw.id)), "collected item must not appear in the in-flight list");
});

test("listInFlightItems excludes finished items (published / completed)", (t) => {
  const ctx = createTestContext();
  t.after(ctx.cleanup);

  const published = ctx.createItem("published", { production_state: "completed", publication_state: "published" });
  const completedOnly = ctx.createItem("completed only", { production_state: "completed", publication_state: "draft" });
  const publishedOnly = ctx.createItem("published only", { production_state: "in_review", publication_state: "published" });
  const stuck = ctx.createItem("stuck in review", { production_state: "in_review", publication_state: "draft" });

  const result = idsOf(ctx.repo.listInFlightItems());
  assert.deepEqual(result, [Number(stuck.id)]);
  for (const finished of [published, completedOnly, publishedOnly]) {
    assert.ok(!result.includes(Number(finished.id)), `finished item #${finished.id} must not appear`);
  }
});

test("listInFlightItems keeps every intermediate state, including assignment/handoff", (t) => {
  const ctx = createTestContext();
  t.after(ctx.cleanup);

  const expected = [];
  for (const productionState of [
    "analyzed",
    "brief_generated",
    "ready_for_content",
    "generated",
    "content_in_progress",
    "in_review",
    "needs_revision",
    "rejected",
    "ready_for_publish",
    "submitted_for_admin_review",
  ]) {
    expected.push(Number(ctx.createItem(productionState, {
      production_state: productionState,
      publication_state: "draft",
    }).id));
  }
  const assigned = ctx.createItem("assigned", {
    production_state: "generated",
    publication_state: "draft",
    assignment_state: "assigned",
  });
  expected.push(Number(assigned.id));

  const result = idsOf(ctx.repo.listInFlightItems());
  assert.deepEqual(result, expected.sort((a, b) => a - b));
});

test("listInFlightItems excludes soft-deleted items", (t) => {
  const ctx = createTestContext();
  t.after(ctx.cleanup);

  const kept = ctx.createItem("kept", { production_state: "generated", publication_state: "draft" });
  const removed = ctx.createItem("removed", { production_state: "generated", publication_state: "draft" });
  ctx.repo.deleteItem(Number(removed.id));

  const result = idsOf(ctx.repo.listInFlightItems());
  assert.deepEqual(result, [Number(kept.id)]);
});

test("listInFlightItems excludes items with no workflow head", (t) => {
  const ctx = createTestContext();
  t.after(ctx.cleanup);

  const inFlight = ctx.createItem("in flight", { production_state: "generated", publication_state: "draft" });
  const headless = ctx.repo.saveItem({
    type: "place",
    category: "attractions",
    title: "headless item",
    description_raw: "headless item",
    description_clean: "",
    summary: "",
    meta_title: "",
    meta_description: "",
    image_url: "",
    tags: [],
    lang: "th",
  });

  const result = idsOf(ctx.repo.listInFlightItems());
  assert.deepEqual(result, [Number(inFlight.id)]);
  assert.ok(!result.includes(Number(headless.id)), "item without a workflow head belongs to the raw queue");
});

test("listItems is unchanged by the in-flight filter (default list keeps every state)", (t) => {
  const ctx = createTestContext();
  t.after(ctx.cleanup);

  const raw = ctx.createItem("raw", { production_state: "collected", publication_state: "draft" });
  const stuck = ctx.createItem("stuck", { production_state: "generated", publication_state: "draft" });
  const published = ctx.createItem("published", { production_state: "completed", publication_state: "published" });

  assert.deepEqual(
    idsOf(ctx.repo.listItems()),
    [Number(raw.id), Number(stuck.id), Number(published.id)].sort((a, b) => a - b)
  );
});

// ============================================================
// Client-side rendering helpers (collector/server/public/app.js)
// ============================================================
// app.js is a browser script with top-level side effects, so it cannot be imported. These tests pull
// the individual pure helpers out by brace matching and evaluate them in isolation — enough to pin the
// two display contracts that regressed before: no raw English state string may reach the status
// column, and the stalled-age tone boundaries must match the documented bands.

const APP_JS_PATH = path.resolve(process.cwd(), "collector", "server", "public", "app.js");

function loadAppHelpers() {
  const src = fs.readFileSync(APP_JS_PATH, "utf8");

  const extractFunction = (name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `function ${name} not found in app.js`);
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced braces while extracting ${name}`);
  };

  const labelsStart = src.indexOf("const IN_FLIGHT_STATUS_LABELS");
  assert.ok(labelsStart >= 0, "IN_FLIGHT_STATUS_LABELS not found in app.js");
  const labelsSrc = src.slice(labelsStart, src.indexOf("});", labelsStart) + 3);

  const names = [
    "getItemWorkflowSnapshot",
    "parseServerTimestamp",
    "formatInFlightStalledAge",
    "buildInFlightStatusLabel",
  ];
  const body = `${labelsSrc}\n${names.map(extractFunction).join("\n\n")}`;
  return new Function(`${body}\nreturn { ${names.join(", ")} };`)();
}

const DAY_MS = 86400000;

test("in-flight status label never leaks a raw snake_case state into the UI", () => {
  const { buildInFlightStatusLabel } = loadAppHelpers();
  // Every state the in-flight filter admits, i.e. everything except collected and completed/published.
  const states = [
    ["analyzed", "draft", null],
    ["brief_generated", "draft", null],
    ["ready_for_content", "draft", null],
    ["generated", "draft", null],
    ["content_in_progress", "draft", null],
    ["in_review", "draft", null],
    ["needs_revision", "draft", null],
    ["rejected", "draft", null],
    ["ready_for_publish", "approved", null],
    ["submitted_for_admin_review", "draft", null],
    ["in_review", "unpublished", null],
    ["generated", "draft", "assigned"],
  ];
  const snakeCase = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
  for (const [production, publication, assignment] of states) {
    const label = buildInFlightStatusLabel({
      id: 1,
      production_state: production,
      publication_state: publication,
      assignment_state: assignment,
    });
    assert.ok(
      !snakeCase.test(label),
      `state ${production}/${publication} rendered the raw identifier ${JSON.stringify(label)} instead of a Thai label`
    );
    assert.ok(String(label).trim().length > 0, `state ${production}/${publication} rendered an empty label`);
  }
});

test("in-flight status label covers submitted_for_admin_review specifically", () => {
  const { buildInFlightStatusLabel } = loadAppHelpers();
  assert.equal(
    buildInFlightStatusLabel({ production_state: "submitted_for_admin_review", publication_state: "draft" }),
    "ส่งให้แอดมินตรวจแล้ว"
  );
});

test("stalled-age tone boundaries: 30 days exactly is still warn, past 30 is fail", () => {
  const { formatInFlightStalledAge } = loadAppHelpers();
  const ageOf = (days) => formatInFlightStalledAge(new Date(Date.now() - days * DAY_MS - 1000).toISOString());

  assert.equal(ageOf(6).colorVar, "", "6 days must carry no tone");
  assert.equal(ageOf(7).colorVar, "--warn", "7 days enters the warn band");
  assert.equal(ageOf(29).colorVar, "--warn");
  assert.equal(ageOf(30).colorVar, "--warn", "30 days exactly must still be warn, not fail");
  assert.equal(ageOf(30).text, "4 สัปดาห์");
  assert.equal(ageOf(31).colorVar, "--fail", "past 30 days becomes the hard signal");
  assert.equal(ageOf(31).text, "1 เดือน");
});

test("stalled age reads SQLite timestamps as UTC, not local time", () => {
  const { parseServerTimestamp, formatInFlightStalledAge } = loadAppHelpers();

  // SQLite CURRENT_TIMESTAMP format: UTC with no timezone marker. Parsing it as local time is what
  // previously inflated every age by the viewer's UTC offset.
  assert.equal(
    parseServerTimestamp("2026-07-19 12:00:00"),
    Date.parse("2026-07-19T12:00:00Z"),
    "a bare SQLite timestamp must resolve to the same instant as the explicit UTC form"
  );

  // A row written this second must read as today regardless of the machine's timezone.
  const nowSqlite = new Date().toISOString().replace("T", " ").slice(0, 19);
  assert.equal(formatInFlightStalledAge(nowSqlite).text, "วันนี้");

  // Values that already carry their own timezone must be left untouched.
  for (const stamp of ["2026-07-19T12:00:00Z", "2026-07-19T12:00:00+07:00", "2026-07-19T12:00:00-0500"]) {
    assert.equal(parseServerTimestamp(stamp), Date.parse(stamp), `${stamp} must not be rewritten`);
  }

  // Malformed input degrades to a dash — never NaN, never a negative age.
  for (const bad of [null, undefined, "", "not-a-date", 0, "2026-13-45"]) {
    assert.equal(formatInFlightStalledAge(bad).text, "-");
  }
});
