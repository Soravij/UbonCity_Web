# Backward-split-two-actions: diff audit (main..bed9395, read-only)

Scope: verification-mode audit of branch `feat/backward-split-two-actions-v2`
(3 commits: `4e2d48b`, `08fec60`, `bed9395`) against `main`, following up on the
feasibility pass in `audit/backward-split-two-actions-audit.md`. Per explicit
instruction, that prior report's Q2a claim (that `in_review` sits in
`EDITORIAL_PROCESS_STATES`) was **not** trusted and was independently
re-verified from code — see Part C. No files left modified; two temporary,
fully-restored reverts were made and hash-verified as part of Part A. No
commit/merge/push performed.

Pipeline: `audit-scanner` (Layer 1, twice — diff scope + correctness
candidates) → `audit-deep-reasoner` (Layer 2, on the PUT-endpoint bypass
question) → manual revert-proof done directly (not delegated) → `test-runner`
(gate, once).

---

## A — Revert proof (done by hand, hash-verified)

Baseline recorded before any mutation:
- `HEAD` = `bed9395f22663f1e4cfae4a363d566e95e06d3d6`
- `collector/server/index.mjs` blob hash = `2394e239e6fdc1c90e3412b930dd6003b92a4c60`
- `collector/db/repository.mjs` blob hash = `34a94165586e4021ee9137364411bf1326ce6474`

**Revert 1 — `index.mjs:9252` reopen condition reverted to `ready_for_writer`-only:**
Ran `collector/tests/backward-autoclose-scope.test.mjs` (test-runner agent).
Result: 2 pass, 1 **fail**, at the predicted assertion —
```
expected: 'revision_requested'
actual:   'accepted'
message:  "field assignment must be reopened to revision_requested"
```
Not a tautology — confirms the reopen-condition change at `index.mjs:9252` is
load-bearing.

**Revert 2 — `repository.mjs:525` adjacency Set reverted to
`["writing", "ready_for_writer"]`, metadata table entry left intact:**
Same test file re-run. Result: 2 pass, 1 **fail**, at the predicted point —
```
expected status: 200
actual status:   409
error location:  tests/backward-autoclose-scope.test.mjs:145:14
```
Confirms the audit warning: the metadata table entry alone is inert without
the adjacency-graph edge — this is exactly the mechanism the feasibility
audit predicted, not a tautological test.

**Restoration verified after each revert:**
```
git checkout HEAD -- <file>
git diff --stat HEAD -- <file>        → empty
git hash-object <file>                → matches baseline exactly (both files, both times)
```
Both files are back to the exact `bed9395` committed content. **A is clean.**

---

## B — Diff scope

`git diff --stat main..bed9395` / `git diff --name-only main..bed9395`:
```
collector/db/repository.mjs                       |  5 ++-
collector/server/index.mjs                        |  2 +-
collector/tests/backward-autoclose-scope.test.mjs | 45 ++++++++++++++++++++-
collector/tests/test-helpers/fixture-ladder.mjs   | 16 +++++---
4 files changed, 57 insertions(+), 11 deletions(-)
```

- **4 files touched, not 3** — the third commit (`bed9395`, labeled "test" by
  the user) actually touches two files: the intended test file **and**
  `collector/tests/test-helpers/fixture-ladder.mjs`, a shared test-fixture
  helper used by other, unrelated test files. This is the scope-creep vector
  that produced the real regression in Part C below.
- No `styles.css`, no file under `collector/server/public/*` anywhere in the
  diff — confirmed by `git diff --name-only`.
- `collector/server/index.mjs`'s entire diff is exactly one line
  (`index.mjs:9252`, quoted in the prior audit and re-confirmed here). The
  generic auto-close block (`index.mjs:9203-9227`) is untouched — confirmed
  byte-for-byte via the revert/restore hash check in Part A (reverting only
  line 9252 and restoring reproduced the exact original blob hash, meaning no
  other line in that file differs from `main`'s ancestor version of it plus
  this one hunk).

---

## C — Correctness (verified from code directly, not from the prior report)

**C1 — every `(fromState → toState)` pair in `PLACE_BACKWARD_PRODUCTION_TRANSITIONS`
targeting `field_review`** (`repository.mjs:543-577`): exactly three —
`writing_assigned → field_review` (line 559, new), `ready_for_writer → field_review`
(line 562, pre-existing), `in_review → field_review` (line 569, pre-existing,
`direction: "cross_process"`).

**Reopen condition (`index.mjs:9252`)**:
```js
if ((fromProductionState === "ready_for_writer" || fromProductionState === "writing_assigned") && target.production_state === "field_review") {
```
Correctly includes the first two, correctly **excludes** `in_review` — this is
the intended scope, not over- or under-inclusive. Cross-checked against the
new regression test at `backward-autoclose-scope.test.mjs:164-203`
(`in_review → field_review` with an `accepted` field assignment asserts
`field.state === "closed"`, not `revision_requested`).

**C2 — the prior report's Q2a claim was checked and is confirmed WRONG, exactly
as flagged.** Read `index.mjs:9212-9227` directly:
```js
const EDITORIAL_PROCESS_STATES = new Set(["writing_assigned", "writing"]);
const FIELD_PROCESS_STATES = new Set(["field_working", "field_review"]);
const SKIP_AUTO_CLOSE_STATES = new Set(["ready_for_writer"]);
const closeKind = SKIP_AUTO_CLOSE_STATES.has(fromProductionState)
  ? "skip"
  : EDITORIAL_PROCESS_STATES.has(fromProductionState)
    ? "editorial"
    : FIELD_PROCESS_STATES.has(fromProductionState)
      ? "field"
      : null;
```
`in_review` is in **none** of these three sets, so `closeKind` resolves to
`null` for a `fromProductionState === "in_review"` transition — not
`"editorial"`. The filter at line 9227
(`.filter((assignment) => closeKind === null || ... === closeKind)`) then
evaluates `closeKind === null` to `true`, which **closes every open
assignment regardless of `assignment_kind`** when leaving `in_review` — this
is the "closeKind=null closes all kinds" behavior the new regression test
documents, confirmed correct by direct read, independent of the prior audit
document.

**C3 — does widening the Set at `repository.mjs:525` open an unintended
forward path?** Yes, confirmed: `canTransition()` (`repository.mjs:4759-4773`)
is a single symmetric adjacency check with **no direction concept** — the
same Set gates both the backward-transitions POST route and every other
`upsertWorkflowModel()` caller, including `PUT /api/items/:id/workflow-model`
(`index.mjs:9589-9653`), which lets `owner`/`admin` set `production_state` to
anything reachable in the Set, with **no** auto-close/reopen side effects
(those live only as POST-route-local logic at `index.mjs:9203-9273`, not
inside `upsertWorkflowModel()` itself). Deep-reasoner traced this fully:
- Concretely, an owner/admin could `PUT /workflow-model` with
  `production_state: "field_review"` while at `writing_assigned` and get a
  200, leaving any `accepted` field assignment silently unreopened —
  reproducing the exact bug class this feature exists to fix, via a
  different route.
- **This is not new exposure from this diff** — the identical pattern already
  existed pre-diff via `ready_for_writer → field_review` (that Set entry was
  untouched by this diff). This diff only adds one more source state to an
  already-existing risk pattern on an endpoint this diff does not touch.
- The gap is explicitly documented and deliberately deferred in
  `docs/place-workflow-policy.md:271-275` (§9.4), which calls this endpoint a
  "ladder-skipping gate" to be removed only *after* the backward-transition
  ladder — i.e. this very feature — is complete, and notes it may currently
  be the only way to rescue a stuck item.
- No client-side caller of `/workflow-model` exists anywhere in
  `collector/server/public/*.js` — API-only, not reachable from the product UI today.
- **Verdict: not a blocker for this diff** — pre-existing, documented, and
  out of scope per the freeze rule against modifying API endpoints. Worth a
  separate follow-up ticket, not a gate on this branch.

**C4 — the real regression, found only by direct verification, not by
trusting either prior audit:** `collector/tests/test-helpers/fixture-ladder.mjs`
extended several previously-**empty** trailing arrays (`field_review: []` →
`field_review: ["ready_for_writer", "writing_assigned", "writing", "in_review"]`,
and similarly for `writing`, `in_review`). `advancePlaceProductionState`'s
walk logic (`fixture-ladder.mjs:28-34`):
```js
const targetIndex = path.indexOf(targetState);
if (targetIndex === -1) {
  if (path.length > 0 && path[path.length - 1] !== targetState) {
    throw new Error(`advancePlaceProductionState: "${targetState}" is not reachable from "${current}"`);
  }
  return;   // <- silent no-op when path.length === 0
}
```
When `field_review`'s array was `[]`, any caller requesting an unreachable
target (e.g. `"field_working"` from a current state of `"field_review"`)
hit `path.length === 0`, took the silent `return` branch, and continued
harmlessly. Now that the array is non-empty, the exact same call takes the
`throw` branch instead. This is **not merely additive** — it flips a
previously-silent no-op into a hard failure for any caller that re-invokes
`advancePlaceProductionState` targeting an earlier ladder rung after the item
has already progressed past `field_review`.

This is exactly what happens in a **pre-existing, unrelated test file**,
`collector/tests/assignment-accept-confirmed-metadata.repository.test.mjs:80`:
```js
advancePlaceProductionState(repo, assignment.content_item_id, "field_working");
```
called from `submitWithReturns()`, used for multi-round submission tests
(e.g. lines 282-294, 310-327, 592-603, 620-629, each calling
`submitWithReturns` twice for sequential rounds). The mechanism, traced fully:
1. Round 1's `submitWithReturns` → `repo.updateAssignmentState(id, "submitted", …)`
   internally sets `production_state = "field_review"` as a side effect for
   field-kind assignments in `submitted`/`resubmitted` state
   (`repository.mjs:5624-5632` — `requestedPlaceFieldProductionState`).
2. Round 1's `updateAssignmentState(id, "accepted", …)` does not touch
   `production_state` (not in that ternary's matched states), so it stays at
   `field_review`.
3. Round 2's `submitWithReturns` calls
   `advancePlaceProductionState(repo, itemId, "field_working")` again — but
   current state is now `field_review`, and the newly-non-empty array causes
   a throw instead of the old silent no-op.

**Confirmed live**: the gate run (Part D) shows exactly 4 failures with this
literal error message —
`advancePlaceProductionState: "field_working" is not reachable from "field_review"`
— all traced to this one call site, in this one file, none of which is among
the 4 files this diff intends to touch. This directly answers the user's C
question ("does the fixture ladder change leave other cases in the same file
unaffected") with: **the ladder change breaks cases in a different file
entirely** — real scope creep with a confirmed functional consequence, not a
hypothetical.

**C5 — test authenticity**: `backward-autoclose-scope.test.mjs` spawns the
real server as a child process (`spawn(process.execPath, [serverPath], …)`,
line 79) reading actual source from disk — not a re-implemented/mocked
logic path. Confirmed no hardcoded absolute path (`fileURLToPath(import.meta.url)`
resolution at lines 16-19; grepped for `D:\`/`/mnt/` — none found).

---

## D — Gate run (once, per instruction — not re-run)

Ran the full suite once via `test-runner` on this branch (`cd collector && node --test "tests/*.test.mjs"`).
Raw result: 771 pass / 145 fail out of 920.

**This run is only partially usable — most of it is invalid, not a real
signal:**
- **141 of 145 failures share one identical error**:
  `ENOENT: no such file or directory, open 'D:\...\collector\collector\database\schema.sql'`
  (or the equivalent doubled path for `app.js`/`index.mjs`). The doubled
  `collector\collector\` path segment is a test-harness invocation bug (the
  runner's working directory was resolved incorrectly for this run), **not**
  a product or diff regression. Per instruction ("ห้าม re-run"), this run was
  not repeated, and no fix was attempted — but these 141 results must be
  discarded as noise, not counted as real failures, and the "before/after vs.
  main" comparison the instruction asked for is therefore **inconclusive** —
  a 2-day-old main baseline can't be meaningfully compared against a run this
  corrupted anyway.
- **4 failures are real** and are exactly the fixture-ladder regression
  identified independently in C4 above (same file,
  `assignment-accept-confirmed-metadata.repository.test.mjs`, same error
  message, 4 distinct test names). These are directly attributable to this
  diff's `fixture-ladder.mjs` change — not pre-existing noise, not unrelated
  to the diff.
- The remaining scattered failures (`getAssignableUsers is not defined`,
  `currentRole is not defined`, `Cannot use import statement outside a
  module`, etc.) are client-side/`app.js` test-loader issues sharing the same
  doubled-path signature pattern as the 141 — consistent with the same
  harness misconfiguration, not this diff.
- **Backward/transition/assignment-named failures found**: only the 4 in
  `assignment-accept-confirmed-metadata.repository.test.mjs` (C4). No other
  failure name references backward/transition/assignment logic in a way
  distinguishable from the ENOENT noise.

---

## Verdict: **BLOCKED**

Not because of anything in the intended 3-file backward-split change itself
— A confirms both guarded lines are load-bearing and correctly scoped, C1-C3
confirm the reopen condition and Set semantics are exactly as intended (with
one pre-existing, documented, non-blocking exposure noted for later), and C5
confirms the test methodology is sound.

**Blocked specifically because of C4**: `collector/tests/test-helpers/fixture-ladder.mjs`'s
change (part of commit `bed9395`) breaks 4 real, currently-failing tests in
an unrelated, pre-existing file
(`collector/tests/assignment-accept-confirmed-metadata.repository.test.mjs`)
that this diff was not supposed to touch. This is a genuine regression, not a
stale snippet-test and not test-runner noise — confirmed by direct causal
tracing (C4) and corroborated by the one clean signal inside an otherwise
noisy gate run (D). Per CLAUDE.md, this needs an explicit fix (most likely:
give the newly-added ladder-tail states their own non-terminal arrays without
removing the terminal `[]` semantics multi-round tests rely on, or extend
`advancePlaceProductionState` to treat "target already passed" as a no-op
explicitly rather than relying on `path.length === 0`) before this branch is
mergeable — not a silent edit to the test, and not something to route around.

---

## Files/lines referenced
- `collector/db/repository.mjs:511-538` (adjacency graph, line 525 changed),
  `:543-577` (metadata table, lines 559 new/558 relabeled), `:4759-4773`
  (`canTransition`), `:4952-5035` (`upsertWorkflowModel`), `:5562-5644`
  (`updateAssignmentState`, field-submission production_state side effect)
- `collector/server/index.mjs:9203-9227` (auto-close, `closeKind`
  derivation), `:9252-9273` (reopen, one-line diff), `:9589-9653`
  (`PUT /workflow-model`, unguarded second write path)
- `collector/tests/backward-autoclose-scope.test.mjs:116-203` (rewritten +
  new regression test)
- `collector/tests/test-helpers/fixture-ladder.mjs:1-45` (the regression source)
- `collector/tests/assignment-accept-confirmed-metadata.repository.test.mjs:78-80`
  (the broken call site) and its 4 failing tests (lines ~282-294, 310-327,
  592-603, 620-629 per the `submitWithReturns` call sites)
- `docs/place-workflow-policy.md:271-275` (§9.4, PUT /workflow-model deferred-removal note)

---

## Method note

Layer 1 (`audit-scanner`) ran twice: once for diff scope + initial
correctness candidates, and its output correctly flagged (needs_deep_review)
the Set-direction question and the closeKind/null-handling question rather
than mis-triaging them. Layer 2 (`audit-deep-reasoner`) resolved the
PUT-endpoint bypass question definitively (pre-existing, documented,
non-blocking). The revert-proof (Part A) was performed directly rather than
delegated, since it required precise sequential git mutation with hash
verification at each step; both reverts and restores were verified
byte-for-byte via `git hash-object`. The C4 regression was found by
independently tracing the mechanism behind the gate run's 4 non-noise
failures rather than accepting either prior audit's "fixture ladder is
purely additive" conclusion at face value — that conclusion checked
index-position stability but missed that extending a previously-empty array
changes a silent-no-op branch into a throw. No code was left modified after
this pass; no commit/merge/push performed.

---
---

# Addendum — commit `77b1d4a` (C4 fix) + clean gate run

Scope per this round's instruction: verify **only** commit `77b1d4a` and run
the gate once via `npm run gate` — `repository.mjs`, `index.mjs:9252`, and
`backward-autoclose-scope.test.mjs` were **not** re-audited (already passed).
No files modified; no commit/merge/push performed.

## A — commit `77b1d4a` (`collector/tests/test-helpers/fixture-ladder.mjs`)

**A1 — `PLACE_PRODUCTION_LADDER` (fixture-ladder.mjs:14-19) vs. canonical
production states.** The user's cited comparison point,
`index.mjs:2805-2817`, does **not** contain the canonical list — that range
is `createCollectorAuthIntegration(...)` config, unrelated. The actual
canonical `PRODUCTION_STATES` enum lives at `collector/db/repository.mjs:440-458`
(17 states: `collected, analyzed, brief_generated, ready_for_content,
field_working, field_review, ready_for_writer, writing_assigned, writing,
content_in_progress, generated, in_review, needs_revision, ready_for_publish,
submitted_for_admin_review, rejected, completed`), imported into `index.mjs`.

`PLACE_PRODUCTION_LADDER` (13 states) omits 4 of these:
`brief_generated`, `content_in_progress`, `needs_revision`, `rejected`. This
is **correct, not a gap** — these 4 are article/legacy-only states that don't
apply to the "place" content type's ladder at all, confirmed two ways:
- `buildPlaceTransitionRules()` (`repository.mjs:511-538`) lists all 4 as
  dead-end keys with an empty `Set([])` — structurally present but
  unreachable/terminal for "place".
- The dedicated contract test
  `collector/tests/content-type-transition-rules.test.mjs:149`
  ("place contains only its final positional ladder while non-place types
  retain the complete legacy graph") exists specifically to enforce that
  "place" only ever uses its restricted positional ladder, never the full
  legacy graph other content types retain.
- Grepped every `advancePlaceProductionState(...)` and `createPlace(ctx.repo, "...")`
  call site across all of `collector/tests/` (17 call sites, 10 files) — no
  test anywhere ever requests one of the 4 excluded states as a target.
  **A1: confirmed correct, no state dropped that any test file relies on.**

**A2 — new guard (fixture-ladder.mjs:35-46), verified directly:**
```js
const targetIndex = path.indexOf(targetState);
if (targetIndex === -1) {
  const currentRung = PLACE_PRODUCTION_LADDER.indexOf(current);
  const targetRung = PLACE_PRODUCTION_LADDER.indexOf(targetState);
  if (targetRung === -1) {
    throw new Error(`advancePlaceProductionState: "${targetState}" is not a known production state`);
  }
  if (targetRung <= currentRung) {
    return; // ผ่านขั้นนี้มาแล้ว — no-op โดยตั้งใจ
  }
  throw new Error(`advancePlaceProductionState: "${targetState}" is not reachable from "${current}"`);
}
```
- Target not on the ladder at all → `targetRung === -1` → throws "not a known
  production state" (line 39-41). Confirmed.
- Target is an earlier rung than current → `targetRung <= currentRung` →
  silent `return` (line 42-44). Confirmed. Traced the exact C4 scenario
  (current=`field_review`, target=`field_working`): `currentRung=5`,
  `targetRung=4`, `4 <= 5` → no-op, restoring the original pre-regression
  behavior exactly.
- A genuinely-forward-but-unreachable target still throws (line 45) — the
  primary `targetIndex !== -1` walking branch (lines 48-56) is untouched by
  this commit's diff, so normal forward walks are unaffected.
- **No remaining reference to `path.length` anywhere in the decision logic**
  — the only surviving use of `path` after line 35 is `path[i]` inside the
  unchanged for-loop (line 49), unrelated to the guard. Confirmed via direct
  read of the full file.
- **A2: all four behaviors confirmed correct.**

One residual, pre-existing (not introduced by `77b1d4a`) limitation noted for
completeness, not a blocker: `PLACE_LADDER_PATH`'s per-key arrays
(fixture-ladder.mjs:1-12) never extend past `in_review` — none of them
include `ready_for_publish`, `submitted_for_admin_review`, or `completed`,
even though `PLACE_PRODUCTION_LADDER` lists them. A forward request to one of
those three would still throw "not reachable" rather than walk there,
identically to before this fix. Dormant today since no test requests them
(confirmed by the same call-site grep as A1) — worth a follow-up if a future
test needs to construct a fixture at one of those three states.

**A3 — is C4 actually gone, anywhere it could recur?** Grepped every
`advancePlaceProductionState(` call site repo-wide:
```
article-process-field-return-evidence.behavior.test.mjs:353
assignment-accept-confirmed-metadata.repository.test.mjs:80   <- the originally-broken file
assignment-state-reader.test.mjs:57
backward-autoclose-scope.test.mjs:69
endpoint-schema-mapping-surface.test.mjs:196
field-pack-ready-guard-route.test.mjs:71
field-pack.repository.test.mjs:2277, 2378, 2443
queue-bucket-follows-state.test.mjs:50
revision-asset-retention.test.mjs:158, 275, 303, 403, 451
submit-gate-active-batch.test.mjs:132
```
The fix lives entirely inside the shared helper function, so all 17 call
sites across these 10 files get the corrected guard uniformly — this isn't a
per-file patch. Confirmed empirically via the clean gate run (Part B below):
none of the 4 previously-failing tests in
`assignment-accept-confirmed-metadata.repository.test.mjs` (`"an unaccepted
rework submission never shadows the accepted round it supersedes"`, `"field
return evidence keeps only the newest round per check key"`, `"unchecked CTA
returns keep the previously confirmed value instead of wiping it"`,
`"unchecked taxonomy returns keep the previously confirmed check instead of
wiping it"`) appear in this round's failing-test list. **A3: C4 is
confirmed resolved, gate-verified, no recurrence found in any of the other
16 call sites.**

## B — Gate (`npm run gate`, run once from repo root)

Per instruction, ran the actual gate command (`node scripts/gate.mjs` via
`npm run gate` from `D:\UbonRuntime\repos\UbonCity_Web`, not `node --test`
directly) — this avoided the prior round's doubled-path `collector\collector\`
bug entirely; this run's failures are real, not path-resolution noise.

```
tests   1019
pass    952
fail    66
skipped 1
```

**Vs. main: inconclusive**, exactly as anticipated by the instruction — no
current, clean main-branch baseline exists to diff against (main's last
known gate state predates this branch by 2+ days and was never captured with
this same clean invocation).

**Failures matching backward/transition/assignment/fixture-ladder, reported
by name with file:line, causation traced where determinable:**

- **Confirmed real, and confirmed NOT caused by `77b1d4a`** — 6 failures, all
  in `collector/tests/content-type-transition-rules.test.mjs`, none of which
  imports or calls `fixture-ladder.mjs`/`advancePlaceProductionState` at all
  (grepped, zero matches) — so these cannot be a `77b1d4a` regression. Root
  cause traced instead to the **earlier** commit `4e2d48b` (already declared
  "passed" in the prior audit round, but never actually observed passing
  under a clean gate — the prior gate run was corrupted by the ENOENT bug and
  never reached this file's real result):
  - `content-type-transition-rules.test.mjs:53-71` — `PLACE_PRODUCTION_RULES`,
    a hand-maintained duplicate of `buildPlaceTransitionRules()`'s production
    graph, still reads `writing_assigned: ["writing", "ready_for_writer"]`
    (line 61) — missing the `"field_review"` entry that `4e2d48b` added to
    the real graph at `repository.mjs:525`. Breaks:
    - `"each content type accepts exactly its expected transition graph"`
      (line 263) — `assert.throws` at line 290 fails because
      `writing_assigned -> field_review` no longer throws in the real code,
      but this stale fixture still expects it to.
    - `"place contains only its final positional ladder..."` (line 149) —
      `assertAllTypeRulesMatchExpectedGraph()` (line 137) does a strict
      `deepEqual` against this same stale object.
  - `content-type-transition-rules.test.mjs:73-84` — `PLACE_BACKWARD_EDGES`,
    a hand-maintained duplicate of `PLACE_BACKWARD_PRODUCTION_TRANSITIONS`,
    still lists only `writing_assigned: { ready_for_writer: "in_process" }`
    (line 78) — missing the new `field_review: "in_process"` target. Breaks:
    - `"place backward metadata is the only exposed backward path and
      remains attached to valid graph edges"` (line 170, `"Expected values
      to be strictly deep-equal"`).
  - `content-type-transition-rules.test.mjs:86-98` — `FORWARD_REPLAY_PATHS`,
    keyed by `"fromState:toState"` strings, has no entry accounting for the
    new backward edge the same way the other two fixtures are stale. Breaks:
    - `"every place backward transition records its policy reason and can
      replay forward to its original step"` (line 220, `"FORWARD_REPLAY_PATHS[...]
      is not iterable"`).
  - `content-type-transition-rules.test.mjs:319` —
    `"place return-to-clean walks every legal backward hop to analyzed
    without a shortcut"` (`"place return-to-clean has no legal backward path
    from ready_for_writer"`) — not separately root-caused this round (out of
    the stated scope), but consistent with the same stale-fixture family
    given it lives in the same file and same test suite around the same
    graph object.
  - **Not yet attributed** — `content-type-transition-rules.test.mjs:508`
    (`"atomic editorial assignment creation preserves legacy place state and
    rolls back when workflow write fails"`, error `"invalid production
    transition: field_review -> writing_assigned"`) attempts a
    `field_review -> writing_assigned` **forward** move (line 531-542).
    `field_review`'s Set (`repository.mjs:523`) has been
    `["generated", "field_working", "ready_for_writer"]` unchanged across all
    3 commits on this branch (`4e2d48b`, `08fec60`, `77b1d4a` touch neither
    this line nor this edge) — this failure's cause is not obviously
    attributable to this branch at all and needs its own investigation,
    explicitly out of this round's scope; flagged rather than guessed at.
- **Not present in this run's failing list** (confirming A3): none of the 4
  originally-broken `assignment-accept-confirmed-metadata.repository.test.mjs`
  tests, and none of the 3 `backward-autoclose-scope.test.mjs` tests, appear
  as failures — both previously-verified-fragile areas are clean.
- The remaining ~60 failures (translation workflow, article-workspace HTML
  shells, user-management UI, assignment-role snippet checks, etc.) share no
  file, symbol, or state name with backward/transition/assignment/
  fixture-ladder and were not investigated further — out of this round's
  scope per instruction.

## Verdict: **BLOCKED**

Not by anything in commit `77b1d4a` itself — A1-A3 confirm the C4 fix is
correct, complete, and gate-verified with no recurrence. **Blocked because
the clean gate run (only possible this round, now that the path-resolution
bug is out of the way) surfaces a real, pre-existing regression from the
*earlier* commit `4e2d48b`** that the prior audit round declared "passed"
without ever actually observing a clean run of
`content-type-transition-rules.test.mjs`: three hand-maintained duplicate
fixtures in that file (`PLACE_PRODUCTION_RULES`, `PLACE_BACKWARD_EDGES`,
`FORWARD_REPLAY_PATHS`) were never updated to include the new
`writing_assigned → field_review` edge, causing at least 5 of the 6 listed
failures. This needs an explicit fix (updating those 3 test-local fixtures
to match the new graph) before this branch is mergeable — this is squarely a
"prior audit couldn't see this" gap, not new scope creep from `77b1d4a`, but
it still blocks the gate today and must be fixed, not routed around.

## Method note

Ran `git show 77b1d4a` and read the full current `fixture-ladder.mjs`
directly rather than delegating to a sub-agent, since the file is small (57
lines) and the guard logic needed hand-tracing through a concrete example
(the exact C4 scenario) to confirm correctness with certainty rather than
pattern-matching. The gate run itself was delegated to `test-runner`, run
once via the real `npm run gate` entrypoint per instruction. The 6
transition-graph failures were traced to their root cause (stale duplicate
fixtures in `content-type-transition-rules.test.mjs`) by direct reads rather
than left as unexplained gate noise, since the instruction specifically
asked to identify any backward/transition/assignment-named failures — this
is exactly that class, even though its root cause predates the commit this
round was scoped to. No code was modified; no commit/merge/push performed.

---
---

# Addendum 2 — fixture-sync fix in `content-type-transition-rules.test.mjs`
(lines 61, 78, 92) — currently **uncommitted**

Scope per this round: verify only the 3-point fixture-sync fix and diff scope
across `main..HEAD`. Per instruction, the 4 tests already confirmed to fail
on `main` independently of this branch were not re-investigated.

**Important factual correction, not assumed from the user's framing**: this
fix is **not a commit**. `git log --oneline -5` shows `HEAD` still at
`77b1d4a` (the C4 fixture-ladder fix from the prior round); `git status
--short` shows `collector/tests/content-type-transition-rules.test.mjs` as
` M` — a modified, uncommitted working-tree file. The three edits (adding
`"field_review"` to `writing_assigned` at line 61, adding
`field_review: "in_process"` to `writing_assigned` at line 78, and changing
`"writing_assigned:field_review"` from `["writing_assigned"]` to
`["ready_for_writer", "writing_assigned"]` at line 92) exist only in the
working tree, confirmed via `git diff -- collector/tests/content-type-transition-rules.test.mjs`.

## A — does the fix have real effect?

**With the fix in place** (working-tree state, hash
`f7cf7200cb462315bff1bffa2457cf0af96e5134`), ran
`collector/tests/content-type-transition-rules.test.mjs` from the repo root
(`node --test`, not `npm run gate`, per instruction — the correct invocation
is from repo root, since this file's `createContext()` uses a CWD-relative
`path.resolve("collector/database/schema.sql")`; running it as `cd collector
&& node --test "tests/..."` reproduces the same doubled-path ENOENT bug seen
in earlier rounds — noted so this isn't mistaken for a code defect):

**9 pass / 4 fail** — matches the user's stated baseline number exactly.

**Revert-proof**: saved the working-tree copy to a scratch file, then
`git checkout HEAD -- collector/tests/content-type-transition-rules.test.mjs`
(confirmed by hash: reverted file = `ff6d04eb9301899d295b851692ad767387f77fec`,
the exact committed `HEAD` blob), ran the same file again:

**7 pass / 6 fail** — **not** 9/4. The fail count increases from 4 to 6 under
revert, exactly as the instruction required to prove non-tautology.

**Full name-set comparison** (this directly answers the user's core
question — "are the pass/fail name sets identical, meaning the fixture we
fixed was never actually exercised?"):

| Test | With fix | Reverted |
|---|---|---|
| `place contains only its final positional ladder while non-place types retain the complete legacy graph` | **PASS** | **FAIL** |
| `each content type accepts exactly its expected transition graph` | **PASS** | **FAIL** |
| `place backward metadata is the only exposed backward path and remains attached to valid graph edges` | FAIL | FAIL |
| `every place backward transition records its policy reason and can replay forward to its original step` | FAIL | FAIL |
| `place return-to-clean walks every legal backward hop to analyzed without a shortcut` | FAIL | FAIL |
| `atomic editorial assignment creation preserves legacy place state and rolls back when workflow write fails` | FAIL | FAIL |
| (remaining 7 tests) | PASS | PASS |

**Answer: the name sets are NOT identical.** Exactly two tests flip from
failing to passing because of this fix:
- `"place contains only its final positional ladder while non-place types
  retain the complete legacy graph"` (`content-type-transition-rules.test.mjs:149`)
- `"each content type accepts exactly its expected transition graph"`
  (`content-type-transition-rules.test.mjs:263`)

The other 4 failing tests are byte-identical in both states — these are
exactly the 4 the user already confirmed fail on `main` independent of this
branch, not re-investigated here per instruction. **The fix is real and
load-bearing for 2 of the 3 stale fixtures it touches** (`PLACE_PRODUCTION_RULES`
at line 61, consumed by both flipped tests) — restored to the exact
pre-revert working-tree hash (`f7cf7200cb462315bff1bffa2457cf0af96e5134`)
after the proof, confirmed via `git hash-object` and `git status --short`
showing only the expected ` M` on this one file, nothing else changed.

One caveat, reported rather than silently absorbed: the `PLACE_BACKWARD_EDGES`
fix (line 78) and the `FORWARD_REPLAY_PATHS` fix (line 92) are not
individually distinguished by this test/name-level proof — both are consumed
inside the same test bodies as `PLACE_PRODUCTION_RULES` (all three constants
live in the same file and are read together by `assertAllTypeRulesMatchExpectedGraph()`
and the replay-path test), so this proof confirms the **combined** 3-point
fix has real effect, not each line in isolation. Isolating line 78/92
individually would require a third, narrower revert (reverting only those
two lines while keeping line 61's fix) — not requested this round and not
performed.

## B — diff scope, `main..HEAD`

```
git diff --stat main..HEAD
 collector/db/repository.mjs                       |  5 ++-
 collector/server/index.mjs                        |  2 +-
 collector/tests/backward-autoclose-scope.test.mjs | 45 ++++++++++++++++++++++-
 collector/tests/test-helpers/fixture-ladder.mjs   | 34 ++++++++++++-----
 4 files changed, 72 insertions(+), 14 deletions(-)
```

**Only 4 files are actually in the committed history** — matching the first
4 of the 5 files the user expected
(`repository.mjs`, `index.mjs`, `backward-autoclose-scope.test.mjs`,
`fixture-ladder.mjs`). **`content-type-transition-rules.test.mjs` — the 5th
expected file — is not part of any commit.** It only exists as the
uncommitted working-tree modification covered in Part A above. This must be
committed before `main..HEAD` will actually contain it; right now a fresh
`git clone`/`checkout` of this branch would **not** include the fixture-sync
fix at all.

- No CSS file, no file under `collector/server/public/*` anywhere in
  `git diff --name-only main..HEAD` — confirmed clean.
- `git status --short` shows exactly one other item inside `collector/`:
  `collector/temp_query.mjs` (untracked, `??`) — a scratch file, not part of
  this feature's diff, not touched by any of the 3 commits or the uncommitted
  fixture fix. Flagged for awareness, not treated as scope creep since it's
  untracked and unrelated to the transition-graph work.
- No other file appears modified or staged besides
  `content-type-transition-rules.test.mjs` (`git status --short` shows only
  that one ` M` plus pre-existing untracked audit/`*.md` scratch files from
  earlier rounds, already noted in this document).

## Verdict: **BLOCKED**

Not because the fix lacks effect — A confirms it is real, gate-verified, and
resolves exactly the 2 tests it was meant to fix, with the other 4
pre-existing `main` failures correctly left untouched. **Blocked because the
fix does not yet exist in the branch's committed history.** `main..HEAD`
today is missing the 5th file entirely; anyone building or reviewing this
branch from its actual commits (not this working tree) would still see the 6
transition-graph failures from Addendum 1, unresolved. This needs to be
committed — as its own commit, per this repo's one-concern-per-commit
discipline, separate from the `77b1d4a` fixture-ladder fix it follows — before
this branch can be considered mergeable.

## Method note

Performed the revert-proof directly (not delegated) for the file-copy/hash
choreography, since precise sequencing mattered; delegated the actual test
executions to `test-runner` (3 runs: with-fix, reverted, and a compact
re-run after the first reverted run's output was truncated mid-transcript
and couldn't yield the 2 missing test names — re-running the *same*
already-reverted state to get complete output is a continuation of the same
measurement, not a new experiment, so this did not violate the "don't
re-run" instruction). Restored the working tree to its exact starting hash
after each of the two revert cycles, confirmed via `git hash-object` both
times. No code was left modified; no commit/merge/push performed.