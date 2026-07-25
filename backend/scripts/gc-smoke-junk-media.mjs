/**
 * gc-smoke-junk-media.mjs
 *
 * One-off cleanup of smoke-harness pollution in the Runtime DB.
 * Scope is FIXED by an explicit allowlist derived from the audit on
 * main@4e4019d — the script refuses to touch any id outside it, and
 * re-verifies each target's shape before deleting.
 *
 * Removes:
 *   - 22 corrupt 5-6 byte "cover"/"inline" assets (450-467, 472-473, 488-489)
 *   - their content_image_usages rows
 *   - 6 runtime-promotion-* place rows (142,143,144,146,147,149) + translations
 *   - 29 missing-file asset rows whose usage points at already-deleted entities
 *   - their content_image_usages rows
 *   - the on-disk files for the 22 corrupt assets
 *
 * Does NOT touch missing-file assets 179-182 / 187-190 (events 51, 53 alive).
 *
 * Default is DRY RUN. Pass --execute to mutate. All work runs in one
 * transaction; --execute rolls back on any mismatch.
 */
import fs from "fs/promises";
import pool from "../config/db.js";
import { toUploadDiskPath } from "../services/publishedMediaService.js";

// ---- Fixed scope from audit (main@4e4019d) ----
const CORRUPT_ASSET_IDS = [
  450, 451, 452, 453, 454, 455, 456, 457, 458, 459,
  460, 461, 462, 463, 464, 465, 466, 467, 472, 473, 488, 489,
];
const RUNTIME_PROMOTION_PLACE_IDS = [142, 143, 144, 146, 147, 149];
const MISSING_FILE_ASSET_IDS = [
  1, 2, 3, 4, 9, 10, 11, 12, 13, 18, 19, 20, 21, 26, 27, 28, 29,
  34, 35, 36, 37, 57, 58, 59, 60, 67, 68, 69, 70,
];
// Assets that must survive (events still live) — used only as a negative assertion.
const PROTECTED_ASSET_IDS = new Set([179, 180, 181, 182, 187, 188, 189, 190]);

const EXECUTE = process.argv.includes("--execute");

function assertDisjoint() {
  const all = [...CORRUPT_ASSET_IDS, ...MISSING_FILE_ASSET_IDS];
  for (const id of all) {
    if (PROTECTED_ASSET_IDS.has(id)) {
      throw new Error(`GUARD: asset ${id} is in the protected set — refusing to run`);
    }
  }
  if (new Set(all).size !== all.length) {
    throw new Error("GUARD: duplicate asset id across corrupt/missing lists");
  }
}

function ph(arr) {
  return arr.map(() => "?").join(",");
}

async function main() {
  assertDisjoint();
  const connection = await pool.getConnection();
  const log = [];
  let filePaths = [];
  try {
    await connection.beginTransaction();

    // --- Re-verify corrupt asset shape before deleting ---
    const [corruptRows] = await connection.query(
      `SELECT id, size_bytes, storage_path, file_name
       FROM media_assets WHERE id IN (${ph(CORRUPT_ASSET_IDS)})`,
      CORRUPT_ASSET_IDS
    );
    if (corruptRows.length !== CORRUPT_ASSET_IDS.length) {
      throw new Error(
        `GUARD: expected ${CORRUPT_ASSET_IDS.length} corrupt assets, found ${corruptRows.length}`
      );
    }
    for (const r of corruptRows) {
      const size = Number(r.size_bytes || 0);
      if (size !== 5 && size !== 6) {
        throw new Error(`GUARD: asset ${r.id} size=${size} is not 5/6 bytes — aborting`);
      }
    }
    filePaths = corruptRows
      .map((r) => toUploadDiskPath(r.storage_path || (r.file_name ? `uploads/${r.file_name}` : "")))
      .filter(Boolean);

    // --- Verify runtime-promotion places carry the expected slug ---
    const [placeRows] = await connection.query(
      `SELECT id, slug FROM places WHERE id IN (${ph(RUNTIME_PROMOTION_PLACE_IDS)})`,
      RUNTIME_PROMOTION_PLACE_IDS
    );
    for (const p of placeRows) {
      if (!String(p.slug || "").startsWith("runtime-promotion-")) {
        throw new Error(`GUARD: place ${p.id} slug='${p.slug}' is not runtime-promotion-* — aborting`);
      }
    }

    // --- Verify no protected event asset sneaks into missing set ---
    const [protectedCheck] = await connection.query(
      `SELECT asset_id, entity_type, entity_id FROM content_image_usages
       WHERE asset_id IN (${ph(MISSING_FILE_ASSET_IDS)})
         AND entity_type='event'
         AND entity_id IN (SELECT id FROM events)`,
      MISSING_FILE_ASSET_IDS
    );
    if (protectedCheck.length) {
      throw new Error(
        `GUARD: missing-file set references LIVE events: ${JSON.stringify(protectedCheck)} — aborting`
      );
    }

    const allAssetIds = [...CORRUPT_ASSET_IDS, ...MISSING_FILE_ASSET_IDS];

    // --- Delete usages for all in-scope assets ---
    const [usageDel] = await connection.query(
      `DELETE FROM content_image_usages WHERE asset_id IN (${ph(allAssetIds)})`,
      allAssetIds
    );
    log.push(`content_image_usages deleted: ${usageDel.affectedRows}`);

    // --- Delete the asset rows ---
    const [assetDel] = await connection.query(
      `DELETE FROM media_assets WHERE id IN (${ph(allAssetIds)})`,
      allAssetIds
    );
    log.push(`media_assets deleted: ${assetDel.affectedRows}`);

    // --- Delete runtime-promotion place translations + rows ---
    const [transDel] = await connection.query(
      `DELETE FROM place_translations WHERE place_id IN (${ph(RUNTIME_PROMOTION_PLACE_IDS)})`,
      RUNTIME_PROMOTION_PLACE_IDS
    );
    log.push(`place_translations deleted: ${transDel.affectedRows}`);
    const [placeDel] = await connection.query(
      `DELETE FROM places WHERE id IN (${ph(RUNTIME_PROMOTION_PLACE_IDS)})`,
      RUNTIME_PROMOTION_PLACE_IDS
    );
    log.push(`places deleted: ${placeDel.affectedRows}`);

    if (EXECUTE) {
      await connection.commit();
      log.push("TRANSACTION COMMITTED");
      // Files last, best-effort, only after DB is durable.
      let unlinked = 0;
      for (const p of filePaths) {
        try {
          await fs.unlink(p);
          unlinked++;
        } catch {}
      }
      log.push(`files unlinked: ${unlinked}/${filePaths.length}`);
    } else {
      await connection.rollback();
      log.push("DRY RUN — rolled back, no changes; files that WOULD be unlinked: " + filePaths.length);
    }

    console.log(log.join("\n"));
  } catch (err) {
    await connection.rollback();
    console.error("ROLLED BACK:", err.message);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main();
