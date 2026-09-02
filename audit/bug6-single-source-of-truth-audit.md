# BUG 6 — Single Source of Truth Audit (item 39 state divergence)

Mode: discovery, read-only, Runtime machine (`D:\UbonRuntime\repos\UbonCity_Web`).
Pipeline: audit-scanner (Layer 1) → audit-deep-reasoner (Layer 2), all Layer-2 file:line
citations spot-verified directly against source (see "Spot-verification" below).

Case: item 39, `production_state = ready_for_writer`, field pack 38,
editorial assignments #31 and #32 both `closed`, no open editorial assignment.
Four surfaces disagree simultaneously:
- article-intake.html Status and Access → "กำลังเขียนบทความ" (currently writing)
- My Writing Queue → bucketed "กำลังเขียน" not "ต้องจัดการตอนนี้"
- handoff queue page → shows `ready_for_field`
- Field Pack Review list → "รอตรวจชุดสั่งงาน" (waiting for field-pack review)

---

## Q1 — Display point → endpoint → column → function

| Display point | Endpoint | Column/field read | Function that computes it |
|---|---|---|---|
| (a) article-intake.html "สถานะปัจจุบัน" | `GET /api/items/:id/article-process` (`collector/server/index.mjs:9289`) | `content_workflow_models.production_state` only | `deriveArticleProcessStatus()` `index.mjs:4444-4476` → `deriveQueuedArticleProcessStatus()` `index.mjs:4478-4480` (no-op passthrough) → `buildArticleProcessPayload()` `index.mjs:4622-4633`. Rendered by `articleStatus()` `article-intake.js:192-210` and `articleStatusLabel()` `article-intake.js:212-222`, output at `article-intake.js:285`. |
| (b) My Writing Queue bucket ("ต้องจัดการตอนนี้" vs "กำลังเขียน") | same article-process endpoint, fed into client-side grouping | `content_assignments.state` (via `has_accepted_assignment`), article-process `status` | `isSelectedAssignmentAccepted()` `collector/services/publishable-assignment-candidate.mjs:59-62` → gates `needsProcessPrefetch()` `article-intake.js:454-465` → `derivedArticleWorkflowStatus()` `article-intake.js:422-452` → `queueGroupKey()` `article-intake.js:508-527`, which also consults `hasAssignedWriter()` `article-intake.js:179-186` via `primaryAssignmentForItem()` `article-intake.js:170-177`. |
| (c) handoff queue (2.1) | `GET /api/items` (`index.mjs:7970`) | `production_state`, `current_field_pack_status`, `has_open_assignment` | `resolveQueueBucket()` `app.js:749-803` (via `isAssignmentContextReady()` `app.js:957-960`). For this exact state combination it correctly returns `"handoff"` (confirmed passing at `collector/tests/ready-for-writer-queue-bucket.behavior.test.mjs:57-69`). The visible "ready_for_field" text is the raw `field_pack_status` leaking through the badge tooltip `title` attribute at `app.js:2054` (`renderHandoffQueueStatusBadge()`, `app.js:2048-2056`), not a bucket-resolution defect — needs live-DOM confirmation, see Open questions. |
| (d) Field Pack Review list | field-pack list endpoint reading `field_packs` table | `field_packs.status` | `getCurrentFieldPackByItem` (`collector/db/repository.mjs:3284-3290`, `WHERE is_current=1 AND archived_at IS NULL`); the value is set once by `updateFieldPack()` `repository.mjs:10130-10132` (called only from `PATCH /api/field-packs/:fieldPackId`, `index.mjs:12781`) and never advanced by any production_state/assignment-lifecycle code path. |
| (e) tab=work (2.2) / tab=review (2.3) | same `/api/items` response as (c), filtered client-side by query param | `production_state` + tab query param | Same `resolveQueueBucket()` path as (c); tab filters partition the bucket result client-side in `app.js` (not separately re-derived). |

---

## Q2 — Columns standing in for "current stage"

| Column | Canonical? | Written by | Notes |
|---|---|---|---|
| `content_workflow_models.production_state` | **Canonical** | assignment lifecycle / editorial transitions | The real source of truth for pipeline stage. |
| `content_workflow_models.publication_state` | Canonical (publish-side) | admin sync/publish flow | Governs `synced_to_admin` / `ready_for_sync` branches, `index.mjs:4449-4451`. |
| `content_workflow_models.place_review_flag` | Canonical modifier | review flow | Drives `rejected`/`revision_requested` overrides, `index.mjs:4452-4454`. |
| `content_assignments.state` | Canonical per-assignment, **inconsistently rolled up** | assignment CRUD | Some consumers exclude `"closed"` from "active" (`selectPrimaryEditorialAssignment()` `index.mjs:4612-4616`); `isSelectedAssignmentAccepted()` (`publishable-assignment-candidate.mjs:59-62`) treats `"closed"` as `"accepted"`. Same underlying column, two contradictory readings. |
| `field_packs.status` | Nominally canonical, **functionally vestigial after creation** | editor, manually, via `PATCH /api/field-packs/:fieldPackId` only | Never auto-advances with `production_state`; only 3 `UPDATE field_packs` statements exist in `repository.mjs` (`3239-3275`, `3314-3318`, `3320-3324`), none reachable from workflow-transition code. |
| article-process `status` (`"drafting"`, etc.) | **Not persisted** — derived twice, independently | server (`deriveArticleProcessStatus`) and client (`derivedArticleWorkflowStatus`) | A duplicated derivation, not a stored column — itself a source of drift since the two derivations can (and do) disagree. |
| `workflow_status` (legacy) | **Vestigial / write-only shim** | none live | `mapWorkflowStatusToModelStates()` (`repository.mjs:4318-4319`, `10138-10139`) accepts it as a legacy input param for backward-compat writes; it is not a persisted `content_items`/`content_workflow_models` column. |
| `transport_routes_v2.workflow_status` | N/A — unrelated table | — | Same column name, different table/domain (`schema.sql:353`); a false-positive grep target, noted so future audits don't chase it. |

---

## Q3 — Why article-intake shows "กำลังเขียนบทความ" for `ready_for_writer` + no open assignment

Root cause: **`article-intake.html` runs on a structurally separate pipeline that never reads
`field_pack_status` or assignment openness at all** — it is not a stale-column bug, it is a
missing-input bug.

`deriveArticleProcessStatus()` (`index.mjs:4444-4476`) buckets `production_state === "ready_for_writer"`
into a 13-state catch-all (lines 4456-4470) that all collapse to `"drafting"` (line 4471).
`deriveQueuedArticleProcessStatus()` (`index.mjs:4478-4480`) — the only other function in the
chain — is a literal no-op (`return baseStatus;`), so nothing downstream of it can correct for
field-pack state or assignment state. `articleStatus()` (`article-intake.js:192-210`) reads this
`"drafting"` value and returns immediately (line 195-196) without falling through to any richer
logic. `articleStatusLabel()` has no `"drafting"`-specific branch, so it renders the default label
`"กำลังเขียนบทความ"` (`article-intake.js:212-222`, label at 221).

This function is called with `workflowModel` (which has `production_state`) but is never passed
field-pack or assignment-openness data — the input simply isn't there to read, correctly or
incorrectly.

---

## Q4 — Why My Writing Queue doesn't show "Assign Editor" and buckets as "กำลังเขียน"

Deciding condition: `queueGroupKey()` `article-intake.js:508-527`, specifically the
"needs reassignment" branch at **line 514**:
`needsProcessPrefetch(item) && !hasAssignedWriter(item)`.

This evaluates false because `hasAssignedWriter()` (`article-intake.js:179-186`) returns `true` —
not because a writer is actively assigned, but because `primaryAssignmentForItem()`
(`article-intake.js:170-177`) falls back to `assignments[0]` from
`listEditorialAssignmentsByItem()` (`index.mjs:4604-4610`, **unfiltered by state**), since
`selectPrimaryEditorialAssignment()` (`index.mjs:4612-4616`) excludes `"closed"` from its active-state
set and returns `null`. The closed assignment's leftover `assignee_user_id` on that fallback row
disguises "no active writer" as "has assigned writer."

Separately, `isSelectedAssignmentAccepted()` (`publishable-assignment-candidate.mjs:59-62`, line 61:
`state === "accepted" || state === "closed"`) treats the closed assignment as accepted, which
triggers `needsProcessPrefetch()` (`article-intake.js:454-465`) to fetch the article-process endpoint,
returning `"drafting"` per Q3 → `derivedArticleWorkflowStatus()` maps `processStatus === "drafting"`
to `"content_in_progress"` (`article-intake.js:430`) → `queueGroupKey()` line 517 routes it to the
`"drafting"` bucket, which My Writing Queue renders as "กำลังเขียน".

Net effect: a **closed** assignment is being read as evidence of an **active** one, in two separate
places (`isSelectedAssignmentAccepted` and the `primaryAssignmentForItem` fallback), for two
different reasons.

---

## Q5 — Structural fix proposal (proposal only — no code changes made)

Confirmed footprint of the decoupling: 4 files —
`collector/server/index.mjs`, `collector/db/repository.mjs`,
`collector/server/public/article-intake.js`, `collector/server/public/app.js` —
across at least 3 independent status-derivation pipelines (article-process, `resolveQueueBucket`,
field-pack-status readers) plus one shared-but-inconsistent input
(`content_assignments.state` rollup semantics).

**Option (ก) — full canonical function**
One function, likely server-side (e.g. `resolveItemStage(item, workflowModel, fieldPack, assignments)`),
called by every display surface — article-process endpoint, `/api/items` bucketing, field-pack list,
handoff badge — replacing `deriveArticleProcessStatus`, `deriveQueuedArticleProcessStatus`,
`derivedArticleWorkflowStatus`, and `resolveQueueBucket`'s stage-computation piece.
- Touches: `index.mjs` (2 functions removed/replaced + endpoint wiring), `article-intake.js`
  (`derivedArticleWorkflowStatus`, `queueGroupKey`, `hasAssignedWriter`/`primaryAssignmentForItem`
  fallback), `app.js` (`resolveQueueBucket` internals kept as a thin caller), `repository.mjs`
  (need a `field_packs.status` sync path if it's to be trusted as live input, or drop it from the
  canonical inputs and derive field-pack readiness structurally).
- **Riskiest point: `isSelectedAssignmentAccepted()` (`publishable-assignment-candidate.mjs:59-62`).**
  It's shared beyond the queue-display bug — also feeds publish-eligibility checks
  (`index.mjs:7134` publishable-source logic). Changing "closed counts as accepted" semantics could
  silently change which closed-but-accepted rounds are treated as valid publish sources elsewhere.
  Any canonical-function work must special-case or isolate this call site rather than change it
  globally.
- Pros: kills the 3-pipeline drift permanently; the two brittle tests
  (`queue-bucket-follows-state.test.mjs`, `ready-for-writer-queue-bucket.behavior.test.mjs`) would
  naturally consolidate into tests of the one function instead of re-deriving `app.js`-only logic
  every time `resolveQueueBucket` changes shape.
- Cons: large, cross-cutting, touches code the freeze rules call out (`app.js`) and would need
  explicit sanction similar to the pageMode DOM-split exception; nontrivial regression surface
  given the shared `isSelectedAssignmentAccepted` risk above.
- Rough size: multi-day, 4 files, needs a dedicated audit-diff pass afterward.

**Option (ข) — narrow fix of currently-wrong spots**
Three independent, smaller patches:
1. Make `selectPrimaryEditorialAssignment()` (`index.mjs:4612-4616`) the single source
   `primaryAssignmentForItem()` falls back to, so a closed assignment can never masquerade as
   "assigned writer" (`article-intake.js:170-186`).
2. Give `deriveArticleProcessStatus`/`deriveQueuedArticleProcessStatus` (`index.mjs:4444-4480`)
   actual field-pack/assignment-openness input instead of a no-op, at least for the
   `ready_for_writer` branch.
3. Either wire `field_packs.status` to advance on relevant `production_state` transitions, or stop
   three separate consumers (`app.js:957-960`, `repository.mjs` handoff preview, `app.js:2054` badge
   title) from treating it as live truth independently.
- Pros: small, reviewable, one-concern-per-patch (matches this repo's patch discipline), doesn't
  touch the shared `isSelectedAssignmentAccepted` publish-eligibility risk.
- Cons: leaves 3 pipelines structurally intact — the next new display surface can reintroduce the
  same class of bug; doesn't resolve the brittle-test coverage gap (Q-notes below) on its own.
- Rough size: half-day to 1 day per patch, 3 patches.

**Brittle tests — include in either option's scope:**
`collector/tests/ready-for-writer-queue-bucket.behavior.test.mjs:13-69` and
`collector/tests/queue-bucket-follows-state.test.mjs:1-30` both exercise only `app.js`'s
`resolveQueueBucket()` (Pipeline B) — the `ready_for_writer`+`ready_for_field`+no-assignment case
they assert **already passes**, which is why this bug shipped despite "passing" queue-bucket tests:
the suite never touched `article-intake.js`'s parallel `queueGroupKey()`/`derivedArticleWorkflowStatus()`
(Pipeline A). `test-helpers/fixture-ladder.mjs` `advancePlaceProductionState()` (`:21-57`) only ever
writes `production_state`/`publication_state` when advancing the ladder — it never creates or advances
a `field_packs` row or a `content_assignments` row, so no test built on this fixture can surface the
closed-assignment-counts-as-accepted or field-pack-status-never-advances bugs even in principle.
Whichever option is chosen, a new test needs to assert cross-pipeline agreement (both `article-intake.js`
bucketing and `app.js` bucketing return the same answer for the same DB state), and the fixture ladder
needs a field-pack/assignment-state lane, not just a production_state lane.
`content-type-transition-rules.test.mjs` is brittle in an unrelated way (hardcodes a legacy
transition-rule map) and does not test display/bucketing logic — not evidence of false confidence
for this bug specifically.

---

## Spot-verification (Layer 2 claims checked directly against source)

- `index.mjs:4444-4480` — read directly; confirmed `ready_for_writer` (line 4464) falls into the
  `"drafting"` catch-all (4456-4471), and `deriveQueuedArticleProcessStatus` (4478-4480) is a literal
  one-line passthrough. Matches Layer 2 exactly.
- `publishable-assignment-candidate.mjs:59-62` — read directly; confirmed line 61
  `state === "accepted" || state === "closed"`. Matches Layer 2 exactly.
- Layer 2's own self-correction of Layer 1 accepted as-is without re-verification:
  `buildAssignmentHandoffPreview()` lives in `repository.mjs` (~8616-8628), not `index.mjs` as
  Layer 1 first claimed.

## Open questions (need live DB/DOM, out of static-audit scope)

- Whether "handoff queue page shows ready_for_field" is the badge tooltip (`app.js:2054`) vs. a
  different fallback render path (`app.js:9075-9092`) vs. some other page — could not disambiguate
  without a browser session or live DB row for item 39 / field pack 38.
- Confirm actual live values (assignment state casing, any lingering open field-kind assignment) for
  item 39 match the stated scenario exactly — static trace assumed the ticket's stated DB state is
  accurate.
