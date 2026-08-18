# Step 5 visibility plumbing inventory — `#panel-assignments`

Scope: visibility-control leftovers under `#panel-assignments` after DOM-split Steps 1-4.
Files: `collector/server/public/app.js`, `collector/server/public/index.html`,
`collector/server/public/styles.css`.
Branch `fix/pipeline-round-15aug`, HEAD `803160a`. Mode: discovery. Read-only — no code
changed by this pass.

Method: Layer 1 (audit-scanner) produced a candidate list; every line/condition it cited was
re-read against live source in this session before use. Layer 2 (audit-deep-reasoner) traced
call order for every candidate flagged `needs_deep_review=true`, plus one conflict
(`setAssignmentDetailVisible` vs. `syncAssignmentPageMode`) found while manually re-verifying
Layer 1's output. All findings below are re-confirmed against current HEAD, not against
`audit/dom-split-plan.md`'s (stale) line numbers, which are cited only where the plan's
classification is being checked against current code.

No fixes are proposed and nothing is prioritized below — this is inventory only.

---

## 1. Full visibility control-point inventory

### 1.1 New layer — container-level toggle (baseline, for reference)

| path:line | element | condition (verbatim) |
|---|---|---|
| `app.js:4479` | `#assignment-panel-handoff` | `qs("assignment-panel-handoff")?.classList.toggle("hidden", pageMode !== "handoff")` |
| `app.js:4480` | `#assignment-panel-work` | `qs("assignment-panel-work")?.classList.toggle("hidden", pageMode !== "work")` |
| `app.js:4481` | `#assignment-panel-review` | `qs("assignment-panel-review")?.classList.toggle("hidden", pageMode !== "review")` |

### 1.2 Old layer — per-node toggles inside `syncAssignmentPageMode` (`app.js:4397-4549`)

| path:line | element (variable / id) | condition (verbatim) |
|---|---|---|
| `app.js:4470-4471` | `createPanel` / `#assignment-manual-create-panel` | `if (createPanel && pageMode !== "handoff") { createPanel.classList.add("hidden"); }` |
| `app.js:4473-4474` | same node, 2nd block | `if (createPanel && pageMode === "handoff" && !canSeeExtendedManage) { createPanel.classList.add("hidden"); }` |
| `app.js:4476-4477` | `listPanel` (ternary-selected: `#assignment-list-panel-handoff/-work/-review`, `app.js:4408`) | `listPanel.classList.toggle("hidden", !canSeeBaseTasks)` |
| `app.js:4482-4483` | `detailPanel` / `#assignment-detail-panel-handoff` (`app.js:4409`) | `detailPanel.classList.toggle("hidden", !canSeeCurrentWork \|\| (pageMode === "handoff" ? true : !hasAssignment))` |
| `app.js:4485-4486` | `stateWorkspace` / `#assignment-state-workspace` (`app.js:4410`) | `stateWorkspace.classList.toggle("hidden", pageMode !== "work" \|\| !hasAssignment)` |
| `app.js:4488-4490` | `backwardControls` / `#workflow-backward-controls` (`app.js:4488`) | `if (backwardControls && pageMode !== "handoff") { backwardControls.classList.add("hidden"); }` |
| `app.js:4492-4493` | `submissionWorkspace` / `#assignment-submission-workspace` (`app.js:4411`) | `submissionWorkspace.classList.toggle("hidden", !canSeeCurrentWork \|\| pageMode === "handoff" \|\| pageMode === "review")` |
| `app.js:4495-4496` | `reviewWorkspace` / `#assignment-review-workspace` (`app.js:4412`) | `reviewWorkspace.classList.toggle("hidden", !canSeeExtendedReview \|\| pageMode !== "review")` |
| `app.js:4498-4499` | `reviewSummaryCard` / `#assignment-review-summary-card` (`app.js:4413`) | `reviewSummaryCard.classList.toggle("hidden", !canSeeExtendedReview \|\| pageMode !== "review" \|\| !hasAssignment)` |
| `app.js:4501-4502` | `reviewSubmissionCard` / `#assignment-review-submission-card` (`app.js:4414`) | `reviewSubmissionCard.classList.toggle("hidden", !canSeeExtendedReview \|\| pageMode !== "review" \|\| !hasAssignment)` |
| `app.js:4504-4505` | `submissionForm` / `#assignment-submission-form` (`app.js:4415`) | `submissionForm.classList.toggle("hidden", pageMode === "review" \|\| (pageMode === "work" && hasAssignment && (!canActInWork \|\| isReadOnlyInWork)))` |
| `app.js:4507-4508` | `workMonitor` / `#assignment-work-monitor` (`app.js:4416`) | `workMonitor.classList.toggle("hidden", pageMode !== "work" \|\| !hasAssignment \|\| (!isReadOnlyInWork && canActInWork))` |
| `app.js:4510-4511` | `deliverableEditor` / `qs("assignment-deliverable-editor")` (`app.js:4417`) | `deliverableEditor.classList.toggle("hidden", pageMode === "review" \|\| (pageMode === "work" && hasAssignment && (!canActInWork \|\| isReadOnlyInWork)))` — **id `assignment-deliverable-editor` does not exist anywhere in `index.html`; `qs()` always returns `null`; this `if` body never executes.** |
| `app.js:4513-4514` | `deliverableActions` / `qs("assignment-deliverables-actions")` (`app.js:4418`) | `deliverableActions.classList.toggle("hidden", pageMode === "review" \|\| (pageMode === "work" && hasAssignment && (!canActInWork \|\| isReadOnlyInWork)))` — **id `assignment-deliverables-actions` does not exist anywhere in `index.html`; same dead-lookup pattern.** |
| `app.js:4516-4517` | `deliverablesCard` / `qs("assignment-deliverables-summary")?.closest(".assignment-deliverables-card")` (`app.js:4419`) | `deliverablesCard.classList.toggle("hidden", isEditor \|\| (pageMode === "work" && hasAssignment && (!canActInWork \|\| isReadOnlyInWork)))` |
| `app.js:4519-4520` | `selectedSummary` / `#assignment-selected-summary` (`app.js:4420`) | `selectedSummary.classList.toggle("hidden", pageMode === "work" \|\| pageMode === "review")` |
| `app.js:4522-4523` | `guideBox` / `.assignment-guide` via `qs("assignment-next-action")?.closest(...)` (`app.js:4421`) | `guideBox.classList.toggle("hidden", pageMode === "work" \|\| pageMode === "review")` |
| `app.js:4525-4526` | `contextBriefCard` / `.assignment-brief-card` via `qs("assignment-context-brief")?.closest(...)` (`app.js:4422`) | `contextBriefCard.classList.toggle("hidden", pageMode === "work" \|\| pageMode === "review")` |
| `app.js:4531-4532` | `nextStepCard` / `.assignment-brief-card` via `qs("assignment-next-step-content")?.closest(...)` (`app.js:4424`) | `nextStepCard.classList.toggle("hidden", pageMode === "work" \|\| pageMode === "review")` |
| `app.js:4534-4535` | `debugBox` / `#assignment-debug-box` (`app.js:4425`) | `debugBox.classList.toggle("hidden", !canSeeExtendedManage \|\| pageMode === "work" \|\| pageMode === "review")` |
| `app.js:4537-4538` | `loadSubmissionsBtn` / `qs("btn-assignment-load-submissions")` (`app.js:4426`) | `loadSubmissionsBtn.classList.toggle("hidden", isEditor \|\| pageMode === "work")` — **id does not exist in `index.html`; dead lookup, never executes.** |
| `app.js:4540-4541` | `loadHistoryBtn` / `qs("btn-assignment-load-history")` (`app.js:4427`) | `loadHistoryBtn.classList.toggle("hidden", isEditor \|\| pageMode === "work")` — **id does not exist in `index.html`; dead lookup, never executes.** |

### 1.3 Old layer — `applySectionState` inside `syncAssignmentWorkflowLayout` (`app.js:4590-4683`)

Local closure, not a top-level function; defined `app.js:4621-4638`:

```
const applySectionState = (node, mode, summaryNode, summaryText) => {
  if (!node) return;
  const normalizedMode = assignment ? mode || "hidden" : "hidden";
  node.classList.toggle("is-active", normalizedMode === "active");
  node.classList.toggle("is-secondary", normalizedMode === "collapsed");
  node.classList.toggle("is-collapsed", normalizedMode === "collapsed");
  if (summaryNode) {
    summaryNode.textContent = summaryText || "เลือกงานในกระบวนการนี้เพื่อดูสรุปของขั้นนี้";
    summaryNode.classList.toggle("hidden", normalizedMode !== "collapsed");
  }
  if (normalizedMode === "hidden") {
    node.classList.add("hidden");
    node.classList.remove("is-active", "is-secondary", "is-collapsed");
    if (summaryNode) summaryNode.classList.add("hidden");
    return;
  }
  node.classList.remove("hidden");
};
```

Call sites (`app.js:4640-4642`):

| path:line | element | mode source |
|---|---|---|
| `app.js:4640` | `stateSection` = `#assignment-state-workspace` | `assignment ? effectiveLayout.stateMode : "hidden"` |
| `app.js:4641` | `submissionSection` = `#assignment-submission-workspace` | `assignment ? effectiveLayout.submissionMode : "hidden"` |
| `app.js:4642` | `reviewSection` = `#assignment-review-workspace` | `assignment ? effectiveLayout.reviewMode : "hidden"` |

`effectiveLayout` (`app.js:4596-4611`) forces `stateMode:"hidden"`, `submissionMode:"active"`,
`reviewMode:"hidden"` whenever `pageMode === "work" && assignment` and the user can act on
the work (unless read-only/track-only), overriding whatever `getAssignmentWorkspaceLayout`
(`app.js:~3800-3860`) returned for the assignment's actual state (e.g. `stateMode:"active"`
for state `"assigned"`, `app.js:3842-3850`).

### 1.4 Old layer — `setAssignmentDetailVisible` (`app.js:3757-3759`)

```js
function setAssignmentDetailVisible(visible) {
  qs("assignment-detail-panel-handoff")?.classList.toggle("hidden", !visible);
}
```

8 call sites: `app.js:4838`, `9260`, `9310`, `9579`, `9620`, `9705`, `10491`, `10510`.
Targets the same node as `app.js:4482-4483` (§1.2).

### 1.5 Old layer — `setAssignmentRoleVisibility` (`app.js:3532-3604`)

| path:line | element | condition (verbatim) |
|---|---|---|
| `app.js:3559-3561` | `assigneeWrap` / `#assignment-assignee-wrap` | `assigneeWrap.classList.toggle("hidden", !canSeeExtendedManage \|\| pageMode === "handoff" \|\| pageMode === "work" \|\| pageMode === "review")` — condition ORs across all 3 possible `pageMode` values, so it is unconditionally `true`; element is always hidden regardless of role. |
| `app.js:3562-3564` | `limitWrap` / `#assignment-limit-wrap-work` | `limitWrap.classList.toggle("hidden", !canSeeBaseTasks \|\| pageMode === "handoff")` |
| `app.js:3565-3567` | `reviewTrackingWrap` / `#assignment-review-tracking-wrap` | `reviewTrackingWrap.classList.toggle("hidden", !(pageMode === "review" && canSeeExtendedReview && isOwnerUser()))` |
| `app.js:3568-3570` | `createPanel` / `#assignment-manual-create-panel` | `createPanel.classList.toggle("hidden", !showCreatePanel)` where `showCreatePanel = pageMode === "handoff" && contextItemId > 0 && canSeeExtendedManage` (`app.js:3557`) |
| `app.js:3584-3585` | `handoffTab` / `#tab-handoff` | `handoffTab.classList.add("hidden")` (unconditional add, every call) |
| `app.js:3587-3588` | `workTab` / `#tab-work` | `workTab.classList.add("hidden")` (unconditional add) |
| `app.js:3590-3591` | `reviewTab` / `#tab-review` | `reviewTab.classList.add("hidden")` (unconditional add) |
| `app.js:3593-3594` | `handoffMode` / `#assignment-mode-handoff` (subnav button) | `handoffMode.classList.toggle("hidden", !canSeeExtendedManage)` |
| `app.js:3596-3597` | `workMode` / `#assignment-mode-work` | `workMode.classList.toggle("hidden", !canSeeCurrentWork)` |
| `app.js:3599-3600` | `reviewMode` / `#assignment-mode-review` | `reviewMode.classList.toggle("hidden", !canSeeExtendedReview)` |

### 1.6 Old layer — `applyFreelanceWorkerView` (`app.js:447-482`)

Only runs `if (currentRole() === "freelance")` (`app.js:448`). Force-hides (unconditional
`.add("hidden")`, no pageMode branch):

| path:line | element |
|---|---|
| `app.js:468` | `pageSummary` / `#assignment-page-summary` |
| `app.js:469` | `guideBox` / `.assignment-guide` via `qs("assignment-next-action")?.closest(...)` |
| `app.js:470` | `stepsRoot` / `#assignment-process-steps` |

### 1.7 Old layer — `renderAssignmentsTable` (`app.js:9064-9239`)

| path:line | element | condition |
|---|---|---|
| `app.js:9090` | `loadBtn` / `#btn-assignments-load` | `loadBtn.classList.add("hidden")` — handoff branch only |
| `app.js:9093` | `actionableTitle` / `#assignment-actionable-list-title` | `actionableTitle.classList.add("hidden")` — handoff branch only |
| `app.js:9096` | `actionableNote` / `#assignment-actionable-list-note` | `actionableNote.classList.add("hidden")` — handoff branch only |
| `app.js:9099` | `submittedWrap` / `#assignment-submitted-list-wrap` | `submittedWrap.classList.add("hidden")` — handoff branch only |
| `app.js:9190` | `actionableTitle` | `actionableTitle.classList.toggle("hidden", pageMode !== "work")` — shared work/review branch |
| `app.js:9193` | `actionableNote` | `actionableNote.classList.toggle("hidden", pageMode !== "work")` |
| `app.js:9196` | `submittedWrap` | `submittedWrap.classList.toggle("hidden", pageMode !== "work")` |
| `app.js:9199` | `loadBtn` | `loadBtn.classList.remove("hidden")` — shared work/review branch |

---

## 2. Classification (ก / ข / ค)

**ก — pure pageMode, redundant with container toggle, no other function:**
- `app.js:4470-4471` (createPanel, block 1 of 2)
- `app.js:4488-4490` (backwardControls) — pageMode-only, but see §5 note: this is the exact
  mechanism `12b02f7` added and `audit/dom-split-plan.md` §E already documents as slated for
  Step 5 removal; not a new finding, cited here for inventory completeness.
- `app.js:4519-4520`, `4522-4523`, `4525-4526`, `4531-4532` (selectedSummary, guideBox,
  contextBriefCard, nextStepCard) — condition is pageMode-only; each node's ancestor is
  `#assignment-detail-panel-handoff`, itself nested inside `#assignment-panel-handoff`, so
  redundant with two ancestor layers, not just one.
- `app.js:3559-3561` (assigneeWrap) — pageMode component technically ก (always-true, see §4).

**ข — necessary, unrelated to pageMode:**
- `app.js:4476-4477` (listPanel — role only; pageMode only selects *which* of the 3 nodes is
  targeted, not whether it's shown)
- `app.js:4473-4474` (createPanel, block 2 of 2 — role only)
- `app.js:3562-3564` (limitWrap — role, +pageMode exclusion, see ค below; role part alone
  would be ข)
- `app.js:3568-3570` (createPanel via `setAssignmentRoleVisibility` — role+context+pageMode
  folded together, this is the site that actually decides the element's fate; §4 Layer-2
  finding: the two ก blocks in `syncAssignmentPageMode` can only ever agree with this, never
  contradict it, because they only ever add `hidden`, never remove it)
- `app.js:3593-3594`, `3596-3597`, `3599-3600` (handoffMode/workMode/reviewMode subnav
  buttons — pure role)
- `app.js:9090`, `9093`, `9096`, `9099`, `9190`, `9193`, `9196`, `9199` (renderAssignmentsTable
  — these encode "which sub-list applies to which mode's table", not a redundant duplicate of
  the container toggle, since `renderAssignmentsTable` itself writes into whichever table/list
  corresponds to the *current* pageMode only; no other function does this job)
- `app.js:4640-4642` (`applySectionState` calls — encode workflow-state layout, not pageMode)

**ค — mixed, pageMode component dead but a non-pageMode clause must survive:**
- `app.js:4482-4483` (detailPanel) — `!canSeeCurrentWork` clause is real and must survive;
  the `pageMode === "handoff" ? true : ...` clause is not simply "redundant," it is inverted
  (see §4 Issue 1) — its removal is not a pure simplification, the whole line's logic needs
  re-deriving, not just the pageMode part deleted.
- `app.js:4485-4486` (stateWorkspace) — `!hasAssignment` clause is real and must survive; the
  `pageMode !== "work"` clause is redundant with the container ancestor **and** currently
  conflicts with `applySectionState` (§4 Issue 2).
- `app.js:4492-4493` (submissionWorkspace) — `pageMode` clauses redundant with ancestor;
  `!canSeeCurrentWork` clause technically live but currently always `false` in practice
  (`canSeeAssignmentCurrentWorkSurface()` returns `true` for any logged-in role per Layer 2's
  trace of `app.js:432-435`), so inert today but not provably dead by construction.
- `app.js:4495-4496` (reviewWorkspace) — `pageMode !== "review"` clause redundant with
  ancestor; `!canSeeExtendedReview` clause necessary. Open question (§4) on whether this also
  conflicts with `applySectionState`'s `reviewMode` the way stateWorkspace does.
- `app.js:4498-4502` (reviewSummaryCard, reviewSubmissionCard) — same split as reviewWorkspace,
  plus `!hasAssignment`.
- `app.js:4504-4505` (submissionForm) — the `pageMode === "review"` disjunct is unreachable in
  practice (node is only ever rendered while nested in the work-only submission-workspace
  subtree); the `pageMode === "work" && hasAssignment && (...)` clause encodes real
  role/state gating and must survive.
- `app.js:4507-4508` (workMonitor) — `pageMode !== "work"` redundant with ancestor;
  `!hasAssignment` and `(!isReadOnlyInWork && canActInWork)` necessary.
- `app.js:4516-4517` (deliverablesCard) — `pageMode === "work" && ...` clause's pageMode part
  is redundant/moot in agreement with ancestor; `isEditor` and the state-gating sub-clause are
  necessary.
- `app.js:4534-4535` (debugBox) — `pageMode === "work" || pageMode === "review"` redundant
  with the handoff-container ancestor (doubly moot, same as the ก group above, since debugBox
  is also nested under `#assignment-panel-handoff`); `!canSeeExtendedManage` necessary.
- `app.js:3562-3564` (limitWrap) — `pageMode === "handoff"` exclusion is redundant with the
  fact this node lives inside the work container only; `!canSeeBaseTasks` necessary.
- `app.js:3565-3567` (reviewTrackingWrap) — `pageMode === "review"` inclusion redundant with
  ancestor; `canSeeExtendedReview && isOwnerUser()` necessary.

**Dead / not a pageMode question at all (excluded from ก/ข/ค — see §5):**
- `app.js:4510-4511`, `4513-4514` (deliverableEditor, deliverableActions) — target ids that
  don't exist in `index.html`; `qs()` always `null`; bodies never execute.
- `app.js:4537-4538`, `4540-4541` (loadSubmissionsBtn, loadHistoryBtn) — same, ids don't exist.
- `app.js:3584-3585`, `3587-3588`, `3590-3591` (handoffTab, workTab, reviewTab) — unconditional
  `add("hidden")` on elements that ship already-hidden in markup (`index.html:55-57`,
  `class="tab hidden"`) and that nothing else in `app.js` ever removes `hidden` from (grepped
  all `tab-handoff`/`tab-work`/`tab-review` references, `app.js:603, 2442, 3540-3543, 10582-10592,
  10632` — none of these call `.classList.remove("hidden")` on the button nodes themselves;
  `10582-10592`/`10632` only compare `tabId` as a string key into `applyLandingState`, they
  never touch the DOM node). These 3 buttons are never shown in any pageMode, any role.

---

## 3. Undocumented contract

**"One element, one decider" is not yet a written rule, and its absence is why Issue 1/Issue 2
(§4) exist.** Nothing in `PROJECT_POLICY.md`, `collector/PROJECT_POLICY.md`, or
`audit/dom-split-plan.md` states that a given DOM node's `hidden` class must have exactly one
authoritative writer per render cycle. The current code instead relies on an *implicit*
"last call in the synchronous chain wins" ordering: `syncAssignmentWorkflowLayout` runs
`applySectionState` (§1.3) and then, as its literal last line (`app.js:4682`), calls
`syncAssignmentPageMode`, whose per-node toggles (§1.2) silently overwrite whatever
`applySectionState` just decided for the same 3 nodes (`stateSection`/`submissionSection`/
`reviewSection`). This ordering is real and load-bearing today — it is the mechanism behind
Issue 2 (§4) — but it is not declared anywhere as an invariant, so nothing prevents a future
edit from reordering these two calls (or adding a third caller) and silently changing which
layer wins, with no test or comment to catch it. `audit/dom-split-plan.md` §C acknowledges
`syncAssignmentPageMode`'s trailing call to itself from `syncAssignmentWorkflowLayout` "must
not survive as-is once that function is deleted," which implies awareness that ordering matters,
but does not name the ordering itself as a rule.

---

## 4. Confirmed layering conflicts — which layer wins, and where content is lost

### Issue 1 — `#assignment-detail-panel-handoff` is forced hidden whenever `pageMode === "handoff"`, unconditionally

- Deciding line: `app.js:4483` — `detailPanel.classList.toggle("hidden", !canSeeCurrentWork || (pageMode === "handoff" ? true : !hasAssignment))`.
  When `pageMode === "handoff"`, the parenthesized ternary evaluates to the literal `true`,
  making the full expression `true` regardless of `canSeeCurrentWork`/`hasAssignment`. `.hidden`
  is `display: none !important` (`styles.css:2310-2312`), so the entire subtree —
  `#assignment-selected-summary`, `.assignment-guide`, both `.assignment-brief-card`s
  (context brief, next-step) — is force-hidden in handoff mode, the one mode where this
  content is supposed to be the primary working content per `audit/dom-split-plan.md` §A.2
  finding 1.
- `setAssignmentDetailVisible` (`app.js:3757-3759`, §1.4) targets the same node with the
  opposite intent at 3 of its 8 call sites — `app.js:9260` (`pageMode === "handoff" && Boolean(contextItem)`),
  `app.js:9310` (`true`, inside `selectAssignment`), `app.js:9705` (`getAssignmentPageMode() === "handoff"`,
  inside `loadAssignmentsByItem`) — but all 3 call sites are followed, later in the same
  synchronous call, by `syncAssignmentWorkflowLayout(...)` → `syncAssignmentPageMode` (tail
  call `app.js:4682`), which re-executes `app.js:4483` and overwrites the node back to hidden.
  Traced: `selectAssignment` (`app.js:9241`) → `setAssignmentDetailVisible(true)` at `9310` →
  `syncAssignmentWorkflowLayout(assignment)` at `9315` → tail call `syncAssignmentPageMode` at
  `4682` → `4483` re-hides. No async boundary, `MutationObserver`, or later re-render exists in
  between (grepped for both across `app.js`; none found).
- Winner: `app.js:4483` always wins for these 3 call sites — `setAssignmentDetailVisible`'s
  "show" effect never survives past the same call stack. The other 5 call sites all pass
  `false` (`app.js:4838`, `9579`, `9620`, `10491`, `10510`) and so already agree with the
  forced-hide outcome — no observable conflict there.
- Not a migration regression: `git log -S` on this exact ternary text shows it unchanged since
  the line was first introduced, predating every DOM-split commit
  (`324accb`/`9bceb37`/`4bc50c1`/`4a3e96d`/`a52a9bc`/`5cd108a`/`2de7387`/`803160a`). The
  migration renamed the id (`assignment-detail-panel` → `assignment-detail-panel-handoff`,
  per `audit/dom-split-plan.md` §A.1) and added the container-level toggle around it, but never
  touched this specific condition.
- `collector/tests/assignment-ui-scope.test.mjs:3265` asserts a literal string —
  `'detailPanel.classList.toggle("hidden", pageMode === "handoff" ? true : !hasAssignment);'` —
  that does not match current `app.js:4483` (current code wraps the same ternary inside
  `!canSeeCurrentWork || (...)`). The assertion is stale against current source independent of
  the behavior question above.

### Issue 2 — `#assignment-state-workspace` reappears, unstyled, whenever `pageMode === "work"` and an assignment is selected

- `applySectionState` (`app.js:4640`) sets `stateSection` hidden whenever
  `effectiveLayout.stateMode === "hidden"`, which `app.js:4596-4610` forces unconditionally for
  every `pageMode === "work" && assignment` case (the work-mode submission-consolidation
  design). This runs first.
- `syncAssignmentPageMode`'s own toggle for the same node (`app.js:4485-4486`,
  `stateWorkspace.classList.toggle("hidden", pageMode !== "work" || !hasAssignment)`) runs
  second, as the tail call from `syncAssignmentWorkflowLayout` (`app.js:4682`). When
  `pageMode === "work"` and `hasAssignment` is true, this evaluates `false` — removing the
  `hidden` class `applySectionState` just added, one statement later in the same call.
- Winner: `app.js:4485-4486` wins for the `hidden` class specifically; `applySectionState`'s
  other writes to the same node (`is-active`/`is-secondary`/`is-collapsed`, `app.js:4624-4626`)
  are untouched by `syncAssignmentPageMode` (which never references those classes), so the
  node ends up visible (base `.assignment-workspace-section` styling, `styles.css:4473`) but
  with none of the `is-active`/`is-collapsed` layout classes applied — the raw state-update
  form (`#assignment-state-action` select + reason/notes fields + action toolbar,
  `index.html:554-579`) becomes visible, unstyled, alongside the submission workspace it was
  supposed to be consolidated into.
- Introduced by commit `4a3e96d` ("move `#assignment-state-workspace` to
  `#assignment-panel-work`"): `git show 4a3e96d` shows the per-node condition on this line
  changed from `pageMode !== "handoff" || !canSeeExtendedManage` to
  `pageMode !== "work" || !hasAssignment` as part of retargeting the element to its new
  container — this edit did not account for `applySectionState`'s pre-existing, still-live
  `stateMode:"hidden"` override for work mode, which used to agree with the old condition
  (both said "hidden whenever not handoff") and now disagrees with the new one.

### Open question — `#assignment-review-workspace` / `reviewSummaryCard` / `reviewSubmissionCard`

`syncAssignmentPageMode`'s toggle for `reviewWorkspace` (`app.js:4495-4496`) has no
assignment-state awareness (`pageMode === "review" && canSeeExtendedReview` is sufficient to
unhide it) and, via the same last-call-wins ordering as Issue 2, overrides whatever
`applySectionState`'s `effectiveLayout.reviewMode` decided (`getAssignmentWorkspaceLayout`,
`app.js:~3800-3860`, returns `reviewMode:"hidden"` for at least the `"assigned"` state,
`app.js:3852`). Whether this is reachable as a live conflict (i.e., whether an unsubmitted
assignment can appear in the review-mode list at all) depends on server-side behavior of
`scope=review&include_tracking=1` (`app.js:6335-6339`, gated by `isOwnerReviewTrackingEnabled`,
`app.js:413-415`) — outside the `app.js`/`index.html` file boundary of this pass, so not
confirmed either way. This specific per-node condition (`4495-4496`) is unchanged since before
the DOM-split migration (checked against the `af413aa` snapshot), so if it is a live bug it
predates Step 1-4, not caused by them.

---

## 5. Leftovers (dead code / dead ids / never-shown elements / silent-null `qs()`)

- **Dead lookups, ids don't exist in `index.html`:** `app.js:4417` (`assignment-deliverable-editor`),
  `app.js:4418` (`assignment-deliverables-actions`), `app.js:4426`
  (`btn-assignment-load-submissions`), `app.js:4427` (`btn-assignment-load-history`) — all 4
  `qs()` calls always return `null`; the 6 `if (...)` blocks that depend on them
  (`4510-4511`, `4513-4514`, `4537-4538`, `4540-4541`) never execute their bodies.
- **Dead local variable:** `app.js:4429` — `hasContextItem` is computed
  (`pageMode === "handoff" && Boolean(getAssignmentContextItem())`) but never referenced
  anywhere else in `syncAssignmentPageMode`'s body.
- **Element live in markup but functionally always-off:** `#assignment-assignee-wrap`
  (`index.html:500`) — `app.js:3559-3561`'s condition ORs across all 3 `pageMode` values,
  making it unconditionally `true`; the element is hidden regardless of role or mode. Matches
  `audit/dom-split-plan.md`'s prior "dead" classification for this id (§A.1 table), still true
  at current HEAD.
- **Elements never shown in any pageMode, any role:** `#tab-handoff`, `#tab-work`, `#tab-review`
  (`index.html:55-57`) — ship with `class="tab hidden"` in markup; `app.js:3584-3591`
  unconditionally re-adds `hidden` on every `setAssignmentRoleVisibility` call; grepped every
  other reference to these 3 ids (`app.js:603, 2442, 3540-3543, 10582-10592, 10632`) and none
  calls `.classList.remove("hidden")` on the button nodes — `10582-10592`/`10632` only use the
  id string as a routing key into `applyLandingState`, never touching the DOM node.
- **Stale test assertion (not itself a visibility bug, but tracks one):**
  `collector/tests/assignment-ui-scope.test.mjs:3265` — literal-string assertion no longer
  matches current `app.js:4483` (see Issue 1 above).
- **Silent-null `qs()` with unguarded property access (not crash-prone today, but no
  existence guard):** `app.js:9262` and `app.js:9312` —
  `qs("assignment-selected-summary").textContent = ...` with no `?.`/`if` guard. The target id
  exists unconditionally in `index.html:444` (single instance inside the handoff container, not
  duplicated per-mode), so this doesn't currently throw, but both call sites write into it
  regardless of active pageMode (i.e., they write into a node that's inside
  `#assignment-panel-handoff` even when `pageMode` is `"work"`/`"review"` and that container is
  hidden by the ancestor toggle) — consistent with `assignment-selected-summary` being
  handoff-only per `audit/dom-split-plan.md` §A.2, just via an unguarded lookup rather than a
  guarded one like the majority of the file's other `qs()` call sites.
- **Silent-null-then-return pattern (guarded, not a bug, cited for completeness since item 5
  asked for these):** `app.js:4622` (`applySectionState`: `if (!node) return;`), `app.js:3764`
  (`setAssignmentProcessGuide`: `if (!nextActionNode || !stepsRoot) return;`) — both silent, no
  `console.warn`, unlike `renderAssignmentsTable`'s equivalent guard at `app.js:9067`
  (`if (!table) { console.warn(...); return; }`), which does log.
- **CSS:** no dead `#assignment-list-panel`/`#assignment-detail-panel` (bare, unsuffixed)
  selectors remain in `styles.css` — grepped fully, all matches are the current split ids
  (`-handoff`/`-work`/`-review`, `#assignment-detail-panel-handoff`). The 5 CSS comma-syntax
  fixes and dead `#table-assignments` (bare id) removal described in commit `803160a`'s message
  are confirmed present at the cited line ranges. The sibling-combinator rule
  (`.assignment-workspace-section + .assignment-workspace-section`,
  `styles.css:7674, 8361, 8414, 8950`) is confirmed still load-bearing: `#assignment-review-workspace`
  (`index.html:691`) and `#assignment-return-to-field` (`index.html:735`) remain consecutive
  DOM siblings inside the review container, matching `audit/dom-split-plan.md` §C's finding.

---

## 6. Function survey — what each of the 8 named functions actually does now

| function | path:line | current real work |
|---|---|---|
| `syncAssignmentPageMode` | `app.js:4397-4549` | Resolves per-mode title/note nodes (`4404-4405`) and writes their text (`4440-4457`); writes `pageSummary` HTML per mode (`4458-4468`); does the container-level toggle (`4479-4481`, the one part of this function that's fully live and non-redundant); runs the ~20 per-node `hidden` toggles cataloged in §1.2 (redundant-to-buggy per §2/§4); calls `applyFreelanceWorkerView`, `syncAssignmentSubnav`, all 3 table-render functions, and `applyAssignmentModernClasses` as trailing side effects (`4543-4548`) — these calls are not visibility logic and are not candidates for Step 5 removal themselves, only the per-node toggles above them are. |
| `syncAssignmentWorkflowLayout` | `app.js:4590-4683` | Computes `effectiveLayout` (work-mode consolidation override, `4596-4611`) — still real, still needed; builds workspace summaries (`4612`); resolves the 3 workspace-section nodes and calls `applySectionState` on each (`4613-4642`, §1.3) — still real, still needed, and is the losing side of Issue 2; writes section title/help text (`4644-4656`); writes the next-step card HTML (`4658-4681`); ends with the tail call to `syncAssignmentPageMode` (`4682`) whose ordering is the undocumented contract in §3. |
| `applySectionState` | `app.js:4621-4638` (local closure inside `syncAssignmentWorkflowLayout`, not top-level — confirms `audit/dom-split-plan.md` §C's correction of the other plan's citation) | Is-active/is-secondary/is-collapsed classing (`4624-4626`) and summary-node text+hidden (`4627-4630`) is real, container-agnostic, non-redundant work. Its own `hidden` add/remove (`4631-4637`) is the losing side of Issue 2 for `stateSection`, is currently not provably in conflict for `submissionSection` (effectiveLayout always forces `"active"` in work mode when this path runs), and is the open-question side for `reviewSection`. |
| `setAssignmentDetailVisible` | `app.js:3757-3759` | Single-line wrapper, only ever does one thing: toggle `#assignment-detail-panel-handoff`'s hidden class. Per Issue 1, its effect is overwritten at 3 of 8 call sites by a later `syncAssignmentPageMode` call in the same synchronous chain; the other 5 call sites pass `false` and are unaffected either way. |
| `applyAssignmentModernClasses` | `app.js:4551-4588` | No visibility logic at all — every operation is `classList.add(...)` of styling classes (`as-scope`, `as-list-panel`, `as-card-raised`, etc., `4552-4587`) or a guarded early return (`4553`, `if (!panel) return`). Already fully adapted to the split ids (`assignment-list-panel-handoff/-work/-review`, `assignment-detail-panel-handoff`, `4559-4562`) — not part of the Step 5 hidden-toggle cleanup, cited here only because the task named it. |
| `setAssignmentRoleVisibility` | `app.js:3532-3604` | Real, necessary role-gating for the subnav mode buttons (`3593-3600`), `limitWrap`/`reviewTrackingWrap`/`createPanel` (`3562-3570`), plus unconditional/dead pieces cataloged in §1.5/§2/§5 (`assigneeWrap` always-hidden, `handoffTab`/`workTab`/`reviewTab` always-hidden-and-never-unhidden). Ends by calling `updateAssignmentActionControls` and `syncAssignmentPageMode` (`3602-3603`) — the latter is why every role-visibility pass also re-triggers Issue 1/Issue 2. |
| `applyFreelanceWorkerView` | `app.js:447-482` | Text-relabeling for the freelance role (`466-481`) plus 3 unconditional force-hides unrelated to pageMode (`468-470`, §1.6) — no pageMode branching of its own; already resolves per-mode title/note nodes correctly via the `-work`/`-review`/`-handoff` suffix ternary (`449-450`), consistent with the split. |
| `renderAssignmentsTable` | `app.js:9064-9239` | Two genuinely separate bodies behind `if (pageMode === "handoff") { ... return; }` (`9078-9165`) vs. the shared work/review path (`9167-9239`), exactly as `audit/dom-split-plan.md` §C described — already writes to the correct per-mode table id via the `table-assignments-handoff/-work/-review` ternary (`9066`) and per-mode list-title/list-note ids (`9068-9069`). The `actionableTitle`/`actionableNote`/`submittedWrap`/`loadBtn` toggles (§1.7) are real per-mode-visible/hidden decisions this function alone makes — no other function touches those 4 nodes. |

---

## Summary

- **Visibility control points inventoried:** 22 per-node toggle statements in
  `syncAssignmentPageMode` (§1.2) + 3 `applySectionState` call sites (§1.3) + 8
  `setAssignmentDetailVisible` call sites (§1.4) + 10 in `setAssignmentRoleVisibility` (§1.5) +
  3 in `applyFreelanceWorkerView` (§1.6) + 8 in `renderAssignmentsTable` (§1.7) = **54 old-layer
  control points**, plus the 3 new container-level toggles (§1.1).
- **Classification:** ก (pure pageMode, redundant) = 6; ข (necessary, unrelated to pageMode) =
  14; ค (mixed, pageMode part dead but a clause must survive) = 16; dead/not-applicable
  (ids don't exist, or unconditional-and-never-reversed) = 9 control points across 7 distinct
  elements/ids.
- **Elements confirmed double- or triple-controlled with a real conflict, not just redundancy:**
  2 confirmed (`#assignment-detail-panel-handoff` — Issue 1; `#assignment-state-workspace` —
  Issue 2), 1 open/unconfirmed (`#assignment-review-workspace` + its 2 child cards).
- **Of ค้าง (leftovers):** 4 dead `qs()` id lookups (6 dependent `if` blocks that never run),
  1 dead local variable, 1 element live-in-markup-but-always-hidden
  (`#assignment-assignee-wrap`), 3 elements never shown in any mode/role
  (`#tab-handoff`/`#tab-work`/`#tab-review`), 1 stale test assertion, 2 unguarded `qs()` writes
  (not crashing today, but ungated), CSS confirmed already clean (comma/dead-selector fixes
  from `803160a` verified present).
- **Undocumented contract:** the "last call in the chain wins for `hidden`" ordering between
  `applySectionState` and `syncAssignmentPageMode` is real, currently load-bearing, and stated
  nowhere as an invariant — see §3.

---

## 7. Follow-up — Step 5 close-out status (post `803160a..2cf5c2e`, this session)

Five commits (`f8c7923`, `1692863`, `b8cb8a8`, `babe3a6`, `2cf5c2e`) implemented the bulk of this
inventory's work order and were verified in a follow-up audit pass earlier in this session (Layer 1 +
Layer 2, same pipeline as above). Outcomes:

- All 6 ก-classified toggles (§2) deleted; all 8 ค-classified toggles named in the work order had
  their `pageMode` clause stripped, necessary clause retained; ข-classified code (`listPanel`,
  `createPanel`'s role-only block, `renderAssignmentsTable`'s 8 sites, `applySectionState`'s 3 call
  sites) confirmed untouched, as intended.
- **Issue 1** (`#assignment-detail-panel-handoff` force-hidden in handoff mode) — confirmed closed by
  `f8c7923`: `setAssignmentDetailVisible` (`app.js:3761-3766` at that HEAD) is now sole decider, folding
  in the `!canSeeAssignmentCurrentWorkSurface()` check that used to live in the deleted per-node toggle.
  Traced all 8 call sites; the 3 that used to be clobbered by `syncAssignmentPageMode`'s tail call now
  survive.
- **Issue 2** (`#assignment-state-workspace` reappearing unstyled in work mode) — confirmed closed by
  `f8c7923`: the per-node toggle was deleted outright, leaving `applySectionState` as sole decider. This
  is also now written into `collector/PROJECT_POLICY.md`'s "one element, one decider" rule (added this
  session) so the fix's rationale doesn't only live in a commit message.
- **`#assignment-review-workspace` open question — still NOT fixed, by design this round.** Confirmed
  in the follow-up audit that the same last-write-wins mechanism as Issue 2 is still live and unchanged:
  `syncAssignmentPageMode`'s per-node toggle (`!canSeeExtendedReview || pageMode !== "review"`) still
  runs after `applySectionState`'s `reviewMode`-driven `hidden` write on the same
  `#assignment-review-workspace` node, in the same tail-call order as before (`syncAssignmentWorkflowLayout`
  → `syncAssignmentPageMode`). Neither writer nor the call order changed across the 5 commits — grepped
  and confirmed. This was deliberately left alone this round per Sor's instruction: fixing it requires
  first confirming, server-side, whether `GET /api/assignments/mine?scope=review&include_tracking=1`
  can actually return an assignment that hasn't reached the submitted state while `pageMode === "review"`
  — if it can, `applySectionState`'s `reviewMode: "hidden"` decision for that state is being silently
  overridden today. That's a backend-behavior question outside `app.js`/`index.html`'s file boundary, so
  it stays open. No code changed for this item in the `f8c7923..2cf5c2e` round.
