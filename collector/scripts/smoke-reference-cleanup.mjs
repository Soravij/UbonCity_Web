import "dotenv/config";
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
  console.error(`[${nowIso()}] smoke-reference-cleanup step=${step}${suffix ? ` ${suffix}` : ""}`);
}

function createDeletedItem(db, titleSuffix) {
  const uid = `smoke-reference-${crypto.randomUUID()}`;
  const title = `Smoke Reference ${titleSuffix}`;
  const slug = `smoke-reference-${titleSuffix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  const result = db.prepare(`
    INSERT INTO content_items (
      item_uid, type, category, lang, title, normalized_title, slug, description_raw, workflow_status, is_deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(uid, "place", "attraction", "th", title, title.toLowerCase(), slug, "smoke reference fixture", "raw");
  const itemId = Number(result.lastInsertRowid || 0) || 0;
  assert(itemId > 0, "failed to create deleted item");
  return { id: itemId, title };
}

function createReferenceFixture(db) {
  const item = createDeletedItem(db, "Primary");
  const holder = createDeletedItem(db, "Shared Holder");

  db.prepare(`
    INSERT INTO source_records (content_item_id, source_type, source_name, source_url, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(item.id, "smoke", "Ref Source", `https://example.com/ref/${item.id}`, "{}");
  db.prepare(`
    INSERT INTO reviews_raw (content_item_id, review_text, source_name, source_url)
    VALUES (?, ?, ?, ?)
  `).run(item.id, "review", "smoke", `https://example.com/review/${item.id}`);
  db.prepare(`
    INSERT INTO quality_checks (content_item_id, check_name, status, reason)
    VALUES (?, ?, ?, ?)
  `).run(item.id, "smoke_quality", "failed", "fixture");

  const runUid = `smoke-run-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO content_drafts (
      content_item_id, generation_run_uid, draft_title, excerpt, body, status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(item.id, runUid, "Smoke Draft", "excerpt", "body", "generated");
  const draftId = Number(db.prepare("SELECT id FROM content_drafts WHERE content_item_id=? AND generation_run_uid=?").get(item.id, runUid)?.id || 0) || 0;
  assert(draftId > 0, "failed to create draft");

  const reviewReportId = Number(db.prepare(`
    INSERT INTO review_reports (content_item_id, draft_id, issues_json, report_json, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(item.id, draftId, "[]", "{}", "pending").lastInsertRowid || 0) || 0;
  assert(reviewReportId > 0, "failed to create review report");

  const fieldPackId = Number(db.prepare(`
    INSERT INTO field_packs (
      content_item_id, source_draft_id, source_review_report_id, status, is_current,
      ai_summary, ai_highlights_json, ai_unknowns_json, verified_facts_json, uncertain_facts_json,
      social_shot_emphasis_json, social_on_camera_points_json, updated_by
    ) VALUES (?, ?, ?, ?, 1, ?, '[]', '[]', '[]', '[]', '[]', '[]', ?)
  `).run(item.id, draftId, reviewReportId, "ready_for_field", "Smoke field pack", "smoke-reference-cleanup").lastInsertRowid || 0) || 0;
  assert(fieldPackId > 0, "failed to create field pack");

  db.prepare(`
    INSERT INTO content_workflow_models (
      content_item_id, production_state, publication_state, assignment_state,
      current_draft_id, current_review_report_id, current_field_pack_id,
      updated_by, last_actor_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, "brief_generated", "draft", null, draftId, reviewReportId, fieldPackId, "smoke-reference-cleanup", "smoke-reference-cleanup@example.com");

  const sharedAssetId = Number(db.prepare(`
    INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `asset-shared-${crypto.randomUUID()}`, "local", `smoke/reference/${crypto.randomUUID()}.jpg`, "shared.jpg", "image/jpeg", 1000, "smoke-shared"
  ).lastInsertRowid || 0) || 0;
  const privateAssetId = Number(db.prepare(`
    INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `asset-private-${crypto.randomUUID()}`, "local", `smoke/reference/${crypto.randomUUID()}.jpg`, "private.jpg", "image/jpeg", 1000, "smoke-private"
  ).lastInsertRowid || 0) || 0;

  db.prepare(`
    INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
    VALUES (?, ?, ?, 0, 0, ?, 0)
  `).run(item.id, sharedAssetId, "gallery", "gallery");
  db.prepare(`
    INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
    VALUES (?, ?, ?, 0, 0, ?, 1)
  `).run(item.id, privateAssetId, "gallery", "gallery");
  db.prepare(`
    INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
    VALUES (?, ?, ?, 0, 0, ?, 0)
  `).run(holder.id, sharedAssetId, "gallery", "gallery");

  return { itemId: item.id, holderId: holder.id, sharedAssetId, privateAssetId };
}

function cleanupItem(db, itemId) {
  const id = Number(itemId || 0) || 0;
  if (!id) return;
  db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_drafts WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM review_reports WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM quality_checks WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM reviews_raw WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_assets WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM field_packs WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM source_records WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_items WHERE id=?").run(id);
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const dirs = resolvePaths(path.resolve(scriptDir, ".."));
  const db = openDatabase(dirs.dbPath, path.join(dirs.rootDir, "database", "schema.sql"));
  const client = createTestClient();

  let fixture = null;
  try {
    logStep("auth.me");
    const auth = await client.get("/api/auth/me");
    assert(auth.ok, "auth.me failed");
    assert(String(auth.body?.user?.role || "").toLowerCase() === "owner", "owner role required");

    logStep("fixture.create");
    fixture = createReferenceFixture(db);

    logStep("references.get");
    const before = await client.get(`/api/admin/deleted-items/${fixture.itemId}/references`);
    assert(before.ok, `references get failed: ${JSON.stringify(before.body)}`);
    const keys = new Set((before.body?.groups || []).map((entry) => String(entry?.key || "").trim().toLowerCase()));
    for (const key of ["source_records", "reviews_raw", "quality_checks", "drafts", "review_reports", "field_packs", "content_assets", "content_workflow_models"]) {
      assert(keys.has(key), `missing ${key} in references`);
    }

    logStep("references.invalid");
    const invalid = await client.post(`/api/admin/deleted-items/${fixture.itemId}/references/cleanup`, {
      groups: ["not_a_real_group"],
      reason: "smoke invalid group",
    });
    assert(invalid.status === 400, "invalid group should return 400");
    assert(String(invalid.body?.category || "") === "invalid_group", "invalid group category mismatch");

    logStep("references.cleanup");
    const cleaned = await client.post(`/api/admin/deleted-items/${fixture.itemId}/references/cleanup`, {
      groups: ["source_records", "reviews_raw", "quality_checks", "drafts", "review_reports", "field_packs", "content_assets", "content_workflow_models"],
      // drafts and field_packs are confirm_required: the cleanup is refused unless the owner names them.
      confirmed_overrides: ["drafts", "field_packs"],
      reason: "smoke reference cleanup",
    });
    assert(cleaned.ok, `cleanup failed: ${JSON.stringify(cleaned.body)}`);
    assert((Array.isArray(cleaned.body?.skipped_assets) ? cleaned.body.skipped_assets.length : 0) >= 1, "expected skipped_assets for shared asset");

    const after = await client.get(`/api/admin/deleted-items/${fixture.itemId}/references`);
    assert(after.ok, `references after cleanup failed: ${JSON.stringify(after.body)}`);
    const afterKeys = new Set((after.body?.groups || []).map((entry) => String(entry?.key || "").trim().toLowerCase()));
    for (const key of ["source_records", "reviews_raw", "quality_checks", "drafts", "review_reports", "field_packs", "content_assets", "content_workflow_models"]) {
      assert(!afterKeys.has(key), `group ${key} should be removed after cleanup`);
    }

    const check = await client.get(`/api/admin/deleted-items/${fixture.itemId}/cleanup-check`);
    assert(check.ok, "cleanup-check after reference cleanup failed");
    assert(Boolean(check.body?.item?.can_purge), "item should be purgeable after cleanup");

    logStep("purge.after_cleanup");
    const purged = await client.post(`/api/admin/deleted-items/${fixture.itemId}/purge`, { reason: "smoke purge after reference cleanup" });
    assert(purged.ok, "purge after cleanup failed");
    const gone = await client.get(`/api/admin/deleted-items/${fixture.itemId}/cleanup-check`);
    assert(gone.status === 404, "purged reference item should be gone");

    console.log(JSON.stringify({
      ok: true,
      fixture: { item_id: fixture.itemId, shared_holder_item_id: fixture.holderId },
      checks: {
        references_get_contract_ok: true,
        references_invalid_group_rejected: true,
        references_cleanup_executed: true,
        references_cleanup_reports_skipped_assets: true,
        references_cleanup_made_item_purgeable: true,
        references_cleanup_purge_removed_item: true,
      },
    }, null, 2));
  } finally {
    try {
      if (fixture?.sharedAssetId) db.prepare("DELETE FROM assets WHERE id=?").run(fixture.sharedAssetId);
      if (fixture?.privateAssetId) db.prepare("DELETE FROM assets WHERE id=?").run(fixture.privateAssetId);
      if (fixture?.holderId) cleanupItem(db, fixture.holderId);
      if (fixture?.itemId) cleanupItem(db, fixture.itemId);
    } finally {
      if (typeof db.close === "function") db.close();
    }
  }
}

main().catch((err) => {
  console.error(`smoke-reference-cleanup: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
