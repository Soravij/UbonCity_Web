# แผนปรับสถาปัตยกรรม pageMode (handoff/work/review) — collector assignment UI

Audited commit: `af413aa41c3be91268ce196f9f81b89abf55398e`
Branch: `fix/pipeline-round-15aug`

Source of truth for the inventory claims below:
`C:\Users\WIN11\AppData\Local\Temp\claude\D--UbonRuntime-repos-UbonCity-Web\2e199822-be3f-4677-9fd1-6dd253a5fb17\scratchpad\pagemode-inventory.md`
("the inventory"). A handful of citations were spot-checked fresh against HEAD `af413aa4` on
2026-08-17 and matched exactly: `app.js:4419-4571` (`syncAssignmentPageMode` full body),
`app.js:4510-4513` (Writer A, backward-controls force-hide), `workflow-backward-transitions.js:1-50`
(`renderWorkflowBackwardTransitionControls`, Writer B). This is a **PLAN ONLY** document — no code
was modified to produce it.

This is plan-only. No code file was edited. No commit was made.

---

## Finding 0 — undocumented-but-enforced contract (audit category 4)

Grep for `pageMode` across every `PROJECT_POLICY.md` in the repo
(`PROJECT_POLICY.md`, `admin/PROJECT_POLICY.md`, `backend/PROJECT_POLICY.md`,
`frontend/PROJECT_POLICY.md`, `collector/PROJECT_POLICY.md`,
`tmp-runtime-facebook-url-frontend/PROJECT_POLICY.md`) returns zero matches — verified fresh,
2026-08-17. `collector/PROJECT_STATE.md` exists but was not found to document pageMode either
(not grepped for this term in this pass — ไม่พบ specific confirmation, treat as unlikely given the
policy-file result).

This means: the entire "one DOM tree, ~20 shared elements, three mutually-exclusive pageModes,
last-writer-wins" architecture described below is **not a documented contract anywhere in this
repo**. It exists only as an emergent pattern across `app.js`'s functions. Nothing here is a
"policy violation" in the audit-skill sense (there is no policy to violate), but per audit-skill
category 4 it is exactly the kind of undocumented-but-enforced contract that should be written
down once a refactor happens — whichever option in §B is chosen, the resulting invariant
("element X's visibility is owned by exactly one function, driven by Y") should be added to
`collector/PROJECT_POLICY.md` as part of the same phase that establishes it. This is a
recommendation, not a claim that a rule was broken.

---

## A. Blast radius

Basis: inventory §1 (~20 shared elements/containers) and §4 (5 confirmed double-decision points +
1 lower-confidence one). Not a fresh re-scan; line numbers below were spot-checked, not
re-derived from scratch.

### ต้องแตะแน่ (definitely must touch)

| target | file:line | why it must be touched |
|---|---|---|
| `syncAssignmentPageMode` (whole function — the central writer) | `app.js:4419-4571` | Owns Writer-A/B/C role for 5 of 5 confirmed double-decision points (`#workflow-backward-controls` line 4510-4513; `#assignment-detail-panel` line 4504-4505; `#assignment-state-workspace` line 4507-4508; `#assignment-submission-workspace` line 4514-4516; `#assignment-review-workspace` line 4517-4518) plus ~15 single-writer elements (title/note/summary/create-panel/list-panel/review cards/submission form/work monitor/deliverable editor+actions+card/selected-summary/guide/context-brief/next-step/debug-box/load buttons — inventory §1 rows). Any option below rewrites or removes this function. |
| `renderWorkflowBackwardTransitionControls` | `workflow-backward-transitions.js:20-33` (spot-checked, matches exactly) | Writer B in the confirmed live bug. Pageless/pageMode-agnostic today — must either stay agnostic and become the sole writer (Option B/C), or be made pageMode-aware (Option A), depending on which option is chosen. |
| `renderAssignmentBackwardTransitionControls` / `refreshAssignmentBackwardTransitions` / `loadAssignmentContextFieldPackStatus` (the call chain that invokes Writer B) | `app.js:3662-3683`, `app.js:3685-3693`, `app.js:3695-3736` | This is the async chain whose ordering relative to `syncAssignmentPageMode` causes the race (inventory §4, `#workflow-backward-controls` section). Any fix to the race must touch either this chain's call site or `syncAssignmentPageMode`'s trigger points. |
| `syncAssignmentWorkflowLayout` | `app.js:4610-4702` (reads pageMode at `4610`/renamed `4611` per inventory note, computes `effectiveLayout` `4616-4631`, calls `applySectionState` `4641-4662`, unconditionally calls `syncAssignmentPageMode` again at `4702`) | This is the mechanism of the state/submission/review-workspace double-decision — it calls Writer A (`applySectionState`) then unconditionally re-invokes Writer B (`syncAssignmentPageMode`) which overrides it every time. Must be rewritten in any option that kills the double-decision pattern. |
| `applySectionState` | `app.js:4641-4662` | Writer A for the 3-workspace double-decision (state/submission/review). Must be reconciled with or absorbed into whichever function becomes sole owner. |
| `setAssignmentDetailVisible` | `app.js:3779-3781`, 8 call sites per inventory §3 (`4858`, `9279`, `9329`, `9598`, `9639`, `9724`, `10510`, `10529`) | Writer A for `#assignment-detail-panel`; Writer B is the inline block in `syncAssignmentPageMode` (`4504-4505`) that bypasses this function entirely. All 8 call sites need to be re-audited once ownership is consolidated, since some currently rely on Writer B running afterward to "correct" their decision. |
| `selectAssignment` | `app.js:9260-9391` (per inventory §4 ordering trace; no-assignment branch `9265-9279`, assignment-found branch `9299-9391`) | This is where the confirmed race plays out end-to-end: `setAssignmentDetailVisible(true)` (`9329`) → `syncAssignmentWorkflowLayout` (`9334`) → Writer A/B inside it → later `loadAssignmentContextFieldPackStatus`'s `.then` → `rerenderSelectedAssignment` (`9351-9357`) → `syncAssignmentWorkflowLayout` again (`9356`) → Writer A (backward-controls force-hide) re-runs last. Any fix that reorders "load backward-transition data" vs "run syncAssignmentPageMode" touches this function. |
| `getAssignmentPageMode` / `getDefaultAssignmentPageMode` | `app.js:985-997`, `544-547` | The pageMode getter itself. Every option that changes what drives visibility (client pageMode vs. backend `production_state`/`can_transition`) touches this or its call sites — inventory §2 lists ~15 additional call sites (`app.js:3569`, `3629`, `3920`, `3928`, `3938-3941`, `4132`, `4262`, `4409`, `4611`, `9265`, `9299`, `9607`, `9841`, `9092`+, `6344`+, `10472`+) that would need re-verification if the getter's contract changes. |

### อาจกระทบ (might be affected)

| target | file:line | why it's a maybe |
|---|---|---|
| `#assignment-manual-create-panel` double-decision | `setAssignmentRoleVisibility` `app.js:3590-3592` vs `syncAssignmentPageMode` `app.js:4495-4500` | Inventory flags this as "lower confidence" — same last-writer-wins shape as the confirmed 5, but not owner-verified as a live bug. Should be swept in the same refactor pass since the pattern is identical, but is not blocking anything today. |
| `setAssignmentRoleVisibility` | `app.js:3562-3623`, calls `syncAssignmentPageMode` at end (`3625`) | Reads pageMode to gate `assigneeWrap`/`limitWrap`/`reviewTrackingWrap`/tab visibility, then re-triggers the central writer. Not itself a double-decision point on the 5 confirmed elements, but any change to `syncAssignmentPageMode`'s signature/trigger contract touches this caller. |
| `refreshAssignments` / `loadAssignmentsByItem` | `app.js:9607-9682` region (rewritten by `c6821e7`), `app.js:9700-9770` region | Both branch on pageMode for endpoint selection and selection-restoration (inventory §2, rows for `9607`, `9631-9682`) and both call `setAssignmentDetailVisible` (§3: `9639`, `9724`). Not part of the 5 confirmed double-decision points but share the same "pageMode read → visibility write" shape and were touched by `c6821e7` — worth re-testing, not necessarily rewriting. |
| `applyLandingState` / `refreshAssignmentWorkspaceForCurrentMode` | `app.js:10472-10561` | Reads pageMode 7 times (inventory §2) to route between `loadAssignmentsByItem` / `loadAssignmentByLandingId` / `refreshAssignments`, and calls `setAssignmentDetailVisible` twice (`10510`, `10529`). Downstream of the core fix; likely unaffected in behavior but should be smoke-tested since it's a heavy pageMode consumer. |
| `renderAssignmentReviewSummary` / `renderAssignmentReviewSubmissionContent` | `app.js:4132`, `4262` (pageMode reads), branches at `4135`, `4267` | Single-writer per inventory §1 (`assignment-review-summary-card`, `assignment-review-submission-card` rows) — not a double-decision point, but called from inside `syncAssignmentPageMode` itself (`4462-4463`), so any restructuring of the parent function touches the call site even if these functions' internals don't change. |
| `renderAssignmentWorkMonitor` | body from `app.js:3945`, called at `4461`, own visibility toggle also inside `syncAssignmentPageMode` at `4529-4531` | Inventory flags this as "related but distinct decision surface" — the function sets content/hidden on its own sub-nodes independently of the `4529-4531` toggle on the outer `#assignment-work-monitor` container. Two decision layers on nested nodes; worth checking but not a confirmed double-decision on the same node. |
| `tab-handoff`/`tab-work`/`tab-review`/`tab-assignments` + `goToProcessTab` family | `index.html:52,55-57`; `app.js:3562-3623`, `app.js:10601-10651` | Inventory explicitly calls this "a separate subsystem from `syncAssignmentPageMode`, not further expanded." Drives `state.preferredTab` which `getAssignmentPageMode()` reads, so a change to the getter's contract could ripple here, but the tab-click subsystem itself was out of scope for the inventory pass. |
| `index.html` structure (`#panel-assignments` and its ~20 children) | `index.html:336` onward, specific ids at `342`, `343`(implicit), `349`, `358`, `360`, `425`, `512`, `535`, `540`, `543`, `573` | Option A (separate DOM container per pageMode) requires restructuring this markup; Options B/C likely leave markup as-is and only change which JS function decides visibility. Whether this file is touched is option-dependent — see §B. |

---

## B. Architecture options

### Option A — Separate DOM container per pageMode

Render three independent subtrees (`#assignment-panel-handoff`, `#assignment-panel-work`,
`#assignment-panel-review`) instead of one shared tree with ~20 conditionally-visible nodes.
`getAssignmentPageMode()` picks which container is un-hidden; each container's internal content
is owned by one dedicated render function with no cross-pageMode branching inside it.

- **Rewrite**: `index.html:336` onward — duplicate/split markup for elements that currently
  differ by pageMode (title, note, summary, workspaces, submission form, review cards — inventory
  §1 rows). `syncAssignmentPageMode` (`app.js:4419-4571`) is replaced by three smaller
  `renderHandoffPanel`/`renderWorkPanel`/`renderReviewPanel` functions. `syncAssignmentWorkflowLayout`
  (`app.js:4610-4702`) and `applySectionState` (`4641-4662`) are largely deleted — layout-mode
  logic collapses into "which container is active," not per-node hidden toggling.
- **Reuse**: `renderWorkflowBackwardTransitionControls` (`workflow-backward-transitions.js:20-33`)
  unchanged — it's already pageMode-agnostic and can be mounted inside whichever container needs
  it (or, if the backward-control is legitimately handoff-only per its original design intent per
  `db1cccc`'s commit message, mounted only in the handoff container and simply not rendered
  elsewhere). Elements with single writers today (review cards, submission form, work monitor,
  deliverable editor — inventory §1) port over largely as-is, just re-parented.
- **Risks**: Largest surface-area change — touches `index.html` markup (a file the inventory
  explicitly separates from JS-only changes in all 4 recent commits' diffs, i.e. no recent commit
  has touched markup structure this heavily). Risk of breaking CSS selectors that assume the
  current nesting (e.g. `index.html:512` `.secondary-panel` class, `index.html:543`
  `.assignment-workspace-section` class) if containers are duplicated rather than moved. Also
  risks re-introducing the exact bug `db1cccc` fixed (item nested inside a panel that hides it
  when no assignment is selected) if the new container split doesn't carefully replicate that
  fix's reasoning per container.
- **Size**: Large. Touches `index.html` + most of `app.js`'s pageMode-adjacent functions
  (inventory §2's ~20 call sites are all candidates for rewrite, not just review).

### Option B — Single source of truth per element (kill the double-decision pattern, no DOM restructuring)

Keep the current shared-DOM-tree structure, but for each of the 5 confirmed double-decision
elements (plus the 1 lower-confidence one), delete one of the two writers and make the other the
sole owner. Concretely: remove the `syncAssignmentPageMode` blocks at `app.js:4507-4508`
(state-workspace), `4510-4513` (backward-controls), `4514-4516` (submission-workspace),
`4517-4518` (review-workspace), and the inline block at `4504-4505` (detail-panel), and make
`applySectionState`/`setAssignmentDetailVisible`/`renderWorkflowBackwardTransitionControls` the
sole writers for their respective nodes — with `syncAssignmentPageMode` calling *into* those
owner functions instead of re-deciding independently.

- **Rewrite**: `syncAssignmentPageMode` (`app.js:4419-4571`) shrinks — the 5 double-decision
  blocks above are deleted and replaced with calls to the surviving owner function (e.g.
  `applySectionState(stateWorkspace, effectiveLayout.stateMode)` instead of a separate
  `stateWorkspace.classList.toggle(...)`). `syncAssignmentWorkflowLayout` (`app.js:4610-4702`)
  keeps its `effectiveLayout` computation but stops unconditionally re-calling the parts of
  `syncAssignmentPageMode` it just overrode. For `#workflow-backward-controls` specifically: delete
  `app.js:4510-4513` entirely and make `renderWorkflowBackwardTransitionControls`
  (`workflow-backward-transitions.js:20-33`) the sole writer — it already has the correct,
  backend-driven logic (`can_transition`/`targets`), it just needs pageMode-awareness added if
  the product intent (per `db1cccc`'s and `12b02f7`'s commit messages) is still "handoff-only
  visually, but backend-driven for hidden/shown-with-data." If the intent is simply "trust the
  backend everywhere," no pageMode check is added at all — this decision needs product input
  before deleting `4510-4513` (see Option C, which resolves this ambiguity directly).
- **Reuse**: All of `index.html` unchanged. Single-writer elements (inventory §1's ~13 rows with
  only one writer: review cards, submission form, work monitor, deliverable editor/actions/card,
  selected-summary, guide, debug-box, load buttons) are untouched.
- **Risks**: Requires re-deriving, for each of the 5 double-decision elements, which of the two
  existing conditions is actually correct — the inventory documents *that* they conflict, not
  *which one* should win in every role/state combination. Risk of picking the wrong "winner" per
  element and silently reintroducing a different visibility bug (e.g. if `applySectionState`'s
  `effectiveLayout` computation, not inspected in depth by the inventory beyond `4616-4631`, has
  gaps that `syncAssignmentPageMode`'s blunter pageMode-only check was accidentally compensating
  for). Smaller blast radius than Option A but still touches the same central functions, so
  regression risk against `12b02f7`/`db1cccc` is direct (see §D).
- **Size**: Medium. Touches `app.js` only (`syncAssignmentPageMode`, `syncAssignmentWorkflowLayout`,
  `applySectionState`, `setAssignmentDetailVisible` call sites) plus
  `workflow-backward-transitions.js` if pageMode-awareness is added there. No `index.html` changes.

### Option C — Bind visibility to backend state (`production_state` / `can_transition`) instead of client-side `pageMode`

Stop deriving visibility from `getAssignmentPageMode()` (a client-side value derived from
`state.preferredTab`, itself just a UI navigation choice — inventory §2, `app.js:985-997`) and
instead drive the 5 confirmed double-decision elements (and ideally all ~20) from what the backend
already returns: `assignment.production_state`, and for `#workflow-backward-controls` specifically,
`can_transition`/`targets` from `GET /api/items/:id/workflow/backward-transitions` (already the
data `renderWorkflowBackwardTransitionControls` consumes, per `workflow-backward-transitions.js:20-33`
and inventory §4's confirmed bug description).

- **Rewrite**: `syncAssignmentPageMode` is renamed/restructured so its branches read
  `assignment.production_state`/`can_transition` (already available on the assignment object being
  passed in — same param at `app.js:4419` `function syncAssignmentPageMode(assignment)`) instead
  of `pageMode`. `pageMode` (`state.preferredTab`-derived) becomes purely a navigation/tab-active
  concern (which tab is highlighted, which subnav shows) — decoupled from "what is legal to do to
  this assignment right now," which becomes backend-driven. This directly kills the confirmed bug
  by construction: `#workflow-backward-controls` visibility becomes `can_transition === true`, full
  stop, no pageMode override possible because the override is deleted along with the pageMode
  dependency.
- **Reuse**: `renderWorkflowBackwardTransitionControls` unchanged (it's already backend-driven —
  this option just removes the thing fighting it). `index.html` unchanged. Backend endpoints
  unchanged (`GET /api/items/:id/workflow/backward-transitions` already exists and returns the
  right shape per inventory §4).
  Note: no backend route file was opened in this pass to re-confirm the endpoint's current
  response shape beyond what the inventory already documents from the confirmed bug report;
  treat the endpoint's existence/shape as inventory-sourced, not freshly re-verified here.
- **Risks**: Requires auditing every one of the ~20 elements (inventory §1) individually to
  determine its "real" gating condition in backend terms, not just the 5 confirmed ones — some
  elements (e.g. `#assignment-manual-create-panel`, role-based tab visibility) are legitimately
  role-driven, not state-driven, and forcing everything onto `production_state` would be wrong for
  those. Risk of scope creep if not tightly bounded to "only the elements whose current bug is a
  pageMode-vs-backend conflict." Largest conceptual change (redefines what "pageMode" means
  going forward) even if the line-count delta is similar to Option B.
- **Size**: Medium-to-large depending on scope discipline. Minimum viable scope (just
  `#workflow-backward-controls`, matching the confirmed bug) is small — delete `app.js:4510-4513`,
  done, same as Option B's treatment of that one element. Full scope (all 5 double-decision
  elements re-derived from backend state) is medium, comparable to Option B but with an added
  "is this element role-driven or state-driven" classification step per element.

---

## C. Phased rollout

Each phase below leaves the system in a state where, for every element touched, exactly one
function decides its visibility — no phase ships with "some elements new pattern, some old,
ambiguous which governs."

### Phase 1 — Fix `#workflow-backward-controls` only (kills the confirmed item-29 bug)

Delete `app.js:4510-4513` (Writer A) inside `syncAssignmentPageMode`. Leave
`renderWorkflowBackwardTransitionControls` (`workflow-backward-transitions.js:20-33`) as the sole
writer — it is already correct and backend-driven (inventory §4). No other element touched.

- **Files touched**: `collector/server/public/app.js` (one 4-line deletion, `4510-4513`). That is
  the only file this phase must touch. (`workflow-backward-transitions.js` is read, not written —
  it already has the correct logic.)
- **Verifiable independently**: yes — re-run the item-29 pipeline check (item at
  `field_working`, backend `can_transition:true` for "ส่งงานไปทำ" target) and confirm the control
  now renders un-hidden with the button visible. This is a pure subtraction (removing a
  force-hide with no `else` branch), so it cannot leave the element in an ambiguous
  half-migrated state — either the force-hide exists or it doesn't; there's no partial version.
- **This phase unlocks the pipeline test currently stuck at item 29 step 8.** It is both Option
  B's and Option C's treatment of this one element (they converge on the same fix for this
  specific node), so this phase is compatible with either option being chosen for the remaining
  4 elements in Phase 2+.
- **Caveat**: this phase does not address *why* Writer A was added (`12b02f7`'s stated purpose:
  stop the control from leaking into non-handoff pages after `db1cccc` moved it top-level). If
  the product intent really is "backward-controls should be visually hidden outside handoff
  regardless of `can_transition`," deleting `4510-4513` outright would reintroduce that leak. This
  needs a one-line product confirmation before Phase 1 ships: is "handoff-only" a real UX
  requirement, or was it a workaround for the race that's actually being fixed here? Per the
  owner-verified bug report (item 29 expects the control to work on the *work* page), the
  workaround interpretation is presumed correct for this plan, but flag it as an explicit
  assumption, not a verified fact.

### Phase 2 — Kill the remaining 4 confirmed double-decision points

Apply the same "delete the losing writer, keep the winning one" treatment (Option B) to
`#assignment-detail-panel` (delete `app.js:4504-4505`, keep `setAssignmentDetailVisible` as sole
writer, audit its 8 call sites per inventory §3), and to
`#assignment-state-workspace`/`#assignment-submission-workspace`/`#assignment-review-workspace`
(delete `app.js:4507-4508`, `4514-4516`, `4517-4518`; keep `applySectionState`
(`app.js:4641-4662`) as sole writer, called from `syncAssignmentWorkflowLayout`; stop
`syncAssignmentWorkflowLayout`'s unconditional re-call into the now-deleted
`syncAssignmentPageMode` blocks at `app.js:4702`).

- **Files touched**: `collector/server/public/app.js` only (4 more deletions/edits inside
  `syncAssignmentPageMode` + `syncAssignmentWorkflowLayout`'s trailing call at `4702` needs to
  become conditional/scoped instead of unconditional).
- **Verifiable independently**: yes — for each of the 4 elements, confirm visibility now tracks
  its single remaining writer's condition across all three pageModes and both role tiers
  (`canSeeCurrentWork`/`canSeeExtendedManage`/`canSeeExtendedReview` per `app.js:4422-4425`).
  Does not depend on Phase 1 having shipped a particular way (Phase 1's element is independent),
  but should ship after Phase 1 so the pipeline test is unblocked first and this phase can be
  tested without that noise in the way.

### Phase 3 — Sweep the lower-confidence double-decision (`#assignment-manual-create-panel`) + document the contract

Apply the same treatment to `app.js:3590-3592` vs `4495-4500` (inventory's lower-confidence
finding). Then write down the resulting invariant — "each shared element under `#panel-assignments`
has exactly one owning function" — in `collector/PROJECT_POLICY.md` (currently silent on this,
per Finding 0), so the pattern that caused `12b02f7` to blindly add a second writer without
noticing the first one doesn't recur.

- **Files touched**: `collector/server/public/app.js` (small), `collector/PROJECT_POLICY.md`
  (new section, no code).
- **Verifiable independently**: yes — this phase has no interaction with Phases 1-2's elements.

### Phase 4 (optional, only if Option A or C's fuller scope is desired) — Backend-driven visibility for role/state-sensitive elements

Only pursue this if product wants the deeper architectural change (Option C's full scope, or
Option A's container split). This is a distinct, larger effort layered on top of Phases 1-3's
already-consolidated single-writer functions — it would not need to happen at all for the
confirmed bug to stay fixed. Not further broken into sub-phases here since it is optional and
its scope depends on a decision not yet made (see §E).

---

## D. Regression risk against recent commits

| commit | what it touched (per inventory §5) | which phase(s) touch the same code | what could break if not handled carefully |
|---|---|---|---|
| `db1cccc` (moved `#workflow-backward-controls` to top-level `index.html:358`) | `index.html` only — moved the `<section>` out from inside `#assignment-detail-panel` | Phase 1 (deletes the JS force-hide that was compensating for this move) | None of the phases touch `index.html:358` itself — the element's *position* in the DOM is not being changed again. Risk is conceptual, not code-level: `db1cccc`'s fix (stop the widget disappearing when no assignment is selected) must remain true after Phase 1's deletion. Since Phase 1 only removes a *hide*, and `db1cccc`'s concern was about the widget being wrongly hidden, Phase 1 is directionally aligned with `db1cccc`'s intent, not opposed to it. |
| `12b02f7` (`fix(assignment-ui): hide workflow-backward-controls outside handoff`, added `app.js:4510-4513`) | `app.js` only | **Phase 1 directly reverts this commit's change.** This is not incidental overlap — Phase 1's entire deliverable is deleting exactly the 4 lines `12b02f7` added. Per inventory §4, `12b02f7`'s block **is the confirmed bug's Writer A** — the commit that introduced the double-decision and, per the item-29 report, the one currently causing the wrong behavior. Phase 1 should say plainly in its commit message that it is reverting `12b02f7`'s specific mechanism (the unconditional force-hide), not just "fixing a related issue" — future readers of `git log` need to see the causal chain `db1cccc` → `12b02f7` (regression) → Phase 1 (fix) explicitly, or the same "control leaks outside handoff" concern that motivated `12b02f7` could get re-added a third time by someone unaware of this history. If the Phase 1 caveat above (product confirmation on handoff-only intent) resolves toward "yes, still want handoff-only visually," Phase 1 must replace `12b02f7`'s block with a corrected, race-free version rather than deleting outright — but per the owner-verified bug report, plain deletion is the currently-indicated fix. |
| `c6821e7` (stop auto-selecting an assignment, rewrote `refreshAssignments`/`loadAssignmentsByItem` `else` branches) | `app.js:9607-9682`, `9700-9770` region (per inventory §5) — does not touch `#workflow-backward-controls` or `#assignment-state-workspace` directly | Phase 2 touches `setAssignmentDetailVisible`'s call sites, two of which (`app.js:9639`, `9724`) are inside the exact branches `c6821e7` rewrote | Phase 2 must not re-introduce auto-selection behavior while consolidating `#assignment-detail-panel`'s visibility logic — the call sites at `9639`/`9724` currently pass explicit booleans (`false`, `getAssignmentPageMode() === "handoff"`) that must be preserved verbatim when `syncAssignmentPageMode`'s competing `4504-4505` block is deleted and these become the sole source of truth. Getting this wrong would silently resurrect the bug `c6821e7` fixed (auto-selected assignment on load) as a side effect of an unrelated cleanup. |
| `af413aa` (PATCH-on-click for "เปิดงาน", rewrote `wireAssignments()` around `app.js:11425-11455`) | `app.js` only; commit message explicitly cites `app.js:4507-4509` (now `4507-4508`) as "untouched by this change" | Phase 2 directly touches `app.js:4507-4508` (the state-workspace double-decision `af413aa`'s author knowingly left alone) | `af413aa`'s author already documented (in the commit message) that they saw the state-workspace handoff-only gate and chose to route around it with a new PATCH-based path rather than fix the gate itself. Phase 2 changes that exact gate. Risk: if Phase 2's consolidated single-writer logic for `#assignment-state-workspace` ends up hiding the "เปิดงาน" reopen flow's target UI in a case `af413aa`'s workaround was relying on being visible (or vice versa — un-hiding something `af413aa` expected to stay hidden), the two changes could interact. Re-test the reopen ("เปิดงาน") flow end-to-end as part of Phase 2's verification, not just the 4 elements' visibility in isolation. |

---

## E. Recommended path

Phase 1 (Option B/C's convergent single-line-item fix for `#workflow-backward-controls`) first,
regardless of which broader option is chosen later — it is the smallest fully-scoped change (one
file, one deletion), it directly reverts the confirmed regression source (`12b02f7`), and it is
the only thing blocking the item-29 pipeline test today. For Phases 2-3, recommend Option B
(single source of truth, no DOM restructuring) over Option A: same bug-fixing outcome, much
smaller blast radius (`app.js` only, no `index.html` risk), and it directly matches the shape of
the problem the inventory documented (competing writers on the same node, not a wrong DOM
structure). Defer Option C's full backend-driven scope (Phase 4) as a separate, later decision —
it's a genuine architectural improvement but not required to close the confirmed bug or the
pattern behind it, and forcing it into this fix cycle risks scope creep per §B's Option C risk note.

