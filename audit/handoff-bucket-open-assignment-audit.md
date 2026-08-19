# Audit: handoff-bucket-open-assignment (main..dff04e4)

Audit only. No code modified. Pipeline: `audit-scanner` (L1) → `audit-deep-reasoner` (L2), L1 not
skipped.

Scope: commit dff04e4 "fix(collector): use hasOpenAssignment for handoff bucket gate" on branch
`fix/handoff-bucket-open-assignment`, diffed against `main`. Files touched: `collector/server/index.mjs`,
`collector/server/public/app.js`, `collector/services/publishable-assignment-candidate.mjs`,
`collector/tests/queue-bucket-follows-state.test.mjs`.

---

## 1. Scope check — is `has_open_assignment` from the server actually necessary?

Yes. `resolveItemScopeContext` (`collector/server/index.mjs:3990`) computes `hasOpenAssignment` by
calling the new `hasOpenAssignment(primaryAssignment)` (`collector/services/publishable-assignment-candidate.mjs:67-70`)
against `primaryAssignment`, a DB-derived object the client never receives directly. No existing
payload field could substitute — `has_accepted_assignment` (pre-existing) only distinguishes
accepted/closed, which is exactly the bug being fixed (see Q3). `attachItemMatchFields`
(`index.mjs:1344`) itself does not recompute the value — it just passes through `item?.has_open_assignment`
already set upstream by `attachItemScopeMetadata`/`resolveItemScopeContext` — so there's one source
of truth, not duplicated logic. Touching `index.mjs` was required, not scope creep, though it does
mean this patch isn't purely "UI-only" per CLAUDE.md's allowlist (it threads a new server-computed
field, not just a client-side gate change) — worth noting, not a defect.

## 2. index.mjs 4 locations — which endpoints, and is any endpoint that feeds resolveQueueBucket missed?

- `index.mjs:39` — import only, no endpoint.
- `index.mjs:1344` (`attachItemMatchFields`) and `index.mjs:4012` (`attachItemScopeMetadata`) — both
  used by `GET /api/items` (list endpoint, confirmed by L1 scan call chain: `index.mjs:7969` →
  `attachItemScopeMetadata`/`resolveItemScopeContext` → `attachItemMatchFields`), which is the sole
  source that populates `state.items` client-side (`app.js:10344`) — the data all 8
  `resolveQueueBucket` call sites read from.
- `index.mjs:1403` (`attachWorkflowHeadFields`) — used by single-item endpoints: `GET /api/items/:id`
  (8189), `PUT /api/items/:id` (8726), `POST /api/items/:id/place-ready-for-content` (8778).
- `index.mjs:4012` (`attachItemScopeMetadata`) also covers `claim`/`release`/`takeover`
  (8581/8629/8672).

**Gap found (not a missing patch, pre-existing and out of this commit's stated scope):**
`POST /api/items/:id/workflow/backward-transitions` (`index.mjs:9143-9250`) returns
`nextItem = repo.getItem(id)` (line 9237) — a raw row never passed through either patched function,
so its response never carries `has_open_assignment` (also true for `has_accepted_assignment` before
this diff — not newly introduced). Client-side, `app.js:3634-3646` merges this response into
`state.items` via `{...row, ...nextItem}`; a missing key on `nextItem` leaves the row's stale
pre-transition value in place. **L2 confirmed this is real but not currently reachable**: both
backward targets relevant to the assignment flow (`field_working→ready_for_content`,
`field_review→field_working`, `collector/db/repository.mjs:545-551`) always change `surface`, so
`placeBackwardTransitionResumePath` (`index.mjs:4129-4139`) always differs from the current path,
forcing `window.location.assign` (`app.js:3639-3641`) — a full reload that refetches `state.items`
fresh. Severity: low/dormant, would only surface if a future backward target ever mapped to its
origin surface. `/api/items/:id/editor-work` (8827) has the same gap but is unrelated — it's not
called anywhere in `app.js` (only used by the separate article-composer pages), so it never feeds
`resolveQueueBucket`.

## 3. Is `hasOpenAssignment` including "accepted" correct per the state mapping?

Yes — **confirmed correct** by both the prior audit doc (`origin/audit/process2-backward-map.md`,
not present on this branch/main) and L2 re-verification. That doc's step mapping: step 2 (ลงงาน) =
`field_working` + assignment ∈ {assigned, in_progress}; step 3 (ตรวจงาน) = `field_review` +
assignment ∈ {submitted, resubmitted, accepted}. `resolveQueueBucket` (`app.js:749-802`) has no
distinct "review" bucket — only `{unknown_workflow, published, assignment, handoff,
field_pack_review, raw_prep}`. The `hasOpenAssignment` check (`app.js:767-769`) runs before the
handoff allow-list (`app.js:781-796`), so both step-2 and step-3 items land in `assignment`, never
`handoff` — matching the doc's diagnosis that the *old* bug was step-2 (assigned/in_progress) items
leaking into handoff, while accepted items were already correctly excluded. The new set
intentionally omits `closed`, which is correct: a closed assignment means "no longer open," and
`app.js` test `queue-bucket-follows-state.test.mjs:169-183` confirms a closed-assignment item with
`field_working` state resolves to `handoff`, matching step-1's "assignment-less" definition in the
backward-map doc §4.

## 4. Is `isSelectedAssignmentAccepted` untouched, and is `article-intake.js` unaffected?

Confirmed both. `diff <(git show main:collector/services/publishable-assignment-candidate.mjs) <(git show dff04e4:...)`
shows only a pure addition after line 62 — `isSelectedAssignmentAccepted` (lines 60-62) is
byte-identical. `git diff main..dff04e4 --name-only` does not list `article-intake.js` at all.
`article-intake.js:457,463,471,511` all read `item?.has_accepted_assignment === true` directly (not
via the helper), and `has_accepted_assignment`'s computation is unchanged by this diff — this
commit only adds a sibling `has_open_assignment` field alongside it. Existing callers of the old
helper/field are unaffected.

## 5. All 8 `resolveQueueBucket` call sites — which change behavior?

`app.js:805` (`isRawPreparationItem`), `813` (badge status label), `963` (`isHandoffEligibleItem`),
`5073` (`getPreparationQueueItems`), `5112` (`getDashboardPrimaryEntryAction`), `5142`
(`splitRawQueueByFieldPack`), `5158`/`5168` (badge label/class). All 8 read from `state.items`, which
after any full `/api/items` load carries a real `has_open_assignment` boolean (per Q2). Behavior
changes for any item that has an *open-but-not-accepted* assignment (`assigned`/`in_progress`/
`submitted`/`resubmitted`/`revision_requested`) with `production_state=field_working` (or other
handoff-allow-listed states) and a ready field pack: these now resolve to `assignment` instead of
`handoff` at every one of the 8 sites — that's the fix's intended effect, not a side effect. One
site is behaviorally inert to the change: `getDashboardPrimaryEntryAction` (`app.js:5119`) treats
`bucket === "assignment"` and `bucket === "handoff"` identically (same CTA/URL), so items shifting
between those two buckets produce no visible difference there. `isRawPreparationItem` (805),
`splitRawQueueByFieldPack` (5142) only check for `raw_prep`/`field_pack_review`/`unknown_workflow` —
unaffected since `assignment`/`handoff` were already excluded from those checks before this diff.

---

## Verdict

**PASS.** The core fix (Q3) is correct and matches the prior diagnostic audit's prescribed
direction. Scope (Q1) was necessary, not creep. No untouched helper/caller was broken (Q4). One real
but dormant gap exists (Q2/Q5, Candidate B): `POST /api/items/:id/workflow/backward-transitions`
doesn't attach `has_open_assignment` to its response, leaving a theoretically stale client-side
value — currently unreachable because every backward transition triggers a full-page reload, but
worth a follow-up note if a future backward target ever avoids changing surface.
