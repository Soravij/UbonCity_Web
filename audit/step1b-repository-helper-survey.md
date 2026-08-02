# Step 1B — `createRepository()` helper survey

Date: 2026-08-02  
Scope: read-only survey of `collector/db/repository.mjs`, `collector/database/schema.sql`, and production references under `collector/server`, `collector/db`, `collector/services`, `collector/pipeline`, and `collector/config`. No source/schema/Git state was changed. Temporary SQLite databases were created outside the repository and removed.

This continues [step1-boot-helper-survey.md](step1-boot-helper-survey.md). Unlike the first survey, this one measures the complete `createRepository()` initialization list at `repository.mjs:3958-3975`.

## A. Inventory of every `ensure*` invoked by `createRepository()`

All 17 helpers below are invoked on every call to `createRepository()`. “Conditional” means the DDL/data migration only executes when table metadata or legacy SQL requires it; `CREATE ... IF NOT EXISTS` is still issued on each call where shown.

| Helper and line | DDL / data behavior | Classification |
| --- | --- | --- |
| `ensureLifecycleColumns` (`2836`) | Conditional `ALTER TABLE published_articles ADD COLUMN` for `draft_id`, `review_report_id`, `latitude`, `longitude`, `map_url`, `google_place_id`, `event_period_text`, `location_text`. | SCHEMA |
| `ensureTranslationTables` (`2873`) | `CREATE TABLE/INDEX IF NOT EXISTS` for `content_translations` and `translation_runs`; conditional table rebuild when `source_published_article_id` is incorrectly NOT NULL; conditional ALTERs for translation recheck fields. Rebuild copies rows and normalizes source ID `0` to `NULL`. | SCHEMA + DATA |
| `ensureContentAssetWorkflowColumns` (`3089`) | Conditional ADDs for `selected_in_clean`, `is_cover`, `placement_type`, `caption`, `assignment_id`, `assignment_round`, `assignment_media_type`, `assignment_surface`, `assignment_sync_batch_id`; always executes four conditional-normalization UPDATEs. | SCHEMA + DATA |
| `ensureReferenceMediaSelectionTable` (`3147`) | `CREATE TABLE/INDEX IF NOT EXISTS` for `content_reference_media_selections` and its two indexes. | SCHEMA |
| `ensureFieldPackTables` (`3166`) | `CREATE TABLE/INDEX IF NOT EXISTS` for field-pack tables; conditional `content_asset_id` ADD/copy; conditional rebuild of `field_pack_checklists` when legacy SQL has `must_capture_shot` or lacks `capture_type`, copying/transforming rows. | SCHEMA + DATA |
| `ensureWorkflowHeadColumns` (`3405`) | Conditional seven workflow-head ADDs, asserts the two workflow migrations, and `CREATE INDEX IF NOT EXISTS` for three workflow-head indexes. | SCHEMA + guard |
| `ensureAgentProfileTables` (`3377`) | `CREATE TABLE IF NOT EXISTS agent_profiles`. | SCHEMA |
| `ensureAiFeaturePolicyTables` (`3392`) | `CREATE TABLE/INDEX IF NOT EXISTS ai_feature_policies` and `idx_ai_feature_policies_updated_at`. | SCHEMA |
| `ensureUsersProfileSupport` (`3793`) | Conditional ADD of `users.profile_json`. | SCHEMA |
| `ensureItemClaimSupport` (`3802`) | Conditional ADDs on `content_items`: `claimed_by_user_id`, `claimed_at`, `claim_note`, `event_period_text`, `location_text`. | SCHEMA |
| `ensureAssignmentTableSupport` (`3616`) | Conditional ADDs for assignment metadata; conditional rebuild when `assignee_user_id` is legacy NOT NULL, copying rows and recreating indexes. | SCHEMA + DATA |
| `ensureFieldPackMetadataSupport` (`3823`) | Conditional ADDs for nine field-pack metadata/curation columns. | SCHEMA |
| `ensureAssignmentSubmissionFieldReturnSupport` (`3858`) | Conditional ADD of `field_return_payload_json` and `updated_at`; when adding `updated_at`, backfills it from `created_at`. | SCHEMA + DATA |
| `ensureContentDraftConfirmedMetaSupport` (`3871`) | Conditional ADDs for six confirmed-metadata columns on `content_drafts`. | SCHEMA |
| `ensureAssignmentSubmissionDraftTableSupport` (`3730`) | Creates draft table and two indexes; conditionally rebuilds the old table lacking `revision_round`, copying rows with a default round. | SCHEMA + DATA |
| `ensureFieldPackAssignmentForeignKeySupport` (`3460`) | Only if legacy SQL references `content_assignments_legacy_external`, rebuilds four tables with canonical FKs/indexes and copies rows. | SCHEMA + DATA |
| `ensureReviewSubmissionSnapshotTable` (`3895`) | `CREATE TABLE/INDEX IF NOT EXISTS` for `review_submission_snapshots` and three indexes. | SCHEMA |

The code order is not declaration order: `ensureWorkflowHeadColumns` is called at `3964` before `ensureAgentProfileTables` at `3965`, even though its definition appears later.

## B. Measured schema delta

### Method

1. Created a temporary empty SQLite DB outside the repo and executed raw `collector/database/schema.sql`.
2. Snapshotted `sqlite_master` tables/indexes/triggers, `PRAGMA table_info` for each table, and row counts.
3. Ran `createRepository(db)`, then took the same snapshot and diffed it.
4. Ran `createRepository(db)` a second time on that same DB and diffed again.

Initial raw schema: **63 tables, 151 named sqlite_master objects**. After the first `createRepository()`: **65 tables, 155 objects**.

### First-call additions

**Tables added (2)**

- `agent_profiles` — `ensureAgentProfileTables` (`3377-3390`)
- `content_assignment_submission_drafts` — `ensureAssignmentSubmissionDraftTableSupport` (`3730-3791`)

**Columns added (14)**

- `content_assets.assignment_id` — `ensureContentAssetWorkflowColumns`
- `content_assets.assignment_round` — `ensureContentAssetWorkflowColumns`
- `content_assets.assignment_media_type` — `ensureContentAssetWorkflowColumns`
- `content_assets.assignment_surface` — `ensureContentAssetWorkflowColumns`
- `content_assets.assignment_sync_batch_id` — `ensureContentAssetWorkflowColumns`
- `content_assignment_submissions.updated_at` — `ensureAssignmentSubmissionFieldReturnSupport`
- `content_assignments.accepted_at` — `ensureAssignmentTableSupport`
- `content_assignments.image_reset_required` — `ensureAssignmentTableSupport`
- `content_assignments.image_reset_reason` — `ensureAssignmentTableSupport`
- `content_assignments.video_reset_required` — `ensureAssignmentTableSupport`
- `content_assignments.video_reset_reason` — `ensureAssignmentTableSupport`
- `content_assignments.accepted_submission_id` — `ensureAssignmentTableSupport`
- `content_assignments.accepted_handoff_snapshot_id` — `ensureAssignmentTableSupport`
- `field_pack_checklists.capture_type` — `ensureFieldPackTables` rebuild

**Indexes added (2)**

- `idx_assignment_submission_drafts_expiry` on `(expires_at, updated_at DESC)`
- `idx_assignment_submission_drafts_assignment` on `(assignment_id, user_id, revision_round, updated_at DESC)`

No trigger was added. The fresh-schema run also rebuilt the SQL definition of `field_pack_checklists` and its existing `idx_field_pack_checklists_pack_type` to introduce `capture_type` and the canonical checklist-type constraint. It did not add that index under a new name.

No rows were inserted, deleted, or updated in this empty-DB measurement. This does not erase the DATA classification in section A: the helpers issue repair/backfill UPDATE or copy operations when an existing legacy DB satisfies their conditions.

### Second-call result

The second `createRepository()` call had a **zero diff**:

- tables added/removed: 0 / 0
- columns added: 0
- indexes added/removed: 0 / 0
- triggers added/removed: 0 / 0
- changed `sqlite_master` definitions: 0
- row-count changes: 0

Thus the measured fresh-schema path becomes idempotent after one call. It does not prove that a dirty legacy DB cannot be repaired on a later call; several helpers intentionally do conditional data repair for that case.

## C. Live production use versus historical debris

The following checks exclude tests and helper DDL itself. All objects added in section B are used by production runtime code, so none of the measured additions is a dead candidate.

| Measured item(s) | Production evidence | Verdict |
| --- | --- | --- |
| `agent_profiles` | Repository runtime SELECT/INSERT statements at `repository.mjs:4440-4458`. | **Used → must enter schema.sql** |
| `content_assignment_submission_drafts` | Repository reads, upserts, and deletes it at `repository.mjs:5059-5082`. | **Used → must enter schema.sql** |
| Five `content_assets.assignment_*` columns | Server reads/writes these fields in assignment asset validation and inserts, for example `server/index.mjs:6180-6273` and `15381-15625`; repository also resolves active work batches at `3917-3955`. | **Used → must enter schema.sql** |
| `content_assignment_submissions.updated_at` | Repository writes/reads it in submission persistence and ordering, including `repository.mjs:5038-5051` and later submission methods. | **Used → must enter schema.sql** |
| Seven `content_assignments` acceptance/reset columns | Repository persists acceptance/reset state at `repository.mjs:4943-4963`; server parses and returns reset state at `server/index.mjs:3124-3132`, `3371-3407`, and assignment routes. | **Used → must enter schema.sql** |
| `field_pack_checklists.capture_type` | Repository validates/persists it at `repository.mjs:2605-2618` and `4500`; server validates it at `server/index.mjs:3214-3215`; agent generation consumes it at `services/agent-generation.mjs:120-127`. | **Used → must enter schema.sql** |

### Historical objects called out by Step 1A

These are not a reason to add DDL in this step because neither is created by the current `createRepository()` measurement.

- `release_snapshots`: no production reference was found under the scanned production paths. It is a legacy-only table in `collector/data/collector.db`, not a current helper output. **No current use → leave out of `schema.sql`; retire via a separately approved data migration if desired.**
- `content_assignment_submissions.source_handoff_snapshot_id`: no production reference was found, and no current helper creates it. **No current use → leave out of `schema.sql`; retire via a separately approved data migration if desired.**

One separate, important exception was found: `content_assets.assignment_slot_key` is **not** created by the current helper and is absent from current `schema.sql`, but production server code reads/writes it at `server/index.mjs:3399`, `3434`, `3645`, and `3672`. A fresh DB after `createRepository()` still lacks this column. It is not part of the 14-item measured delta, but it is live usage and must be resolved before removing compatibility code: add it to canonical schema or remove/replace those server writes in a separately approved change.

## D. Final schema and helper plan

### DDL that must be made canonical

Add or correct these in `collector/database/schema.sql`:

1. The three direct-client indexes from Step 1A:
   - `idx_audit_logs_assignment`
   - `idx_workflow_transitions_reason`
   - `idx_workflow_transitions_assignment`
2. `agent_profiles` table.
3. `content_assignment_submission_drafts` table and its two indexes.
4. Five `content_assets` assignment columns: `assignment_id`, `assignment_round`, `assignment_media_type`, `assignment_surface`, `assignment_sync_batch_id`.
5. `content_assignment_submissions.updated_at`.
6. Seven `content_assignments` columns: `accepted_at`, the two `image_reset_*` fields, the two `video_reset_*` fields, `accepted_submission_id`, and `accepted_handoff_snapshot_id`.
7. Canonical `field_pack_checklists.capture_type` with `CHECK (capture_type IS NULL OR capture_type IN ('photo', 'video', 'both'))`, and canonical `checklist_type` values (`must_verify_fact`, `must_capture`, `must_ask_question`); this needs the table DDL corrected, not merely an additive ALTER.
8. Resolve `content_assets.assignment_slot_key` separately but before fresh-DB deployment: production currently requires it and neither canonical schema nor a current helper supplies it.

Do **not** add `release_snapshots` or `source_handoff_snapshot_id` based on current code: both are legacy residue with no production read/write found.

### Helper disposition

- **Can be deleted after the canonical-schema change and an explicit one-shot legacy migration are verified:** `ensureLifecycleColumns`, `ensureTranslationTables`, `ensureContentAssetWorkflowColumns`, `ensureReferenceMediaSelectionTable`, `ensureFieldPackTables`, `ensureWorkflowHeadColumns`, `ensureAgentProfileTables`, `ensureAiFeaturePolicyTables`, `ensureUsersProfileSupport`, `ensureItemClaimSupport`, `ensureAssignmentTableSupport`, `ensureFieldPackMetadataSupport`, `ensureAssignmentSubmissionFieldReturnSupport`, `ensureContentDraftConfirmedMetaSupport`, `ensureAssignmentSubmissionDraftTableSupport`, and `ensureReviewSubmissionSnapshotTable`.
- **Keep temporarily until legacy tables are explicitly migrated and verified:** `ensureTranslationTables`, `ensureContentAssetWorkflowColumns`, `ensureFieldPackTables`, `ensureAssignmentTableSupport`, `ensureAssignmentSubmissionFieldReturnSupport`, and `ensureAssignmentSubmissionDraftTableSupport`; these currently perform data copy/backfill/normalization, not just DDL.
- **Keep temporarily until the `content_assignments_legacy_external` FK repair has a dedicated migration and the legacy signature is absent:** `ensureFieldPackAssignmentForeignKeySupport`. It rebuilds four interdependent tables and copies rows, so deleting it before that migration would strand old DBs.

There is no repository helper that should remain permanently for fresh initialization once the canonical schema and versioned legacy migrations exist. The safe order is: add canonical DDL, execute/verify explicit migrations on real DBs, then remove the compatibility helpers in a separate change.

