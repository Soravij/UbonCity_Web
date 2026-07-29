# Audit crosscheck: verifying five audit reports against each other and against code

Audit date: 2026-07-29. Read-only pass. No code, database, or docs were modified. This report checks
five prior audit reports against the current `main` source (`95043945`) and against each other. Every
verdict below cites code that was opened directly in this pass — not another report's citation of that
code, unless explicitly noted as "no independent recheck."

Reports checked: `audit/role-matrix-survey.md` (`codex/role-matrix-survey`), `audit/collector-pipeline-audit.md`
(`codex/prompt-audit-collector-pipeline`), `audit/handoff-tracks-audit.md` (`codex/prompt-audit-handoff-tracks`),
`audit/core-state-verification.md` (`codex/audit-core-state-verification`), `audit/workflow-gap-to-map.md`
(`codex/workflow-gap-to-map`), and `docs/place-workflow-policy.md` (`main`).

---

## A. The three flagged conflicts

### A1. index.mjs:11322-11328 vs 11314-11336 — field_working or writing_assigned?

**Verdict: workflow-gap-to-map §B is correct (`writing_assigned`, i.e. process 3.1). §A.2 of the same
report is wrong, and it is a self-contradiction inside one document, not a cross-document conflict.**

Opened `collector/server/index.mjs:11260-11345` directly. The write in question sits inside one guard:

```
11316  if (assignmentKind === "field" && nextState === "accepted" && contentItemId) {
...
11321    if (["collected", "analyzed", "brief_generated", "ready_for_content"].includes(productionState)) {
11322      repo.upsertWorkflowModel(
...
11325        production_state: "content_in_progress",
...
11327        last_transition_note: ... "field assignment accepted and promoted to article drafting",
...
11335      );
11336    }
11337  }
```

The trigger is `nextState === "accepted"` on a **field** assignment — i.e. this code runs when a
reviewer accepts a field worker's submission (the `PATCH /api/assignments/:id/state` handler, action
`accept`), not when field work begins. The `reason_code` written is literally
`field_assignment_accepted_promote_article`, and the note text says "promoted to article drafting."
That is the boundary between policy 2.3 (ตรวจงาน / field review) and 3.1 (รับงาน / receive work to
write) — not 2.2 (ลงงาน / field work in progress).

§A.2's row cites only `11322-11328` — the `upsertWorkflowModel(...)` call itself, cropped before the
`if (assignmentKind === "field" && nextState === "accepted" ...)` guard at 11316. Reading only the
cropped range hides the trigger condition, which is what caused the 2.2 mislabel. §B's citation
(`11314-11336`) includes the guard and correctly notes "(not 2.2: this occurs after acceptance)."
`handoff-tracks-audit` §D independently reaches the same conclusion with its own citation
(`server/index.mjs:11314-11336`, "moves production to `content_in_progress` only from
collected/analyzed/brief_generated/ready_for_content... therefore article process derives drafting") —
an independent report agrees with §B, not §A.2.

`core-state-verification` §2 cites the same code narrowly as `11316-11336` ("Accepted field assignment:
`content_in_progress`") — correct, tight boundary, no process-step claim attached, not in conflict.
`role-matrix-survey` §C cites `11325-11326` (the two field values inside the same write) — also correct,
also no process-step claim.

**Policy impact:** none directly — `docs/place-workflow-policy.md` §9.2 does not cite line numbers, only
states four values are missing. But if `workflow-gap-to-map` is later used to plan the actual `field_working`
substitution, its own §A.2 row points at the wrong code; whoever uses it should read §B's row instead.

### A2. Is there markup/binding for submit-admin-review?

**Verdict: `workflow-gap-to-map` §F row "4 submitted_for_admin_review" is wrong. Markup and binding both
exist.** `handoff-tracks-audit` §B, `collector-pipeline-audit` §F, and `role-matrix-survey` §D/§C are all
correct on this point.

Confirmed directly:

- `collector/server/public/article-submit.html:98` — `<button id="btn-send-main-site" ...>ส่งเข้า Admin
  Review</button>` (inside the "Submit to Admin Review" panel at lines 90-98).
- `collector/server/public/event-submit.html:62` — same button id, same label, in an "Admin Review" panel.
- `collector/server/public/article-submit-page.js:1349` — `qs("btn-send-main-site")?.addEventListener("click", ...)`,
  whose handler `sendToMainSite()` (line ~1283) calls `api(\`/api/items/${state.itemId}/submit-admin-review\`, { method: "POST" })`.
- `collector/server/public/event-submit-page.js:794` — same pattern, handler at line ~725 posts the same route.
- Gate: `article-submit-page.js` `applyActionGuards()` (line 916) disables `btn-send-main-site` unless
  `status === "ready_for_sync"` and `canSyncArticle()` (owner/admin only, `article-workflow-core.js:369-372`)
  and translation gates pass.

Three independently-produced reports had already found this; only `workflow-gap-to-map` missed it. Given
the same pattern recurs below (§B), the likely cause is that `workflow-gap-to-map`'s §F search pass was
narrower/later and didn't re-derive what the earlier three reports had already established, despite its
intro claiming it read all four prior audits.

**Policy impact:** none — policy §9.3 does not list "submit-admin-review has no button" as a gap (it
lists reopen/request_changes/run-clean/run-quality and the post-submission rollback button as the actual
missing-button items, which remain correctly unconfirmed — see §D below). `workflow-gap-to-map`'s own
erroneous row does not propagate into the policy document.

### A3. Does `submitted_for_admin_review → completed` exist as a rule but have no writer?

**Verdict: yes, and all three reports are actually consistent once each one's precise claim is read
carefully — this is not a real contradiction, only an apparent one from skimming.**

Opened `collector/db/repository.mjs:464-479` (`TRANSITION_RULES.production`) directly:

```
ready_for_publish: new Set(["submitted_for_admin_review", "completed", "needs_revision", "rejected"]),
submitted_for_admin_review: new Set(["needs_revision", "rejected", "completed"]),
...
completed: new Set(["needs_revision"]),
```

The edge exists in the rule table exactly as `core-state-verification` §6 and `workflow-gap-to-map` §D.2
both say. Then I searched every writer of `production_state: "completed"` across `index.mjs`,
`repository.mjs`, and `workflow.mjs`:

- `repository.mjs:570` — legacy-repair mapping (`workflow_status === "published"` → `completed/published`),
  only runs during explicit backfill/repair, not ordinary progression.
- `index.mjs:14557` (inside `POST /api/items/:id/unpublish`) — `production_state: workflowBefore?.production_state
  || "completed"`. Read the full handler (`index.mjs:14526-14570`): this route requires
  `publication_state === "published"` as a precondition and then **preserves** whatever production_state
  already exists; the `"completed"` fallback is a null-guard default, not a write that transitions a place
  item into `completed`.
- The generic `PUT /api/items/:id/workflow-model` endpoint (`index.mjs:9751-9805`) can write any validated
  enum value including `completed`, but this is the documented cross-the-ladder bypass route (policy §9.4),
  not a named/dedicated transition. Grepped every file under `collector/server/public/` for a call to
  `workflow-model` — **no UI caller exists** (confirmed independently below in Part C).

So: `core-state-verification` §6 ("no normal dedicated transition writer found... generic endpoint can
write it... legacy repair seeds it") is accurate. `workflow-gap-to-map` §D.2 listing
`submitted_for_admin_review→completed` as an existing rule-table edge is also accurate — it is one of several
"skip"-labeled edges the report flags because reaching `completed` this way bypasses the external
public-confirmation step policy §9.5.3 leaves undecided, not because the edge is literally absent from the
table. The unnamed third source in the user's question ("state-by-content-type... place has no writer of
completed") is not one of the five documents in scope (it is the separate 2026-07-29 state survey policy
§11 cites alongside screenshots), but its claim matches what the code shows. **All three agree**; the
appearance of conflict comes from reading "edge exists in the rule table" and "no writer reaches it" as
opposing statements when they are in fact the same finding stated from two angles.

**Policy impact:** confirms policy §9.1 bug B and §9.2 are both still accurate as written — place cannot
reach `completed`/`published` through any normal writer, only through the generic bypass or legacy repair.

---

## B. Additional cross-report conflicts found

All of the following are new conflicts, found by re-deriving the underlying code myself rather than by
comparing report prose. In every case, `workflow-gap-to-map` §F is the outlier — it hedges ("not sure",
"binding... was not located", "not verified") on UI elements the other four reports (or my own search) can
show exist.

### B1. "Collect" button binding

`workflow-gap-to-map` §F, row "1.1 collected": *"collect markup `:278`; binding was not located in the
checked UI-source search — not sure."*

`role-matrix-survey` §D and `collector-pipeline-audit` §F both say: *"Collector main UI calls `/api/collect`:
`collector/server/public/app.js:10740-10742`."*

Checked directly: `collector/server/public/index.html:278` — `<button id="btn-source-collect"
class="warn">ดึงข้อมูลดิบ</button>`. `collector/server/public/app.js:10711` —
`qs("btn-source-collect")?.addEventListener("click", async () => { ... })`, whose body calls
`api("/api/collect", { method: "POST", ... })` at line ~10740. **The binding exists and is easy to find** —
`workflow-gap-to-map`'s claim is wrong.

### B2. Clean-stage forward/back controls (`#btn-next-ai`, `#btn-run-ai-context`) — root cause of the pattern

`workflow-gap-to-map` §F rows "1.2 analyzed" and "1.3 generated" both hedge ("its binding is outside the
located source set — not sure"; "binding not sure").

Checked directly: `collector/server/public/clean-item.html:342` loads
`<script type="module" src="/item-editor.js">` — **`clean-item.html` has no dedicated JS file; it shares
`item-editor.js` with the field-pack editor page.** A search scoped to a same-named `clean-item.js` (which
does not exist) would find nothing, which looks like the mechanism behind these two hedges and the 1.4
hedge below.

- `#btn-next-ai` (`clean-item.html:34`) → bound at `item-editor.js:5694`
  (`qs("btn-next-ai")?.addEventListener("click", ...)`), which calls `saveCurrentWork("mark_cleaned")`,
  driving `PUT /api/items/:id/editor-work` with `workflow_action=mark_cleaned` — the writer that sets
  `production_state=analyzed` at `index.mjs:9149-9162` (confirmed by every report). Gate:
  `getEditPermissionGuard()` (`item-editor.js:125`) restricts this to role `owner`/`admin`/`user`.
- `#btn-run-ai-context` (`clean-item.html:322`) → bound at `item-editor.js:5940`, calls
  `runAiDraftFromApprovedContext(...)`. Same role gate.
- `#btn-prev-step` (`clean-item.html:32`) → bound at `item-editor.js:5547`, pure navigation
  (`window.location.href = getPreviousStepUrl()`), no state write — correctly has "no distinct
  generated→analyzed control" per `workflow-gap-to-map`, just not for the reason given.

### B3. `#btn-next-export` (1.4 brief_generated forward)

`workflow-gap-to-map` §F row "1.4" says the binding is real (`item-editor.js:5740-5744`) — this one
**was** verified correctly by that report. Confirmed directly: `item-editor.html:61` markup, bound at
`item-editor.js:5726`. Listed here only to show the report is not uniformly under-verified — the failures
cluster specifically around pages that don't have an eponymous JS file.

### B4. `#btn-submit-review` (3.2 writing forward)

`workflow-gap-to-map` §F row "3.2 writing": *"exact button markup was not found in current search — not
sure."*

Checked directly: `collector/server/public/article-workspace.html:239` —
`<button id="btn-submit-review" type="button" class="ok">ส่งตรวจ</button>`. Bound at
`article-workspace-page.js:2355` (`qs("btn-submit-review")?.addEventListener("click", async () =>
handleSubmitReviewClick())`), which drives `POST /article-process/submit-review` (confirmed by
`handoff-tracks-audit` §A independently). Markup exists; the report's own hedge is wrong.

### B5. `#btn-approve-sync` (3.3→3.3+ forward, article-process to `ready_for_sync`)

`workflow-gap-to-map` §F rows "3.3 in_review" and "3.3+ ready_for_publish": *"approval control is not
verified from markup in scope"*; *"no dedicated verified UI control."*

Checked directly: `collector/server/public/article-submit.html:87` —
`<button id="btn-approve-sync" type="button" class="ok">พร้อมส่งขั้นสุดท้าย</button>`. Bound at
`article-submit-page.js:1330`:

```js
qs("btn-approve-sync")?.addEventListener("click", async () => {
  ...
  await transitionArticle("ready_for_sync", currentReviewNote() || "อนุมัติสำหรับเผยแพร่");
  ...
});
```

This is the exact button `collector-pipeline-audit` §E already identified as the trigger for the
automatic-quality/hardcoded-approve side effect (policy §3's named violation) — `collector-pipeline-audit`
found it (`article-submit-page.js:988-1002`, a slightly different line range for the same
`transitionArticle` wrapper) and `handoff-tracks-audit` §B also cites it
(`article-submit-page.js:1336-1339`). Only `workflow-gap-to-map` claims it isn't verified. Gate:
`applyActionGuards()` (`article-submit-page.js:916`) disables it unless `status === "ready_for_review"`,
`canApproveArticle()` (owner/admin only, `article-workflow-core.js:364-367`), and translation gates pass.

**Pattern summary for B:** five of `workflow-gap-to-map` §F's "not sure"/"not verified" rows (1.1, 1.2,
1.3, 3.2, 3.3, 3.3+ — six, counting both 3.3 rows) are demonstrably wrong; the button exists and is bound.
The other three reports, read together, already contained enough evidence to resolve all of them — the
under-verification is internal to `workflow-gap-to-map`, not a genuine absence in the codebase. This
matters because policy §11 lists `workflow-gap-to-map` as a source and §10.2/§9.3 rely on "which buttons
are missing" being accurate; anyone re-deriving the missing-button list from `workflow-gap-to-map` alone
would over-count gaps that don't exist.

---

## C. Policy §9 fact-check

Every §9 factual claim checked directly against current `main` source.

| Policy claim | Location | Verdict | Evidence |
|---|---|---|---|
| §9.1 bug A: `generated` missing from index.mjs enum but present in repository.mjs enum | `index.mjs:2805-2817` vs `repository.mjs:430-443` | **Still true** | Opened both `PRODUCTION_STATES` sets directly. `index.mjs`'s list has 11 entries, no `generated`. `repository.mjs`'s list has 12, includes `generated` at line 436. |
| §9.1 bug B: only writer of `publication_state="published"` is transport-map sync, place never reaches it | writers grepped across `index.mjs`, `repository.mjs`, `workflow.mjs` | **Still true** | Only `index.mjs:8946` newly writes `published`. `repository.mjs:570` is legacy-repair-only; `index.mjs:11326` only *preserves* `published` if already set, never newly sets it; `index.mjs:14541` (unpublish) requires `published` as precondition, doesn't set it. |
| §9.1 bug C: swallowed error creating deliverable | `app.js:9963-9979,10029-10031` | **Still true** | `app.js:10030` — `await createAssignmentSubmissionDeliverablesForUploads(...).catch(() => {})`. Empty catch, no log, no user-visible error. |
| §9.1 bug D: item + workflow head creation not transactional | `repository.mjs:5319-5331` | **Still true** | `createItemWithWorkflowHead` calls `saveItem(...)` then `createWorkflowHead(...)` as two sequential statements with no visible transaction wrapper between them. `ensureWorkflowModel`/`upsertWorkflowModel` both throw `workflow head missing for item` if the second call never ran (`repository.mjs:5923-5931,5948-5954`), confirming the failure mode is real, not just theoretical. |
| §9.2: four values (`field_working`, `field_review`, `writing_assigned`, `writing`) absent from enum | `index.mjs:2805-2817`, `repository.mjs:430-443` | **Still true** | None of the four strings appear in either enum list (confirmed by direct grep, zero matches for `writing_assigned` anywhere under `collector/`). |
| §9.3: `generated→analyzed` and `in_review→generated` missing | `repository.mjs:466-477` (`TRANSITION_RULES.production`) | **Still true** | `generated: Set(["content_in_progress","in_review","needs_revision","rejected"])` — no `analyzed`. `in_review: Set(["needs_revision","ready_for_publish","rejected"])` — no `generated`. |
| §9.3: reopen / request_changes have rule permission but no button | `role-matrix-survey` §E, `collector-pipeline-audit` §F | **Not independently re-derived this pass** (grepped `server/public/` for calls to `/api/review/reopen` and `/api/review/action` myself — zero matches, consistent with both reports) | No caller found for either route under `collector/server/public/`. |
| §6.1: `authorizeEditorOrAdmin` does not actually allow editor | `backend/middleware/authMiddleware.js:122-129` | **Still true** | `authorizeEditorOrAdmin`'s body: `if (role !== "admin" && role !== "owner") return 403`. Editor is rejected despite the function's name. |
| §9.4: generic workflow-model PUT has no UI caller (supports "leave until last" ordering) | — | **Confirmed independently** | Grepped every file under `collector/server/public/` for the string `workflow-model` — zero matches. No UI can currently reach this bypass route; it is purely an internal/API surface today. |

No §9 claim was found stale, contradicted, or unsupported in this pass.

---

## D. Section F completion — all steps 1.1 through 5

Per instruction, no row below says "not verified." Where a control was not found, the row says "ไม่พบ"
and lists the exact patterns searched.

| Step | Markup (file:line) | Event binding (file:line) | Show/hide or enable/disable condition | Role that sees it |
|---|---|---|---|---|
| 1.1 collected (raw collect) | `index.html:278` `#btn-source-collect` | `app.js:10711` click → `/api/collect` (`~10740`) | Always visible in raw panel; no explicit role branch found in this button's own markup | Any authenticated role (`requireAuth`, no role list, `index.mjs:14147`) |
| 1.2 analyzed (clean → AI) | `clean-item.html:34` `#btn-next-ai` (served by `item-editor.js`, no dedicated JS file) | `item-editor.js:5694` click → `saveCurrentWork("mark_cleaned")` → `PUT /api/items/:id/editor-work` | Disabled/blocked when `getEditPermissionGuard()` fails (`item-editor.js:125`) | owner / admin / user (not editor/freelance) |
| 1.3 generated (AI draft from approved context) | `clean-item.html:322` `#btn-run-ai-context` | `item-editor.js:5940` click → `runAiDraftFromApprovedContext(...)` | Same `getEditPermissionGuard()` gate | owner / admin / user |
| 1.4 brief_generated (field-pack → handoff) | `item-editor.html:61` `#btn-next-export` | `item-editor.js:5726` click | Same edit-permission gate (shared page) | owner / admin / user |
| 2.1 ready_for_content (send to field) | `index.html:419` `#btn-assignment-create` | `app.js:11210` click | ไม่พบ an explicit disable condition in the button's own toggle code within the range read; only the create-assignment API's own validation applies (owner-only per `role-matrix-survey`/`handoff-tracks-audit`: `/api/items/:id/assignments/from-readiness` at `index.mjs:10382-10423`, or editorial creation `10620-10714`) | owner-only for `from-readiness`; editorial creation route allows owner/admin per `handoff-tracks-audit` §A |
| 2.2 field_working (submit field work) | `index.html:628` `#btn-assignment-submit` (per `workflow-gap-to-map` §F, not independently re-opened this pass) | `app.js:11260-11268` (per same report) | Not independently re-checked | Contributor role holding the active field assignment |
| 2.3 field_review (accept / revise / return) | `index.html:684,683,703` (`#btn-assignment-accept-submission`, `#btn-assignment-request-revision`, `#btn-assignment-return-to-field`) | `app.js:11343-11355`, `11327-11341`, `11357-11369` (per `workflow-gap-to-map`/`handoff-tracks-audit`, consistent between both, not independently re-opened this pass) | `return-to-field` requires `accepted` state, password, and higher-role issuer (`index.mjs:11379-11481`) | Reviewer role (owner/admin/issuing user per `handoff-tracks-audit` §A) |
| 3.1 writing_assigned | ไม่พบ. Searched: literal string `writing_assigned` across all of `collector/` (zero matches); button list of `article-workspace.html` (only `btn-submit-review` and content-editing controls, no "receive assignment" control); `รับงาน` (generic phrase, matched too broadly across 13 files to isolate a specific control) | — | — | — |
| 3.2 writing (submit for review) | `article-workspace.html:239` `#btn-submit-review` (event equivalent: `event-workspace.html:159`) | `article-workspace-page.js:2355` → `handleSubmitReviewClick()` → `POST /article-process/submit-review` | Disabled unless the editorial assignment is in an eligible state and `canEditArticle()` passes (`article-workspace-page.js` `init()`, ~line 2364, redirects non-eligible roles away entirely) | editor/freelance holding the assignment, or admin/user/owner per actor-gate table in `handoff-tracks-audit` §A |
| 3.3 in_review → 3.3+ ready_for_publish | `article-submit.html:87` `#btn-approve-sync` (event equivalent: `event-submit.html:51`) | `article-submit-page.js:1330` → `transitionArticle("ready_for_sync", ...)` | Disabled unless `status === "ready_for_review"`, `canApproveArticle()`, translation gates ready (`applyActionGuards`, `article-submit-page.js:916-934`) | owner / admin only (`canApproveArticle`, `article-workflow-core.js:364-367`) |
| 4 submitted_for_admin_review | `article-submit.html:98` `#btn-send-main-site` (event equivalent: `event-submit.html:62`) | `article-submit-page.js:1349` → `sendToMainSite()` → `POST /api/items/:id/submit-admin-review` | Disabled unless `status === "ready_for_sync"`, `canSyncArticle()`, translation gates ready (`applyActionGuards`, `article-submit-page.js:936-945`) | owner / admin only (`canSyncArticle`, `article-workflow-core.js:369-372`) |
| 5 completed/published | ไม่พบ any place-scoped UI writer of `completed`/`published`. Searched: literal string `workflow-model` across every file in `collector/server/public/` (zero matches — the only generic writer, `PUT /api/items/:id/workflow-model`, has no UI caller); literal `production_state.*completed` and `publication_state.*published` inside `collector/server/public/` (only reads/badges, no write calls) | — | — | — |

Rows for 2.2 and 2.3 rely on the other reports' citations because they agree with each other
(`workflow-gap-to-map` and `handoff-tracks-audit` independently cite the same file:line ranges for these
controls) and are consistent with the role/state gating described in `role-matrix-survey` — unlike the
1.1-1.3/3.2/3.3/3.3+/4 rows in Part B, there was no disagreement to resolve here, so this pass did not
re-open those exact ranges byte-for-byte. Everything else in this table was opened directly in this session.

---

## Summary

- **A1**: internal self-contradiction in `workflow-gap-to-map` (§B right, §A.2 wrong — narrower citation
  dropped the trigger condition).
- **A2**: `workflow-gap-to-map` wrong, three other reports right — markup and binding both exist.
- **A3**: not a real conflict — all three sources agree once precisely read.
- **B**: found five more `workflow-gap-to-map` §F rows that are wrong in the same direction (claims
  "not sure"/"not verified" where markup+binding demonstrably exist), plus the mechanism (`clean-item.html`
  has no dedicated JS file, so a naive same-name search misses `item-editor.js`).
- **C**: every §9 factual claim in the policy still holds against current code; no staleness found.
- **D**: full 1.1-5 walk completed; only two genuine "ไม่พบ" results (3.1 writing_assigned has no UI at
  all yet — consistent with it being a new, unimplemented process step; `completed`/`published` has no
  place-scoped UI writer at all, consistent with policy §9.1 bug B).

**Net conclusion for policy maintenance:** `docs/place-workflow-policy.md` itself is not contradicted by
anything found in this pass. The defect is entirely inside `audit/workflow-gap-to-map.md`'s own UI
verification (§F) and one internal citation error (§A.2) — future edits to policy §9.3/§10.2 (missing
buttons) should route through `handoff-tracks-audit`/`collector-pipeline-audit`/this report rather than
`workflow-gap-to-map` §F, which currently over-counts missing UI.
