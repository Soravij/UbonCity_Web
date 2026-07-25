import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assertSmokeDatabaseAllowed, assertSmokeSqliteDatabaseAllowed } from "../../scripts/smokeSafety.mjs";
import { cleanupFixtureReviewContent, isFixtureReviewRow } from "../scripts/smoke-collector-admin-final-review.mjs";

test("database smoke guard aborts non-test targets unless explicitly opted in", () => {
  assert.throws(() => assertSmokeDatabaseAllowed("uboncity_production", {}), /refusing DB_NAME=uboncity_production/);
  assert.doesNotThrow(() => assertSmokeDatabaseAllowed("uboncity_production", { SMOKE_ALLOW_DB: "uboncity_production" }));
  assert.doesNotThrow(() => assertSmokeDatabaseAllowed("uboncity_test", {}));
});

test("sqlite smoke guard uses canonical paths instead of tmp-looking strings", () => {
  const persistentRoot = fs.mkdtempSync(path.join(process.cwd(), "smoke-safety-persistent-"));
  const fakeTmpDirectory = path.join(persistentRoot, "tmp");
  const fakeTmpDatabase = path.join(fakeTmpDirectory, "collector.db");
  const realTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-safety-real-"));
  const realTempDatabase = path.join(realTempRoot, "collector.db");
  const symlinkPath = path.join(realTempRoot, "tmp-looking-link");
  try {
    fs.mkdirSync(fakeTmpDirectory);
    fs.writeFileSync(fakeTmpDatabase, "");
    fs.writeFileSync(realTempDatabase, "");

    assert.throws(() => assertSmokeSqliteDatabaseAllowed(fakeTmpDatabase, {}), /refusing DB_PATH=/);
    assert.throws(() => assertSmokeSqliteDatabaseAllowed("./tmp/smoke-safety-relative.db", {}), /refusing DB_PATH=/);
    assert.doesNotThrow(() => assertSmokeSqliteDatabaseAllowed(realTempDatabase, {}));

    fs.symlinkSync(persistentRoot, symlinkPath, "junction");
    const escapedThroughTempLookingLink = path.join(symlinkPath, "tmp", "collector.db");
    assert.throws(() => assertSmokeSqliteDatabaseAllowed(escapedThroughTempLookingLink, {}), /refusing DB_PATH=/);
    assert.doesNotThrow(() => assertSmokeSqliteDatabaseAllowed(escapedThroughTempLookingLink, { SMOKE_ALLOW_DB: fakeTmpDatabase }));
  } finally {
    fs.rmSync(realTempRoot, { recursive: true, force: true });
    fs.rmSync(persistentRoot, { recursive: true, force: true });
  }
});

test("final-review teardown rejects a colliding review id without its exact fixture marker", async () => {
  const fixture = { slug: "final-review-approve-123" };
  assert.equal(isFixtureReviewRow({ slug: "final-review-approve-123" }, fixture), true);
  assert.equal(isFixtureReviewRow({ slug: "final-review-existing-record" }, fixture), false);
  assert.equal(isFixtureReviewRow({ slug: "ordinary-place" }, fixture), false);

  const calls = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await cleanupFixtureReviewContent({
      async query(sql, params) {
        calls.push({ sql, params });
        return [[{ id: 79, public_entity_type: "place", public_entity_id: 85, slug: "final-review-existing-record" }]];
      },
    }, { ...fixture, reviewContentIds: [79] });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /^DELETE/i);
});
