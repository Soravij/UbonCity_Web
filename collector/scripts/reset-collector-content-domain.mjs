import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");

const DEFAULT_CONTENT_TABLES = Object.freeze([
  "field_pack_assignments",
  "field_pack_media_hints",
  "field_pack_references",
  "field_pack_checklists",
  "field_packs",
  "approved_context_blocks",
  "evidence_blocks",
  "review_actions",
  "review_reports",
  "content_assignment_submission_deliverables",
  "content_assignment_submissions",
  "content_assignment_handoff_snapshots",
  "content_assignments",
  "content_execution_channels",
  "content_execution_controls",
  "content_readiness_briefs",
  "content_intelligence_models",
  "content_workflow_transitions",
  "content_workflow_models",
  "content_direction_reports",
  "social_momentum_snapshots",
  "social_signal_sources",
  "place_intelligence_scores",
  "search_enrichment_records",
  "content_translations",
  "published_articles",
  "internal_link_suggestions",
  "content_drafts",
  "draft_input_snapshots",
  "quality_checks",
  "content_versions",
  "reviews_raw",
  "source_records",
  "staging_items",
]);

const DEFAULT_RUN_TABLES = Object.freeze([
  "export_jobs",
  "pipeline_runs",
  "generation_runs",
  "publish_runs",
  "translation_runs",
]);

const DEFAULT_SOURCE_RAW_TABLES = Object.freeze([
  "source_raw_media",
  "source_raw_items",
  "source_ingestions",
]);

const DEFAULT_TRANSPORT_TABLES = Object.freeze([
  "transport_route_render_jobs_v2",
  "transport_route_poster_paths_v2",
  "transport_route_resolved_paths_v2",
  "transport_route_stops_v2",
  "transport_route_control_points_v2",
  "transport_routes_v2",
  "transport_base_map_labels_v2",
  "transport_base_maps_v2",
  "transport_label_layout_items_v2",
  "transport_label_layouts_v2",
]);

const CONTENT_LIKE_AUDIT_TARGET_TYPES = new Set([
  "content_item",
  "assignment",
  "translation_run",
  "transport_base_map_v2",
  "transport_label_layout_v2",
  "transport_route_v2",
  "execution_channel",
  "lifecycle_sync",
]);

const KEEP_AUDIT_TARGET_TYPES = new Set(["user", "agent_profile"]);
const KEEP_AUDIT_ACTIONS = new Set([
  "auth.login",
  "auth.login.backend",
  "auth.login.backend_failed",
  "auth.logout",
  "auth.backend_identity_refresh",
  "auth.backend_identity_provisioned",
  "auth.backend_identity_projection_pending_manager",
  "auth.backend_identity_projection_cleared_placeholder",
  "user.create",
  "user.create.rejected",
  "user.update_profile",
  "user.update_role.rejected",
  "user.delete",
  "user.delete.rejected",
  "user.reset_password",
  "user.reset_password.rejected",
  "user.avatar.upload",
  "agent_profile.update",
  "agent_profile.reset",
]);

const CONTENT_LIKE_AUDIT_PREFIXES = Object.freeze([
  "item.",
  "context.",
  "field_pack.",
  "draft.",
  "publish.",
  "translation.",
  "assignment.",
  "assignment_",
  "asset.",
  "search_enrichment.",
  "place_intelligence.",
  "social_signal.",
  "momentum.",
  "content_direction.",
  "workflow_",
  "workflow.",
  "readiness_",
  "readiness.",
  "execution_",
  "execution.",
  "staging.",
  "review_",
  "review.",
  "evidence.",
  "export.",
  "transport_v2.",
]);

function parseArgs(argv = []) {
  const args = new Set(Array.isArray(argv) ? argv : []);
  return {
    dryRun: args.has("--dry-run"),
    confirm: args.has("--confirm-reset-content-domain"),
    includeTransport: !args.has("--exclude-transport"),
    keepAuthLogs: !args.has("--drop-auth-logs"),
  };
}

function parseObjectJson(value) {
  if (value == null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function placeholders(n) {
  return Array.from({ length: n }, () => "?").join(", ");
}

function normalizeStoragePath(value) {
  return String(value || "").trim().replace(/\\/g, "/");
}

function chunk(values = [], size = 500) {
  const source = Array.isArray(values) ? values : [];
  const chunks = [];
  for (let i = 0; i < source.length; i += size) {
    chunks.push(source.slice(i, i + size));
  }
  return chunks;
}

function shouldDeleteAuditRow(row, { keepAuthLogs }) {
  if (!keepAuthLogs) return true;
  const targetType = String(row?.target_type || "").trim();
  const action = String(row?.action || "").trim();
  if (KEEP_AUDIT_TARGET_TYPES.has(targetType)) return false;
  if (KEEP_AUDIT_ACTIONS.has(action)) return false;
  if (targetType === "asset" && action === "user.avatar.upload") return false;
  if (CONTENT_LIKE_AUDIT_TARGET_TYPES.has(targetType)) return true;
  return CONTENT_LIKE_AUDIT_PREFIXES.some((prefix) => action.startsWith(prefix));
}

function countTableRows(db, tableName) {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${tableName}`).get()?.c || 0) || 0;
}

async function listAllFilesRecursively(baseDir) {
  const files = [];
  const root = path.resolve(baseDir);
  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

async function wipeDirectoryContents(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    await fs.rm(fullPath, { recursive: true, force: true });
  }
}

async function wipeMediaExceptAvatar(mediaDir, keepAvatarStoragePaths = new Set()) {
  await fs.mkdir(mediaDir, { recursive: true });
  const allFiles = await listAllFilesRecursively(mediaDir);
  for (const fullPath of allFiles) {
    const relativePath = normalizeStoragePath(path.relative(mediaDir, fullPath));
    if (keepAvatarStoragePaths.has(relativePath)) continue;
    await fs.rm(fullPath, { force: true });
  }

  // Remove empty directories after file removal.
  async function cleanupEmptyDirs(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await cleanupEmptyDirs(path.join(currentDir, entry.name));
    }
    if (currentDir === mediaDir) return;
    const remaining = await fs.readdir(currentDir).catch(() => []);
    if (remaining.length === 0) {
      await fs.rm(currentDir, { recursive: true, force: true });
    }
  }
  await cleanupEmptyDirs(mediaDir);
}

function collectUserAvatarAssetIds(db) {
  const rows = db.prepare("SELECT id, profile_json FROM users ORDER BY id ASC").all();
  const keep = new Set();
  for (const row of rows) {
    const profile = parseObjectJson(row?.profile_json);
    const picAssetId = Number(profile?.pic_asset_id || 0) || 0;
    if (picAssetId > 0) keep.add(picAssetId);
  }
  return Array.from(keep);
}

function collectAvatarStoragePaths(db, avatarAssetIds = []) {
  const ids = Array.isArray(avatarAssetIds) ? avatarAssetIds.filter(Boolean) : [];
  if (!ids.length) return new Set();
  const rows = db
    .prepare(`SELECT storage_path FROM assets WHERE id IN (${placeholders(ids.length)})`)
    .all(...ids);
  return new Set(rows.map((row) => normalizeStoragePath(row?.storage_path)).filter(Boolean));
}

function summarizeAuditRows(db, options) {
  const rows = db.prepare("SELECT id, target_type, action FROM audit_logs ORDER BY id ASC").all();
  let keep = 0;
  let purge = 0;
  for (const row of rows) {
    if (shouldDeleteAuditRow(row, options)) purge += 1;
    else keep += 1;
  }
  return { total: rows.length, keep, purge };
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

async function summarizeFileCounts({ mediaDir, rawDir, stagingDir, exportDir, keepAvatarStoragePaths }) {
  const mediaFiles = await listAllFilesRecursively(mediaDir);
  const rawFiles = await listAllFilesRecursively(rawDir);
  const stagingFiles = await listAllFilesRecursively(stagingDir);
  const exportFiles = await listAllFilesRecursively(exportDir);
  let keptAvatarFiles = 0;
  for (const filePath of mediaFiles) {
    const rel = normalizeStoragePath(path.relative(mediaDir, filePath));
    if (keepAvatarStoragePaths.has(rel)) keptAvatarFiles += 1;
  }
  return {
    media_total_files: mediaFiles.length,
    media_kept_avatar_files: keptAvatarFiles,
    media_purge_files: Math.max(0, mediaFiles.length - keptAvatarFiles),
    raw_total_files: rawFiles.length,
    staging_total_files: stagingFiles.length,
    export_total_files: exportFiles.length,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dirs = resolvePaths(ROOT_DIR);
  const schemaPath = path.join(dirs.rootDir, "database", "schema.sql");
  const db = openDatabase(dirs.dbPath, schemaPath);

  const avatarAssetIds = collectUserAvatarAssetIds(db);
  const keepAvatarStoragePaths = collectAvatarStoragePaths(db, avatarAssetIds);
  const contentTables = [...DEFAULT_CONTENT_TABLES];
  const transportTables = options.includeTransport ? [...DEFAULT_TRANSPORT_TABLES] : [];
  const runTables = [...DEFAULT_RUN_TABLES];
  const sourceRawTables = [...DEFAULT_SOURCE_RAW_TABLES];
  const baseResetTables = [...runTables, ...sourceRawTables, ...transportTables, ...contentTables, "content_items"];

  const tableCounts = {};
  for (const tableName of baseResetTables) {
    tableCounts[tableName] = countTableRows(db, tableName);
  }
  tableCounts.content_assets = countTableRows(db, "content_assets");
  tableCounts.asset_variants = countTableRows(db, "asset_variants");
  tableCounts.assets = countTableRows(db, "assets");
  tableCounts.users = countTableRows(db, "users");
  tableCounts.audit_logs = countTableRows(db, "audit_logs");

  const fileCounts = await summarizeFileCounts({
    mediaDir: dirs.mediaDir,
    rawDir: dirs.rawDir,
    stagingDir: dirs.stagingDir,
    exportDir: dirs.exportDir,
    keepAvatarStoragePaths,
  });

  const auditSummary = summarizeAuditRows(db, options);
  const dryRunReport = {
    mode: options.dryRun ? "dry-run" : "execute",
    db_path: dirs.dbPath,
    include_transport: options.includeTransport,
    keep_auth_logs: options.keepAuthLogs,
    avatar_asset_ids: avatarAssetIds,
    table_counts: tableCounts,
    audit_logs: auditSummary,
    files: fileCounts,
  };
  console.log(formatJson(dryRunReport));

  if (options.dryRun) return;
  if (!options.confirm) {
    throw new Error("missing --confirm-reset-content-domain");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    // Reset audit logs by policy first so stale content logs do not remain.
    const auditRows = db.prepare("SELECT id, target_type, action FROM audit_logs ORDER BY id ASC").all();
    const auditDeleteIds = auditRows
      .filter((row) => shouldDeleteAuditRow(row, options))
      .map((row) => Number(row.id || 0))
      .filter(Boolean);
    for (const ids of chunk(auditDeleteIds, 500)) {
      db.prepare(`DELETE FROM audit_logs WHERE id IN (${placeholders(ids.length)})`).run(...ids);
    }

    for (const tableName of runTables) {
      db.prepare(`DELETE FROM ${tableName}`).run();
    }
    for (const tableName of sourceRawTables) {
      db.prepare(`DELETE FROM ${tableName}`).run();
    }
    for (const tableName of transportTables) {
      db.prepare(`DELETE FROM ${tableName}`).run();
    }
    for (const tableName of contentTables) {
      db.prepare(`DELETE FROM ${tableName}`).run();
    }

    db.prepare("DELETE FROM content_items").run();
    db.prepare("DELETE FROM content_assets").run();

    if (avatarAssetIds.length > 0) {
      db.prepare(`DELETE FROM asset_variants WHERE asset_id NOT IN (${placeholders(avatarAssetIds.length)})`).run(...avatarAssetIds);
      db.prepare(`DELETE FROM assets WHERE id NOT IN (${placeholders(avatarAssetIds.length)})`).run(...avatarAssetIds);
    } else {
      db.prepare("DELETE FROM asset_variants").run();
      db.prepare("DELETE FROM assets").run();
    }

    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }

  await wipeDirectoryContents(dirs.rawDir);
  await wipeDirectoryContents(dirs.stagingDir);
  await wipeDirectoryContents(dirs.exportDir);
  await wipeMediaExceptAvatar(dirs.mediaDir, keepAvatarStoragePaths);

  const verify = {
    users: countTableRows(db, "users"),
    content_items: countTableRows(db, "content_items"),
    content_assignments: countTableRows(db, "content_assignments"),
    source_ingestions: countTableRows(db, "source_ingestions"),
    source_raw_items: countTableRows(db, "source_raw_items"),
    source_raw_media: countTableRows(db, "source_raw_media"),
    assets: countTableRows(db, "assets"),
    asset_variants: countTableRows(db, "asset_variants"),
    audit_logs: summarizeAuditRows(db, options),
    files: await summarizeFileCounts({
      mediaDir: dirs.mediaDir,
      rawDir: dirs.rawDir,
      stagingDir: dirs.stagingDir,
      exportDir: dirs.exportDir,
      keepAvatarStoragePaths,
    }),
  };

  assert(verify.users > 0, "users must remain");
  assert(verify.content_items === 0, "content_items must be empty after reset");
  assert(verify.content_assignments === 0, "content_assignments must be empty after reset");
  assert(verify.source_ingestions === 0, "source_ingestions must be empty after reset");
  assert(verify.source_raw_items === 0, "source_raw_items must be empty after reset");
  assert(verify.source_raw_media === 0, "source_raw_media must be empty after reset");

  console.log(formatJson({ ok: true, verify }));
}

main().catch((error) => {
  console.error(`[reset-collector-content-domain] ${String(error?.message || error)}`);
  process.exitCode = 1;
});
