# Field-pack ready_for_field guard — impact audit

Date: 2026-08-14
Branch audited: `fix/field-pack-ready-guard-route` @ `f0d6c91` vs `main`
Mode: READ-ONLY, static analysis only (dev machine has no live DB)
Method: audit-scanner (Layer 1 grep/trace) -> audit-deep-reasoner (Layer 2 confirmation)

---

## Headline

**The guard does not block the real Save button.** `assertFieldPackReadyProductionGate()`
(`collector/server/index.mjs:12577-12587`) is wired into 3 routes, but the UI's actual
save path — `btn-save` -> `saveCurrentWork()` -> `PUT /api/items/:id/editor-work` — is a
**4th write path that was never guarded**, and it's the one the field-progress-status
dropdown actually goes through. A place item at `production_state=analyzed` can still be
marked `ready_for_field` today, through the primary UI flow, with a plain 200 response.

The three routes this branch guarded are effectively guarding dead code / a route with no
UI caller. This is confirmed, not a hypothesis — see Q1 below.

---

## 1) Which button/screen sets field pack to `ready_for_field`, and is it actually blocked?

**No — the real flow is NOT blocked. FAIL.**

Call chain, confirmed by reading the actual wiring (not inferred):

- `item-editor.html:335` — `<select id="fp-status" hidden>` — hidden, not user-facing directly.
- `item-editor.js:4022-4034` (`getFieldProgressActions`) — offers a `"ready_for_field"` action
  with **no check on `production_state`** at all.
- `item-editor.js:4093-4104` — the visible progress-control button
  ("เปลี่ยนเป็นพร้อมส่ง handoff") click handler sets `select.value = nextStatus` (i.e. writes
  `"ready_for_field"` into the hidden select).
- `item-editor.js:5725` — `qs("btn-save")` click handler -> `saveCurrentWork(workflowAction)`.
- `item-editor.js:5703-5723` (`saveCurrentWork`) — builds payload via `buildEditorWorkPayload()`
  and calls `PUT /api/items/:id/editor-work` (`item-editor.js:5712-5716`).
- `item-editor.js:4360-4370` (`buildEditorWorkPayload`) — includes `field_pack:
  buildFieldPackApiPayload()`.
- `item-editor.js:4188` (`buildFieldPackTopLevelPayload`) — `status:
  String(qs("fp-status")?.value || "draft")` — i.e. whatever the hidden select holds,
  `"ready_for_field"` after the click above.
- `collector/server/index.mjs:8813-8939` — `PUT /api/items/:id/editor-work` route. Calls
  `repo.saveItemWithFieldPack()` at `index.mjs:8876`. **`assertFieldPackReadyProductionGate`
  is never called anywhere in this route.**
- `collector/db/repository.mjs:10114-10149` (`saveItemWithFieldPack`) -> `createFieldPackInternal`
  / `updateFieldPackInternal` (`repository.mjs:9771-9829`) — only runs `normalizeFieldPackPayload`
  (shape/enum validation, `repository.mjs:2497-2554`) and `assertFieldPackSourcesBelongToItem`.
  No `production_state` read anywhere in this path.

Result: **200 OK**, `field_pack.status` becomes `ready_for_field`, `production_state` stays
`analyzed`. There is no error to handle, raw or otherwise, because the guard never fires on
this path — `FIELD_PACK_HEAD_NOT_GENERATED` is never thrown here.

The two routes this branch *did* guard are not reachable from this flow:
- `saveCurrentFieldPack()` (`item-editor.js:4397-4407`, targets the two guarded
  `/field-packs` routes) is **defined but never called anywhere** in `public/` — dead code.
  Confirmed by grep: the only match for `saveCurrentFieldPack` in the whole `public/`
  directory is its own definition.
- `POST /api/items/:id/field-pack/regenerate` has **zero UI callers** — grep across
  `collector/server/public/`, `frontend/`, and `admin/` for `field-pack/regenerate` matches
  only the route definition in `index.mjs`.

## 2) Are pre-existing `ready_for_field` packs (merged before this guard) affected?

**PASS — guard is write-time only, no read-path re-validation, confirmed.**

- `validateAssignmentCreateFieldPackPrerequisites` (`collector/db/repository.mjs:2950-2969`,
  called from `index.mjs:10567` and `index.mjs:8788`) reads `field_pack.status ===
  "ready_for_field"` only — never re-invokes the guard or reads `production_state`.
- `listItemsByStatus` (`repository.mjs:4352-4371`) filters by `production_state`/
  `publication_state` only; does not read `field_pack.status`.
- `attachWorkflowHeadFields` (`index.mjs:1387-1408`) serializes `currentFieldPack?.status`
  for API responses with no re-check.
- No code path found anywhere that mutates or rejects an existing `field_pack` row because
  `production_state` drifted after the row was written.

Existing rows are untouched by this branch either way.

## 3) Does a new item always reach `generated` before pack assembly, or is an earlier `ready_for_field` a legitimate flow?

**There is no code-enforced sequencing on the actual write path — this is the original bug, not fixed by this branch.**

- Place production-state transitions (`repository.mjs:517-519`): `collected -> {analyzed}`,
  `analyzed -> {generated}`. `production_state` and `field_pack.status` are otherwise two
  independent tracks.
- Through `PUT /api/items/:id/editor-work` (the real write path, see Q1), nothing requires
  or checks `production_state === "generated"` before accepting `field_pack.status =
  "ready_for_field"`.
- This matches the pre-existing finding in `audit/field-working-writers.md` ("§3: No guard
  exists... handoff tab filter does not check production_state... item with head=analyzed +
  field_pack.status=ready_for_field... will appear on the handoff tab") — that was the
  problem this whole guard effort set out to fix. It is **still reproducible today** on this
  branch, because the fix landed on 3 routes that aren't the route actually used.
- Whether an editor should legitimately be able to draft/prepare a field pack before
  `generated` is a product question this audit doesn't answer — but as currently coded,
  nothing distinguishes "legitimate early prep, still draft" from "prematurely marked ready,"
  because status can go straight to `ready_for_field` regardless of stage.

## 4) Is the guard actually place-only? event/transport unaffected?

**PASS, confirmed by line number — but scope-correct on a route that isn't the live write path (see headline).**

- `index.mjs:12578` — `if (String(item?.type || "").trim().toLowerCase() !== "place")
  return;` — early return for any non-place type.
- `index.mjs:12567-12569` — `FIELD_PACK_PRE_GENERATED_PLACE_PRODUCTION_STATES = new
  Set(["collected", "analyzed"].filter(...))` — place-specific set.
- `repository.mjs:485-497` (event/transport transition rules) and `index.mjs:575-579`
  (`TRANSITION_RULES` — event/other_transport both resolve to the generic
  `buildContentTypeTransitionRules()`, not `buildPlaceTransitionRules()`) confirm event/
  transport never carry the place-only `field_working`/`field_review`/`writing_assigned`
  states this guard cares about.
- No type-mutation path found that could make a stored `event`/`transport` row present as
  `type: "place"` to the guard.

## 5) Do all 3 guarded routes return 409 consistently? Any route still falls to 400/500?

**The 3 guarded routes are consistent with each other. A 4th write path (`editor-work`) isn't in the comparison set at all — the guard is simply never called there, so no error is even generated to misclassify.**

| Route | Catch block | `FIELD_PACK_HEAD_NOT_GENERATED` -> |
|---|---|---|
| `POST /api/items/:id/field-packs` | `index.mjs:12618-12622` | 409 (explicit `err.code === "FIELD_PACK_HEAD_NOT_GENERATED"` check) |
| `PUT /api/field-packs/:fieldPackId` | `index.mjs:12665-12670` | 409 (same check, plus 404 for not-found) |
| `POST /api/items/:id/field-pack/regenerate` | `index.mjs:12753-12757` | 409 (same check) |
| `PUT /api/items/:id/editor-work` | `index.mjs:8934-8938` | **N/A — guard never called, so this error can't occur here.** Catch only maps `/not found/` -> 404, `/conflict\|constraint/` -> 409, else 400. |

All three explicitly-guarded routes are internally consistent (same `isConflict` expression,
same 409 mapping). The gap isn't a miscaught error on a 4th route — it's that the 4th route
never invokes the check at all, so the write succeeds unconditionally.

---

## Recommendation (not applied — read-only pass)

The guard needs to move to (or be additionally called from) `repo.saveItemWithFieldPack()`
in `collector/db/repository.mjs`, or `assertFieldPackReadyProductionGate` needs to be called
directly inside the `PUT /api/items/:id/editor-work` handler
(`collector/server/index.mjs:8813-8939`) before `repo.saveItemWithFieldPack()` runs at line
`8876`, using the incoming `field_pack.status` from the request body. Until that lands, this
branch's guard has no observable effect on the actual product flow.
