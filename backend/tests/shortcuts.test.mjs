import test from "node:test";
import assert from "node:assert/strict";

import pool from "../config/db.js";
import { createShortcut, deleteShortcutBySlug } from "../repositories/shortcutRepository.js";

const TEST_SLUG = "__test-shortcut-probe";
const TEST_SLUG2 = "test-sc-409-probe";
const TEST_FILL_PREFIX = "__test-fill-shortcut-";

async function cleanupTestShortcuts() {
  await pool.query("DELETE FROM shortcut_places WHERE shortcut_id IN (SELECT id FROM shortcuts WHERE slug LIKE ?)", ["\\_\\_test-fill-shortcut-%"]);
  await pool.query("DELETE FROM shortcuts WHERE slug LIKE ?", ["\\_\\_test-fill-shortcut-%"]);
  await pool.query("DELETE FROM shortcut_places WHERE shortcut_id IN (SELECT id FROM shortcuts WHERE slug = ?)", [TEST_SLUG]);
  await pool.query("DELETE FROM shortcuts WHERE slug = ?", [TEST_SLUG]);
  await pool.query("DELETE FROM shortcut_places WHERE shortcut_id IN (SELECT id FROM shortcuts WHERE slug = ?)", [TEST_SLUG2]);
  await pool.query("DELETE FROM shortcuts WHERE slug = ?", [TEST_SLUG2]);
  await pool.query("DELETE FROM places WHERE slug LIKE ?", ["\\_\\_test-shortcut-probe-%"]);
}

async function ensureShortcutCount(target) {
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) AS cnt FROM shortcuts");
  const current = Number(cnt);
  if (current >= target) return [];
  const inserted = [];
  for (let i = 0; i < target - current; i++) {
    const slug = `${TEST_FILL_PREFIX}${Date.now()}-${i}`;
    const [r] = await pool.query("INSERT INTO shortcuts (slug, sort_order) VALUES (?, ?)", [slug, 900 + i]);
    inserted.push({ id: Number(r.insertId), slug });
  }
  return inserted;
}

test("shortcuts API", async (t) => {

  // --- A. Shortcut limit = 6 ---

  await t.test("A1: createShortcut succeeds when 5 rows exist", async () => {
    await cleanupTestShortcuts();
    const fills = await ensureShortcutCount(5);
    try {
      const id = await createShortcut({ slug: TEST_SLUG, sort_order: 99 });
      assert.ok(id > 0, `expected id > 0, got ${id}`);
    } finally {
      await cleanupTestShortcuts();
    }
  });

  await t.test("A2: createShortcut rejects when 6 rows exist with SHORTCUT_LIMIT_REACHED", async () => {
    await cleanupTestShortcuts();
    const fills = await ensureShortcutCount(6);
    try {
      await assert.rejects(
        () => createShortcut({ slug: TEST_SLUG, sort_order: 99 }),
        (err) => {
          assert.match(err.message, /Maximum 6 shortcuts/);
          assert.equal(err.code, "SHORTCUT_LIMIT_REACHED");
          return true;
        }
      );
    } finally {
      await cleanupTestShortcuts();
    }
  });

  await t.test("A3: POST /api/shortcuts returns 409 when 6 rows exist", async () => {
    await cleanupTestShortcuts();
    const fills = await ensureShortcutCount(6);

    const { default: express } = await import("express");
    const { default: jwt } = await import("jsonwebtoken");
    const shortcutRoutes = (await import("../routes/shortcutRoutes.js")).default;

    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", shortcutRoutes);
    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const secret = process.env.JWT_SECRET;
      const token = jwt.sign({ role: "admin", email: "test@test.com" }, secret, {
        issuer: process.env.JWT_ISSUER || "uboncity-backend",
        audience: process.env.JWT_AUDIENCE_BACKEND || "uboncity-backend",
        expiresIn: "60s",
      });

      const res = await fetch(`http://localhost:${port}/api/shortcuts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slug: TEST_SLUG2, translations: { en: { title: "Should 409" } } }),
      });
      const body = await res.json();
      assert.equal(res.status, 409, `expected 409, got ${res.status}`);
      assert.match(body.error, /Maximum 6 shortcuts/);
    } finally {
      server.close();
      await cleanupTestShortcuts();
    }
  });

  // --- B. GET /api/shortcuts/:slug/places ---

  await t.test("B4: unknown slug returns 404", async () => {
    const { default: express } = await import("express");
    const shortcutRoutes = (await import("../routes/shortcutRoutes.js")).default;

    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", shortcutRoutes);
    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/shortcuts/__test-nonexistent-slug/places`);
      const body = await res.json();
      assert.equal(res.status, 404, `expected 404, got ${res.status}`);
      assert.deepEqual(body, { error: "Shortcut not found" });
    } finally {
      server.close();
    }
  });

  await t.test("B5: shortcut exists with no places returns empty items", async () => {
    await cleanupTestShortcuts();
    await createShortcut({ slug: TEST_SLUG, sort_order: 99 });

    const { default: express } = await import("express");
    const shortcutRoutes = (await import("../routes/shortcutRoutes.js")).default;

    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", shortcutRoutes);
    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/shortcuts/${TEST_SLUG}/places`);
      const body = await res.json();
      assert.equal(res.status, 200, `expected 200, got ${res.status}`);
      assert.deepEqual(body.items, []);
    } finally {
      server.close();
      await cleanupTestShortcuts();
    }
  });

  await t.test("B6: places returned ordered by sort_order ASC", async () => {
    await cleanupTestShortcuts();
    const [scIns] = await pool.query("INSERT INTO shortcuts (slug, sort_order) VALUES (?, ?)", [TEST_SLUG, 99]);
    const scId = Number(scIns.insertId);

    const [[catRow]] = await pool.query("SELECT id FROM categories LIMIT 1");
    const catId = Number(catRow.id);

    const placeIds = [];
    for (let i = 0; i < 3; i++) {
      const [r] = await pool.query(
        "INSERT INTO places (slug, category_id) VALUES (?, ?)",
        [`${TEST_SLUG}-place-${i}`, catId]
      );
      placeIds.push(Number(r.insertId));
    }

    await pool.query("INSERT INTO shortcut_places (shortcut_id, place_id, sort_order) VALUES (?, ?, ?)", [scId, placeIds[2], 3]);
    await pool.query("INSERT INTO shortcut_places (shortcut_id, place_id, sort_order) VALUES (?, ?, ?)", [scId, placeIds[0], 1]);
    await pool.query("INSERT INTO shortcut_places (shortcut_id, place_id, sort_order) VALUES (?, ?, ?)", [scId, placeIds[1], 2]);

    const { default: express } = await import("express");
    const shortcutRoutes = (await import("../routes/shortcutRoutes.js")).default;

    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", shortcutRoutes);
    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/shortcuts/${TEST_SLUG}/places`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.items.length, 3);
      assert.equal(body.items[0].sort_order, 1);
      assert.equal(body.items[1].sort_order, 2);
      assert.equal(body.items[2].sort_order, 3);
    } finally {
      server.close();
      await cleanupTestShortcuts();
    }
  });

  await t.test("B7: 7 places returned completely (no shortcut limit on places)", async () => {
    await cleanupTestShortcuts();
    const [scIns7] = await pool.query("INSERT INTO shortcuts (slug, sort_order) VALUES (?, ?)", [TEST_SLUG, 99]);
    const scId = Number(scIns7.insertId);

    const [[catRow]] = await pool.query("SELECT id FROM categories LIMIT 1");
    const catId = Number(catRow.id);

    for (let i = 0; i < 7; i++) {
      const [r] = await pool.query(
        "INSERT INTO places (slug, category_id) VALUES (?, ?)",
        [`${TEST_SLUG}-seven-${i}`, catId]
      );
      await pool.query(
        "INSERT INTO shortcut_places (shortcut_id, place_id, sort_order) VALUES (?, ?, ?)",
        [scId, Number(r.insertId), i + 1]
      );
    }

    const { default: express } = await import("express");
    const shortcutRoutes = (await import("../routes/shortcutRoutes.js")).default;

    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", shortcutRoutes);
    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/shortcuts/${TEST_SLUG}/places`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.items.length, 7, `expected 7 places, got ${body.items.length}`);
    } finally {
      server.close();
      await cleanupTestShortcuts();
    }
  });

  await t.test("B8: uppercase slug normalized to lowercase", async () => {
    await cleanupTestShortcuts();
    await createShortcut({ slug: TEST_SLUG, sort_order: 99 });

    const { default: express } = await import("express");
    const shortcutRoutes = (await import("../routes/shortcutRoutes.js")).default;

    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", shortcutRoutes);
    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const upperSlug = TEST_SLUG.toUpperCase();
      const res = await fetch(`http://localhost:${port}/api/shortcuts/${upperSlug}/places`);
      const body = await res.json();
      assert.equal(res.status, 200, `expected 200, got ${res.status}`);
      assert.ok(Array.isArray(body.items));
    } finally {
      server.close();
      await cleanupTestShortcuts();
    }
  });

  // --- C. GET /api/situations/:slug/places ---

  await t.test("C9: unknown situation slug returns 404", async () => {
    const { default: express } = await import("express");
    const situationRoutes = (await import("../routes/situationRoutes.js")).default;

    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", situationRoutes);
    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/situations/__test-nonexistent-slug/places`);
      const body = await res.json();
      assert.equal(res.status, 404, `expected 404, got ${res.status}`);
      assert.deepEqual(body, { error: "Situation not found" });
    } finally {
      server.close();
    }
  });

  await t.test("C10: situation exists with no places returns empty items", async () => {
    const SIT_EMPTY_SLUG = "__test-sit-empty-probe";
    await pool.query("DELETE FROM situations WHERE slug = ?", [SIT_EMPTY_SLUG]);
    await pool.query("INSERT INTO situations (slug, sort_order, is_active) VALUES (?, ?, 1)", [SIT_EMPTY_SLUG, 997]);

    const { default: express } = await import("express");
    const situationRoutes = (await import("../routes/situationRoutes.js")).default;

    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", situationRoutes);
    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/situations/${SIT_EMPTY_SLUG}/places`);
      const body = await res.json();
      assert.equal(res.status, 200, `expected 200, got ${res.status}`);
      assert.equal(body.items.length, 0, `expected 0 items, got ${body.items.length}`);
    } finally {
      server.close();
      await pool.query("DELETE FROM situations WHERE slug = ?", [SIT_EMPTY_SLUG]);
    }
  });

  await t.test("C11: situation places ordered by sort_order ASC", async () => {
    const SIT_SLUG = "__test-sit-places-probe";
    await pool.query("DELETE FROM situation_places WHERE situation_id IN (SELECT id FROM situations WHERE slug = ?)", [SIT_SLUG]);
    await pool.query("DELETE FROM situations WHERE slug = ?", [SIT_SLUG]);
    await pool.query("DELETE FROM places WHERE slug LIKE ?", [`${SIT_SLUG}-%`]);

    const [sitIns] = await pool.query("INSERT INTO situations (slug, sort_order, is_active) VALUES (?, ?, 1)", [SIT_SLUG, 998]);
    const sitId = Number(sitIns.insertId);

    const [[catRow]] = await pool.query("SELECT id FROM categories LIMIT 1");
    const catId = Number(catRow.id);

    const placeIds = [];
    for (let i = 0; i < 3; i++) {
      const [r] = await pool.query("INSERT INTO places (slug, category_id) VALUES (?, ?)", [`${SIT_SLUG}-${i}`, catId]);
      placeIds.push(Number(r.insertId));
    }
    await pool.query("INSERT INTO situation_places (situation_id, place_id, sort_order) VALUES (?, ?, ?)", [sitId, placeIds[2], 3]);
    await pool.query("INSERT INTO situation_places (situation_id, place_id, sort_order) VALUES (?, ?, ?)", [sitId, placeIds[0], 1]);
    await pool.query("INSERT INTO situation_places (situation_id, place_id, sort_order) VALUES (?, ?, ?)", [sitId, placeIds[1], 2]);

    const { default: express } = await import("express");
    const situationRoutes = (await import("../routes/situationRoutes.js")).default;
    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", situationRoutes);
    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/situations/${SIT_SLUG}/places`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.items.length, 3);
      assert.equal(body.items[0].sort_order, 1);
      assert.equal(body.items[1].sort_order, 2);
      assert.equal(body.items[2].sort_order, 3);
    } finally {
      server.close();
      await pool.query("DELETE FROM situation_places WHERE situation_id = ?", [sitId]);
      await pool.query("DELETE FROM situations WHERE id = ?", [sitId]);
      for (const pid of placeIds) await pool.query("DELETE FROM places WHERE id = ?", [pid]);
    }
  });

});

test("teardown: close pool", async () => {
  await pool.end();
});
