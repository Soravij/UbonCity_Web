import test from "node:test";
import assert from "node:assert/strict";

import pool from "../config/db.js";
import { listSituations, getSituationBySlug, createSituation, deleteSituationBySlug } from "../repositories/situationRepository.js";
import { validateSituationCreatePayload } from "../validators/situationValidator.js";

const TEST_SLUG = "test-situation-api-probe";

async function cleanup() {
  await pool.query("DELETE FROM situations WHERE slug = ?", [TEST_SLUG]);
}

test("situations API", async (t) => {

  await t.test("listSituations returns seed data (4 rows)", async () => {
    const rows = await listSituations("th");
    assert.ok(rows.length >= 4, `expected >= 4, got ${rows.length}`);
    const slugs = rows.map((r) => r.slug);
    assert.ok(slugs.includes("day-trip"));
    assert.ok(slugs.includes("budget-500"));
    assert.ok(slugs.includes("couple"));
    assert.ok(slugs.includes("family"));
  });

  await t.test("createSituation without en translation fails validation", () => {
    const result = validateSituationCreatePayload({
      slug: "no-en",
      translations: { th: { title: "ทดสอบ" } },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /English title/i);
  });

  await t.test("createSituation + getSituationBySlug round-trip", async () => {
    await cleanup();
    try {
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
    }
  });

  await t.test("listSituations with unsupported lang falls back to en title", async () => {
    await cleanup();
    try {
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
    }
  });

});

test("teardown: close pool", async () => {
  await pool.end();
});
