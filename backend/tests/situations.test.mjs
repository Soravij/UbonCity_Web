import test from "node:test";
import assert from "node:assert/strict";

import pool from "../config/db.js";
import { listSituations, getSituationBySlug, createSituation, updateSituationBySlug, deleteSituationBySlug } from "../repositories/situationRepository.js";
import { validateSituationCreatePayload, validateSituationUpdatePayload } from "../validators/situationValidator.js";

const TEST_SLUG = "test-situation-api-probe";

const SEED_SITUATIONS = [
  { slug: "day-trip", sort_order: 1, th: "เที่ยวหนึ่งวัน", en: "One-day Trip", zh: "一日游", lo: "ທ່ຽວມື້ດຽວ" },
  { slug: "budget-500", sort_order: 2, th: "งบ 500", en: "Budget 500", zh: "500泰铢预算", lo: "ງົບ 500" },
  { slug: "couple", sort_order: 3, th: "มากับแฟน", en: "With Partner", zh: "情侣同行", lo: "ມາກັບແຟນ" },
  { slug: "family", sort_order: 4, th: "มากับครอบครัว", en: "With Family", zh: "家庭出游", lo: "ມາກັບຄອບຄົວ" },
  { slug: "solo", sort_order: 5, th: "เที่ยวคนเดียว", en: "Solo Trip", zh: "独自旅行", lo: "ທ່ຽວຄົນດຽວ" },
  { slug: "rainy-day", sort_order: 6, th: "วันฝนตก", en: "Rainy Day", zh: "雨天好去处", lo: "ມື້ຝົນຕົກ" },
  { slug: "local-food", sort_order: 7, th: "กินของถิ่น", en: "Local Food", zh: "当地美食", lo: "ກິນຂອງທ້ອງຖິ່ນ" },
];

async function cleanup() {
  await pool.query("DELETE FROM situations WHERE slug = ?", [TEST_SLUG]);
}

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
    for (const lang of ["th", "en", "zh", "lo"]) {
      await pool.query(
        "INSERT INTO situation_translations (situation_id, lang, title) VALUES (?, ?, ?)",
        [id, lang, seed[lang]]
      );
    }
  }
}

test("situations API", async (t) => {

  await t.test("listSituations returns seed data (7 rows)", async () => {
    const rows = await listSituations("th");
    assert.ok(rows.length >= 7, `expected >= 7, got ${rows.length}`);
    const slugs = rows.map((r) => r.slug);
    for (const seed of SEED_SITUATIONS) {
      assert.ok(slugs.includes(seed.slug), `missing seed: ${seed.slug}`);
    }
  });

  await t.test("createSituation without en translation fails validation", () => {
    const result = validateSituationCreatePayload({
      slug: "no-en",
      translations: { th: { title: "ทดสอบ" } },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /English title/i);
  });

  await t.test("createSituation fails when 7 situations already exist", async () => {
    await cleanup();
    try {
      await assert.rejects(
        () => createSituation({
          slug: TEST_SLUG,
          sort_order: 99,
          translations: { en: { title: "Should Fail" } },
        }),
        (err) => {
          assert.match(err.message, /Maximum 7 situations/);
          return true;
        }
      );
    } finally {
      await cleanup();
    }
  });

  await t.test("createSituation with 7 rows returns SITUATION_LIMIT_REACHED code", async () => {
    await cleanup();
    try {
      await assert.rejects(
        () => createSituation({
          slug: TEST_SLUG,
          sort_order: 99,
          translations: { en: { title: "Should Fail" } },
        }),
        (err) => {
          assert.equal(err.code, "SITUATION_LIMIT_REACHED");
          assert.match(err.message, /Maximum 7 situations/);
          return true;
        }
      );
    } finally {
      await cleanup();
    }
  });

  await t.test("createSituation + getSituationBySlug round-trip", async () => {
    await cleanup();
    try {
      const [countRows] = await pool.query("SELECT COUNT(*) AS cnt FROM situations");
      if (Number(countRows[0].cnt) >= 7) {
        await pool.query("DELETE FROM situations WHERE slug = ?", [SEED_SITUATIONS[SEED_SITUATIONS.length - 1].slug]);
      }

      const id = await createSituation({
        slug: TEST_SLUG,
        sort_order: 99,
        is_active: 1,
        translations: {
          en: { title: "Test Situation" },
          th: { title: "สถานการณ์ทดสอบ" },
        },
      });
      assert.ok(id > 0);

      const item = await getSituationBySlug(TEST_SLUG);
      assert.ok(item);
      assert.equal(item.slug, TEST_SLUG);
      assert.equal(item.sort_order, 99);
      assert.ok(item.translations.length >= 2);

      const en = item.translations.find((t) => t.lang === "en");
      assert.ok(en);
      assert.equal(en.title, "Test Situation");
    } finally {
      await cleanup();
      await restoreSeed();
    }
  });

  await t.test("listSituations with unsupported lang falls back to en title", async () => {
    await cleanup();
    try {
      const [countRows] = await pool.query("SELECT COUNT(*) AS cnt FROM situations");
      if (Number(countRows[0].cnt) >= 7) {
        await pool.query("DELETE FROM situations WHERE slug = ?", [SEED_SITUATIONS[SEED_SITUATIONS.length - 1].slug]);
      }

      await createSituation({
        slug: TEST_SLUG,
        sort_order: 99,
        translations: {
          en: { title: "Fallback Title" },
        },
      });

      const rows = await listSituations("ja");
      const item = rows.find((r) => r.slug === TEST_SLUG);
      assert.ok(item, "test situation should appear in list");
      assert.equal(item.title, "Fallback Title");
    } finally {
      await cleanup();
      await restoreSeed();
    }
  });

  await t.test("updateSituationBySlug with empty th.title removes th translation row", async () => {
    await cleanup();
    try {
      const [countRows] = await pool.query("SELECT COUNT(*) AS cnt FROM situations");
      if (Number(countRows[0].cnt) >= 7) {
        await pool.query("DELETE FROM situations WHERE slug = ?", [SEED_SITUATIONS[SEED_SITUATIONS.length - 1].slug]);
      }

      await createSituation({
        slug: TEST_SLUG,
        sort_order: 1,
        translations: {
          en: { title: "EN Keep" },
          th: { title: "TH Remove" },
        },
      });

      await updateSituationBySlug(TEST_SLUG, {
        translations: { en: { title: "EN Keep" }, th: { title: "" } },
      });

      const item = await getSituationBySlug(TEST_SLUG);
      assert.ok(item);
      const thRow = item.translations.find((r) => r.lang === "th");
      assert.equal(thRow, undefined, "th translation should be deleted");
      const enRow = item.translations.find((r) => r.lang === "en");
      assert.ok(enRow, "en translation should still exist");
      assert.equal(enRow.title, "EN Keep");
    } finally {
      await cleanup();
      await restoreSeed();
    }
  });

  await t.test("validateSituationUpdatePayload rejects empty en.title", () => {
    const result = validateSituationUpdatePayload({
      translations: { en: { title: "" } },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /English title/i);
  });

});

test("teardown: close pool", async () => {
  await pool.end();
});
