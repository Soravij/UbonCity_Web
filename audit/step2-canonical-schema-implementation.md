# Step 2 canonical schema implementation

Branch: `codex/step2-canonical-schema`, created from `main` at
`51796ecc57d0c9ce5dfd4dbd9c78614a16a5a25b`.

The three Step 1 survey reports were committed first as `0a6e126 docs(audit): add canonical schema surveys`.

## Implemented changes

`collector/database/schema.sql` now contains the DDL previously supplied at boot:

- `agent_profiles`.
- `content_assignment_submission_drafts` and indexes
  `idx_assignment_submission_drafts_expiry` and
  `idx_assignment_submission_drafts_assignment`.
- `content_assets.assignment_id`, `assignment_round`,
  `assignment_media_type`, `assignment_surface`, and `assignment_sync_batch_id`.
- `content_assignment_submissions.updated_at`.
- `content_assignments.accepted_at`, `image_reset_required`,
  `image_reset_reason`, `video_reset_required`, `video_reset_reason`,
  `accepted_submission_id`, and `accepted_handoff_snapshot_id`.
- `field_pack_checklists.capture_type`, with the canonical capture-type CHECK,
  and the corrected `must_capture` checklist type in the table DDL.
- `idx_audit_logs_assignment`, `idx_workflow_transitions_reason`, and
  `idx_workflow_transitions_assignment`.

It intentionally does not add `release_snapshots`,
`source_handoff_snapshot_id`, or `assignment_slot_key`.

The boot-time schema helpers were removed from `collector/db/client.mjs` and
the 17 `ensure*` helpers plus their `createRepository()` calls were removed
from `collector/db/repository.mjs`. The two non-mutating migration assertion
guards remain; `createRepository()` now invokes them before any prepared
statement. The unreachable `content_assets.assignment_slot_key` readiness path
was removed from `collector/server/index.mjs`; payload `slot_key` handling was
retained.

## Canonical-schema proof

A temporary empty SQLite database was created from `schema.sql` only, then
opened with `openDatabase()` and `createRepository()`.

| Comparison | Tables | Columns | Named schema objects (indexes/triggers/etc.) |
| --- | ---: | ---: | ---: |
| schema.sql-only -> first open/repository | 0 | 0 | 0 |
| first open/repository -> second open/repository | 0 | 0 | 0 |

The initial schema snapshot had 65 tables and 158 named `sqlite_master`
objects. Both comparisons were zero.

## Test gate — passed after triage

The first gate found 10 new failures. The triage is recorded in
`audit/step2-test-triage.md`: nine were tests of removed legacy schema helpers
and were deleted as obsolete; one was missing non-mutating guard wiring.

- `createRepository()` calls `assertPlaceReviewFlagMigrationApplied` and
  `assertAssignmentStateMigrationApplied` before its first prepared statement.
- An empty database built from `schema.sql` confirms both
  `content_assignments.assignee_name` and `assignee_contact` exist before the
  obsolete assignee helper-string test was removed.
- The final `npm run test:all` run reported 810 tests, 749 passing, and 60
  failing. Its 60 failing test names exactly equal the supplied baseline:
  `new = 0`, `resolved = 0`.

Nothing was pushed or merged.
