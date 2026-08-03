# Clean → crawl → merge shortcut: implementation audit

## Scope and branch

- Branch: `codex/clean-crawl-merge-shortcut`, created from current local `main` (`d2b6090`).
- No commit, merge, push, endpoint, state-machine rule, transition, or CSS class was added.
- The implementation uses the existing `/api/collect` crawl flow and the existing `/api/source-raw-items/import` review/import flow.

## Implemented behavior

1. `clean-item.html` no longer renders the misleading `btn-prev-step` link to `/?tab=raw`.
2. In Clean mode, a dynamically-created `Crawl ข้อมูลเพิ่มเข้า item นี้` button takes an eligible user to `/?tab=raw&crawl_merge_item_id=<current item id>`.
3. The source-intake modal reads that context when the crawl batch reaches review.  It sets merge mode, injects the selected item directly into the target list (before the dashboard's 50-item list), and disables both destination selects.
4. The forced ID also wins at confirmation time and after the existing “accept recommended” action, so accepted candidates cannot be submitted as `new` or merged into another item during this context.
5. The shortcut is dynamically rendered only when `isCleanMode`, a positive item ID, and `isAdminUser()` are all true.  `isAdminUser()` allows `admin` and `owner`; server middleware treats `owner` as satisfying `requireRole("admin")` (`collector/server/auth-integration.mjs:563-581`).  A `user` therefore has no button to click.

## Files changed

| File | Change | Lines |
| --- | --- | ---: |
| `collector/server/public/clean-item.html` | Remove legacy raw-navigation button | -1 |
| `collector/server/public/item-editor.js` | Add guarded Clean shortcut and item-ID query context; remove legacy handler | +23 / -8 |
| `collector/server/public/app.js` | Read, force, display, lock, and submit the merge target context | +34 / -8 |
| `collector/tests/clean-crawl-shortcut.surface.test.mjs` | New source-surface regression tests | +45 |
| `audit/clean-crawl-shortcut-implementation.md` | This report | new |

No CSS file changed.  The shortcut reuses `utility-action`, which has existing normal and `:root[data-theme="dark"]` rules in `collector/server/public/styles.css:3925-3927` and `:5705-5719`; the locked controls use the browser's existing disabled state.  This was a source-level light/dark check, not a live-browser visual test.

## Tests added

`collector/tests/clean-crawl-shortcut.surface.test.mjs` covers:

- current item ID is sent as `crawl_merge_item_id`;
- context starts and remains as merge, direct-injects the item option, disables both target controls, and forces that ID at import confirmation;
- `user` cannot get a statically rendered or dynamically created shortcut.

On the branch: `node --test collector/tests/clean-crawl-shortcut.surface.test.mjs` passes (3/3).

Mutation proof was also run before restoration: checking the three production files out from `main` made all three new tests fail, respectively on the legacy button, missing context reader, and missing role gate.  The test is therefore coupled to production behavior rather than passing only against fixtures.

## Gate: `npm run test:all`

The required baseline was run on `main`, and the branch was run in the same working directory after switching checkout (no worktree).  The final branch run was repeated after the final forced-target safeguard.  `test:all` exits non-zero on both baseline and branch because of the same pre-existing failures below.

| Comparison | Failure names |
| --- | --- |
| Baseline (`main`) | `collector admin final review smoke`; `privileged include_unapproved paths retain the normalized admin response`; `nearby candidates always use the public place DTO and retain card fields`; `admin review shaping keeps the public scrubbing but adds the confirmed taxonomy Curation signal`; `composer media helper no longer emits prep-claim errors before article access fallback`; `refreshTranslations preserves missing translation targets as blockers`; `generate translations action stays available before sync for admins`; `translation detail popup exposes automatic check failure reasons`; `article workspace html loads authoring-focused shell`; `article review html loads approval-focused shell`; `article intake html loads intake-focused shell`; `dashboard routes article workflow statuses to article workspace`; `article workspace uses article-process payload field names`; `article workspace supports structured body blocks while keeping raw body storage`; `article workspace can insert image blocks directly from media library`; `article workspace media library supports hover preview`; `article workspace separates translation phase from release actions`; `article intake script supports queue selection and assignment flow`; `assignment app logic drops readiness create flow and uses manual item route`; `manual assignment create flow is gated by step 4 prep-ready status in frontend and backend`; `assignment state patch permission keeps editor out of assignment workflow`; `user role can perform item-editor clean workflow actions`; `process-1 UI exposes claim controls in item pages and raw queue`; `claim banner and theme control stay wired to shared theme tokens`; `assignment brief card no longer renders preparation checklists from legacy assignment context data`; `assignment create flow supports external assignees and due presets`; `work-lane article payload prefill keeps only current field-pack prompts and preserves previous answers`; `assignment routes use management-line scope helpers instead of global admin visibility`; `user management UI keeps create-role choices aligned with backend permission`; `user profile picture flow keeps create-form draft isolated from row-level avatar updates`; `assignment normalization keeps assignee_email as an email-only field`; `assignment workflow layout removes duplicate review actions from submitted states and aligns accepted with close step`; `assignment route aliases expose separate handoff, work, and review views on the shared panel`; `content preparation process ends at review/edit and hands off into process 2`; `assignment route split keeps direct assignment landing while work-only roles stay out of review lanes`; `assignment default page mode treats user as a work-capable assignee while owner still starts in handoff`; `assignment tab switches refresh the current workspace instead of changing mode only`; `handoff queue reuses scoped assignments and leaves the queue after an assignment is accepted or closed`; `handoff detail view can render field-pack context before an assignment exists`; `assignment tabs stay visible for admin and owner flows`; `assignment top tab keeps explicit work or review sub-mode instead of resetting to handoff`; `assignment work access allows assigned accounts across roles while assign target policy stays narrow`; `assignment assignee selection summary keeps avatar and name visible even when there is no assignment yet`; `assignment filter select does not auto-select a lone assignee option`; `content preparation queue only shows items that are still in process 1`; `work lane keeps only contributor-facing scope`; `work lane submission form renders prompt fields from field pack and uploads media through assignment-scoped endpoint`; `review lane keeps only returned work plus review controls`; `step 1 handoff view keeps only the six agreed pre-submit blocks and redirects into work after send`; `review-like assignment APIs no longer allow freelance access`; `/api/assets is filtered to collector-controlled local media`; `release tab exposes article queue UI and renders accepted handoff items`; `requested-check section renders condition input on visible taxonomy rows and keeps AI badge tied to main value only`; `buildRequestedChecksHandoffPayload omits requested_checks when nothing is selected`; `index route wiring keeps HEAD route count and replacement helper on assignment upload only`; `rerunProblemTranslations falls back to draft source before publish`; `rerunProblemTranslations can force regenerate ready translations`; `rerunProblemTranslations falls back when translation provider has no api key`; `rerunProblemTranslations returns per-language missing_article_draft_body failures without calling translator` |
| Branch | Same named failures as baseline |
| New failures on branch | None |
| Baseline failures missing on branch | None |

`git diff --check` passes.  The gate is not green because the named baseline failures remain; this hotfix introduced no additional `test:all` failure name.
