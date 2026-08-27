# Gate baseline — `main`

- **Machine:** Runtime — `D:\UbonRuntime\repos\UbonCity_Web`
- **Branch:** `main`
- **Commit:** `a2be1b9e31c954de255f348422f53d085b695df1` (`a2be1b9`, 2026-08-27 15:18:43 +0700)
  — `audit: root-cause item 39 stuck-at-drafting article-process status`
- **Measured:** 2026-08-27 20:28 +0700
- **Command:** `npm run gate` (via `test-runner`), run once

## Result

```
GATE tests=1040 pass=972 fail=67 skipped=1
```

**67 failing tests.** This replaces the stale `59` in `docs/TEST_SUITE_BASELINE.md`
(that number was measured at 915 tests total, last touched 2026-08-09; the suite has since
grown by ~125 tests).

## Failing test names (sorted, 67)

```
/api/assets is filtered to collector-controlled local media
admin review shaping keeps the public scrubbing but adds the confirmed taxonomy Curation signal
article intake html loads intake-focused shell
article intake script supports queue selection and assignment flow
article review html loads approval-focused shell
article workspace can insert image blocks directly from media library
article workspace html loads authoring-focused shell
article workspace media library supports hover preview
article workspace separates translation phase from release actions
article workspace supports structured body blocks while keeping raw body storage
article workspace uses article-process payload field names
assignment app logic drops readiness create flow and uses manual item route
assignment assignee selection summary keeps avatar and name visible even when there is no assignment yet
assignment brief card no longer renders preparation checklists from legacy assignment context data
assignment create flow supports external assignees and due presets
assignment default page mode treats user as a work-capable assignee while owner still starts in handoff
assignment filter select does not auto-select a lone assignee option
assignment normalization keeps assignee_email as an email-only field
assignment route aliases expose separate handoff, work, and review views on the shared panel
assignment route split keeps direct assignment landing while work-only roles stay out of review lanes
assignment routes use management-line scope helpers instead of global admin visibility
assignment state patch permission keeps editor out of assignment workflow
assignment tab switches refresh the current workspace instead of changing mode only
assignment tabs stay visible for admin and owner flows
assignment top tab keeps explicit work or review sub-mode instead of resetting to handoff
assignment work access allows assigned accounts across roles while assign target policy stays narrow
assignment workflow layout removes duplicate review actions from submitted states and aligns accepted with close step
atomic editorial assignment creation preserves legacy place state and rolls back when workflow write fails
buildRequestedChecksHandoffPayload omits requested_checks when nothing is selected
claim banner and theme control stay wired to shared theme tokens
collector admin final review smoke
composer media helper no longer emits prep-claim errors before article access fallback
content preparation process ends at review/edit and hands off into process 2
content preparation queue only shows items that are still in process 1
dashboard routes article workflow statuses to article workspace
every HTML page loading a backward-control renderer contains its container
every place backward transition records its policy reason and can replay forward to its original step
generate translations action stays available before sync for admins
handoff detail view can render field-pack context before an assignment exists
handoff queue reuses scoped assignments and leaves the queue after an assignment is accepted or closed
index route wiring keeps HEAD route count and replacement helper on assignment upload only
item ownership scope metadata exposes holder and assignment owner details without broadening access
manual assignment create flow is gated by step 4 prep-ready status in frontend and backend
nearby candidates always use the public place DTO and retain card fields
onTransition does not return early before loading deliverables bundle in non-navigate path
onTransition reloads deliverables bundle even when resume_path matches current URL
place backward metadata is the only exposed backward path and remains attached to valid graph edges
place return-to-clean walks every legal backward hop to analyzed without a shortcut
privileged include_unapproved paths retain the normalized admin response
process-1 UI exposes claim controls in item pages and raw queue
refreshTranslations preserves missing translation targets as blockers
release tab exposes article queue UI and renders accepted handoff items
requested-check section renders condition input on visible taxonomy rows and keeps AI badge tied to main value only
rerunProblemTranslations can force regenerate ready translations
rerunProblemTranslations falls back to draft source before publish
rerunProblemTranslations falls back when translation provider has no api key
rerunProblemTranslations returns per-language missing_article_draft_body failures without calling translator
review lane keeps only returned work plus review controls
review-like assignment APIs no longer allow freelance access
step 1 handoff view keeps only the six agreed pre-submit blocks and redirects into work after send
translation detail popup exposes automatic check failure reasons
user management UI keeps create-role choices aligned with backend permission
user profile picture flow keeps create-form draft isolated from row-level avatar updates
user role can perform item-editor clean workflow actions
work lane keeps only contributor-facing scope
work lane submission form renders prompt fields from field pack and uploads media through assignment-scoped endpoint
work-lane article payload prefill keeps only current field-pack prompts and preserves previous answers
```

## Diff vs `fix/writing-assigned-to-in-review` @ `7fe8d8a` (branch gate = 68 fail / 1044 tests)

Sorted failing-name sets compared:

- **Only on branch (1):** `backward from writing_assigned: editorial closed, field reopened to revision_requested`
  (`collector/tests/backward-autoclose-scope.test.mjs:116`)
- **Only on main:** none
- Branch has 4 more total tests — the branch-only file
  `collector/tests/place-ladder-writing-assigned-in-review.test.mjs` (4 tests, all pass).

### Regression candidate — needs a targeted re-run to confirm

`backward from writing_assigned: editorial closed, field reopened to revision_requested`
failed on the branch run but not on this main run. Caveats before calling it a real
regression:

- It is a **server-spawn integration test** (`withServer` → spawns the collector child,
  `waitForCollector`, real `fetch`) — the class of test this repo's
  `docs/TEST_SUITE_BASELINE.md` already notes can be full-suite-order sensitive
  (`manual-import-merge-backfill.behavior.test.mjs` cluster, "precise interaction wasn't
  chased further").
- Each gate was run **once** per side (per audit instructions — no re-runs this round).
- The branch's only code change vs main is adding the **forward** edge
  `writing_assigned → in_review` (`collector/db/repository.mjs:525`). This test exercises a
  **backward** transition `writing_assigned → field_review` and the assignment auto-close
  scoping added in `02e2a21` / `bed9395` — no obvious causal path from a forward-edge
  addition.

**Verdict on this candidate: most likely a flake, not confirmed.** To settle it, run
`node --test collector/tests/backward-autoclose-scope.test.mjs` from the repo root a few
times on each of `a2be1b9` and `7fe8d8a`.

## The 4 focus tests from the previous audit round

`:170` `:220` `:319` `:508` in `content-type-transition-rules.test.mjs` all fail on **both**
main and branch → **pre-existing** (confirmed empirically by this run; matches the
diff-causality finding in `audit/gate-baseline-and-fixture-diff.md`). `:149` and `:263`
pass on both sides.
