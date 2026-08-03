# Step 5B round 2 — remove `content_items.workflow_status`

## Scope and decision

This change removes the `content_items.workflow_status` persistence mirror under the fresh-DB approach. No migration is included: existing databases must be recreated from `collector/database/schema.sql` before running this code.

The legacy request compatibility mapper `mapWorkflowStatusToModelStates()` remains at create/import boundaries (including repository helper inputs) so an older client payload can be translated into the canonical workflow-head patch. It no longer writes, reads, or seeds a `content_items.workflow_status` field.

## Runtime evidence for removal

Fresh Runtime evidence supplied for the dev investigation: item `9` completed the place progression `field_review` -> `writing_assigned` -> `writing` three times, while `content_items.workflow_status` remained `raw` throughout. These states cannot be represented by the old derived mirror, so the field is incorrect data rather than merely redundant data. The canonical workflow head and transition history are the retained source of truth.

## Implementation

- Removed `workflow_status` from `content_items` in `collector/database/schema.sql`.
- Removed repository insert/update parameters, input normalization, mirror seeding, `setWorkflowStatus`, `reconcileLegacyWorkflowStatusMirror`, and `deriveWorkflowStatusFromModel`.
- New workflow heads always default to canonical `collected` / `draft`; explicit workflow patches remain canonical.
- Removed legacy-mirror drift reporting and legacy-mirror values from delete/audit responses.
- Updated runtime helpers and smoke-fixture SQL that inserted or selected the removed content-item field.

## Hard-delete gate

`getRawOnlyHardDeleteEligibility` no longer checks `workflow_status === 'raw'`. Eligibility remains constrained by the canonical equivalent and all existing blockers:

- active item, no claimant, and a workflow head;
- `production_state === 'collected'` and `publication_state === 'draft'`;
- no current draft/review/field-pack pointers; and
- every existing downstream/reference blocker check.

This preserves the old safe raw-intake case while preventing hard deletion once the canonical head progresses. `raw-delete.test.mjs` now proves both outcomes on a fresh schema and asserts that the deleted column cannot be restored unnoticed.

## Place-review migration writer

`collector/scripts/migrate-place-review-flags.mjs` no longer updates `content_workflow_models.production_state` with raw SQL. Both up and down directions call `repo.upsertWorkflowModel(...)` with migration reason metadata and only the required production-transition validation bypass. This preserves state-version, actor, note, timestamp, and transition recording behavior through the repository. The migration test asserts the persisted actor/note metadata, so restoring the prior raw update path fails the test.

## Regression coverage

- `raw hard-delete eligibility is defined only by canonical collected/draft state` fails if the column is restored or if canonical progression stops blocking hard delete.
- The canonical claim-pool test asserts a fresh `content_items` schema has no mirror while checking each formerly lossy workflow-head state is not claimable as raw.
- The place-review migration test asserts repository-owned audit metadata after migration, which the previous raw SQL writer did not produce.

## Test gate

`npm run test:all` was run once from a detached fresh worktree at `5a0de7b` and once from this branch. The failure-name sets were extracted from each completed test runner output; no cached baseline file was used.

| Set | Count | Result |
| --- | ---: | --- |
| baseline (`5a0de7b`) | 171 | failures |
| actual (this branch) | 60 | failures |
| new | 0 | none |
| missing | 111 | baseline-only failures |

The branch introduces no failure name not present in the fresh-main baseline. The 111 missing names are improvements relative to that baseline (including the old `workflow readers log and reject unknown states` schema mismatch); they are not treated as a reason to change unrelated failing tests in this scoped branch.
