# DOM-Split Backward-Transition Regression Check — `#workflow-backward-controls`

Audit only. No code modified. Pipeline: `audit-scanner` (L1) → `audit-deep-reasoner` (L2), L1 not
skipped.

Scope: diff `324accb..bce986a` (the pageMode DOM split — `git log` shows 15 commits in this range,
not the 12 named in the request; noted, doesn't change scope), limited to points touching
`#workflow-backward-controls` and `#assignment-panel-handoff`. Target feature: step-1 handoff page
— sending a field-pack item backward to field-pack review ("ส่งงานกลับไปขั้นตรวจ field pack").

---

## 1. Container placement

`#workflow-backward-controls` (`collector/server/public/index.html:344`) is a direct child of
`#panel-assignments` (opened `:333`), a **sibling** to the three pageMode containers
`#assignment-panel-handoff` (`:345`), `-work` (`:490`), `-review` (`:667`) — not nested inside any
of them. A whole-file grep for `workflow-backward-controls` returns exactly one hit; a grep for
`assignment-panel-` returns only the three expected containers plus their child ids — no
duplicate/leftover node survived the 15-commit split.

This is the correct, intentional shape per `collector/PROJECT_POLICY.md:42-57` (Rule 2): the
widget must NOT live inside a per-mode container since a per-mode container-hidden toggle would
silently hide it in the wrong modes — top-level/sibling is what lets it show regardless of which
of the three panels is active.

## 2. Mount/render selector integrity

`app.js` references the id exactly once: `qs("workflow-backward-controls")`
(`app.js:3624`, inside `renderAssignmentBackwardTransitionControls()`). One DOM node (§1) + one
selector = no stale/duplicate-id race introduced by the split.

## 3. Per-node pageMode toggles

`syncAssignmentPageMode` (`app.js:4384-4491`, read in full) has zero references to
`workflow-backward-controls` — only the three container toggles at `app.js:4455-4457`. Also
checked `syncAssignmentWorkflowLayout` and `applyFreelanceWorkerView`: neither touches the widget.

History confirmed via `git log -p 324accb..bce986a`: the old force-hide
(`if (backwardControls && pageMode !== "handoff") { backwardControls.classList.add("hidden"); }`)
was deleted by `1692863` (commit message names it explicitly: "renderWorkflowBackwardTransitionControls
is sole owner"). No later commit in the range (`f8c7923`, `b8cb8a8`, `babe3a6`, `2cf5c2e`,
`5484df5`, `bce986a`) reintroduces it — `5484df5` documents the invariant directly in its message.
`#panel-assignments` itself (`app.js:4494`) is only ever given a CSS scope class, never
pageMode-hidden — so no ancestor-level leak either. **No Rule 1 violation found on this widget.**

## 4. Click → PATCH guard chain

`workflow-backward-transitions.js:46-73`: click → requires non-empty `reason` (legitimate,
`:51`) → requires `onTransition` to be a function (`:58`, always true) → invokes callback. In
`app.js:3625-3643`'s `onTransition`, the only gate before the POST is
`itemId = Number(state.assignments.contextItemId || getAssignmentLandingItemId() || 0) || 0`
(`:3626`) — **no pageMode check anywhere in the chain.**

Ordering was traced for both paths that populate `contextItemId` ahead of the render/POST chain:
- Manual click (`selectAssignmentContextItem`, `app.js:3608-3618`): sets `contextItemId` (`:3611`)
  before `loadAssignmentContextFieldPackStatus` (`:3618`) → `refreshAssignmentBackwardTransitions`
  → render. Correct order.
- Handoff-page auto-load from `?item_id=` (`app.js:9613-9617`, reached via `getAssignmentLandingItemId`,
  `:999-1004`): sets `contextItemId` (`:9616`) before the field-pack/backward-transitions reload
  (`:9617`) — fires automatically on page mount, same correct order. With no landing item,
  `contextItemId` is explicitly zeroed (`:10389`) and the widget correctly stays hidden — expected
  empty state, not a bug.
- Work/review path `selectAssignment` also sets `contextItemId` (`app.js:9224-9226`) before its
  own field-pack reload (`:9273`).

No path was found where the handoff page renders the widget with a stale/zero `itemId`, and no
path was found where the render chain fails to fire in handoff mode.

*(Adjacent, out of scope: switching pageMode tabs without a `landingItemId` in the URL takes the
plain `refreshAssignments()` branch, `app.js:10470-10474`, which doesn't reset `contextItemId` —
theoretically stale until next selection. This predates the DOM split and doesn't affect the
handoff page, which always goes through `loadAssignmentsByItem` when a landing item exists.)*

---

## Summary

| # | Question | Answer |
|---|---|---|
| 1 | Container after split | Sibling to all three `#assignment-panel-*`, not nested — correct per policy |
| 2 | Selector/duplicate nodes | One id, one selector, no duplicates |
| 3 | Surviving per-node pageMode toggle | None found — the `12b02f7` force-hide was removed by `1692863` and never reintroduced through `bce986a` |
| 4 | Reintroduced client gate on click→PATCH | None — only a legitimate empty-`reason` guard |

**Regression: not confirmed.** The feature is intact post-split.
