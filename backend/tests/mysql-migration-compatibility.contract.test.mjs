import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationsDir = path.resolve(import.meta.dirname, "..", "migrations");
const migrationNames = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
const stripSqlComments = (source) => String(source || "").replace(/^\s*--.*$/gm, "");

test("new MySQL migrations must guard ADD/DROP COLUMN with information_schema dynamic DDL", () => {
  const source = stripSqlComments(fs.readFileSync(path.join(migrationsDir, "021_review_submission_snapshot_provenance.sql"), "utf8"));
  assert.doesNotMatch(source, /(?:ADD|DROP)\s+COLUMN\s+IF\s+(?:NOT\s+)?EXISTS/i);
  for (const column of ["source_submission_id", "source_manifest_hash", "caption", "source_asset_id"]) {
    assert.match(source, new RegExp(`COLUMN_NAME = '${column}'`));
  }
  assert.equal((source.match(/PREPARE stmt FROM @ddl;/g) || []).length, 5);
});

test("scan reports no unsupported conditional column syntax in current MySQL migrations after 001", () => {
  const offenders = migrationNames
    .filter((name) => name !== "001_schema_alignment_core.sql")
    .filter((name) => /(?:ADD|DROP)\s+COLUMN\s+IF\s+(?:NOT\s+)?EXISTS/i.test(stripSqlComments(fs.readFileSync(path.join(migrationsDir, name), "utf8"))));
  assert.deepEqual(offenders, []);
});
