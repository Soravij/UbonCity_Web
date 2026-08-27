import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { openDatabase } from "../db/client.mjs";
import { createRepository, TRANSITION_RULES } from "../db/repository.mjs";

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "place-ladder-writing-assigned-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), path.resolve("collector/database/schema.sql"));
  const repo = createRepository(db);
  return {
    db,
    repo,
    cleanup() {
      try { db.close(); } catch {}
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

const FROM_STATE = "writing_assigned";
const PLACE_PRODUCTION = TRANSITION_RULES.place.production;
const ACTUAL_TARGETS = [...PLACE_PRODUCTION[FROM_STATE]].sort();

test("writing_assigned forward targets include in_review (revert-proof)", () => {
  assert.ok(
    ACTUAL_TARGETS.includes("in_review"),
    `writing_assigned targets must include in_review; got [${ACTUAL_TARGETS.join(", ")}]`
  );
});

test("canTransition place writing_assigned → in_review = true", () => {
  const ctx = createContext();
  try {
    assert.equal(
      ctx.repo.canTransition("place", "production", FROM_STATE, "in_review"),
      true,
      "writing_assigned → in_review must be allowed"
    );
  } finally {
    ctx.cleanup();
  }
});

test("all original writing_assigned targets still pass canTransition", () => {
  const ctx = createContext();
  try {
    for (const target of ACTUAL_TARGETS) {
      assert.equal(
        ctx.repo.canTransition("place", "production", FROM_STATE, target),
        true,
        `writing_assigned → ${target} must be allowed`
      );
    }
  } finally {
    ctx.cleanup();
  }
});

test("writing_assigned → published is rejected", () => {
  const ctx = createContext();
  try {
    assert.equal(
      ctx.repo.canTransition("place", "production", FROM_STATE, "published"),
      false,
      "writing_assigned → published must not be allowed"
    );
  } finally {
    ctx.cleanup();
  }
});
