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
  console.error(`[${nowIso()}] smoke-field-pack-return-to-clean step=${step}${suffix ? ` ${suffix}` : ""}`);
}

function createItemWithFieldPack(db, {
  titleSuffix,
  productionState = "brief_generated",
  publicationState = "draft",
  withActiveAssignment = false,
  claimedByUserId = null,
}) {
  const uid = `smoke-return-clean-${crypto.randomUUID()}`;
  const title = `Smoke Return Clean ${titleSuffix}`;
  const slug = `smoke-return-clean-${titleSuffix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  const itemResult = db.prepare(`
    INSERT INTO content_items (
      item_uid, type, category, lang, title, normalized_title, slug, description_raw, workflow_status, claimed_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uid, "place", "attraction", "th", title, title.toLowerCase(), slug, "smoke return-to-clean fixture", "raw", claimedByUserId);
  const itemId = Number(itemResult.lastInsertRowid || 0) || 0;
  assert(itemId > 0, `failed to create fixture item ${titleSuffix}`);

  const fieldPackResult = db.prepare(`
    INSERT INTO field_packs (
      content_item_id, status, is_current, ai_summary, ai_highlights_json, ai_unknowns_json,
      verified_facts_json, uncertain_facts_json, social_shot_emphasis_json, social_on_camera_points_json, updated_by
    ) VALUES (?, ?, 1, ?, '[]', '[]', '[]', '[]', '[]', '[]', ?)
  `).run(itemId, "ready_for_field", `Smoke field pack ${titleSuffix}`, "smoke-field-pack-return-to-clean");
  const fieldPackId = Number(fieldPackResult.lastInsertRowid || 0) || 0;
  assert(fieldPackId > 0, `failed to create field pack ${titleSuffix}`);

  db.prepare(`
    INSERT INTO content_workflow_models (
      content_item_id, production_state, publication_state, assignment_state,
      current_field_pack_id, updated_by, last_actor_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemId,
    productionState,
    publicationState,
    withActiveAssignment ? "assigned" : null,
    fieldPackId,
    "smoke-field-pack-return-to-clean",
    "smoke-field-pack-return-to-clean@example.com"
  );

  if (withActiveAssignment) {
    db.prepare(`
      INSERT INTO content_assignments (assignment_uid, content_item_id, assignment_kind, state, contributor_note)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `smoke-return-clean-assignment-${crypto.randomUUID()}`,
      itemId,
      "field",
      "assigned",
      "smoke active assignment blocker"
    );
  }

  return { itemId, fieldPackId };
}

function cleanupFixture(db, itemId) {
  const id = Number(itemId || 0) || 0;
  if (!id) return;
  db.prepare("DELETE FROM content_assignment_handoff_snapshots WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM field_pack_assignments WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(id);
  db.prepare("DELETE FROM field_pack_media_hints WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(id);
  db.prepare("DELETE FROM field_pack_references WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(id);
  db.prepare("DELETE FROM field_pack_checklists WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(id);
  db.prepare("DELETE FROM field_packs WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_assignments WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_items WHERE id=?").run(id);
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const dirs = resolvePaths(path.resolve(scriptDir, ".."));
  const db = openDatabase(dirs.dbPath, path.join(dirs.rootDir, "database", "schema.sql"));
  const client = createTestClient();

  let successFixture = null;
  let legacySuccessFixture = null;
  let blockedByAssignmentFixture = null;
  let blockedByPublishFixture = null;

  try {
    logStep("auth.me");
    const auth = await client.get("/api/auth/me");
    assert(auth.ok, `GET /api/auth/me failed: ${JSON.stringify(auth.body)}`);
    assert(String(auth.body?.user?.role || "").toLowerCase() === "owner", "owner role required");
    const actorUserId = Number(auth.body?.user?.id || 0) || 0;
    assert(actorUserId > 0, "auth user id required");

    logStep("fixture.create");
    successFixture = createItemWithFieldPack(db, {
      titleSuffix: "Success",
      productionState: "analyzed",
      publicationState: "draft",
      withActiveAssignment: false,
      claimedByUserId: actorUserId,
    });
    legacySuccessFixture = createItemWithFieldPack(db, {
      titleSuffix: "Legacy Brief Generated",
      productionState: "brief_generated",
      publicationState: "draft",
      withActiveAssignment: false,
      claimedByUserId: actorUserId,
    });
    blockedByAssignmentFixture = createItemWithFieldPack(db, {
      titleSuffix: "Blocked Assignment",
      productionState: "analyzed",
      publicationState: "draft",
      withActiveAssignment: true,
      claimedByUserId: actorUserId,
    });
    blockedByPublishFixture = createItemWithFieldPack(db, {
      titleSuffix: "Blocked Publish",
      productionState: "ready_for_publish",
      publicationState: "draft",
      withActiveAssignment: false,
      claimedByUserId: actorUserId,
    });

    logStep("return.success");
    const successRes = await client.post(`/api/items/${successFixture.itemId}/field-pack/return-to-clean`, {
      comment: "smoke return to clean success",
    });
    assert(successRes.ok, `success return-to-clean failed: ${JSON.stringify(successRes.body)}`);
    assert(String(successRes.body?.next_state || "") === "analyzed", "next_state should be analyzed");
    assert(
      String(successRes.body?.redirect_url || "").trim() === `/clean-item.html?id=${successFixture.itemId}`,
      "redirect_url should point to clean page"
    );

    const successWorkflow = db.prepare(`
      SELECT production_state, publication_state, current_field_pack_id
      FROM content_workflow_models
      WHERE content_item_id=?
    `).get(successFixture.itemId);
    assert(String(successWorkflow?.production_state || "") === "analyzed", "workflow production_state not analyzed");
    assert((Number(successWorkflow?.current_field_pack_id || 0) || 0) === 0, "current_field_pack_id should be null/0");
    const successFieldPack = db.prepare("SELECT id FROM field_packs WHERE id=?").get(successFixture.fieldPackId);
    assert(!successFieldPack, "field pack should be deleted after return-to-clean");

    logStep("return.legacy_brief_generated");
    const legacyRes = await client.post(`/api/items/${legacySuccessFixture.itemId}/field-pack/return-to-clean`, {
      comment: "smoke return to clean legacy brief_generated",
    });
    assert(legacyRes.ok, `legacy brief_generated return-to-clean failed: ${JSON.stringify(legacyRes.body)}`);
    const legacyWorkflow = db.prepare(`
      SELECT production_state, current_field_pack_id
      FROM content_workflow_models
      WHERE content_item_id=?
    `).get(legacySuccessFixture.itemId);
    assert(String(legacyWorkflow?.production_state || "") === "analyzed", "legacy workflow production_state not analyzed");
    assert((Number(legacyWorkflow?.current_field_pack_id || 0) || 0) === 0, "legacy current_field_pack_id should be null/0");

    logStep("return.blocked_assignment");
    const assignmentRes = await client.post(`/api/items/${blockedByAssignmentFixture.itemId}/field-pack/return-to-clean`, {
      comment: "smoke block assignment",
    });
    assert(assignmentRes.status === 409, `expected 409 for assignment blocker, got ${assignmentRes.status}`);
    assert(
      /active assignment|handoff/i.test(String(assignmentRes.body?.error || "")),
      `unexpected assignment blocker error: ${JSON.stringify(assignmentRes.body)}`
    );

    logStep("return.blocked_publish_ready");
    const publishRes = await client.post(`/api/items/${blockedByPublishFixture.itemId}/field-pack/return-to-clean`, {
      comment: "smoke block publish ready",
    });
    assert(publishRes.status === 409, `expected 409 for publish-ready blocker, got ${publishRes.status}`);
    assert(
      /publish-ready|published state/i.test(String(publishRes.body?.error || "")),
      `unexpected publish blocker error: ${JSON.stringify(publishRes.body)}`
    );

    console.log(JSON.stringify({
      ok: true,
      fixtures: {
        success_item_id: successFixture.itemId,
        legacy_brief_generated_item_id: legacySuccessFixture.itemId,
        blocked_assignment_item_id: blockedByAssignmentFixture.itemId,
        blocked_publish_ready_item_id: blockedByPublishFixture.itemId,
      },
      checks: {
        return_success_transitioned_to_analyzed: true,
        return_success_removed_current_field_pack: true,
        return_success_redirect_url_clean_page: true,
        return_legacy_brief_generated_supported: true,
        return_blocked_when_active_assignment_exists: true,
        return_blocked_when_publish_ready_or_published: true,
      },
    }, null, 2));
  } finally {
    try {
      if (blockedByPublishFixture?.itemId) cleanupFixture(db, blockedByPublishFixture.itemId);
      if (blockedByAssignmentFixture?.itemId) cleanupFixture(db, blockedByAssignmentFixture.itemId);
      if (legacySuccessFixture?.itemId) cleanupFixture(db, legacySuccessFixture.itemId);
      if (successFixture?.itemId) cleanupFixture(db, successFixture.itemId);
    } finally {
      if (typeof db.close === "function") db.close();
    }
  }
}

main().catch((err) => {
  console.error(`smoke-field-pack-return-to-clean: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
