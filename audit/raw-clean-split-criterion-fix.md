# Raw Intake / Clean Prep criterion fix

## Scope and decision

`content_workflow_models.cleaned_at` is the persisted signal for a real Clean-page save.  This is the appropriate table because it is the one-to-one workflow head for each content item and already stores workflow-facing timestamps and actor context.  It avoids deriving user work from `production_state` or a system transition.

Only the existing `workflow_action=mark_cleaned` path in `collector/server/index.mjs` sets the marker (`cleaned_at: true`); the repository converts that explicit marker to the current Bangkok SQL timestamp.  `runCleanStage` does not supply the marker and therefore preserves `NULL` for an item that has never had a user Clean save.

The repository detects the additive column before preparing its workflow-head upsert.  This keeps the existing legacy-schema migration fixtures usable without editing or running a migration; once the Runtime `ALTER TABLE` below is applied, the normal marker path is enabled.

`/api/items` now returns `cleaned_at`.  The former `has_active_approved_context` list field and the `hasActiveApprovedContext` repository query have both been removed; no remaining callers exist.

The local Raw Intake splitter continues to receive only `workflowSplit.intake` (the existing `raw_prep` bucket).  Within that input it is exhaustive:

- Clean Prep: `claimed_by_user_id` is set and `cleaned_at` is non-empty.
- Raw Intake: every other item, including claimed items with no user Clean save.

Field Pack Review and the workflow-warning table still receive their own existing bucket outputs, so no item from the combined preparation list renders twice.

## Table/UI changes

Raw Intake no longer renders a Status header or status cells.  Its empty-state `colspan` is calculated from the same optional columns as its header, so header/body counts remain aligned.

Clean Prep retains its local `กำลังทำ Clean` status.  Its ownership-chip row had the shared `.intake-chip-row` defaults (`flex-wrap: wrap` and a top margin), while the earlier raw table had scoped narrow-cell rules.  The fix scopes equivalent one-line chip/action treatment to `#table-clean-prep`; it uses only existing selectors/classes.  The existing `.table-wrap` supplies horizontal scrolling at narrow widths, avoiding tall wrapped rows.  Theme colors remain inherited from existing table/chip/button rules, so light and dark styles are unchanged outside this table.

## Verification

- `node --test tests/raw-intake-clean-prep.behavior.test.mjs` passes.
- The behavioral test calls the actual splitter, existing bucket splitter, renderer, repository, `runCleanStage`, and the live `PUT /api/items/:id` `mark_cleaned` route against a temporary SQLite database.  It covers unclaimed and claimed-but-not-cleaned Raw Intake rows, claimed-and-cleaned Clean Prep rows, scores, no duplicate/drop across all four rendered tables, no Raw status column and matching header/body counts, confirms `runCleanStage` leaves `cleaned_at` unset, and verifies the route persists and returns `cleaned_at`.
- Reverting the production splitter, renderer, repository/schema marker, or Clean route marker makes the relevant behavioral assertion fail.
- `node --check` passes for the changed JavaScript modules; `git diff --check` passes.

### Full gate: `npm run test:all`

The gate was run in `D:\UbonCity_Web` by switching checkout in the same tree, without a worktree.  `main` and this branch both exited non-zero with the same 59 failure names.  The name-set comparison is: new on this branch: none; present on main but missing on this branch: none.  The pre-existing names include `collector admin final review smoke`, the assignment/article UI contract group, `/api/assets is filtered to collector-controlled local media`, the requested-check pair, `index route wiring keeps HEAD route count and replacement helper on assignment upload only`, and the four `rerunProblemTranslations` cases; no Raw Intake/Clean Prep test is in the failure set.

The earlier `60` was a reporting error: it was anchored to the uncommitted `docs/TEST_SUITE_BASELINE.md` left in this working tree by an unrelated branch, rather than the actual gate summary/name set.  External audit re-measured both trees at 59/59; `test:all` was not re-run in this closing change.

## Runtime database action (not run here)

```sql
ALTER TABLE content_workflow_models ADD COLUMN cleaned_at TEXT;
```

Run this once on the Runtime database before deploying the code.  No migration script or DDL was executed in this workspace.

## Exact diff

`git diff --numstat main..HEAD` after the implementation commit:

| File | Added | Deleted |
| --- | ---: | ---: |
| `audit/raw-clean-split-criterion-fix.md` | 60 | 0 |
| `collector/database/schema.sql` | 1 | 0 |
| `collector/db/repository.mjs` | 17 | 14 |
| `collector/server/index.mjs` | 3 | 1 |
| `collector/server/public/app.js` | 11 | 9 |
| `collector/server/public/styles.css` | 33 | 0 |
| `collector/tests/raw-intake-clean-prep.behavior.test.mjs` | 125 | 13 |
| **Total** | **250** | **37** |
