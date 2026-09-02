import test from "node:test";
import assert from "node:assert/strict";

import pool from "../config/db.js";
import { reorderSituation } from "../repositories/situationRepository.js";

let snapshot = [];

async function captureSnapshot() {
  const [rows] = await pool.query(
    "SELECT id, slug, sort_order FROM situations ORDER BY sort_order ASC, id ASC");
  snapshot = rows;
}

async function restoreSnapshot() {
  for (const row of snapshot) {
    await pool.query("UPDATE situations SET sort_order = ? WHERE id = ?",
      [row.sort_order, row.id]);
  }
}

async function getOrderedSlugs() {
  const [rows] = await pool.query("SELECT slug FROM situations ORDER BY sort_order ASC, id ASC");
  return rows.map((r) => r.slug);
}

test("reorderSituation", async (t) => {

  await captureSnapshot();

  await t.test("up from middle row swaps with row above (moved: true)", async () => {
    const before = await getOrderedSlugs();
    const idx = before.indexOf("couple");
    assert.ok(idx > 0, "couple should not be first");

    const result = await reorderSituation("couple", "up");
    assert.deepEqual(result, { moved: true });

    const after = await getOrderedSlugs();
    assert.equal(after[idx - 1], "couple", "couple should move up");
    assert.equal(after[idx], before[idx - 1], "previous row should move down");

    await restoreSnapshot();
  });

  await t.test("down from last row returns moved: false", async () => {
    const before = await getOrderedSlugs();
    const lastSlug = before[before.length - 1];

    const result = await reorderSituation(lastSlug, "down");
    assert.deepEqual(result, { moved: false });

    const after = await getOrderedSlugs();
    assert.deepEqual(after, before, "order should not change");

    await restoreSnapshot();
  });

  await t.test("invalid direction returns null", async () => {
    const result = await reorderSituation("couple", "invalid");
    assert.equal(result, null);

    await restoreSnapshot();
  });

  await t.test("non-existent slug returns null", async () => {
    const result = await reorderSituation("does-not-exist", "up");
    assert.equal(result, null);

    await restoreSnapshot();
  });

  await restoreSnapshot();
});

test("teardown: close pool", async () => {
  await pool.end();
});
