import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.resolve(scriptDir, "..");
const dirs = resolvePaths(collectorRoot);
const schemaPath = path.join(dirs.rootDir, "database", "schema.sql");
const db = openDatabase(dirs.dbPath, schemaPath);

function hasGeneratedOutput(row) {
  if (!row) return false;
  if (Number.isFinite(Number(row.current_draft_id)) && Number(row.current_draft_id) > 0) return true;
  if (["generated", "in_review", "ready_for_publish", "completed"].includes(String(row.production_state || ""))) return true;
  if (["approved", "unpublished", "published"].includes(String(row.publication_state || ""))) return true;
  return false;
}

function isFieldPackReady(status) {
  return ["ready_for_field", "ready_for_handoff"].includes(String(status || "").toLowerCase());
}

function isAssignmentEmpty(value) {
  if (value == null) return true;
  const text = String(value).trim();
  return text.length === 0 || text === "[]";
}

function isHandoffEligible(row) {
  if (!row) return false;
  if (!isFieldPackReady(row.field_pack_status)) return false;
  if (!hasGeneratedOutput(row)) return false;
  if (!isAssignmentEmpty(row.assignment_state)) return false;
  return true;
}

function getCaseById(id) {
  return db
    .prepare(
      `SELECT ci.id,
              cwm.production_state,
              cwm.publication_state,
              cwm.current_draft_id,
              cwm.assignment_state,
              cwm.current_field_pack_id,
              fp.status AS field_pack_status
         FROM content_items ci
         JOIN content_workflow_models cwm ON cwm.content_item_id = ci.id
         LEFT JOIN field_packs fp ON fp.id = cwm.current_field_pack_id
        WHERE ci.id = ?`
    )
    .get(id);
}

function findCaseB() {
  return db
    .prepare(
      `SELECT ci.id,
              cwm.production_state,
              cwm.publication_state,
              cwm.current_draft_id,
              cwm.assignment_state,
              cwm.current_field_pack_id,
              fp.status AS field_pack_status
         FROM content_items ci
         JOIN content_workflow_models cwm ON cwm.content_item_id = ci.id
         LEFT JOIN field_packs fp ON fp.id = cwm.current_field_pack_id
        WHERE fp.status IN ('ready_for_field', 'ready_for_handoff')
          AND (
            cwm.current_draft_id IS NOT NULL
            OR cwm.production_state IN ('generated', 'in_review', 'ready_for_publish', 'completed')
            OR cwm.publication_state IN ('approved', 'unpublished', 'published')
          )
          AND (cwm.assignment_state IS NULL OR TRIM(cwm.assignment_state) = '' OR TRIM(cwm.assignment_state) = '[]')
        ORDER BY ci.id DESC
        LIMIT 1`
    )
    .get();
}

function findCaseC() {
  return db
    .prepare(
      `SELECT ci.id,
              cwm.production_state,
              cwm.publication_state,
              cwm.current_draft_id,
              cwm.assignment_state,
              cwm.current_field_pack_id,
              fp.status AS field_pack_status
         FROM content_items ci
         JOIN content_workflow_models cwm ON cwm.content_item_id = ci.id
         LEFT JOIN field_packs fp ON fp.id = cwm.current_field_pack_id
        WHERE cwm.assignment_state IS NOT NULL
          AND TRIM(cwm.assignment_state) <> ''
          AND TRIM(cwm.assignment_state) <> '[]'
        ORDER BY ci.id DESC
        LIMIT 1`
    )
    .get();
}

try {
  const caseA = getCaseById(116);
  const caseB = findCaseB();
  const caseC = findCaseC();
  console.log(
    JSON.stringify(
      {
        caseA: caseA
          ? {
              ...caseA,
              handoff_eligible: isHandoffEligible(caseA),
            }
          : null,
        caseB: caseB
          ? {
              ...caseB,
              handoff_eligible: isHandoffEligible(caseB),
            }
          : null,
        caseC: caseC
          ? {
              ...caseC,
              handoff_eligible: isHandoffEligible(caseC),
            }
          : null,
      },
      null,
      2
    )
  );
} finally {
  db.close();
}
