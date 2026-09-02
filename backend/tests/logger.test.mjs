import test from "node:test";
import assert from "node:assert/strict";

import { logger } from "../middleware/logger.js";

test("logger.error captures Error with stack", () => {
  const captured = [];
  const orig = console.error;
  console.error = (line) => captured.push(line);
  try {
    logger.error("x", { err: new Error("boom") });
  } finally {
    console.error = orig;
  }

  assert.ok(captured.length === 1, `expected 1 log line, got ${captured.length}`);
  const parsed = JSON.parse(captured[0]);
  assert.equal(parsed.err.message, "boom");
  assert.equal(typeof parsed.err.stack, "string");
  assert.ok(parsed.err.stack.length > 0, "stack should be non-empty");
});

test("teardown: close pool", async () => {
  const pool = (await import("../config/db.js")).default;
  await pool.end();
});
