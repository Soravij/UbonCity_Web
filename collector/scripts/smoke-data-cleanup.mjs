import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
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
  console.error(`[${nowIso()}] smoke-data-cleanup step=${step}${suffix ? ` ${suffix}` : ""}`);
}

function createDeletedItem(db, {
  titleSuffix,
  withSourceRecord = false,
  withFieldPack = false,
  withPublishedArticle = false,
  withReviewAction = false,
  withIntelligenceModel = false,
  withAssignment = false,
  withTranslation = false,
  withApprovedContext = false,
  withDeliverableAsset = false,
  mediaDir = "",
  submittedByUserId = 0,
}) {
  const uid = `smoke-cleanup-${crypto.randomUUID()}`;
  const title = `Smoke Cleanup ${titleSuffix}`;
  const slug = `smoke-cleanup-${titleSuffix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  const itemResult = db.prepare(`
    INSERT INTO content_items (
      item_uid, type, category, lang, title, normalized_title, slug, description_raw, workflow_status, is_deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(uid, "place", "attraction", "th", title, title.toLowerCase(), slug, "smoke cleanup fixture", "raw");
  const itemId = Number(itemResult.lastInsertRowid || 0) || 0;
  assert(itemId > 0, `failed to create deleted item for ${titleSuffix}`);

  if (withSourceRecord) {
    db.prepare(`
      INSERT INTO source_records (content_item_id, source_type, source_name, source_url, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(itemId, "smoke", "Smoke Source", `https://example.com/smoke-cleanup/${itemId}`, JSON.stringify({ blocker: "source_records" }));
  }
  if (withFieldPack) {
    db.prepare(`
      INSERT INTO field_packs (
        content_item_id, status, is_current, ai_summary, ai_highlights_json, ai_unknowns_json,
        verified_facts_json, uncertain_facts_json, social_shot_emphasis_json, social_on_camera_points_json, updated_by
      ) VALUES (?, ?, 1, ?, '[]', '[]', '[]', '[]', '[]', '[]', ?)
    `).run(itemId, "ready_for_field", `Smoke field pack for ${titleSuffix}`, "smoke-data-cleanup");
  }
  if (withPublishedArticle) {
    db.prepare(`
      INSERT INTO published_articles (
        content_item_id, slug, title, body, excerpt, meta_title, meta_description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, `${slug}-published`, title, `Published body for ${titleSuffix}`, `Published excerpt for ${titleSuffix}`, title, "smoke", "published");
  }
  if (withReviewAction) {
    db.prepare(`
      INSERT INTO review_actions (content_item_id, action, reviewer_email, notes)
      VALUES (?, ?, ?, ?)
    `).run(itemId, "approve", "smoke-data-cleanup@example.com", `Smoke review action for ${titleSuffix}`);
  }
  if (withIntelligenceModel) {
    db.prepare(`
      INSERT INTO content_intelligence_models (
        content_item_id, model_version, quality_score, popularity_score, momentum_score,
        confidence_score, signals_json, reasons_json, payload_json, computed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, "smoke_v1", 50, 50, 50, 70, "{}", "[]", "{}", "smoke-data-cleanup");
  }
  if (withAssignment) {
    db.prepare(`
      INSERT INTO content_assignments (assignment_uid, content_item_id)
      VALUES (?, ?)
    `).run(`smoke-assignment-${crypto.randomUUID()}`, itemId);
  }
  if (withTranslation) {
    db.prepare(`
      INSERT INTO content_translations (
        source_content_item_id, source_fingerprint, lang, translated_title, translation_status
      ) VALUES (?, ?, ?, ?, ?)
    `).run(itemId, `smoke-fingerprint-${crypto.randomUUID()}`, "en", "Smoke Translation", "pending");
  }
  if (withApprovedContext) {
    const evidenceId = Number(db.prepare(`
      INSERT INTO evidence_blocks (content_item_id, block_type, text_value, status)
      VALUES (?, ?, ?, ?)
    `).run(itemId, "fact", "Smoke evidence", "active").lastInsertRowid || 0) || 0;
    db.prepare(`
      INSERT INTO approved_context_blocks (content_item_id, evidence_block_id, selected_text, status, approved_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(itemId, evidenceId, "Smoke approved context", "active", "smoke-data-cleanup@example.com");
  }
  let deliverableAsset = null;
  if (withDeliverableAsset) {
    const assignmentId = Number(db.prepare("INSERT INTO content_assignments (assignment_uid, content_item_id) VALUES (?,?)").run(`smoke-asset-assignment-${crypto.randomUUID()}`, itemId).lastInsertRowid || 0) || 0;
    const submissionId = Number(db.prepare("INSERT INTO content_assignment_submissions (assignment_id, content_item_id, submitted_by_user_id, submission_state) VALUES (?,?,?,?)").run(assignmentId, itemId, Number(submittedByUserId || 0), "submitted").lastInsertRowid || 0) || 0;
    const storagePath = `smoke/purge-${crypto.randomUUID()}.txt`;
    const filePath = path.join(mediaDir, storagePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "smoke deliverable asset");
    const assetId = Number(db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`smoke-purge-asset-${crypto.randomUUID()}`, "local", storagePath, "purge.txt", "text/plain", 22, `smoke-${crypto.randomUUID()}`).lastInsertRowid || 0) || 0;
    db.prepare(`
      INSERT INTO content_assignment_submission_deliverables
        (assignment_id, submission_id, content_item_id, deliverable_type, source_asset_id, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(assignmentId, submissionId, itemId, "file", assetId, "submitted");
    deliverableAsset = { id: assetId, file_path: filePath };
  }

  return { id: itemId, deliverable_asset: deliverableAsset };
}

function cleanupFixture(db, itemId) {
  const id = Number(itemId || 0) || 0;
  if (!id) return;
  db.prepare("DELETE FROM review_actions WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_intelligence_models WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_assignments WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_translations WHERE source_content_item_id=?").run(id);
  db.prepare("DELETE FROM published_articles WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM field_packs WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM source_records WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM approved_context_blocks WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM evidence_blocks WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_items WHERE id=?").run(id);
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const dirs = resolvePaths(path.resolve(scriptDir, ".."));
  const db = openDatabase(dirs.dbPath, path.join(dirs.rootDir, "database", "schema.sql"));
  const client = createTestClient();

  let purgeable = null;
  let blockedSource = null;
  let blockedFieldPack = null;
  let blockedPublished = null;
  let blockedReviewAction = null;
  let blockedIntelligence = null;
  let confirmAssignment = null;
  let blockedTranslation = null;
  let cascadeGuarded = null;
  let deliverableAssetItem = null;

  try {
    logStep("auth.me");
    const auth = await client.get("/api/auth/me");
    assert(auth.ok, `GET /api/auth/me failed: ${JSON.stringify(auth.body)}`);
    assert(String(auth.body?.user?.role || "").toLowerCase() === "owner", "owner role required");

    logStep("fixture.create");
    purgeable = createDeletedItem(db, { titleSuffix: "Purgeable" });
    blockedSource = createDeletedItem(db, { titleSuffix: "Blocked Source", withSourceRecord: true });
    blockedFieldPack = createDeletedItem(db, { titleSuffix: "Blocked Field Pack", withFieldPack: true });
    blockedPublished = createDeletedItem(db, { titleSuffix: "Blocked Published", withPublishedArticle: true });
    blockedReviewAction = createDeletedItem(db, { titleSuffix: "Blocked Review Action", withReviewAction: true });
    blockedIntelligence = createDeletedItem(db, { titleSuffix: "Blocked Intelligence", withIntelligenceModel: true });
    confirmAssignment = createDeletedItem(db, { titleSuffix: "Confirm Assignment", withAssignment: true });
    blockedTranslation = createDeletedItem(db, { titleSuffix: "Blocked Translation", withTranslation: true });
    cascadeGuarded = createDeletedItem(db, { titleSuffix: "Cascade Guard", withApprovedContext: true });
    deliverableAssetItem = createDeletedItem(db, { titleSuffix: "Deliverable Asset", withDeliverableAsset: true, mediaDir: dirs.mediaDir, submittedByUserId: auth.body.user.id });

    logStep("check.core");
    const purgeableCheck = await client.get(`/api/admin/deleted-items/${purgeable.id}/cleanup-check`);
    assert(purgeableCheck.ok, "purgeable cleanup-check failed");
    assert(Boolean(purgeableCheck.body?.item?.can_purge), "purgeable should be purgeable");

    const expectBlocked = async (id, key) => {
      const check = await client.get(`/api/admin/deleted-items/${id}/cleanup-check`);
      assert(check.ok, `cleanup-check failed for ${id}`);
      assert(check.body?.item?.can_purge === false, `item ${id} should be blocked`);
      assert((check.body?.item?.blockers || []).some((row) => String(row?.key || "") === key), `missing blocker ${key}`);
    };
    await expectBlocked(blockedSource.id, "source_records");
    await expectBlocked(blockedFieldPack.id, "field_packs");
    await expectBlocked(blockedPublished.id, "published_articles");
    await expectBlocked(blockedReviewAction.id, "review_actions");
    await expectBlocked(blockedIntelligence.id, "content_intelligence_models");
    await expectBlocked(confirmAssignment.id, "assignments");
    await expectBlocked(blockedTranslation.id, "translations_unpublished");
    const cascadeReferences = await client.get(`/api/admin/deleted-items/${cascadeGuarded.id}/references`);
    assert(cascadeReferences.ok, "cascade guard references failed");
    assert(!(cascadeReferences.body?.groups || []).some((row) => row?.key === "evidence_blocks"), "SAFE sweep must skip evidence that would cascade approved context");
    assert((cascadeReferences.body?.safe_sweep_skipped || []).some((row) => row?.key === "evidence_blocks"), "cascade guard skip reason missing");

    logStep("purge.blocked");
    // hard_blocker and cleanup_candidate cannot be overridden at purge: 409, no confirmation offered.
    const expectPurgeBlocked = async (id, key) => {
      const response = await client.post(`/api/admin/deleted-items/${id}/purge`, { reason: "smoke blocked" });
      assert(response.status === 409, `expected 409 for blocked item ${id}, got ${response.status}`);
      assert((response.body?.blockers || []).some((row) => String(row?.key || "") === key), `missing purge blocker ${key}`);
    };
    await expectPurgeBlocked(blockedSource.id, "source_records");
    await expectPurgeBlocked(blockedPublished.id, "published_articles");
    await expectPurgeBlocked(blockedReviewAction.id, "review_actions");
    await expectPurgeBlocked(blockedIntelligence.id, "content_intelligence_models");

    logStep("purge.needs_confirmation");
    // confirm_required groups hold human curation: purge is refused with 400 until the owner names
    // every one of them in confirmed_overrides, then it goes through.
    const expectPurgeNeedsConfirmation = async (id, key) => {
      const response = await client.post(`/api/admin/deleted-items/${id}/purge`, { reason: "smoke unconfirmed" });
      assert(response.status === 400, `expected 400 for unconfirmed item ${id}, got ${response.status}`);
      const missing = Array.isArray(response.body?.missing_confirmations) ? response.body.missing_confirmations : [];
      assert(missing.some((row) => String(row?.key || "") === key), `missing confirmation entry ${key}`);
      assert(
        missing.every((row) => String(row?.category || "") === "confirm_required"),
        `missing_confirmations should only carry confirm_required for ${id}`
      );
    };
    await expectPurgeNeedsConfirmation(blockedFieldPack.id, "field_packs");
    await expectPurgeNeedsConfirmation(blockedTranslation.id, "translations_unpublished");
    // The assignment family is confirm_required, not a hard blocker: an open assignment is work an
    // owner can legitimately decide to throw away, so purge must ask rather than refuse outright.
    await expectPurgeNeedsConfirmation(confirmAssignment.id, "assignments");
    await expectPurgeNeedsConfirmation(cascadeGuarded.id, "approved_context_blocks");
    await expectPurgeNeedsConfirmation(deliverableAssetItem.id, "content_assignment_submission_deliverables");

    logStep("purge.confirmed");
    const expectPurgeWithConfirmation = async (id, confirmedOverrides) => {
      const response = await client.post(`/api/admin/deleted-items/${id}/purge`, {
        reason: "smoke confirmed override",
        confirmed_overrides: confirmedOverrides,
      });
      assert(response.ok, `confirmed purge failed for ${id}: ${JSON.stringify(response.body)}`);
      const gone = await client.get(`/api/admin/deleted-items/${id}/cleanup-check`);
      assert(gone.status === 404, `confirmed-purged item ${id} should be gone`);
    };
    await expectPurgeWithConfirmation(blockedFieldPack.id, ["field_packs"]);
    await expectPurgeWithConfirmation(blockedTranslation.id, ["translations_unpublished"]);
    // New happy path for the reclassification: confirm the assignment group and the purge goes through.
    await expectPurgeWithConfirmation(confirmAssignment.id, ["assignments"]);
    await expectPurgeWithConfirmation(cascadeGuarded.id, ["approved_context_blocks"]);
    assert(Number(db.prepare("SELECT COUNT(*) AS c FROM evidence_blocks WHERE content_item_id=?").get(cascadeGuarded.id)?.c || 0) === 0, "cascade purge must remove evidence blocks");
    assert(Number(db.prepare("SELECT COUNT(*) AS c FROM approved_context_blocks WHERE content_item_id=?").get(cascadeGuarded.id)?.c || 0) === 0, "cascade purge must remove approved context blocks");
    const cascadeAudit = db.prepare("SELECT details_json FROM audit_logs WHERE action='item.purge' AND CAST(target_id AS INTEGER)=? ORDER BY id DESC LIMIT 1").get(cascadeGuarded.id);
    const cascadeOverrides = JSON.parse(cascadeAudit?.details_json || "{}")?.confirmed_overrides || [];
    assert(cascadeOverrides.some((entry) => String(entry?.key || "") === "approved_context_blocks"), "cascade purge audit must record approved context override");
    const deliverablePurge = await client.post(`/api/admin/deleted-items/${deliverableAssetItem.id}/purge`, {
      reason: "smoke deliverable asset sweep",
      confirmed_overrides: ["assignments", "content_assignment_submissions", "content_assignment_submission_deliverables"],
    });
    assert(deliverablePurge.ok, `deliverable asset purge failed: ${JSON.stringify(deliverablePurge.body)}`);
    assert(Number(deliverablePurge.body?.assets_swept || 0) === 1, "deliverable asset purge must report assets_swept: 1");
    assert(!fs.existsSync(deliverableAssetItem.deliverable_asset.file_path), "deliverable file must be removed after purge commit");

    logStep("purge.success");
    const purged = await client.post(`/api/admin/deleted-items/${purgeable.id}/purge`, { reason: "smoke purgeable" });
    assert(purged.ok, "purgeable purge failed");
    const after = await client.get(`/api/admin/deleted-items/${purgeable.id}/cleanup-check`);
    assert(after.status === 404, "purged item should be gone");

    console.log(JSON.stringify({
      ok: true,
      fixtures: {
        purgeable_item_id: purgeable.id,
        blocked_source_item_id: blockedSource.id,
        blocked_field_pack_item_id: blockedFieldPack.id,
        blocked_published_item_id: blockedPublished.id,
        blocked_review_action_item_id: blockedReviewAction.id,
        blocked_intelligence_item_id: blockedIntelligence.id,
        confirm_assignment_item_id: confirmAssignment.id,
        blocked_translation_item_id: blockedTranslation.id,
        cascade_guarded_item_id: cascadeGuarded.id,
        deliverable_asset_item_id: deliverableAssetItem.id,
      },
      checks: {
        purgeable_can_purge: true,
        blocked_source_reason_key: "source_records",
        blocked_field_pack_reason_key: "field_packs",
        blocked_published_reason_key: "published_articles",
        blocked_review_action_reason_key: "review_actions",
        blocked_intelligence_reason_key: "content_intelligence_models",
        confirm_assignment_reason_key: "assignments",
        blocked_translation_reason_key: "translations_unpublished",
        confirm_required_purge_rejected_without_overrides: true,
        confirm_required_purge_accepted_with_overrides: true,
        assignment_purge_rejected_without_override: true,
        assignment_purge_accepted_with_override: true,
        cascade_guard_skips_evidence_and_purges_with_approved_context_confirmation: true,
        purge_reports_assets_swept_and_removes_deliverable_file: true,
        purged_item_removed: true,
      },
    }, null, 2));
  } finally {
    try {
      if (blockedTranslation?.id) cleanupFixture(db, blockedTranslation.id);
      if (cascadeGuarded?.id) cleanupFixture(db, cascadeGuarded.id);
      if (deliverableAssetItem?.id) cleanupFixture(db, deliverableAssetItem.id);
      if (confirmAssignment?.id) cleanupFixture(db, confirmAssignment.id);
      if (blockedIntelligence?.id) cleanupFixture(db, blockedIntelligence.id);
      if (blockedReviewAction?.id) cleanupFixture(db, blockedReviewAction.id);
      if (blockedPublished?.id) cleanupFixture(db, blockedPublished.id);
      if (blockedFieldPack?.id) cleanupFixture(db, blockedFieldPack.id);
      if (blockedSource?.id) cleanupFixture(db, blockedSource.id);
      if (purgeable?.id) cleanupFixture(db, purgeable.id);
    } finally {
      if (typeof db.close === "function") db.close();
    }
  }
}

main().catch((err) => {
  console.error(`smoke-data-cleanup: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
