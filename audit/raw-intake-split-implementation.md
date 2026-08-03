# Raw Intake / Clean Prep split — review gate

## Scope and baseline

- Branch: `codex/raw-intake-clean-prep-split`, created from `main` commit `e59a1dae7b69f3523089fa7c0cc151439b866f7e`.
- This is the required **review** round only. No production code, endpoint, state machine, transition rule, CSS, test, or `collector/data` file was changed.
- The working tree already had two unrelated untracked audit files: `audit/interest-score-survey.md` and `audit/interest-score-survey-round2.md`; they were left untouched.

## 1. Signals for “someone has actually entered Clean work”

The requested definition is **not** “claimed” and is **not** “state left `collected`”. The best available implementation criterion is:

> Put an item in Clean Prep only when it is currently claimed **and** it has at least one active approved-context block.

This is the narrowest persisted, intentional Clean action available now. Creating/updating approved context is guarded by `ensurePrepItemEditAccess`, which requires the Clean-edit access path, so it cannot be produced by the autonomous clean pipeline merely moving a workflow state. It also avoids declaring a task active merely because a user opened a page or claimed it.

| Candidate signal | Reliability for this UI decision | Available in `/api/items` today? | Evidence / limitation |
| --- | --- | --- | --- |
| `claimed_by_user_id` | Necessary ownership condition, but not sufficient. | Yes. | A claim write only sets claimant, `claimed_at`, note, and item `updated_at` (`collector/db/repository.mjs:2925-2934`). It does not prove Clean work. |
| `production_state !== collected` | Do **not** use. | Yes. | System pipeline and agent paths can write `analyzed` without a claim (`collector/services/workflow.mjs:1778-1829`, `:2416-2431`). |
| Active `approved_context_blocks` | **Strong / recommended** proof of intentional Clean action. | No. The per-item endpoint exists; the list does not include a count/flag. | Create/update is Clean-edit guarded (`collector/server/index.mjs:12648-12750`). The list response adds workflow, field-pack, and interestingness only (`:1304-1360`). |
| User-added `evidence_blocks` | Medium only if distinguished from automatic seeding; otherwise unsafe. | No. | The explicit add endpoint is Clean-edit guarded (`index.mjs:12648-12667`), but GET evidence auto-seeds source-derived blocks (`:12635-12643`). A bare evidence count therefore means neither human work nor Clean work. |
| `draft_input_snapshots` | Medium: an intentional preview snapshot, but not a content change. | No. | It is created only with `?snapshot=1` (`index.mjs:12938-12972`), and can be requested by read-capable roles; it is useful supplementary evidence, not the primary criterion. |
| `updated_at > claimed_at` | Weak / reject. | Yes, both fields are inherited from `content_items`. | Claim itself sets both timestamps to `CURRENT_TIMESTAMP`; unrelated update/delete/category actions also update `updated_at`. SQLite timestamp precision can also make close operations indistinguishable. |
| Field pack / accepted assignment | Strong evidence of later workflow activity, but outside the requested Raw/Clean boundary. | Yes for current field-pack pointer/status and accepted-assignment flag. | It would hide items that did Clean work but have not reached a field pack, so it is not suitable as the criterion. |

### Required API decision

The recommended criterion needs an additive list field, e.g. `has_active_approved_context` (or an approved-context count), because `/api/items` does not currently return it. The user explicitly instructed that this must be reported and not added without approval. **No API change was made.**

If the product owner instead accepts “a Clean preview was created” as enough, the same list response would need a snapshot flag/count too. That is a different criterion and should not be silently combined with the approved-context criterion.

## 2. Item 1 and why state alone is not valid

The local `collector/data/collector.db` checked read-only at review time has item 1 as unclaimed and `production_state='collected'`, not `analyzed`; it has 16 source-derived active evidence blocks, zero approved-context blocks, and zero draft snapshots. Therefore the stated dev-screen observation (“item 1 is analyzed without a claim”) cannot be reproduced from this checkout’s DB file.

That discrepancy does **not** rescue state as a signal. The code positively permits it: `runCleanStage` reads all `collected` items and writes each head to `analyzed` with actor role `system`, with no claim check (`collector/services/workflow.mjs:1772-1829`). The agent field-pack path does the same (`:2416-2431`). The manual Clean save route also advances to `analyzed` only when a caller chooses `workflow_action=mark_cleaned` (`collector/server/index.mjs:8960-8984`), but it is not the exclusive writer. Thus a dev instance can legitimately show an unclaimed item as `analyzed` after a system/agent run.

## 3. “สถานะ” badge mapping and reuse

For the Raw Intake table, the badge text is local to `collector/server/public/app.js`:

- `buildRawQueueStatusLabel()` returns `รอคัดเข้า AI` only when `isRawPreparationItem()` is true; otherwise it returns `กำลังคัดข้อมูล` (`app.js:5190-5201`).
- `isRawPreparationItem()` requires `resolveQueueBucket(item) === 'raw_prep'` **and** `production_state === 'collected'` (`app.js:777-781`).
- `resolveQueueBucket()` is a broader routing helper used by dashboard entry actions and queue splitting, not only badge display (`app.js:738-776`, `:5150-5188`).
- `normalizeDashboardWorkflowStage()` and the generic `formatWorkflowBadge()` are also shared workflow presentation helpers (`app.js:4950-4959`, `:5000-5048`).

Do **not** change `resolveQueueBucket`, `isRawPreparationItem`, `normalizeDashboardWorkflowStage`, or generic workflow-badge mapping for this hotfix: they affect other dashboard/workflow surfaces. The safe implementation is a new, page-local splitter for this one Raw Intake panel and a local label such as `กำลังทำ Clean` for its second table; it must not repurpose the global status mapping.

## 4. Proposed implementation after approval

1. Add only the minimum additive response flag/count needed for `claimed && has_active_approved_context`; stop before doing so unless the criterion is approved.
2. Split this panel’s existing list into Raw Intake and Clean Prep locally. Raw Intake shows every unclaimed item regardless of `production_state`, always renders `interestingness`, and retains the claim button. Clean Prep shows only items meeting the approved criterion and shows claimant/assigner/progress without interest score.
3. Remove only `RAW_INTAKE_FILTERS`, `buildRawIntakeFilterHtml`, its rendered container, click handling, and `state.dashboard.rawIntakeFilter` after confirming no other reader. Do not touch the separate Raw Review filters.
4. Use existing table, badge, chip, and theme classes; verify light and dark after the change. No new CSS class.
5. Add behavioral tests that load/exercise the real app functions and fail if the production implementation is reverted. Run `npm run test:all` once after the approved patch, using checkout switching in this worktree only for the requested revert gate.

## Decision required

Approve or amend this criterion before implementation:

`Clean Prep = claimed_by_user_id is set AND has at least one active approved_context_blocks row.`

The one unresolved data discrepancy is the supplied item-1 observation versus the local DB snapshot above. It does not affect the code conclusion, but if it must be explained as a specific historical event rather than as a permitted code path, provide the running dev database/API payload or the timestamp of the observed item.

---

## Approved implementation (completed)

The approved criterion is implemented as `claimed_by_user_id > 0 && has_active_approved_context === true`. The new Raw Intake/Clean Prep splitter is page-local in `app.js`; it does not change `resolveQueueBucket`, `isRawPreparationItem`, `normalizeDashboardWorkflowStage`, or `formatWorkflowBadge`.

`bulk_preview.approved_context_count` was not usable as the shared criterion: `GET /api/items` sets `includeBulkPreview` only for `isAdminLikeUser(req.authUser)`, whereas the Raw Intake page is also available to role `user`. The implementation therefore adds the smallest role-neutral response field: boolean `has_active_approved_context`.

The two main tables partition every item that was already in this page's Process-1 preparation list (`getPreparationQueueItems`) exactly once:

- Raw Intake: every item not meeting the criterion, including unclaimed and claimed-without-active-context items. Interestingness renders for every row and unclaimed rows retain the existing claim button.
- Clean Prep: only claimed items with active approved context. It omits the score and uses the local `กำลังทำ Clean` badge while retaining existing claimant/assignee/assigner chips.

The existing Field Pack Review (including Raw Review filters) and workflow-warning table remain separate downstream/special-purpose surfaces. They were restored after the one full-suite run exposed that removing the warning panel was outside this hotfix's scope.

### Exact diff by file

Counts below are from `git diff --numstat main..HEAD` for the committed hotfix; the stat is exactly `382 insertions(+), 72 deletions(-)` across these six files.

| File | Exact diff | Change |
| --- | ---: | --- |
| `collector/db/repository.mjs` | `+12/-0` | Adds a prepared `EXISTS`-style query and exported `hasActiveApprovedContext(itemId)` boolean reader. |
| `collector/server/index.mjs` | `+1/-0` | Adds `has_active_approved_context` to each `/api/items` match-shaped row. |
| `collector/server/public/app.js` | `+59/-71` | Removes only Raw Intake filter state/chips/handler; adds the local exhaustive splitter; creates Raw Intake and Clean Prep rendering; keeps Field Pack Review, Raw Review filters, and warning surface. |
| `collector/server/public/index.html` | `+0/-1` | Removes the Raw Intake chip-container node. |
| `collector/tests/raw-intake-clean-prep.behavior.test.mjs` | new, `206` lines | Calls actual extracted splitter and render functions; verifies all required row classifications, score visibility, partition exhaustiveness, and non-rendering intake chip markup; uses a temporary OS directory for repository behavior, never `collector/data`. |
| `audit/raw-intake-split-implementation.md` | modified | Review record plus this implementation handoff. |

No CSS file changed and no CSS class was added. Static theme review confirmed the existing `workflow-badge-cleaned`, `intake-chip`, and `raw-interest-wrap` rules have both normal and `:root[data-theme="dark"]` coverage in `collector/server/public/styles.css`.

### Verification

- `node --test tests/raw-intake-clean-prep.behavior.test.mjs` — PASS (2 tests).
- `node --check server/public/app.js`, `node --check server/index.mjs`, and `node --check db/repository.mjs` — PASS.
- `git diff --check` — PASS.
- Revert gate: temporarily stashed only `collector/server/public/app.js` in this same checkout, ran the behavioral test against baseline, and observed the expected failure (`splitRawIntakeAndCleanPrep` missing); then popped the stash successfully. No worktree was created.
- Old single-branch `npm run test:all` result is superseded by the final two-tree gate below; it was collected before the warning panel had been restored.

### Final two-tree gate (after warning-panel restoration)

The full suite was run once on `main` and once on this branch by switching checkout in this same working tree. No worktree was created.

| Tree | Exit | Failure names |
| --- | --- | --- |
| `main` | 1 | 59 names (the expected baseline count) |
| hotfix branch | 1 | 59 names |

Name-set comparison, not count comparison:

- New failure names on branch: **none**.
- Missing failure names on branch: **none**.

The baseline failure set is therefore unchanged by this hotfix. The 59 failures are pre-existing on `main`; the gate is not a green-suite result.

### Restored warning-panel evidence

Compared the actual warning-panel markup from `main:collector/server/public/app.js` with the branch file, after normalizing line endings and extracting the full card from `⚠ Workflow state ผิดปกติ` through its closing wrapper:

- `warning_panel_identical=true`
- `main_panel_chars=367`, `branch_panel_chars=367`

This is a direct main-vs-branch content comparison, not a visual/manual reading.

No merge or push was performed. External audit is still required.
