import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";

function nowIso() {
  return new Date().toISOString();
}

function logStep(step, detail = "") {
  const suffix = String(detail || "").trim();
  console.error(`[${nowIso()}] cleanup-smoke-items step=${step}${suffix ? ` ${suffix}` : ""}`);
}

function isTargetSmokeItem(row) {
  const slug = String(row?.slug || "").trim().toLowerCase();
  if (!slug) return false;
  return (
    slug.startsWith("smoke-") ||
    slug.startsWith("manual-smoke-assignment-flow-") ||
    slug.startsWith("phase-d-smoke-") ||
    slug.startsWith("workflow-smoke-temp") ||
    slug === "smoke-event-dedicated-route"
  );
}

function listTargetItems(db) {
  const rows = db.prepare(`
    SELECT id, item_uid, title, slug, workflow_status, is_deleted, created_at
    FROM content_items
    ORDER BY id ASC
  `).all();
  return rows.filter(isTargetSmokeItem);
}

function cleanupItemGraph(db, itemId) {
  const id = Number(itemId || 0) || 0;
  if (!id) return;

  db.prepare("DELETE FROM audit_logs WHERE target_type='content_item' AND target_id=?").run(String(id));
  db.prepare("DELETE FROM content_assignment_submission_deliverables WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_assignment_submissions WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_assignment_handoff_snapshots WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_assignments WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM field_pack_assignments WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(id);
  db.prepare("DELETE FROM field_pack_media_hints WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(id);
  db.prepare("DELETE FROM field_pack_references WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(id);
  db.prepare("DELETE FROM field_pack_checklists WHERE field_pack_id IN (SELECT id FROM field_packs WHERE content_item_id=?)").run(id);
  db.prepare("DELETE FROM field_packs WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_workflow_transitions WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM quality_checks WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM review_reports WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_drafts WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM reviews_raw WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM approved_context_blocks WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM evidence_blocks WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM source_records WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_assets WHERE content_item_id=?").run(id);
  db.prepare("DELETE FROM content_items WHERE id=?").run(id);
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const dirs = resolvePaths(path.resolve(scriptDir, ".."));
  const db = openDatabase(dirs.dbPath, path.join(dirs.rootDir, "database", "schema.sql"));

  try {
    logStep("scan");
    const targets = listTargetItems(db);
    const summary = {
      total_items: targets.length,
      active_items: targets.filter((row) => Number(row.is_deleted || 0) !== 1).length,
      deleted_items: targets.filter((row) => Number(row.is_deleted || 0) === 1).length,
    };

    if (!targets.length) {
      console.log(JSON.stringify({ ok: true, summary, deleted_item_ids: [] }, null, 2));
      return;
    }

    logStep("cleanup", `count=${targets.length}`);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of targets) {
        cleanupItemGraph(db, row.id);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    console.log(JSON.stringify({
      ok: true,
      summary,
      deleted_item_ids: targets.map((row) => Number(row.id || 0) || 0),
      deleted_items: targets.map((row) => ({
        id: Number(row.id || 0) || 0,
        title: String(row.title || "").trim(),
        slug: String(row.slug || "").trim(),
        was_deleted: Number(row.is_deleted || 0) === 1,
      })),
    }, null, 2));
  } finally {
    if (typeof db.close === "function") db.close();
  }
}

try {
  main();
} catch (err) {
  console.error(`cleanup-smoke-items: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
}
