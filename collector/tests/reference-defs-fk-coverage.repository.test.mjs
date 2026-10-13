import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { REFERENCE_HARD_BLOCKER_DEFS } from "../db/repository.mjs";

// FK coverage guard for the purge / reference-cleanup classification.
//
// Purge ends in `DELETE FROM content_items WHERE id=?` (server/index.mjs purgeDeletedItemTx). Every table
// with an FK to content_items(id) is either (a) classified by a reference def (cleanup_candidate,
// confirm_required, hard_blocker) so the gate sees it, or (b) silently removed by ON DELETE CASCADE, or
// (c) makes the DELETE fail (RESTRICT). This test fails when a new FK child table appears that is in
// none of the def lists and not in the explicit ALLOWLIST below, so adding a table forces a decision.
//
// SOURCE-READING TEST: REFERENCE_CLEANUP_CANDIDATE_DEFS and REFERENCE_CONFIRM_REQUIRED_DEFS are
// module-private in db/repository.mjs (only REFERENCE_HARD_BLOCKER_DEFS is exported), and a behavior
// path (repo.getDeletedItemReferenceGroups) would need a seeded row in every FK table. So the table and
// column pairs for those two lists are read from the repository.mjs source text, and the hard-blocker
// list is read from its export. The extraction fails loudly if the declarations move or change shape.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const repositoryPath = path.join(collectorRoot, "db", "repository.mjs");

// table -> reason it is intentionally NOT in any reference def. Applies to every FK column of the table.
const ALLOWLIST = Object.freeze({
  content_asset_name_sequences:
    "Pure per-item counter for generated asset file names (server/assignment-asset-naming.mjs); holds no human work and is meaningless once the item is gone.",
  content_assignment_submission_drafts:
    "Assignee autosave keyed by assignment_id (FK CASCADE to content_assignments) with an expires_at TTL purge; an existing draft implies a content_assignments row, which is the confirm_required assignments group.",
  content_reference_media_selections:
    "Selected-for-AI toggle layered over candidates derived from raw-only data (item image, evidence_blocks, source raw media); the item merge path already moves/deletes it without confirmation.",
});


function sliceFrozenArray(source, constName) {
  const marker = "const " + constName + " = Object.freeze([";
  const markerAt = source.indexOf(marker);
  assert.ok(markerAt >= 0, "could not find '" + marker + "' in db/repository.mjs; update this test's extraction");
  const start = markerAt + marker.length;
  const end = source.indexOf("\n]);", start);
  assert.ok(end > start, "could not find the closing ]); of " + constName + " in db/repository.mjs");
  return source.slice(start, end);
}

function whereColumns(where) {
  return [...String(where).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\?/g)].map((match) => match[1].toLowerCase());
}

// Returns a Set of "table.column" pairs the def list filters by.
function pairsFromSourceDefs(source, constName) {
  const body = sliceFrozenArray(source, constName);
  const keyCount = [...body.matchAll(/\bkey:\s*"/g)].length;
  const pairs = new Set();
  let tableCount = 0;
  for (const match of body.matchAll(/table:\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*,\s*where:\s*"([^"]*)"/g)) {
    tableCount += 1;
    const columns = whereColumns(match[2]);
    assert.ok(columns.length > 0, constName + ": table " + match[1] + " has a where clause with no col=? predicate: " + match[2]);
    for (const column of columns) pairs.add(match[1].toLowerCase() + "." + column);
  }
  assert.ok(keyCount > 0, constName + ": found 0 defs; extraction is stale");
  assert.equal(
    tableCount,
    keyCount,
    constName + ": " + keyCount + " defs have a key but only " + tableCount + " matched the table/where shape; update this test's extraction"
  );
  return pairs;
}

function pairsFromHardBlockerDefs() {
  assert.ok(
    Array.isArray(REFERENCE_HARD_BLOCKER_DEFS) && REFERENCE_HARD_BLOCKER_DEFS.length > 0,
    "REFERENCE_HARD_BLOCKER_DEFS is empty or not exported"
  );
  const pairs = new Set();
  for (const def of REFERENCE_HARD_BLOCKER_DEFS) {
    const match = /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)\s+WHERE\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\?/i.exec(String(def.sql || ""));
    assert.ok(match, "hard blocker " + def.key + ": sql is not FROM <table> WHERE <col>=?; update this test's extraction");
    pairs.add(match[1].toLowerCase() + "." + match[2].toLowerCase());
  }
  return pairs;
}

// Every (child table, FK column) whose parent is content_items, from a fresh DB built from schema.sql.
function listContentItemsForeignKeys() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-reference-defs-fk-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), schemaPath);
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    const edges = [];
    for (const table of tables) {
      const quoted = '"' + table.replace(/"/g, '""') + '"';
      const foreignKeys = db.prepare("PRAGMA foreign_key_list(" + quoted + ")").all();
      for (const fk of foreignKeys) {
        if (String(fk.table || "").toLowerCase() !== "content_items") continue;
        edges.push({
          table: table.toLowerCase(),
          column: String(fk.from || "").toLowerCase(),
          on_delete: String(fk.on_delete || ""),
        });
      }
    }
    return { tableCount: tables.length, edges };
  } finally {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

let analysisCache = null;
function analyze() {
  if (analysisCache) return analysisCache;
  const source = fs.readFileSync(repositoryPath, "utf8");
  const covered = new Set([
    ...pairsFromSourceDefs(source, "REFERENCE_CLEANUP_CANDIDATE_DEFS"),
    ...pairsFromSourceDefs(source, "REFERENCE_CONFIRM_REQUIRED_DEFS"),
    ...pairsFromHardBlockerDefs(),
  ]);
  const { tableCount, edges } = listContentItemsForeignKeys();
  assert.ok(tableCount > 0 && edges.length > 0, "schema.sql produced no FK edges to content_items; the FK scan is broken");
  analysisCache = { covered, edges };
  return analysisCache;
}

test("every FK child of content_items is covered by a reference def or named in the allowlist", () => {
  const { covered, edges } = analyze();
  const uncovered = edges.filter(
    (edge) => !covered.has(edge.table + "." + edge.column) && !Object.prototype.hasOwnProperty.call(ALLOWLIST, edge.table)
  );
  assert.deepEqual(
    uncovered.map((edge) => edge.table + "." + edge.column + " (ON DELETE " + (edge.on_delete || "NO ACTION") + ")"),
    [],
    "FK table(s) to content_items are in no reference def (cleanup_candidate / confirm_required / hard_blocker). " +
      "Purge will delete (CASCADE) or choke on (RESTRICT) these rows without the gate seeing them. " +
      "Add a def in db/repository.mjs (and RAW_ONLY_HARD_DELETE_ALLOWED_REFERENCE_KEYS if raw-only items may carry it), " +
      "or add the table to ALLOWLIST in this test with a reason."
  );
});

test("allowlist has no stale or redundant entries", () => {
  const { covered, edges } = analyze();
  const fkTables = new Set(edges.map((edge) => edge.table));
  for (const [table, reason] of Object.entries(ALLOWLIST)) {
    assert.ok(String(reason).trim().length > 0, "ALLOWLIST entry " + table + " needs a reason");
    assert.ok(fkTables.has(table), "ALLOWLIST entry " + table + " is no longer a table with an FK to content_items; remove it");
    const redundant = edges.filter((edge) => edge.table === table && covered.has(edge.table + "." + edge.column));
    assert.deepEqual(
      redundant.map((edge) => edge.table + "." + edge.column),
      [],
      "ALLOWLIST entry " + table + " is now covered by a reference def; remove it from the allowlist"
    );
  }
});
