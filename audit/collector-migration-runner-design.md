# Collector migration runner and ledger — survey and design proposal

Scope: design only. No Collector code or database was changed.

## Checkout used and survey caveat

The named dev checkout at `C:\UbonRuntime\repos\UbonCity_Web` is on `codex/sync-fix` at `49d32c0` and contains only Collector SQL migrations 001–006 plus the older `migrate-workflow-head.mjs`. It has no current 5A/place-review artifacts and no backend `000_baseline_schema.sql`.

The current migration set described in this request exists in `D:\UbonRuntime\repos\UbonCity_Web` on `main` at `51796ec`; that is the source used for the current-artifact inventory below. The checkout mismatch is itself a deployment risk: a runner must report its manifest/version, rather than infer availability from a folder name alone.

## 1. Collector migration artifact inventory

There are **11** numbered SQL files: 001–007 and 009–012. **008 is absent.** There is no migration manifest, runner, or ledger. `011_drop_release_snapshots.sql` explicitly states that manual execution is required because no runner/ledger is configured.

| Artifact | Current invocation | Idempotent today | Reverse | Hardcoded table rebuild |
|---|---|---|---|---|
| `001_source_ingestion.sql` | manually execute against SQLite | Yes: `CREATE ... IF NOT EXISTS` / index guards | No | No |
| `002_content_lifecycle.sql` | manually execute | Yes: `CREATE ... IF NOT EXISTS` / index guards | No | No |
| `003_publish_traceability_columns.sql` | manually execute | No: unguarded `ALTER TABLE ... ADD COLUMN` | No | No |
| `004_translation_workflow.sql` | manually execute | Yes: table/index guards | No | No |
| `005_image_workflow_guardrails.sql` | manually execute | No: unguarded `ALTER TABLE ... ADD COLUMN`; its updates themselves converge | No | No |
| `006_published_article_location_snapshot.sql` | manually execute | No: unguarded `ALTER TABLE ... ADD COLUMN` | No | No |
| `007_reference_media_selections.sql` | manually execute | Yes: table/index guards | No | No |
| `009_content_asset_caption.sql` | manually execute | No: unguarded `ALTER TABLE ... ADD COLUMN` | No | No |
| `010_review_submission_snapshots.sql` | manually execute | Yes after success: table/index guards | No | No |
| `011_drop_release_snapshots.sql` | manually execute | Yes: `DROP TABLE IF EXISTS` | No | No |
| `012_content_asset_name_sequences.sql` | manually execute | Yes: `CREATE TABLE IF NOT EXISTS` | No | No |
| `scripts/migrate-place-review-flags.mjs` | `node scripts/migrate-place-review-flags.mjs --db <absolute-db-path>`; package alias `npm run migrate:place-review-flags -- --db <path>` | Yes after success: checks column/CHECK and only migrates remaining legacy place rows | Yes: `--down` | Yes: rebuilds `content_workflow_models` |
| `scripts/migrate-remove-assignment-state.mjs` | `node scripts/migrate-remove-assignment-state.mjs --db <absolute-db-path>`; package alias `npm run migrate:remove-assignment-state -- --db <path>` | Yes after success: exits if `assignment_state` is already absent | Yes: `--down` | Yes: rebuilds `content_workflow_models` |

Both `.mjs` scripts use `BEGIN IMMEDIATE`, a transaction, and rollback on thrown errors. The place-review script also writes transition history for each legacy place row it changes; the 5A script does not write transitions. Neither script writes a migration ledger.

Other irregularities:

- The numbering gap is 008; a runner must use an explicit ordered manifest and must not assume every integer exists.
- `collector/database/schema.sql` and `db/client.mjs` are also schema-affecting paths. `openDatabase(..., schemaPath)` currently calls schema/bootstrap helpers with DDL before/while loading `schema.sql`. That implicit boot-time mutation is outside the numbered migration list and would undermine any ledger unless it is removed or explicitly classified as baseline/bootstrap behavior.
- The historic `C:` checkout’s `migrate-workflow-head.mjs` calls `openDatabase(..., schemaPath)` and `repo.backfillWorkflowHeads`; it is not present in current `main`. It is not a portable current migration artifact.

## 2. Backend survey — correction to the premise

The backend does **not** have an existing migration runner or ledger to reuse. It has:

- `backend/migrations/000_baseline_schema.sql`: a fresh-install MySQL 8 baseline, with `CREATE TABLE IF NOT EXISTS` statements in foreign-key dependency order.
- upgrade patches `001`–`023` (with gaps); and
- two unrelated manual scripts, `migrate:utf8mb4` and `migrate:lifecycle-sync`.

`000_baseline_schema.sql` explicitly says it is for a blank DB and that patches 001–023 must not run after it. `backend/PROJECT_STATE.md` instructs operators to apply it before `npm start`. The backend’s `023_drop_lifecycle_tables.sql` also states that there is no migration runner or ledger.

The `applied_at` field found in the baseline belongs to the transport-request domain, not a migration ledger.

Useful design lessons from the backend baseline:

- distinguish a **fresh-install baseline** from upgrade migrations;
- make the baseline’s scope explicit; and
- use foreign-key dependency order for a fresh schema.

Those ideas transfer. The MySQL DDL does not: SQLite has different syntax/types, no MySQL `information_schema` dynamic-DDL approach, different ALTER limitations, and different locking/backup semantics. There is no backend runner code to port.

## 3. Establishing a trustworthy starting point

Known facts for Runtime after the 2 Aug operation:

- the 11 numbered SQL migrations have unknown individual applied state;
- `migrate-place-review-flags.mjs` and `migrate-remove-assignment-state.mjs` are known applied; and
- the 48 MB database was manually audited, backed up, DDL-gated, and snapshot-compared.

Options:

1. **Mark every historical numbered migration as applied.** Cheap, but asserts 11 facts the project cannot prove. A later edited/reordered file complicates the fiction.
2. **Write per-migration schema/data detectors.** More precise in theory, but expensive and unreliable here: several migrations are destructive or data-transforming; schema states can be reached through `schema.sql` bootstrap or later work without the named file ever running. Detectors cannot prove provenance.
3. **Recommended: introduce one audited synthetic baseline.** Define an immutable ID such as `collector-baseline-runtime-2026-08-02-post-place-review-and-5a`, with a documented schema fingerprint/required-table-column-index assertions. Record that one baseline only after an explicit operator confirmation on an already-audited database. Declare all earlier artifacts “superseded by baseline,” not individually proven applied. New migrations begin after the baseline. Fresh installs create the canonical Collector baseline and record the corresponding fresh-install baseline before future migrations.

Option 3 is deliberately the cheaper honest answer. It solves the unknown-state problem without pretending to reconstruct history. Its risk is that a partially compatible old database could be falsely baselined; mitigate by refusing baseline unless the required schema assertions pass, requiring the existing backup gate, and emitting the exact differences. Per-migration detectors should be deferred unless a second historically important database must be upgraded without a controlled baseline.

## 4. Ledger and identity

Create one SQLite table, for example `collector_schema_migrations`, containing at least:

- immutable `migration_id` (not just filename);
- ordered `sequence` / manifest position;
- `filename` and migration kind (`sql`, `module`, `baseline`);
- SHA-256 of canonical file contents;
- `applied_at`, runner version, application Git SHA, and elapsed milliseconds;
- optional `backup_path`, backup SHA-256, and operator/host identity; and
- for baselines, a schema-fingerprint/version and explicit `baseline_of` scope.

The source manifest should be the authority, with a stable ID embedded in a migration header/export. Before applying anything, the runner must validate all manifest entries against their files. If an applied ID has a changed SHA, changed filename, vanished file, duplicate ID, or reordered position, it must fail loudly. A rename is therefore detected rather than silently skipped; an intentional rename/edit needs an explicit manifest migration/acknowledgement, never an implicit rewrite.

Use a single `BEGIN IMMEDIATE` transaction for the migration and its ledger insert when the migration is executed in-process. This prevents a schema change succeeding while its ledger row is absent.

## 5. Boot behavior

Recommendation: **do not auto-apply migrations at Collector boot.** Instead, startup performs a read/check-only manifest-plus-ledger gate and refuses to serve with a message such as:

```text
Collector database migration state is not current.
Pending: 013_example; ledger baseline missing/invalid: …
Run: npm run migrate:collector -- --db <absolute path> --backup-dir <absolute path>
```

This replaces the opaque missing-column failure with an actionable one while avoiding automatic destructive table rebuilds, disk-space failures, lock contention, or unexpected production data transformations at service start. The startup check must not invoke today’s DDL-mutating `openDatabase` helpers before it evaluates migration state.

## 6. Transition for current manual scripts

Do not leave two competing authorities indefinitely.

- Initially, add the runner with a manifest and baseline support only; it owns post-baseline migrations.
- Convert each existing `.mjs` migration into an importable module exposing `preflight`, `up(db)`, and, only where genuinely safe, `down(db)`. Keep the CLI wrapper temporarily, but make it delegate to the runner so ledger writes cannot be bypassed.
- Numbered SQL artifacts run through the same manifest in an in-process SQLite transaction. Non-idempotent historical SQL remains baseline-superseded, not rerunnable.
- Retire direct hand-run commands after wrappers have shipped and operators have been migrated. Keep scripts as implementation modules/tests, not alternate entry points.

## 7. Runtime-specific safeguards and scope recommendation

For the 48 MB Runtime DB, table rebuilds can temporarily require substantially more disk, hold a write lock, and lose unrepresented columns/indexes if the hardcoded DDL is stale. A runner should build in:

- a required pre-write backup gate, recording source/copy size, SHA-256, `integrity_check`, and required row-count comparison;
- WAL/SHM and lock detection; use a SQLite-consistent backup mechanism when sidecars exist;
- a migration-declared destructive/rebuild classification that forces column and index comparison before execution;
- before/after snapshots of item counts, workflow transitions, workflow-status distribution, canonical-state distribution, divergence list, and collected/draft non-raw rows for workflow migrations;
- absolute log paths, created/validated before the migration process starts;
- one invocation per migration attempt, with no automatic retry after a failed run;
- disk-space preflight and a single-writer `BEGIN IMMEDIATE` lock timeout; and
- post-run integrity check plus a readable status command.

Smallest recommended deliverable:

1. a Collector manifest, ledger, and explicit audited-baseline command;
2. a `migrate:collector` status/apply CLI that runs new migrations transactionally and creates required evidence; and
3. a startup pending-migration gate that never auto-applies.

Defer per-historical-migration provenance detectors, automatic boot application, generic automatic rollback, and retrofitting every old SQL file into a reversible migration. Those add risk without solving the immediate boot-failure or unknown-state problem better than the controlled baseline.
