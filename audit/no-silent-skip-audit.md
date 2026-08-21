# Audit: no-silent-transition-skip (atomic production transition guard)

- Branch: `fix/no-silent-transition-skip` (f98acce, merge-base 22c02c1) vs `main`
- Scope: `collector/db/repository.mjs`, `collector/server/index.mjs`, 6 modified test files, 1 new test file, new `collector/tests/test-helpers/fixture-ladder.mjs`
- Mode: READ-ONLY discovery audit, two-layer (audit-scanner → audit-deep-reasoner)
- Gate: not re-run per instruction (branch reports 976/916/59 matching baseline already)

## Summary

`updateAssignmentStateInternal` (`collector/db/repository.mjs:5558-5651`) previously `console.error`-logged and silently continued when a place+field assignment's implied production-state transition was illegal. This branch makes it `throw` instead (`repository.mjs:5624-5628`), relying on the existing `runInTransaction` wrapper to roll back atomically. The core mechanism is sound (Q2, Q4 pass). **One live endpoint was missed**: `POST /api/assignments/:id/submissions` swallows the new error into a generic 400 instead of 409, and — worse — the fix's own deep-reasoner review surfaced that this failure mode leaves a real orphaned DB write (a submission row with no matching assignment-state advance), because `addAssignmentSubmission` runs and commits *before* `updateAssignmentState` in the same route, outside any shared transaction. That's the one finding that should block merge; everything else is PASS.

## Q1 — caller inventory: who doesn't catch, and becomes what?

Full non-test caller list of `updateAssignmentState`/`updateAssignmentStateInternal`:

| caller | file:line | route | catch behavior | result if new error fires |
|---|---|---|---|---|
| `transitionArticleProcessState` → `updateAssignmentState` | `index.mjs:4202`, `:4237` | `POST /api/items/:id/article-process/transition` (try/catch `9243-9255`), `POST /api/items/:id/article-process/submit-review` (try/catch `9290-9426`) | regex `/invalid .*transition\|.../i` | **409, correct** |
| `updateAssignmentState` (editorial-kind only) | `index.mjs:9388` | submit-review route (same as above) | same regex | editorial kind never triggers the new throw (guard requires `assignment_kind==="field"`) — moot |
| `updateAssignmentState` (editorial-kind only) | `index.mjs:10350` | `POST /api/items/:id/article-editorial-assignments` (try/catch `10426-10430`) | regex `/invalid .*transition\|cannot transition\|already exists/i` | editorial-only, moot |
| `updateAssignmentState` (editorial-kind guarded) | `index.mjs:10465` | `.../request-revision` (try/catch `10488-10492`) | regex `/invalid .*transition\|cannot transition/i` | editorial-only (explicit kind check at `10457`), moot |
| `updateAssignmentState` | `index.mjs:10988` | `PATCH /api/assignments/:id/state` (try/catch `10964-11059`) | **exact** regex `/^invalid production transition:/` at `11054` | **409, correct — this is the route the fix was clearly designed around** |
| `updateAssignmentState` | **`index.mjs:11263`** | **`POST /api/assignments/:id/submissions`** (try/catch `11199-11311`) | **catch at `11309-11311` is bare `res.status(400).json({error: String(err?.message ...)})` — no pattern check at all** | **CONFIRMED BUG — 400 instead of 409, and see Q1a below for a worse side effect** |
| `updateAssignmentStateInternal` (direct, own transaction) | `repository.mjs:5729` inside `requestAssignmentRevisionWithReset` (own `runInTransaction` at `5718`) | reached via `PATCH /api/assignments/:id/state` → `repo.requestAssignmentRevisionWithReset` (`index.mjs:10980`) | same route catch as above (`11054`) | 409, correct |
| `updateAssignmentStateInternal` (direct, own transaction) | `repository.mjs:9147` inside `returnFieldAssignmentForRework` (own `runInTransaction` at `9146`) | `POST /api/assignments/:id/return-to-field` (try/catch `11163-11167`, regex `/must be accepted\|only field assignments\|note is required/i` — does **not** match) | this call always passes `nextState="closed"`; the trigger mapping at `repository.mjs:5608-5616` only fires for `in_progress`/`submitted`/`resubmitted`/`revision_requested` — **"closed" can never trigger the new throw**, so this mismatch is currently unreachable, not a live bug. Flagged only as a latent gap if that mapping is ever extended. |
| `repo.updateAssignmentState` | `collector/scripts/seed-mock-work-stage-jobs.mjs:434, 568` | none (manual dev seeding script, `npm run seed:mock:work-stage`, not invoked by `npm run gate`; guarded by `assertSmokeSqliteDatabaseAllowed`) | uncaught → script crashes | acceptable — a hard crash on bad seed state is no worse than the old silent-corruption behavior, and this never touches a real DB. No fix needed. |

### Q1a — the confirmed bug, with the data-integrity detail

`collector/server/index.mjs:11170-11312` (`POST /api/assignments/:id/submissions`):
- `repo.addAssignmentSubmission(...)` at **line 11248** creates the submission row and (indirectly) updates `content_assignments.latest_submission_id`. This function (`repository.mjs:5839-5930`, `addAssignmentSubmission`) is **not wrapped in `runInTransaction`** — its writes commit immediately, independent of anything that follows.
- `repo.updateAssignmentState(assignmentId, nextAssignmentState, ...)` at **line 11263** runs afterward, in its *own* separate transaction. For a place+field assignment going to `submitted`/`resubmitted`, this can now throw the new error (mapped target `field_review`, per `repository.mjs:5608-5616`).
- The catch at **lines 11309-11311** has no message-pattern check, so this reports **400** (not 409) to the caller.
- Worse: because the submission write already committed before the throw, the result is a **real data inconsistency** — a `content_assignment_submissions` row exists (and `latest_submission_id` points at it) while `content_assignments.state` is still stuck at its pre-submission value. This is a regression versus the old behavior, where the (silent) skip meant both writes always succeeded together.
- Reachability is not hypothetical: the comment at `repository.mjs:5617-5619` ("Historical place work can still be on a legacy skip state") documents that field+place assignments sitting in `in_progress`/`revision_requested` with an item whose `production_state` never advanced past `collected` are an acknowledged, real condition — exactly what the old silent-skip allowed to accumulate. Any such pre-existing assignment will hit this the first time its contributor submits, as soon as this branch ships.

**This should block merge or be fixed together with the rest of this diff** — it's the exact same class of problem (silent/wrong handling of the new guard) the branch is otherwise fixing everywhere else.

## Q2 — is rollback real?

**PASS, confirmed with line numbers.** `updateAssignmentState` (`repository.mjs:5554-5556`) wraps `updateAssignmentStateInternal` in `runInTransaction(db, ...)`. `runInTransaction` (`repository.mjs:2658-2680`) does a real `db.exec("BEGIN IMMEDIATE")` (`2668`), `db.exec("COMMIT")` on success (`2672`), and `db.exec("ROLLBACK")` in the `catch` (`2676`) before re-throwing (`2678`), tracked via a transaction-depth map so nested calls don't double-open. The assignment-row write (`updateAssignmentStateStmt.run`, `5582`) and the new throw (`5624-5628`) are inside the same closure passed to `runInTransaction`, so a throw there rolls back the state write too.

- All 7 route-level callers of the outer `updateAssignmentState` are top-level calls (not nested inside another transaction), so each gets a fresh, correct `BEGIN`/`COMMIT`/`ROLLBACK`.
- The 2 direct callers of the inner `updateAssignmentStateInternal` (`requestAssignmentRevisionWithReset` at `5700`/own transaction at `5718`; `returnFieldAssignmentForRework` at `9127`/own transaction at `9146`) each wrap their *entire* function body in one `runInTransaction`, so a throw from the inner call rolls back everything else in that closure too (e.g. the media-reset write in the revision path).
- Confirmed independently by the new test `collector/tests/assignment-production-transition-atomic.test.mjs:79-103` and the rewritten `content-type-transition-rules.test.mjs:478-503`, both asserting the assignment `.state` and workflow head are unchanged after the throw.

## Q3 — is prefix-matching the error string fragile?

**Partially fragile, but by design/convention, not by accident — and the failure mode if it breaks is silent.**

- `index.mjs:11054` uses the exact anchored regex `/^invalid production transition:/`.
- This prefix is **not unique to the new throw**. The pre-existing generic `assertValidTransition` (`repository.mjs:4790`: `` throw new Error(`invalid ${stateGroup} transition: ${fromState} -> ${toState}`) ``) produces the *identical* prefix `"invalid production transition:"` whenever `stateGroup === "production"` — which is exactly what the new custom message was written to match (the new one uses a Unicode `→` inside the message; `assertValidTransition`'s uses ASCII `->`, but the regex only checks the prefix up to the colon, so both match). Conflating these two throw sites into the same 409 response is semantically correct (both really are "invalid production transition" conflicts), so this is not a bug — but it is an **implicit, undocumented contract**: nothing states that the custom message at `repository.mjs:5627` must keep this exact prefix in sync with the generic one at `4790`.
- **Failure mode if the message text ever changes**: silent, not loud. If either string is reworded (casing, punctuation, translation), the regex simply stops matching, the error falls through to the generic `res.status(400)` at `11058`, and nothing throws or logs a mismatch — it just quietly becomes a 400 instead of 409, indistinguishable from an actual validation error unless someone is specifically testing the status code (which the new tests do — so CI would catch this, but a bare code reviewer would not necessarily notice).
- The broader `/invalid .*transition/i` pattern used by 8+ other routes (`8809, 9182, 9253, 9424, 10428, 10490, 14082, 14092, 14373`) is even looser and pre-dates this diff — not introduced here, but shares the same class of risk.

## Q4 — is the blast radius really place+field only, and is event/transport untouched?

**PASS.** The new throw only fires inside the block guarded by `contentType === "place" && assignment_kind === "field"` (`repository.mjs:5608`) — confirmed via the new test `assignment-production-transition-atomic.test.mjs`'s third case ("event field assignment with head=collected still returns 200 (no production state computed)"), which explicitly proves an `event`-type item with the same assignment shape is unaffected. Diff does not touch `resolveQueueBucket`, tab-filter logic, `canTransition` itself, or any event/transport code path — grep of the diff for these identifiers returns nothing.

## Q5 — does `fixture-ladder.mjs`'s early-return silently skip intended test coverage?

`collector/tests/test-helpers/fixture-ladder.mjs:5` (`if (itemType !== "place") return;`) is a **correct no-op, not a bug**: the new throw this whole branch adds can only ever fire for `type==="place"` items (Q4), so advancing a non-place item's production_state through the place ladder would be meaningless for any of these tests' purposes. Checked all 7 insertion sites across the 6 modified test files (`article-process-field-return-evidence.behavior.test.mjs:353`, `assignment-accept-confirmed-metadata.repository.test.mjs:80`, `assignment-state-reader.test.mjs:57`, `endpoint-schema-mapping-surface.test.mjs:196`, `field-pack.repository.test.mjs:2277/2379/2443`, `revision-asset-retention.test.mjs:159/277/305/406/453`) — every one creates a `type: "place"` item, so the helper is never actually a no-op at any current call site. No coverage silently dropped by this mechanism.

## Q6 — did test semantics shift (collected → ready_for_content or similar)?

**No drift found.** Traced all 6 modified test files: in every case, `advancePlaceProductionState(..., "field_working")` was inserted solely so the assignment-state transition under test (submit/resubmit/revision/accept) doesn't hit the new guard — none of these tests assert on or care about the item's `production_state` ladder position; their actual subjects are submission-row shape, confirmed-metadata provenance, assignment-state-reader ranking, payload merge, or asset-retention-across-revision-rounds. None of their names/docstrings claim to test "from a `collected`-state item," so there's no dropped scenario — the old silent-skip behavior leaving `production_state` at `collected` was an accident of the old code, not a deliberate test target.

The one file that *did* change on purpose is `content-type-transition-rules.test.mjs:478-503`: the pre-existing test `"legacy place field sync logs its skipped ladder write instead of failing the assignment"` (asserted `doesNotThrow` + a specific `console.error` log shape) was rewritten to `"place field assignment rejects invalid production transition and rolls back assignment"` (asserts `assert.throws` with the new message, and that the assignment stays at `assigned`). This is the intended target-behavior change, correctly done, and it's what the new test exists to cover — not a side effect. The specific `ready_for_content`/`collected` region named in the prompt (`content-type-transition-rules.test.mjs:290-390`, `createItem("place"/"event", {production_state: "ready_for_content"})`) is confirmed **untouched** by this diff — pre-existing on `main`, unrelated.

## Verdict

**One confirmed blocker (Q1a):** `POST /api/assignments/:id/submissions` (`collector/server/index.mjs:11170-11312`, catch at `11309-11311`) needs the same status-mapping treatment as every sibling route, and — more importantly — the write-ordering gap that lets `addAssignmentSubmission` commit before `updateAssignmentState` can leave a real orphaned submission row when the new guard fires. This should be fixed in the same pass as the rest of this branch, not deferred, since it's the same silent-wrong-handling problem the branch exists to close everywhere else.

Everything else passes: rollback is real and correctly scoped (Q2), the blast radius is genuinely place+field only (Q4), the fixture helper's early-return is correct rather than a coverage gap (Q5), and no existing test's intent was silently changed (Q6). Q3's fragility is real but is an implicit-convention risk with a silent (not loud) failure mode if ever broken — worth a one-line code comment tying the two message formats together, not a blocker.
