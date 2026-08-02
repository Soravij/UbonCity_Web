# Runtime place-review migration

Completed 2026-08-02 on unchanged repository HEAD `cacb737f459c6fb3f217193369319fce0e255b73`. No pull, checkout, merge, or repository update was performed.

## Backup gate

Before any migration write, SHA-256 of `D:\UbonRuntime\backups\collector-db\collector-20260802-111638.db` was re-read as:

```text
BFC81E02D092599FFCE6B5D96286C23D21B5E04F8C7579BA3B3BF17BE829811D
```

It matches the approved backup SHA exactly.

## Phase 1 — script scope and pre-flight gate

`collector/scripts/migrate-place-review-flags.mjs` itself creates the missing `place_review_flag`; no separate schema artifact is used. It opens the supplied DB, sets foreign keys, starts `BEGIN IMMEDIATE`, and commits or rolls back as one transaction.

When `place_review_flag` is absent, the script:

1. renames `content_workflow_models` to `content_workflow_models__place_review_flag_legacy`;
2. creates a replacement `content_workflow_models` with `place_review_flag TEXT NOT NULL DEFAULT 'none' CHECK (place_review_flag IN ('none', 'revision_requested', 'rejected'))`;
3. copies every workflow-head row into the replacement, setting the new flag to `none`;
4. drops the renamed table; and
5. recreates six named indexes.

It then selects only place items whose `production_state` is `needs_revision` or `rejected`. For each selected row, it updates `content_workflow_models.production_state` and `.place_review_flag` and inserts two `content_workflow_transitions` rows with reason code `place_review_flag_migration_up`. It does not write `content_items.workflow_status`.

The script has no dry-run mode. After a successful run it is idempotent: the expected flag/CHECK already exists, so no table rebuild occurs; with no legacy target rows, it commits without row updates or transition inserts.

Pre-run selected legacy place rows: **0**. The affected-ID list was empty.

### Column preservation proof

| Current live column | Script replacement table |
|---|---|
| `id` | retained |
| `content_item_id` | retained |
| `production_state` | retained |
| `publication_state` | retained |
| `assignment_state` | retained |
| — | adds `place_review_flag` |
| `current_draft_id` | retained |
| `current_review_report_id` | retained |
| `current_field_pack_id` | retained |
| `state_version` | retained |
| `content_version` | retained |
| `last_actor_email` | retained |
| `last_transition_at` | retained |
| `last_transition_note` | retained |
| `updated_by` | retained |
| `created_at` | retained |
| `updated_at` | retained |

Live columns missing from the script DDL: **0**.

### Index preservation proof

| Current manual index | Current columns | Recreated by script |
|---|---|---|
| `idx_content_workflow_models_production` | `production_state, updated_at` | Yes, identical |
| `idx_content_workflow_models_publication` | `publication_state, updated_at` | Yes, identical |
| `idx_content_workflow_models_assignment` | `assignment_state, updated_at` | Yes, identical |
| `idx_content_workflow_models_current_draft` | `current_draft_id` | Yes, identical |
| `idx_content_workflow_models_current_review` | `current_review_report_id` | Yes, identical |
| `idx_content_workflow_models_current_field_pack` | `current_field_pack_id` | Yes, identical |

The only other live index was `sqlite_autoindex_content_workflow_models_1` on `content_item_id`; it is automatically recreated by the replacement table’s `UNIQUE(content_item_id)` constraint. Manual indexes not recreated: **0**. Differing recreated definitions: **0**. Pre-flight gate: **passed**.

## Phase 2 / Phase 4 — before and after snapshots

Snapshots:

- Before: [runtime-place-review-before.json](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-place-review-before.json)
- After: [runtime-place-review-after.json](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-place-review-after.json)

The canonical-to-legacy decider is `deriveWorkflowStatusFromModel` in `collector/db/repository.mjs`: published > rejected > needs_revision > approved/unpublished/ready-for-publish/submitted-for-admin-review > in_review > generated > content_in_progress > ready_for_content > brief_generated > analyzed > raw.

| Measurement | Before | After |
|---|---:|---:|
| Non-deleted content items | 51 | 51 |
| Workflow transitions | 475 | 475 |
| Canonical→legacy divergences | 0 | 0 |
| `(collected, draft)` with legacy status not `raw` | 0 | 0 |
| Rows whose workflow status or canonical state changed | — | 0 |

`workflow_status` distributions were identical:

| Status | Before | After |
|---|---:|---:|
| `analyzed` | 11 | 11 |
| `approved` | 7 | 7 |
| `content_in_progress` | 6 | 6 |
| `raw` | 27 | 27 |

Canonical `(production_state, publication_state)` distributions were identical:

| Pair | Before | After |
|---|---:|---:|
| `(analyzed, draft)` | 11 | 11 |
| `(collected, draft)` | 27 | 27 |
| `(content_in_progress, draft)` | 6 | 6 |
| `(ready_for_publish, approved)` | 1 | 1 |
| `(submitted_for_admin_review, approved)` | 6 | 6 |

Every workflow-status/canonical-state change list is empty. This matches the pre-run selection count of zero: the completed migration changed the workflow-head schema only, not any item state, legacy status, or transition row.

## Phase 3 — migration execution

The initial invocation did not run because its relative log path could not be opened from `collector\`; it made no DB change. This explicit retry used an absolute log path and was run once:

```text
node scripts/migrate-place-review-flags.mjs --db D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db
```

Complete migration output: [runtime-place-review-migration-run-attempt2.log](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-place-review-migration-run-attempt2.log)

```json
{"ok":true,"direction":"up","db_path":"D:\\UbonRuntime\\repos\\UbonCity_Web\\collector\\data\\collector.db"}
```

Post-run schema: `place_review_flag` **present**; `assignment_state` **still present**; `content_workflow_models` rows **52**; `place_review_flag_migration_up` transitions **0**.

## Phase 5 — Collector boot

Collector was started once from `D:\UbonRuntime\repos\UbonCity_Web\collector` using `npm.cmd start`, with absolute logs:

- Stdout: [runtime-place-review-collector-startup.out.log](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-place-review-collector-startup.out.log)
- Stderr: [runtime-place-review-collector-startup.err.log](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-place-review-collector-startup.err.log)

Startup stdout:

```text
Collector app running on http://127.0.0.1:5070
```

The process listens on `127.0.0.1:5070` (PID 1732). `GET http://127.0.0.1:5070/api/health` returned `ok: true` and identified the database path as `D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db`.

Startup stderr contains only Node’s experimental SQLite warning; no boot error was reported.
