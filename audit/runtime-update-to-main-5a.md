# Runtime update to main and 5A migration

Completed 2026-08-02.

## Phase 0 — services stopped and new backup

After the backend was stopped in its owning scheduled-task context, the stop gate passed:

- port 5070 listener: absent;
- port 5000 listener: absent; and
- Windows Restart Manager locking processes for `collector\data\collector.db`: **0**.

New backup:

- Source: `D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db`
- Destination: `D:\UbonRuntime\backups\collector-db\collector-20260802-1141-preseed5a.db`
- Source/copy size: **48,492,544 bytes** / **48,492,544 bytes**
- Source/copy SHA-256: `34FC17033632BDCE9171FB9C37AC81726E189AE8F538E58BFD956BA5ADB400AA`
- Copy `PRAGMA integrity_check`: **ok**

| Table | Source | Copy |
|---|---:|---:|
| `content_items` | 52 | 52 |
| `content_workflow_models` | 52 | 52 |
| `content_assignments` | 34 | 34 |
| `audit_logs` | 36,730 | 36,730 |

## Phase 1 — repository update

- Checked out branch: `main`
- Pulled with: `git pull --ff-only origin main`
- Final HEAD: `51796ecc57d0c9ce5dfd4dbd9c78614a16a5a25b` (**51796ec**)

All preserved local branches remain at their prior SHAs:

```text
fix/restore-cta-upstream                    675e673336c439a54d7d58651b8d6c86072ca06a
fix/cta-article-confirmation-gate           3fff4f588f59b9da130b971fb2dff9245a83b5c9
fix/raw-external-asset-workflow              1e7201d2e55000dc57167ef3b04278685afb9895
fix/translation-source-fingerprint-stale-gate 4ef08a29cbfd7128b916600d7f20123e95107643
codex/taxonomy-review-ui                     4118b12442a16e1351ec583866d5bcd950445615
```

Both stashes remain:

```text
stash@{0}: On fix/translation-source-fingerprint-stale-gate: temp public home frontend fix
stash@{1}: On codex/collector-root-cache-busting: temp-before-pull
```

`git log --oneline --branches --not --remotes` is empty.

No tracked-file modification is present. The working tree has existing permitted untracked audit artifacts, including the phase snapshots and reports generated during this runtime work.

## Phase 2 — dependencies

No `package-lock.json` changed between `cacb737` and `51796ec`. Root `package.json` and `collector/package.json` changed, but no lockfile did. No `npm ci` or `npm install` was run.

## Phase 3 — 5A DDL and index gate

Artifact: `collector/scripts/migrate-remove-assignment-state.mjs`.

There is no migration runner or ledger. It was invoked directly:

```text
node scripts/migrate-remove-assignment-state.mjs --db D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db
```

The script uses `BEGIN IMMEDIATE`, renames and rebuilds `content_workflow_models`, copies all rows, drops the legacy table, and recreates its indexes. On the up direction it removes only `assignment_state`.

### Column comparison

The live table before 5A had:

```text
id, content_item_id, production_state, publication_state, assignment_state,
place_review_flag, current_draft_id, current_review_report_id,
current_field_pack_id, state_version, content_version, last_actor_email,
last_transition_at, last_transition_note, updated_by, created_at, updated_at
```

The up-migration replacement DDL had every column above except `assignment_state`, including `place_review_flag` with its `none/revision_requested/rejected` CHECK constraint.

Live columns other than `assignment_state` absent from the 5A DDL: **0**. The critical `place_review_flag` column is retained.

### Index comparison

Before 5A, the manual indexes were production, publication, assignment, current-draft, current-review, and current-field-pack. The 5A DDL recreates production, publication, current-draft, current-review, and current-field-pack with identical columns. It intentionally omits only `idx_content_workflow_models_assignment`, because it removes `assignment_state`. The automatic unique index on `content_item_id` is recreated by `UNIQUE(content_item_id)`.

Manual indexes other than the intended assignment-state index missing from the 5A rebuild: **0**. Differing retained-index definitions: **0**. DDL gate: **passed**.

## Phase 4 — migration and measurement

Migration log: [runtime-5a-migration.log](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-5a-migration.log)

The migration was run once and returned:

```json
{"ok":true,"direction":"up","db_path":"D:\\UbonRuntime\\repos\\UbonCity_Web\\collector\\data\\collector.db"}
```

Snapshots:

- Before: [runtime-5a-before.json](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-5a-before.json)
- After: [runtime-5a-after.json](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-5a-after.json)

| Measurement | Before | After |
|---|---:|---:|
| Non-deleted content items | 51 | 51 |
| Workflow transitions | 475 | 475 |
| Canonical→legacy divergences | 0 | 0 |
| `(collected, draft)` with status not `raw` | 0 | 0 |
| Workflow/canonical-state changes | — | 0 |
| `assignment_state` column | present | **absent** |
| `place_review_flag` column | present | present |

`workflow_status` distributions are unchanged: `analyzed` 11, `approved` 7, `content_in_progress` 6, `raw` 27.

Canonical `(production_state, publication_state)` distributions are unchanged: `(analyzed, draft)` 11; `(collected, draft)` 27; `(content_in_progress, draft)` 6; `(ready_for_publish, approved)` 1; `(submitted_for_admin_review, approved)` 6.

Final database integrity check: **ok**. Final counts: `content_items` 52, `content_workflow_models` 52, `content_assignments` 34, `audit_logs` 36,730, `content_workflow_transitions` 475.

## Phase 5 — service boot

Collector and backend were restarted from `main` with absolute logs:

- Collector stdout: [runtime-5a-collector-startup.out.log](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-5a-collector-startup.out.log)
- Collector stderr: [runtime-5a-collector-startup.err.log](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-5a-collector-startup.err.log)
- Backend stdout: [runtime-5a-backend-startup.out.log](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-5a-backend-startup.out.log)
- Backend stderr: [runtime-5a-backend-startup.err.log](D:\UbonRuntime\repos\UbonCity_Web\audit\runtime-5a-backend-startup.err.log)

Results:

- Collector listens on `127.0.0.1:5070` (PID 15852). `GET /api/health` returned `ok: true` and database path `D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db`.
- Backend listens on port 5000 (PID 13172). `GET /api/health` returned `ok: true`.
- Collector stderr contains only Node’s experimental SQLite warning. Backend stderr is empty.
