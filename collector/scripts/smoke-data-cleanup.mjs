import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";
import { createTestClient } from "./lib/test-client.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function logStep(step, detail = "") {
  const suffix = String(detail || "").trim();
  console.error(`[${nowIso()}] smoke-data-cleanup step=${step}${suffix ? ` ${suffix}` : ""}`);
}

function createDeletedItem(db, {
  titleSuffix,
  withSourceRecord = false,
  withFieldPack = false,
  withPublishedArticle = false,
  withReviewAction = false,
  withIntelligenceModel = false,
}) {
  const uid = `smoke-cleanup-${crypto.randomUUID()}`;
  const title = `Smoke Cleanup ${titleSuffix}`;
  const slug = `smoke-cleanup-${titleSuffix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  const insertItem = db.prepare(`
    INSERT INTO content_items (
      item_uid, type, category, lang, title, normalized_title, slug, description_raw, workflow_status, is_deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const result = insertItem.run(
    uid,
    "place",
    "attraction",
    "th",
    title,
    title.toLowerCase(),
    slug,
    "smoke cleanup fixture",
    "raw"
  );
  const itemId = Number(result.lastInsertRowid || 0) || 0;
  assert(itemId > 0, `failed to create deleted item for ${titleSuffix}`);

  if (withSourceRecord) {
    db.prepare(`
      INSERT INTO source_records (
        content_item_id, source_type, source_name, source_url, payload_json
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      itemId,
      "smoke",
      "Smoke Source",
      `https://example.com/smoke-cleanup/${itemId}`,
      JSON.stringify({ fixture: true, blocker: "source_records" })
    );
  }

  if (withFieldPack) {
    db.prepare(`
      INSERT INTO field_packs (
        content_item_id, status, is_current, ai_summary, ai_highlights_json, ai_unknowns_json,
        verified_facts_json, uncertain_facts_json, social_shot_emphasis_json, social_on_camera_points_json, updated_by
      ) VALUES (?, ?, 1, ?, '[]', '[]', '[]', '[]', '[]', '[]', ?)
    `).run(
      itemId,
      "ready_for_field",
      `Smoke field pack for ${titleSuffix}`,
      "smoke-data-cleanup"
    );
  }

  if (withPublishedArticle) {
    db.prepare(`
      INSERT INTO published_articles (
        content_item_id, slug, title, body, excerpt, meta_title, meta_description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId,
      `${slug}-published`,
      title,
      `Published body for ${titleSuffix}`,
      `Published excerpt for ${titleSuffix}`,
      title,
      `Published meta description for ${titleSuffix}`,
      "published"
    );
  }

  if (withReviewAction) {
    db.prepare(`
      INSERT INTO review_actions (
        content_item_id, action, reviewer_email, notes
      ) VALUES (?, ?, ?, ?)
    `).run(
      itemId,
      "approve",
      "smoke-data-cleanup@example.com",
      `Smoke review action for ${titleSuffix}`
    );
  }

  if (withIntelligenceModel) {
    db.prepare(`
      INSERT INTO content_intelligence_models (
        content_item_id, model_version, quality_score, popularity_score, momentum_score,
        confidence_score, signals_json, reasons_json, payload_json, computed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId,
      "smoke_v1",
      50,
      50,
      50,
      70,
      "{}",
      "[]",
      "{}",
      "smoke-data-cleanup"
    );
  }

  return { id: itemId, item_uid: uid, title, slug };
}

function cleanupFixture(db, itemId) {
  const id = Number(itemId || 0) || 0;
  if (!id) return;
  db.prepare("DELETE FROM review_actions WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_intelligence_models WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM published_articles WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM field_packs WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM source_records WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_items WHERE id=?").run(id);
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const dirs = resolvePaths(path.resolve(scriptDir, ".."));
  const db = openDatabase(dirs.dbPath, path.join(dirs.rootDir, "database", "schema.sql"));
  const client = createTestClient();

  let purgeableFixture = null;
  let blockedSourceFixture = null;
  let blockedFieldPackFixture = null;
  let blockedPublishedFixture = null;
  let blockedReviewActionFixture = null;
  let blockedIntelligenceFixture = null;
  try {
    logStep("auth.me");
    const auth = await client.get("/api/auth/me");
    assert(auth.ok, `GET /api/auth/me failed: ${JSON.stringify(auth.body)}`);
    const role = String(auth.body?.user?.role || "").trim().toLowerCase();
    assert(role === "owner", `owner role required for cleanup smoke: ${JSON.stringify(auth.body?.user || null)}`);

    logStep("fixture.create");
    purgeableFixture = createDeletedItem(db, { titleSuffix: "Purgeable" });
    blockedSourceFixture = createDeletedItem(db, { titleSuffix: "Blocked Source", withSourceRecord: true });
    blockedFieldPackFixture = createDeletedItem(db, { titleSuffix: "Blocked Field Pack", withFieldPack: true });
    blockedPublishedFixture = createDeletedItem(db, { titleSuffix: "Blocked Published", withPublishedArticle: true });
    blockedReviewActionFixture = createDeletedItem(db, { titleSuffix: "Blocked Review Action", withReviewAction: true });
    blockedIntelligenceFixture = createDeletedItem(db, { titleSuffix: "Blocked Intelligence", withIntelligenceModel: true });

    logStep("list.deleted");
    const listed = await client.get("/api/admin/deleted-items?limit=200");
    assert(listed.ok, `GET /api/admin/deleted-items failed: ${JSON.stringify(listed.body)}`);
    const listedIds = new Set((listed.body?.items || []).map((row) => Number(row?.id || 0) || 0));
    assert(listedIds.has(purgeableFixture.id), `purgeable fixture missing from list: ${JSON.stringify(listed.body)}`);
    assert(listedIds.has(blockedSourceFixture.id), `blocked source fixture missing from list: ${JSON.stringify(listed.body)}`);
    assert(listedIds.has(blockedFieldPackFixture.id), `blocked field pack fixture missing from list: ${JSON.stringify(listed.body)}`);
    assert(listedIds.has(blockedPublishedFixture.id), `blocked published fixture missing from list: ${JSON.stringify(listed.body)}`);
    assert(listedIds.has(blockedReviewActionFixture.id), `blocked review action fixture missing from list: ${JSON.stringify(listed.body)}`);
    assert(listedIds.has(blockedIntelligenceFixture.id), `blocked intelligence fixture missing from list: ${JSON.stringify(listed.body)}`);

    logStep("check.purgeable", `item_id=${purgeableFixture.id}`);
    const purgeableCheck = await client.get(`/api/admin/deleted-items/${purgeableFixture.id}/cleanup-check`);
    assert(purgeableCheck.ok, `cleanup-check purgeable failed: ${JSON.stringify(purgeableCheck.body)}`);
    assert(Boolean(purgeableCheck.body?.item?.can_purge), `purgeable item should be purgeable: ${JSON.stringify(purgeableCheck.body)}`);
    assert((purgeableCheck.body?.item?.blockers || []).length === 0, `purgeable item blockers mismatch: ${JSON.stringify(purgeableCheck.body)}`);

    logStep("check.blocked.source", `item_id=${blockedSourceFixture.id}`);
    const blockedSourceCheck = await client.get(`/api/admin/deleted-items/${blockedSourceFixture.id}/cleanup-check`);
    assert(blockedSourceCheck.ok, `cleanup-check blocked source failed: ${JSON.stringify(blockedSourceCheck.body)}`);
    assert(blockedSourceCheck.body?.item?.can_purge === false, `blocked source item should not be purgeable: ${JSON.stringify(blockedSourceCheck.body)}`);
    assert(
      (blockedSourceCheck.body?.item?.blockers || []).some((row) => String(row?.key || "").trim() === "source_records"),
      `blocked source item should expose source_records blocker: ${JSON.stringify(blockedSourceCheck.body)}`
    );

    logStep("check.blocked.field_pack", `item_id=${blockedFieldPackFixture.id}`);
    const blockedFieldPackCheck = await client.get(`/api/admin/deleted-items/${blockedFieldPackFixture.id}/cleanup-check`);
    assert(blockedFieldPackCheck.ok, `cleanup-check blocked field pack failed: ${JSON.stringify(blockedFieldPackCheck.body)}`);
    assert(blockedFieldPackCheck.body?.item?.can_purge === false, `blocked field pack item should not be purgeable: ${JSON.stringify(blockedFieldPackCheck.body)}`);
    assert(
      (blockedFieldPackCheck.body?.item?.blockers || []).some((row) => String(row?.key || "").trim() === "field_packs"),
      `blocked field pack item should expose field_packs blocker: ${JSON.stringify(blockedFieldPackCheck.body)}`
    );

    logStep("check.blocked.published", `item_id=${blockedPublishedFixture.id}`);
    const blockedPublishedCheck = await client.get(`/api/admin/deleted-items/${blockedPublishedFixture.id}/cleanup-check`);
    assert(blockedPublishedCheck.ok, `cleanup-check blocked published failed: ${JSON.stringify(blockedPublishedCheck.body)}`);
    assert(blockedPublishedCheck.body?.item?.can_purge === false, `blocked published item should not be purgeable: ${JSON.stringify(blockedPublishedCheck.body)}`);
    assert(
      (blockedPublishedCheck.body?.item?.blockers || []).some((row) => String(row?.key || "").trim() === "published_articles"),
      `blocked published item should expose published_articles blocker: ${JSON.stringify(blockedPublishedCheck.body)}`
    );

    logStep("check.blocked.review_action", `item_id=${blockedReviewActionFixture.id}`);
    const blockedReviewActionCheck = await client.get(`/api/admin/deleted-items/${blockedReviewActionFixture.id}/cleanup-check`);
    assert(blockedReviewActionCheck.ok, `cleanup-check blocked review action failed: ${JSON.stringify(blockedReviewActionCheck.body)}`);
    assert(blockedReviewActionCheck.body?.item?.can_purge === false, `blocked review action item should not be purgeable: ${JSON.stringify(blockedReviewActionCheck.body)}`);
    assert(
      (blockedReviewActionCheck.body?.item?.blockers || []).some((row) => String(row?.key || "").trim() === "review_actions"),
      `blocked review action item should expose review_actions blocker: ${JSON.stringify(blockedReviewActionCheck.body)}`
    );

    logStep("check.blocked.intelligence", `item_id=${blockedIntelligenceFixture.id}`);
    const blockedIntelligenceCheck = await client.get(`/api/admin/deleted-items/${blockedIntelligenceFixture.id}/cleanup-check`);
    assert(blockedIntelligenceCheck.ok, `cleanup-check blocked intelligence failed: ${JSON.stringify(blockedIntelligenceCheck.body)}`);
    assert(blockedIntelligenceCheck.body?.item?.can_purge === false, `blocked intelligence item should not be purgeable: ${JSON.stringify(blockedIntelligenceCheck.body)}`);
    assert(
      (blockedIntelligenceCheck.body?.item?.blockers || []).some((row) => String(row?.key || "").trim() === "content_intelligence_models"),
      `blocked intelligence item should expose content_intelligence_models blocker: ${JSON.stringify(blockedIntelligenceCheck.body)}`
    );

    logStep("purge.blocked.source", `item_id=${blockedSourceFixture.id}`);
    const blockedSourcePurge = await client.post(`/api/admin/deleted-items/${blockedSourceFixture.id}/purge`, { reason: "smoke blocked source" });
    assert(blockedSourcePurge.status === 409, `blocked source purge status mismatch: ${blockedSourcePurge.status} ${JSON.stringify(blockedSourcePurge.body)}`);
    assert(
      (blockedSourcePurge.body?.blockers || []).some((row) => String(row?.key || "").trim() === "source_records"),
      `blocked source purge response missing source_records blocker: ${JSON.stringify(blockedSourcePurge.body)}`
    );

    logStep("purge.blocked.field_pack", `item_id=${blockedFieldPackFixture.id}`);
    const blockedFieldPackPurge = await client.post(`/api/admin/deleted-items/${blockedFieldPackFixture.id}/purge`, { reason: "smoke blocked field pack" });
    assert(blockedFieldPackPurge.status === 409, `blocked field pack purge status mismatch: ${blockedFieldPackPurge.status} ${JSON.stringify(blockedFieldPackPurge.body)}`);
    assert(
      (blockedFieldPackPurge.body?.blockers || []).some((row) => String(row?.key || "").trim() === "field_packs"),
      `blocked field pack purge response missing field_packs blocker: ${JSON.stringify(blockedFieldPackPurge.body)}`
    );

    logStep("purge.blocked.published", `item_id=${blockedPublishedFixture.id}`);
    const blockedPublishedPurge = await client.post(`/api/admin/deleted-items/${blockedPublishedFixture.id}/purge`, { reason: "smoke blocked published" });
    assert(blockedPublishedPurge.status === 409, `blocked published purge status mismatch: ${blockedPublishedPurge.status} ${JSON.stringify(blockedPublishedPurge.body)}`);
    assert(
      (blockedPublishedPurge.body?.blockers || []).some((row) => String(row?.key || "").trim() === "published_articles"),
      `blocked published purge response missing published_articles blocker: ${JSON.stringify(blockedPublishedPurge.body)}`
    );

    logStep("purge.blocked.review_action", `item_id=${blockedReviewActionFixture.id}`);
    const blockedReviewActionPurge = await client.post(
      `/api/admin/deleted-items/${blockedReviewActionFixture.id}/purge`,
      { reason: "smoke blocked review action" }
    );
    assert(
      blockedReviewActionPurge.status === 409,
      `blocked review action purge status mismatch: ${blockedReviewActionPurge.status} ${JSON.stringify(blockedReviewActionPurge.body)}`
    );
    assert(
      (blockedReviewActionPurge.body?.blockers || []).some((row) => String(row?.key || "").trim() === "review_actions"),
      `blocked review action purge response missing review_actions blocker: ${JSON.stringify(blockedReviewActionPurge.body)}`
    );

    logStep("purge.blocked.intelligence", `item_id=${blockedIntelligenceFixture.id}`);
    const blockedIntelligencePurge = await client.post(
      `/api/admin/deleted-items/${blockedIntelligenceFixture.id}/purge`,
      { reason: "smoke blocked intelligence" }
    );
    assert(
      blockedIntelligencePurge.status === 409,
      `blocked intelligence purge status mismatch: ${blockedIntelligencePurge.status} ${JSON.stringify(blockedIntelligencePurge.body)}`
    );
    assert(
      (blockedIntelligencePurge.body?.blockers || []).some((row) => String(row?.key || "").trim() === "content_intelligence_models"),
      `blocked intelligence purge response missing content_intelligence_models blocker: ${JSON.stringify(blockedIntelligencePurge.body)}`
    );

    logStep("purge.purgeable", `item_id=${purgeableFixture.id}`);
    const purged = await client.post(`/api/admin/deleted-items/${purgeableFixture.id}/purge`, { reason: "smoke purgeable" });
    assert(purged.ok, `purge purgeable failed: ${JSON.stringify(purged.body)}`);
    assert(purged.body?.purged === true, `purged flag mismatch: ${JSON.stringify(purged.body)}`);
    assert(purged.body?.item?.purged === true, `purged item contract mismatch: ${JSON.stringify(purged.body)}`);
    assert(!("can_purge" in (purged.body?.item || {})), `purge response should not return cleanup report contract: ${JSON.stringify(purged.body)}`);

    logStep("verify.removed", `item_id=${purgeableFixture.id}`);
    const purgeableAfter = await client.get(`/api/admin/deleted-items/${purgeableFixture.id}/cleanup-check`);
    assert(purgeableAfter.status === 404, `purged item should be gone from cleanup-check: ${purgeableAfter.status} ${JSON.stringify(purgeableAfter.body)}`);

    const listedAfter = await client.get("/api/admin/deleted-items?limit=200");
    assert(listedAfter.ok, `GET /api/admin/deleted-items after purge failed: ${JSON.stringify(listedAfter.body)}`);
    const listedAfterIds = new Set((listedAfter.body?.items || []).map((row) => Number(row?.id || 0) || 0));
    assert(!listedAfterIds.has(purgeableFixture.id), `purged item still listed after purge: ${JSON.stringify(listedAfter.body)}`);
    assert(listedAfterIds.has(blockedSourceFixture.id), `blocked source item should remain listed after failed purge: ${JSON.stringify(listedAfter.body)}`);
    assert(listedAfterIds.has(blockedFieldPackFixture.id), `blocked field pack item should remain listed after failed purge: ${JSON.stringify(listedAfter.body)}`);
    assert(listedAfterIds.has(blockedPublishedFixture.id), `blocked published item should remain listed after failed purge: ${JSON.stringify(listedAfter.body)}`);
    assert(
      listedAfterIds.has(blockedReviewActionFixture.id),
      `blocked review action item should remain listed after failed purge: ${JSON.stringify(listedAfter.body)}`
    );
    assert(
      listedAfterIds.has(blockedIntelligenceFixture.id),
      `blocked intelligence item should remain listed after failed purge: ${JSON.stringify(listedAfter.body)}`
    );

    console.log(JSON.stringify({
      ok: true,
      auth_user: auth.body?.user || null,
      fixtures: {
        purgeable_item_id: purgeableFixture.id,
        blocked_source_item_id: blockedSourceFixture.id,
        blocked_field_pack_item_id: blockedFieldPackFixture.id,
        blocked_published_item_id: blockedPublishedFixture.id,
        blocked_review_action_item_id: blockedReviewActionFixture.id,
        blocked_intelligence_item_id: blockedIntelligenceFixture.id,
      },
      checks: {
        purgeable_can_purge: true,
        blocked_source_can_purge: false,
        blocked_source_reason_key: "source_records",
        blocked_field_pack_can_purge: false,
        blocked_field_pack_reason_key: "field_packs",
        blocked_published_can_purge: false,
        blocked_published_reason_key: "published_articles",
        blocked_review_action_can_purge: false,
        blocked_review_action_reason_key: "review_actions",
        blocked_intelligence_can_purge: false,
        blocked_intelligence_reason_key: "content_intelligence_models",
        purged_item_removed: true,
      },
    }, null, 2));
  } finally {
    try {
      if (blockedIntelligenceFixture?.id) cleanupFixture(db, blockedIntelligenceFixture.id);
      if (blockedReviewActionFixture?.id) cleanupFixture(db, blockedReviewActionFixture.id);
      if (blockedPublishedFixture?.id) cleanupFixture(db, blockedPublishedFixture.id);
      if (blockedFieldPackFixture?.id) cleanupFixture(db, blockedFieldPackFixture.id);
      if (blockedSourceFixture?.id) cleanupFixture(db, blockedSourceFixture.id);
      if (purgeableFixture?.id) cleanupFixture(db, purgeableFixture.id);
    } finally {
      if (typeof db.close === "function") {
        db.close();
      }
    }
  }
}

main().catch((err) => {
  console.error(`smoke-data-cleanup: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
