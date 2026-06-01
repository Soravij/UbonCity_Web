import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";
import { createTestClient } from "./lib/test-client.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nowIso() {
  return new Date().toISOString();
}

function logStep(step, detail = "") {
  const suffix = String(detail || "").trim();
  console.error(`[${nowIso()}] smoke-ai-input-cleanup step=${step}${suffix ? ` ${suffix}` : ""}`);
}

function createFixture(db) {
  const uid = `smoke-ai-input-cleanup-${crypto.randomUUID()}`;
  const slug = `smoke-ai-input-cleanup-${Date.now()}`;
  const title = "Smoke AI Input Cleanup";
  const itemResult = db.prepare(`
    INSERT INTO content_items (
      item_uid, type, category, lang, title, normalized_title, slug, description_raw, description_clean, summary, workflow_status, is_deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(uid, "place", "attractions", "th", title, title.toLowerCase(), slug, "smoke fixture", "smoke fixture", "smoke fixture", "cleaned");
  const itemId = Number(itemResult.lastInsertRowid || 0) || 0;
  assert(itemId > 0, "failed to create item fixture");

  const fieldPackId = Number(db.prepare(`
    INSERT INTO field_packs (
      content_item_id, status, is_current, ai_summary, updated_by
    ) VALUES (?, ?, 1, ?, ?)
  `).run(itemId, "ready_for_field", "smoke field pack", "smoke-ai-input-cleanup").lastInsertRowid || 0) || 0;
  assert(fieldPackId > 0, "failed to create field pack fixture");

  db.prepare(`
    INSERT INTO content_workflow_models (
      content_item_id, production_state, publication_state, assignment_state, current_field_pack_id, updated_by, last_actor_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(itemId, "brief_generated", "draft", null, fieldPackId, "smoke-ai-input-cleanup", "smoke-ai-input-cleanup@example.com");

  const createAsset = (name) => Number(db.prepare(`
    INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `asset-${name}-${crypto.randomUUID()}`,
    "local",
    `smoke/ai-cleanup/${crypto.randomUUID()}.jpg`,
    `${name}.jpg`,
    "image/jpeg",
    1000,
    `smoke-${name}`
  ).lastInsertRowid || 0) || 0;

  const deletableAssetId = createAsset("deletable");
  const mediaHintAssetId = createAsset("media-hint");
  const assignmentWorkAssetId = createAsset("assignment-work");

  const linkAsset = (assetId, role, selectedInClean, placementType, assignmentSurface = null) => Number(db.prepare(`
    INSERT INTO content_assets (
      content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order, assignment_surface
    ) VALUES (?, ?, ?, ?, 0, ?, 0, ?)
  `).run(itemId, assetId, role, selectedInClean ? 1 : 0, placementType, assignmentSurface).lastInsertRowid || 0) || 0;

  const deletableContentAssetId = linkAsset(deletableAssetId, "gallery", true, "gallery", null);
  const mediaHintContentAssetId = linkAsset(mediaHintAssetId, "gallery", true, "gallery", null);
  const assignmentWorkContentAssetId = linkAsset(assignmentWorkAssetId, "gallery", true, "gallery", "assignment_work");

  db.prepare(`
    INSERT INTO field_pack_media_hints (
      field_pack_id, content_asset_id, url, kind, caption, selected, item_order
    ) VALUES (?, ?, ?, ?, ?, 1, 0)
  `).run(fieldPackId, mediaHintContentAssetId, `https://example.com/smoke/media-hint/${mediaHintAssetId}`, "reference", "smoke media hint");

  return {
    itemId,
    fieldPackId,
    deletableAssetId,
    mediaHintAssetId,
    assignmentWorkAssetId,
    deletableContentAssetId,
    mediaHintContentAssetId,
    assignmentWorkContentAssetId,
  };
}

function installCleanupFailureTrigger(db, fixture) {
  const contentAssetId = Number(fixture?.deletableContentAssetId || 0) || 0;
  assert(contentAssetId > 0, "missing deletable content asset for failure trigger");
  const triggerName = `smoke_cleanup_fail_${contentAssetId}`;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${triggerName}
    BEFORE DELETE ON content_assets
    WHEN OLD.id = ${contentAssetId}
    BEGIN
      SELECT RAISE(FAIL, 'smoke_cleanup_delete_link_failed');
    END;
  `);
  return triggerName;
}

function cleanupFixture(db, fixture) {
  const itemId = Number(fixture?.itemId || 0) || 0;
  if (!itemId) return;
  const triggerName = String(fixture?.cleanupFailureTrigger || "").trim();
  if (triggerName) {
    db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
  }
  db.prepare("DELETE FROM content_assignment_submission_deliverables WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_assignment_submissions WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_assignment_handoff_snapshots WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_assignments WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM field_pack_media_hints WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(itemId);
  db.prepare("DELETE FROM field_pack_checklists WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(itemId);
  db.prepare("DELETE FROM field_pack_references WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(itemId);
  db.prepare("DELETE FROM field_packs WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_assets WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM assets WHERE id IN (?, ?, ?)").run(
    Number(fixture?.deletableAssetId || 0) || 0,
    Number(fixture?.mediaHintAssetId || 0) || 0,
    Number(fixture?.assignmentWorkAssetId || 0) || 0
  );
  db.prepare("DELETE FROM content_items WHERE id=?").run(itemId);
}

async function createAssignmentFromReadiness(client, itemId, ownerId, forceReason) {
  return client.post(`/api/items/${itemId}/assignments/from-readiness`, {
    force_override: true,
    force_reason: forceReason,
    assignee_user_id: ownerId,
    assignment_kind: "field",
    contributor_note: "smoke create assignment",
    internal_note: "smoke create assignment",
  });
}

function verifySuccessCleanup(db, fixture, createRes) {
  assert(createRes.status === 201, `create assignment failed: ${JSON.stringify(createRes.body)}`);
  assert(createRes.body?.ok === true, `create assignment response invalid: ${JSON.stringify(createRes.body)}`);
  const cleanup = createRes.body?.ai_input_cleanup || {};
  assert(cleanup && typeof cleanup === "object", "ai_input_cleanup should exist");

  logStep("verify.cleanup.summary");
  assert(Number(cleanup.ai_input_assets || 0) >= 3, `expected >=3 ai input assets: ${JSON.stringify(cleanup)}`);
  assert(Number(cleanup.eligible_assets || 0) >= 1, `expected >=1 eligible asset: ${JSON.stringify(cleanup)}`);
  assert(Number(cleanup.removed_links || 0) >= 1, `expected >=1 removed link: ${JSON.stringify(cleanup)}`);

  const findContentAsset = db.prepare("SELECT * FROM content_assets WHERE content_item_id=? AND asset_id=? LIMIT 1");
  const findAsset = db.prepare("SELECT * FROM assets WHERE id=? LIMIT 1");

  logStep("verify.deletable.removed");
  const deletedLink = findContentAsset.get(fixture.itemId, fixture.deletableAssetId);
  assert(!deletedLink, "deletable AI input content_asset link should be removed");
  const deletedAsset = findAsset.get(fixture.deletableAssetId);
  assert(!deletedAsset, "deletable AI input asset row should be removed");

  logStep("verify.media_hint.protected");
  const mediaHintLink = findContentAsset.get(fixture.itemId, fixture.mediaHintAssetId);
  assert(Boolean(mediaHintLink), "media-hint referenced content_asset should remain");
  const mediaHintAsset = findAsset.get(fixture.mediaHintAssetId);
  assert(Boolean(mediaHintAsset), "media-hint referenced asset should remain");

  logStep("verify.assignment_work.protected");
  const assignmentWorkLink = findContentAsset.get(fixture.itemId, fixture.assignmentWorkAssetId);
  assert(Boolean(assignmentWorkLink), "assignment_work content_asset should remain");
  const assignmentWorkAsset = findAsset.get(fixture.assignmentWorkAssetId);
  assert(Boolean(assignmentWorkAsset), "assignment_work asset should remain");

  return cleanup;
}

function verifyCleanupFailureContract(db, fixture, createRes) {
  assert(createRes.status === 201, `cleanup failure contract should still return 201: ${JSON.stringify(createRes.body)}`);
  assert(createRes.body?.ok === true, `assignment should still be created: ${JSON.stringify(createRes.body)}`);
  assert(String(createRes.body?.warning || "").trim() === "Assignment created but AI input cleanup failed", `missing cleanup warning: ${JSON.stringify(createRes.body)}`);
  assert(createRes.body?.ai_input_cleanup?.ok === false, `ai_input_cleanup should report failure: ${JSON.stringify(createRes.body)}`);
  assert(String(createRes.body?.ai_input_cleanup?.error || "").includes("smoke_cleanup_delete_link_failed"), `cleanup error should expose deterministic trigger failure: ${JSON.stringify(createRes.body)}`);

  const assignmentCount = Number(
    db.prepare("SELECT COUNT(*) AS c FROM content_assignments WHERE content_item_id=?").get(fixture.itemId)?.c || 0
  );
  assert(assignmentCount === 1, `assignment should be created exactly once in failure contract scenario, got ${assignmentCount}`);

  const preservedLink = db.prepare("SELECT * FROM content_assets WHERE id=? LIMIT 1").get(fixture.deletableContentAssetId);
  assert(Boolean(preservedLink), "cleanup failure should leave deletable content_asset link in place");
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const dirs = resolvePaths(path.resolve(scriptDir, ".."));
  const db = openDatabase(dirs.dbPath, path.join(dirs.rootDir, "database", "schema.sql"));
  const client = createTestClient();
  let fixture = null;
  let failureFixture = null;

  try {
    logStep("auth.me");
    const me = await client.get("/api/auth/me");
    assert(me.ok, `auth failed: ${JSON.stringify(me.body)}`);
    const ownerId = Number(me.body?.user?.id || 0) || 0;
    assert(ownerId > 0, "owner id missing");
    assert(String(me.body?.user?.role || "").toLowerCase() === "owner", "owner role required");

    logStep("fixture.create");
    fixture = createFixture(db);

    logStep("assignment.create.from_readiness.success_path");
    const createRes = await createAssignmentFromReadiness(client, fixture.itemId, ownerId, "smoke ai input cleanup");
    const cleanup = verifySuccessCleanup(db, fixture, createRes);

    logStep("fixture.create.failure_path");
    failureFixture = createFixture(db);
    failureFixture.cleanupFailureTrigger = installCleanupFailureTrigger(db, failureFixture);

    logStep("assignment.create.from_readiness.cleanup_failure");
    const failureRes = await createAssignmentFromReadiness(client, failureFixture.itemId, ownerId, "smoke ai input cleanup failure");
    verifyCleanupFailureContract(db, failureFixture, failureRes);

    console.log(JSON.stringify({
      ok: true,
      item_id: fixture.itemId,
      assignment_id: Number(createRes.body?.assignment?.id || 0) || null,
      cleanup_summary: cleanup,
      checks: {
        create_assignment_succeeded: true,
        ai_input_cleanup_payload_exists: true,
        ai_input_deletable_asset_removed: true,
        media_hint_referenced_asset_preserved: true,
        assignment_work_asset_preserved: true,
        cleanup_failure_returns_201_with_warning: true,
        cleanup_failure_does_not_create_duplicate_assignment: true,
      },
    }, null, 2));
  } finally {
    try {
      if (fixture) cleanupFixture(db, fixture);
      if (failureFixture) cleanupFixture(db, failureFixture);
    } finally {
      if (typeof db.close === "function") db.close();
    }
  }
}

main().catch((err) => {
  console.error(`smoke-ai-input-cleanup-post-assignment: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
