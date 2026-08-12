# Runtime backward-widget check: handoff tab (P2 stage 1)

**Date:** 2026-08-12
**Machine:** Runtime (`D:\UbonRuntime\repos\UbonCity_Web`)
**Mode:** read-only investigation (no code edits, no DB writes, no restart)
**Question:** a dev-environment audit claimed the "backward to generated" button on the handoff
tab (P2 stage 1) works, citing `app.js:9673` / `3623` / `3671`. Real users on
`collector-test.uboncity.com/?tab=handoff` report the backward button doesn't work. Why?

## 1. Runtime HEAD

```
git log -1 --oneline → 8de6298 wire actorEmail to executeBackendAiJson for ai_usage_log tracking
git status            → clean, branch feat/wire-actor-email, up to date with origin
git branch            → feat/wire-actor-email
```

Does **not** match `962da87` — Runtime is 1 commit behind. The gap is exactly one commit
(`962da87`, a `PROJECT_STATE.md` docs update on `main`); `8de6298` is an ancestor of `962da87`
(`git merge-base --is-ancestor` confirms it) and touches no files relevant to this bug
(only `collector/server/index.mjs`, `transport-v2-router.mjs`, `agent-generation.mjs`,
`backend-ai-client.mjs`, `workflow.mjs`, `translation/service.mjs` — actor-email plumbing).
**Not the cause.**

## 2. Does the served code have the backward widget?

Yes. `collector/server/public/workflow-backward-transitions.js:20-28` gates rendering:
`!canTransition || targets.length === 0` → nothing rendered. DOM construction (textarea +
per-target buttons) is at `workflow-backward-transitions.js:29-40`.

Call chain into `app.js`:
- `app.js:3638-3659` `renderAssignmentBackwardTransitionControls()` — calls the renderer above.
- `app.js:3661-3668` `refreshAssignmentBackwardTransitions(itemId)` — fetches
  `GET /api/items/:id/workflow/backward-transitions` and swallows errors to `null`.
- `app.js:3696` — `loadAssignmentContextFieldPackStatus()` invokes the refresh above.

**The prior dev-audit's three line citations do not point at DOM construction:**
- `app.js:9673` → `setAssignmentDetailVisible(getAssignmentPageMode() === "handoff")`, just
  toggles panel visibility.
- `app.js:3623` → `async function selectAssignmentContextItem(itemId, ...)`, loads context.
- `app.js:3671` → `async function loadAssignmentContextFieldPackStatus(itemId)`, loads field-pack
  status and triggers the refresh above.

None of these build the button. That citation error is not itself the bug, but it means the
dev-audit never actually looked at the widget's real gating logic.

## 3. Items currently at P2 stage 1 (handoff, not yet accepted)

Query: `content_assignments` joined to `content_items` and `content_workflow_models`,
filtered to `assignment_kind = 'field'` (read-only, `collector/data/collector.db` via
`node:sqlite` `DatabaseSync(..., { readOnly: true })`).

Only **one** item is currently sitting at handoff, unaccepted:

| field | value |
|---|---|
| item_id | 14 |
| title | โรงแรมเซ็นทารา อุบล |
| type | place |
| category | hotels |
| production_state | **analyzed** |
| publication_state | draft |
| place_review_flag | none |
| current_field_pack_id | 11 (field_pack status=`ready_for_field`, is_current=1, writer_ready=0) |
| assignment id | 5 |
| assignment_kind | field |
| assignment state | **assigned** (not yet accepted; `accepted_at` = null) |

(A second field assignment, id=2 / item 9, is already `accepted` — not at handoff stage 1, out
of scope.)

`content_workflow_transitions` history for item 14: the last `production` transition is
`collected → analyzed` on 2026-08-10 21:05:44. The field assignment was created the next day
(2026-08-11 22:20:49) with **no production-state transition since** — production_state has been
frozen at `analyzed` for the item's entire time in the handoff queue.

## 4. Live GET /api/items/14/workflow/backward-transitions

**Blocked — not completed.** The cached test JWT
(`collector/data/tmp-collector-test-token.json`) expired 2026-08-09; an unauthenticated GET
returned `401`. Minting a fresh token locally (same mechanism `collector/scripts/lib/test-auth.mjs`
uses in `backend_jwt` mode — sign with the existing `BACKEND_JWT_SECRET`, no network call, no DB
write) was blocked by the environment's own permission classifier as a credential-sensitive
action. Per the STOP RULE, no third approach (e.g. manual HMAC signing) was attempted.

This step needs Sor to supply a fresh valid token, or to explicitly approve token minting, for a
follow-up pass. **The static code trace below (steps 3+5) already fully explains the expected API
response without it: `targets: []`, `can_transition: false` (or `true` with empty targets,
depending on role) for item 14 — see below.**

## 5. Why the widget doesn't render, and which condition item 14 hits

Full gating chain, each link read directly and confirmed by an independent
`audit-deep-reasoner` pass:

1. **Frontend:** `workflow-backward-transitions.js:20-28` — hidden unless
   `canTransition && targets.length > 0`.
2. **Backend GET handler:** `collector/server/index.mjs:9099-9114` →
   `buildPlaceBackwardTransitionsPayload()` (`index.mjs:4136-4152`):
   `canTransition = contentType === "place" && canTransitionPlaceBackwardByRole(...)`;
   `targets = repo.listLegalBackwardProductionTransitions(...)`.
3. **`listLegalBackwardProductionTransitions()`** (`collector/db/repository.mjs:4769-4786`):
   returns `[]` if `type !== "place"`, else looks up
   `PLACE_BACKWARD_PRODUCTION_TRANSITIONS[production_state]`.
4. **`PLACE_BACKWARD_PRODUCTION_TRANSITIONS`** (`repository.mjs:541-571`) only has keys for:
   `generated`, `field_working`, `field_review`, `ready_for_content`, `writing_assigned`,
   `writing`, `in_review`, `ready_for_publish`, `submitted_for_admin_review`. **No key for
   `analyzed` or `collected`.** The *only* edge tagged `surface: "handoff"` (the metadata this
   button's surface is meant for) is `field_working → ready_for_content` (line 545-547).

Item 14's `production_state` is `analyzed` — not a key in the map — so `targets = []`
regardless of role. Type is `place` (confirmed), so that precondition passes; it's irrelevant
because the map lookup already fails first.

**Why production_state never reaches `field_working` — the actual root cause:**

- The live route that creates field assignments, `POST /api/items/:id/assignments` with
  `assignment_kind: "field"` (`index.mjs:10565-10579`), calls
  `repo.createAssignmentFromReadiness()` (`repository.mjs:9042-9125`) with
  `requireReadyForHandoff: false`. That function creates the assignment row and a handoff
  snapshot but **never calls `upsertWorkflowModel()`** — it does not touch
  `content_workflow_models.production_state` at all. Its only precondition is
  `field_pack.status === "ready_for_field"` (`validateAssignmentCreateFieldPackPrerequisites()`,
  `index.mjs:2950-2969`) — nothing about the production ladder.
- Contrast with the **editorial** assignment branch in the same file
  (`index.mjs:10357-10368`): it explicitly calls `resolvePlaceLadderWorkflowPatch(...)` to bump
  `production_state` to `writing_assigned` **before** creating the assignment. Field assignments
  have no equivalent step.
- Grepping the whole `collector/services`, `collector/db`, `collector/server` tree for every
  place `production_state` is ever set to `field_working` (forward direction) turns up exactly
  one hit: `collector/services/workflow.mjs:2803-2818` `resolvePlaceRevisionTarget()`, which maps
  `field_review → field_working` **only as a rework/revision target** — i.e. `field_working` is
  only ever entered by sending an *already-submitted* item back for rework, never by the initial
  act of creating/handing off a field assignment.
- There is one more relevant mechanism: `updateAssignmentState()`
  (`repository.mjs:5608-5645`) can sync `production_state → field_working` as a side effect when
  the assignment itself transitions `assigned → in_progress` (i.e. on acceptance) — but only if
  `canTransition("place", "production", <current>, "field_working", ...)` passes, which per the
  ladder (`buildPlaceTransitionRules()`, `repository.mjs:510-536`) requires the item to already
  be at `ready_for_content`. If not, the sync is **silently skipped** with only a
  `console.error("[workflow-transition] skipped production sync", ...)` (line 5624-5632) — no
  user-facing error.
- `ready_for_content` itself is reachable through exactly one route:
  `POST /api/items/:id/place-ready-for-content` (`index.mjs:8764-8809`), a separate manual
  admin/owner action hard-gated on `production_state === "generated"` exactly. Nothing in the
  field-assignment path calls it.

**Net effect:** an item can get a field assignment created — and appear in the handoff queue —
purely because its field pack reached `ready_for_field`, with zero requirement that
`production_state` ever advanced through `generated → ready_for_content`. For any such item
(item 14 is the live example), the backward button is not "not yet visible" — it is **permanently
unreachable**, even after the field worker eventually accepts and starts the assignment, because
the one sync path that could fix it silently no-ops when the ladder precondition isn't met.

This also resolves the apparent contradiction with the dev-audit: the widget code and its
dev-environment demo both genuinely work when tested against an item whose `production_state`
was manually seeded to `field_working`. The bug is not in the widget or the API handler — it's
that the real field-assignment-creation flow never produces an item in that state.

**Adjacent context (not a governing decision, flagged for awareness):**
`collector/docs/assignment-scope-v2.md` is a documented forward-looking, spec-only plan to
decouple assignment (step 5) from step-4 readiness gates, and explicitly states step 5 "does not
implement a backward transition to step 4" as a *future* guardrail — in tension with the
`field_working → ready_for_content` edge this very widget exposes. That doc is spec-only per its
own text ("no runtime behavior changes in this round") and does not document today's missing
production-state sync as intentional; it's worth a conversation with whoever owns that direction,
but it isn't cover for the current gap.

## 6. Preflight

- `collector/.env:18` → `COLLECTOR_FIELD_PACK_LEAN=1` — confirmed present and set.
- MySQL `uboncity` schema → `SHOW TABLES LIKE 'ai_usage_log'` — table **exists**, confirmed via
  a read-only query through the existing `backend/config/db.js` pool.

## Summary

Not a rendering bug and not what the prior dev-audit's citations claimed. The handoff-tab
backward widget is wired correctly end-to-end (frontend gating, GET handler, transitions table).
The real defect is a **state-machine gap**: `createAssignmentFromReadiness()`
(`collector/db/repository.mjs:9042`, used by the live `POST /api/items/:id/assignments` route for
`assignment_kind=field`) never advances `content_workflow_models.production_state`, so real
field-handoff items can get stuck at `analyzed`/`generated` indefinitely — before, during, and
after the assignment is accepted — while the only backward edge usable from the handoff tab
requires `production_state = field_working`, a state nothing in the field-assignment lifecycle
reliably produces. Item 14 (currently the only item at handoff stage 1 on Runtime) demonstrates
exactly this.

**Not completed:** step 4's live API call (blocked on an expired test token; minting a new one
was blocked by the permission system). The static trace makes the expected response
(`targets: []`) unambiguous, but an actual HTTP round-trip would still be good confirmation if
Sor can supply a token.

**Suggested next step (for a separate implement pass, not done here):** decide whether field
assignment creation should advance `production_state` to `ready_for_content`/`field_working` at
creation time (mirroring the editorial-assignment branch), or whether `place-ready-for-content`
should become a hard precondition of field-assignment creation instead of an optional manual
step — either closes the gap; this audit does not recommend which.
