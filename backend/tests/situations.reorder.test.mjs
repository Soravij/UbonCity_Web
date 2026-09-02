import test from "node:test";
import assert from "node:assert/strict";

import pool from "../config/db.js";
import { reorderSituation } from "../repositories/situationRepository.js";

const SEED_SITUATIONS = [
  { slug: "day-trip", sort_order: 1, th: "เที่ยวหนึ่งวัน", en: "One-day Trip" },
  { slug: "budget-500", sort_order: 2, th: "งบ 500", en: "Budget 500" },
  { slug: "couple", sort_order: 3, th: "มากับแฟน", en: "With Partner" },
  { slug: "family", sort_order: 4, th: "มากับครอบครัว", en: "With Family" },
  { slug: "solo", sort_order: 5, th: "เที่ยวคนเดียว", en: "Solo Trip" },
  { slug: "rainy-day", sort_order: 6, th: "วันฝนตก", en: "Rainy Day" },
  { slug: "local-food", sort_order: 7, th: "กินของถิ่น", en: "Local Food" },
];

async function restoreSeed() {
  const [existing] = await pool.query("SELECT slug FROM situations");
  const existingSlugs = new Set(existing.map((r) => r.slug));
  for (const seed of SEED_SITUATIONS) {
    if (existingSlugs.has(seed.slug)) continue;
    const [result] = await pool.query(
      "INSERT INTO situations (slug, sort_order, is_active) VALUES (?, ?, 1)",
      [seed.slug, seed.sort_order]
    );
    const id = Number(result.insertId);
    for (const lang of ["th", "en"]) {
      await pool.query(
        "INSERT INTO situation_translations (situation_id, lang, title) VALUES (?, ?, ?)",
        [id, lang, seed[lang]]
      );
    }
  }
}

async function getOrderedSlugs() {
  const [rows] = await pool.query("SELECT slug FROM situations ORDER BY sort_order ASC, id ASC");
  return rows.map((r) => r.slug);
}

test("reorderSituation", async (t) => {

  await t.test("up from middle row swaps with row above (moved: true)", async () => {
    await restoreSeed();
    const before = await getOrderedSlugs();
    const idx = before.indexOf("couple");
    assert.ok(idx > 0, "couple should not be first");

    const result = await reorderSituation("couple", "up");
    assert.deepEqual(result, { moved: true });

    const after = await getOrderedSlugs();
    assert.equal(after[idx - 1], "couple", "couple should move up");
    assert.equal(after[idx], before[idx - 1], "previous row should move down");

    await restoreSeed();
  });

  await t.test("down from last row returns moved: false", async () => {
    await restoreSeed();
    const before = await getOrderedSlugs();
    const lastSlug = before[before.length - 1];

    const result = await reorderSituation(lastSlug, "down");
    assert.deepEqual(result, { moved: false });

    const after = await getOrderedSlugs();
    assert.deepEqual(after, before, "order should not change");

    await restoreSeed();
  });

  await t.test("invalid direction returns null (not found path is separate)", async () => {
    await restoreSeed();
    const result = await reorderSituation("couple", "invalid");
    assert.equal(result, null);

    await restoreSeed();
  });

  await t.test("non-existent slug returns null", async () => {
    await restoreSeed();
    const result = await reorderSituation("does-not-exist", "up");
    assert.equal(result, null);

    await restoreSeed();
  });

});

test("teardown: close pool", async () => {
  await pool.end();
});
