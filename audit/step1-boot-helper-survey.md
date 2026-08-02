# Step 1 — Collector DB boot-helper survey

Date: 2026-08-02  
Scope: read-only review of `collector/db/client.mjs`, its direct boot-time import, `collector/database/schema.sql`, and metadata from `collector/data/collector.db`. No source or schema file was changed. Temporary SQLite copies were created outside the repository and removed after inspection.

## A. Inventory of boot helpers

`openDatabase(dbPath, schemaPath)` is the direct boot chain. When `schemaPath` is supplied it first runs two conditional helpers, executes `schema.sql`, then runs the remaining helpers in this order (`collector/db/client.mjs:297-318`). `collector/db/workflow-head-schema.mjs` is the only direct imported boot-time module; it validates state and does not create or modify schema/data.

| Helper / location | Runs when | Operations | Classification |
| --- | --- | --- | --- |
| `ensureApprovedContextActiveUniqueness` (`client.mjs:22-64`) | Before `schema.sql` when a path is supplied; also through `ensureEvidenceContextColumns` | Finds duplicate active context rows; changes all but newest to `inactive`; creates `idx_approved_context_active_unique` partial unique index. | **SCHEMA + DATA** (data repair only when duplicates exist) |
| `ensureWorkflowHeadBootstrapColumns` (`client.mjs:224-254`) | Before `schema.sql` when the workflow table already exists | Adds seven workflow-head columns if absent: `current_draft_id`, `current_review_report_id`, `current_field_pack_id`, `state_version`, `content_version`, `last_actor_email`, `last_transition_at`. Then calls the two guards below. | **SCHEMA**; guards themselves are neither schema nor data mutations |
| `assertPlaceReviewFlagMigrationApplied` (`workflow-head-schema.mjs:11-22`) | Called by the preceding helper | Verifies `content_workflow_models.place_review_flag` exists and has its three-value `CHECK`; otherwise throws. | **Guard / no mutation** |
| `assertAssignmentStateMigrationApplied` (`workflow-head-schema.mjs:24-32`) | Called by the preceding helper | Throws if legacy `content_workflow_models.assignment_state` remains. | **Guard / no mutation** |
| `ensureUsersAuthColumns` (`client.mjs:6-15`) | Every open | Adds `users.password_hash` and `users.managed_by_user_id` if absent. | **SCHEMA** |
| `ensureEvidenceContextColumns` (`client.mjs:66-85`) | Every open | Adds four `evidence_blocks` fields (`source_record_type`, `source_record_id`, `source_label`, `lang`), two `approved_context_blocks` fields (`editor_note`, `sort_order`), and two `draft_input_snapshots` fields (`source`, `payload_json`); invokes the active-context index helper. | **SCHEMA** (plus the nested conditional DATA repair above) |
| `ensureSearchIntelligenceTables` (`client.mjs:86-135`) | Every open | Creates `search_enrichment_records` and `place_intelligence_scores`, their four indexes, and conditionally adds `search_enrichment_records.updated_at`. | **SCHEMA** |
| `ensureSocialMomentumTables` (`client.mjs:137-176`) | Every open | Creates `social_signal_sources` and `social_momentum_snapshots`, with six indexes. | **SCHEMA** |
| `ensureContentDirectionTables` (`client.mjs:177-202`) | Every open | Creates `content_direction_reports` and its three indexes. | **SCHEMA** |
| `ensureWorkflowTransitionColumns` (`client.mjs:204-222`) | Every open when the table exists | Adds `actor_role`, `reason_code`, `assignment_id`; creates `idx_workflow_transitions_reason` and `idx_workflow_transitions_assignment`. | **SCHEMA** |
| `ensureAuditColumns` (`client.mjs:256-267`) | Every open when the table exists | Adds `audit_logs.assignment_id`; creates `idx_audit_logs_assignment`. | **SCHEMA** |
| `removeLegacyLocalAuthData` (`client.mjs:17-20`) | Every open | `DROP TABLE IF EXISTS user_sessions`; executes `UPDATE users SET password_hash=''` for every non-empty hash. | **DATA + destructive** (also destructively drops a legacy table). This clears local password hashes on every boot. |

### Owner bootstrap

There is **no owner-row bootstrap in `openDatabase`**. `collector/scripts/ensure-owner-login.mjs:10-15` only opens the DB and is explicitly a no-op. The current backend identity projection is `resolveCollectorUserForBackendIdentity` in `collector/server/auth-integration.mjs:190-309`: it `INSERT`s/`UPDATE`s `users` from a backend identity. That is **DATA**, but runs during token/directory synchronization, not DB open (directory sync begins at line 401). It should be retained as runtime auth synchronization, not treated as a schema helper.

## B. `schema.sql` versus SQLite metadata

### Fresh-schema, direct-client result

`schema.sql` contains **63** `CREATE TABLE` statements. A temporary empty DB was initialized with the raw SQL, copied, and opened through `openDatabase` (without passing `schemaPath`, so only the post-schema helper portion was measured). It remained at **63 tables** and gained **0 columns**. Therefore the tables and columns created by the current client helpers are already represented in `schema.sql`.

The direct-client delta is three missing index declarations:

- `idx_audit_logs_assignment` on `audit_logs(assignment_id, created_at DESC)` (`client.mjs:266`)
- `idx_workflow_transitions_reason` on `content_workflow_transitions(reason_code, created_at DESC)` (`client.mjs:220`)
- `idx_workflow_transitions_assignment` on `content_workflow_transitions(assignment_id, created_at DESC)` (`client.mjs:221`)

No trigger was created by `schema.sql` or the direct client chain.

### Existing dev DB: factual preflight snapshot, not a successful boot dump

The configured DB when Collector is launched from `collector/` is `collector/data/collector.db` (`collector/config/paths.mjs:3-18`). The root `data/collector.db` has zero tables and is not the operational candidate. A copy of `collector/data/collector.db` **cannot complete `openDatabase(..., schema.sql)`**: it fails in `assertPlaceReviewFlagMigrationApplied` because `content_workflow_models.place_review_flag` is absent. The same table still contains legacy `assignment_state`, which would fail the next guard.

For accuracy, the comparison below is a read-only metadata snapshot of that unbootable legacy DB versus a fresh DB built from the current `schema.sql`; it is not labelled as a post-boot state.

| Difference | Actual count | Names |
| --- | ---: | --- |
| Tables in legacy DB but absent from `schema.sql` | 3 | `agent_profiles`, `content_assignment_submission_drafts`, `release_snapshots` |
| Tables in `schema.sql` but absent from legacy DB | 2 | `content_asset_name_sequences`, `review_submission_snapshots` |
| Columns in legacy DB but absent from `schema.sql` | 17 | Listed below |
| Columns in `schema.sql` but absent from legacy DB | 2 | `content_assets.caption`; `content_workflow_models.place_review_flag` |

Legacy-only columns:

- `content_assets.assignment_id`, `.assignment_round`, `.assignment_media_type`, `.assignment_surface`, `.assignment_sync_batch_id`, `.assignment_slot_key`
- `content_assignment_submissions.updated_at`, `.source_handoff_snapshot_id`
- `content_assignments.accepted_at`, `.image_reset_required`, `.image_reset_reason`, `.video_reset_required`, `.video_reset_reason`, `.accepted_handoff_snapshot_id`, `.accepted_submission_id`
- `content_workflow_models.assignment_state`
- `field_pack_checklists.capture_type`

The current `schema.sql` requires `place_review_flag TEXT NOT NULL DEFAULT 'none' CHECK (place_review_flag IN ('none', 'revision_requested', 'rejected'))` at `schema.sql:950-969`; the legacy DB has neither that column nor its constraint. It instead retains the removed `assignment_state` column and legacy `idx_content_workflow_models_assignment` index. Its 17 legacy-only columns and the three legacy-only tables are **not created by `client.mjs`**. Most map to older `createRepository` post-open compatibility code (for example `ensureContentAssetWorkflowColumns` at `repository.mjs:3089`, `ensureAssignmentTableSupport` at `repository.mjs:3616`, `ensureAgentProfileTables` at `repository.mjs:3377`, and `ensureAssignmentSubmissionDraftTableSupport` at `repository.mjs:3730`); `release_snapshots` and `source_handoff_snapshot_id` have no matching current helper definition and are historical drift.

Index/constraint summary for that legacy snapshot:

- Legacy-only indexes: `idx_assignment_submission_drafts_assignment`, `idx_assignment_submission_drafts_expiry`, `idx_audit_logs_assignment`, `idx_content_workflow_models_assignment`, `idx_release_snapshots_active_item`, `idx_release_snapshots_item`, `idx_release_snapshots_item_hash`, `idx_workflow_transitions_assignment`, `idx_workflow_transitions_reason`.
- Schema-only indexes: `idx_review_submission_snapshots_active_item`, `idx_review_submission_snapshots_item`, `idx_review_submission_snapshots_item_hash`.
- The client-created audit/workflow-transition indexes are missing from the SQL file even though the legacy file happens to contain them from an earlier run.
- No triggers exist in either inspected metadata set. SQL text differences shared by both DBs are whitespace/line-ending differences only; no additional shared-object constraint difference was found.

## C. Consumers that depend on boot-time creation

Static scan covered `collector/tests` and `collector/scripts`.

- Every test helper that creates a fresh DB passes `schema.sql` to `openDatabase`; representative contexts include `collector/tests/field-pack.repository.test.mjs:14-16`, `collector/tests/workflow-readers-loud.test.mjs:108-109`, and `collector/tests/schema-foundation.repository.test.mjs:195-200`. Their referenced client columns/tables are already in `schema.sql`; no test was found that must rely on the client to create one of those tables/columns after schema execution.
- The only scripts that call `openDatabase` **without** a schema argument are `collector/scripts/find-smoke-item.mjs:69`, `collector/scripts/smoke-field-flow-publish-translation.mjs:134`, and `collector/scripts/trigger-field-pack.js:63`. Each immediately constructs a repository and reads normal application tables, so it requires an already-initialized database; the client helpers alone cannot initialize an empty DB for these scripts.
- `collector/tests/schema-foundation.repository.test.mjs:195-225` creates legacy assignment/draft tables intentionally before `createRepository`; this exercises repository compatibility helpers, not the direct `client.mjs` boot helpers.
- Migration-focused tests (`collector/tests/place-review-flag-migration.test.mjs` and `collector/tests/assignment-state-migration.test.mjs`) intentionally use `DatabaseSync` after setup to test the two migration scripts. They are not evidence that a client helper creates the required schema.
- No test or script references `removeLegacyLocalAuthData` or `user_sessions`. The only `ensure-owner-login` script reference confirms the script is a no-op (`collector/scripts/ensure-owner-login.mjs:15`).

The three missing indexes are the only direct-client schema dependency that still has no `schema.sql` declaration. A fresh DB is functionally created without those indexes only because the client adds them after SQL execution.

## D. Short migration plan

1. Add the three direct-client index declarations listed in section B to `collector/database/schema.sql` (the only required direct-client lift remaining).
2. Keep `place_review_flag` and its `CHECK` in `schema.sql` exactly as currently declared. For existing DBs, run and verify `migrate:place-review-flags`, then `migrate:remove-assignment-state`; do not rely on boot helpers to transform this table.
3. After legacy DB migration is explicit and verified, the pure direct-client SCHEMA helpers can be removed in a separate scoped change: `ensureUsersAuthColumns`, `ensureEvidenceContextColumns`, `ensureSearchIntelligenceTables`, `ensureSocialMomentumTables`, `ensureContentDirectionTables`, `ensureWorkflowTransitionColumns`, `ensureWorkflowHeadBootstrapColumns`, and `ensureAuditColumns`. Until then they remain the compatibility path for pre-schema databases.
4. Retain backend identity projection (`auth-integration.mjs`) as DATA/runtime behavior. There is no local owner bootstrap helper to retain.
5. Leave `removeLegacyLocalAuthData` for a separate decision. It is destructive and clears `password_hash` on every boot; this survey makes no keep/delete recommendation.
6. Do not fold the 3 legacy-only tables or 17 legacy-only columns into `schema.sql` on the evidence here. They come from repository-era compatibility/history, not the direct client chain; decide them in a separate repository-schema survey after the two workflow migrations make the dev DB bootable.

