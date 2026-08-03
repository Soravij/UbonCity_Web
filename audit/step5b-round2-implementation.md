# Step 5B round 2 — remove `content_items.workflow_status`

## Scope and decision

This change removes the `content_items.workflow_status` persistence mirror under the fresh-DB approach. No migration is included: fresh databases created from `collector/database/schema.sql` omit the field; existing databases keep it as an unused vestigial column until they are rebuilt independently.

The legacy request compatibility mapper `mapWorkflowStatusToModelStates()` remains at create/import boundaries (including repository helper inputs) so an older client payload can be translated into the canonical workflow-head patch. It no longer writes, reads, or seeds a `content_items.workflow_status` field.

## Runtime evidence for removal

Fresh Runtime evidence supplied for the dev investigation: item `9` completed the place progression `field_review` -> `writing_assigned` -> `writing` three times, while `content_items.workflow_status` remained `raw` throughout. These states cannot be represented by the old derived mirror, so the field is incorrect data rather than merely redundant data. The canonical workflow head and transition history are the retained source of truth.

## Implementation

- Actual diff at `ecdec01`: 29 files, `+233/-247`.
- Removed `workflow_status` from `content_items` in `collector/database/schema.sql`.
- Removed repository insert/update parameters, input normalization, mirror seeding, `setWorkflowStatus`, `reconcileLegacyWorkflowStatusMirror`, and `deriveWorkflowStatusFromModel`.
- New workflow heads always default to canonical `collected` / `draft`; explicit workflow patches remain canonical.
- Removed legacy-mirror drift reporting and legacy-mirror values from delete/audit responses.
- Updated runtime helpers and smoke-fixture SQL that inserted or selected the removed content-item field.
- Deleted-item cleanup responses now include flat canonical `production_state` and `publication_state` from the workflow head; the existing table cells render those fields without new CSS classes, using the existing light/dark table theme rules.

## Hard-delete gate

`getRawOnlyHardDeleteEligibility` no longer checks `workflow_status === 'raw'`. Eligibility remains constrained by the canonical equivalent and all existing blockers:

- active item, no claimant, and a workflow head;
- `production_state === 'collected'` and `publication_state === 'draft'`;
- no current draft/review/field-pack pointers; and
- every existing downstream/reference blocker check.

The resulting eligible set is a strict superset of main: the old mirror conjunct could block a row whose canonical state is already `collected` / `draft`. That broadening is accepted because the mirror is independently stale, while every content-safety blocker remains unchanged. The Runtime measurement taken on 2 August found zero place rows in `needs_revision` or `rejected`, so there was no live fuel for the known migration-bypass shape at that time. No new live-DB query was run for this correction. `raw-delete.test.mjs` is `+44/-3` versus main and proves canonical progress blocks hard delete while the fresh schema cannot restore the deleted mirror column.

## Place-review migration writer

`collector/scripts/migrate-place-review-flags.mjs` no longer updates `content_workflow_models.production_state` with raw SQL. Both up and down directions call `repo.upsertWorkflowModel(...)` with migration reason metadata and only the required production-transition validation bypass. This preserves state-version, actor, note, timestamp, and transition recording behavior through the repository. The migration test asserts the persisted actor/note metadata, so restoring the prior raw update path fails the test.

## Regression coverage

- `raw hard-delete eligibility is defined only by canonical collected/draft state` fails if the column is restored or if canonical progression stops blocking hard delete.
- The canonical claim-pool test asserts a fresh `content_items` schema has no mirror while checking each formerly lossy workflow-head state is not claimable as raw.
- The place-review migration test asserts repository-owned audit metadata after migration, which the previous raw SQL writer did not produce.
- The deleted-item cleanup status contract test verifies the endpoint join/projection and the UI's matching flat-field reads, so restoring the blank `workflow_model` access fails.

`assignment-ui-scope.test.mjs` is `+6/-2` versus main; its fresh-schema assertion fails if the production column removal is reverted.

## Test gate

`npm run test:all` was run once with `D:\UbonCity_Web` checked out to `main` and once with it checked out to this branch. The failure-name sets were extracted from each completed test runner output; no cached baseline file was used.

| Set | Count | Result |
| --- | ---: | --- |
| baseline (`5a0de7b`) | 59 | failures |
| actual (this branch) | 59 | failures |
| new | 0 | none |
| missing | 0 | none |

The name sets are identical. A detached-worktree comparison is invalid for this repository today: eight test files hardcode `D:\UbonCity_Web`, so they read the primary checkout rather than their worktree. The correct measurement therefore switches the primary checkout in place. The prior `171/60/0/111` figures came from that contaminated worktree method and are withdrawn.

## Known issue

Eight pre-existing test files hardcode `D:\UbonCity_Web` and make `git worktree` baseline comparisons non-isolated: `article-process-field-return-evidence.behavior.test.mjs`, `assignment-accept-confirmed-metadata.repository.test.mjs`, `assignment-ui-scope.test.mjs`, `endpoint-schema-mapping-surface.test.mjs`, `field-pack.repository.test.mjs`, `schema-foundation.repository.test.mjs`, `translation-recheck.repository.test.mjs`, and `workflow-readers-loud.test.mjs`. They are intentionally not changed in this round; use in-place checkout switching for comparison until a separate fix lands.
