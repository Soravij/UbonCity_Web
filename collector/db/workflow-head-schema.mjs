export const PLACE_REVIEW_FLAG_MIGRATION_COMMAND = "npm run migrate:place-review-flags";

export function hasPlaceReviewFlagCheck(db) {
  const tableSql = String(
    db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='content_workflow_models'").get()?.sql || ""
  );
  return /CHECK\s*\(\s*place_review_flag\s+IN\s*\(\s*'none'\s*,\s*'revision_requested'\s*,\s*'rejected'\s*\)\s*\)/i.test(tableSql);
}

export function assertPlaceReviewFlagMigrationApplied(db, operation) {
  const hasPlaceReviewFlag = db
    .prepare("PRAGMA table_info(content_workflow_models)")
    .all()
    .some((row) => row.name === "place_review_flag");
  if (!hasPlaceReviewFlag) {
    throw new Error(`content_workflow_models.place_review_flag is missing; run ${PLACE_REVIEW_FLAG_MIGRATION_COMMAND} before ${operation}`);
  }
  if (!hasPlaceReviewFlagCheck(db)) {
    throw new Error(`content_workflow_models.place_review_flag is missing its CHECK constraint; run ${PLACE_REVIEW_FLAG_MIGRATION_COMMAND} before ${operation}`);
  }
}
