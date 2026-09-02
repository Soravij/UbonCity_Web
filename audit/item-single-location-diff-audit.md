# Audit — diff `main..5eeba64` (branch `fix/item-single-location`)

- Machine: Runtime `D:\UbonRuntime\repos\UbonCity_Web` — HEAD = `5eeba64` (branch checked out), working tree clean (tracked files)
- Mode: READ-ONLY. No code change committed. Two temporary single-line reverts for A4 were applied then restored; HEAD + tree verified clean afterwards.
- Did NOT run: `npm run gate`, `npm run test:all`. Ran only the individual test files named in A4/A5.
- Sub-agents: `audit-scanner` (Layer 1, done), `audit-deep-reasoner` (Layer 2, 3 candidates, done)
- DB: `collector/data/collector.db` (readOnly) — 33 items, owner under test = user id 2 (`soravij88@gmail.com`)
- Diff subject: enforce PROJECT_POLICY.md:569 "an item must appear in exactly one place system-wide"

---

## A1 — files touched / scope creep

`git diff --name-status main..5eeba64` = **4 files**:

| file | change |
|------|--------|
| `PROJECT_POLICY.md` | +1 line (`:569`) |
| `collector/server/index.mjs` | +`dropDuplicateManagedAssignments` (`:3621-3633`); 2 wrap-calls in `buildManagedAssignmentsForActor` (`:3703`, `:3713`); 2 `.filter` in `/api/assignments/mine` (`:10934`, `:10940`) |
| `collector/server/public/app.js` | +`ADVANCED_PRODUCTION_STATES` set (`:759-764`) + short-circuit (`:806`); +anomaly status label in `buildRawQueueStatusLabel` (`:5186-5189`) |
| `collector/tests/item-single-location.test.mjs` | new file, 148 lines |

Matches "3 files + PROJECT_POLICY.md". **`repository.mjs` not touched** (UI/label + endpoint-filter patch only — respects patch discipline).

Protected functions — **none touched by any hunk** (verified against raw diff):
- `dropClosedAssignments` `index.mjs:3614-3619`
- `buildActionableAssignmentsForActor` `index.mjs:3635`
- `buildSubmittedAssignmentsForActor` `index.mjs:3655`
- `buildReviewAssignmentsForActor` `index.mjs:3676`
- `resolveItemScopeContext` `index.mjs:4006`

Minor scope notes:
- **F1** `PROJECT_POLICY.md:569` added to the **English** "Rework Round (locked)" list only. The Thai counterpart list (rule 568 → Thai `:586`) got **no** matching line → bilingual drift in a *locked* section.
- **F2** rule 569 is worded system-wide ("system-wide", "the in-flight diagnostic table") but is filed under a section scoped to field rework rounds.

## A2 — `buildManagedAssignmentsForActor` return paths (`index.mjs:3701-3721`)

**4 `return` statements:**

| line | returns | wrapped in `dropDuplicateManagedAssignments`? |
|------|---------|-----------------------------------------------|
| `:3703` | owner: `dropDuplicateManagedAssignments(dropClosedAssignments(repo.listAssignments(limit)), actorUserId)` | ✅ |
| `:3706` | `[]` (role ∉ {admin,user}) | ❌ — literal `[]`, equivalent to `dropDuplicateManagedAssignments([])` |
| `:3710` | `[]` (empty scope) | ❌ — literal `[]`, equivalent |
| `:3713` | admin/user: `dropDuplicateManagedAssignments(sortAssignmentsForList(dropClosedAssignments(filterAssignmentsByManagementLine(...))).slice(...), actorUserId)` | ✅ |

Every **non-empty** return path is wrapped. The two bare `return []` are not, but are provably equivalent.

Call sites `buildManagedAssignmentsForActor(` = `index.mjs:10901` (`scope=managed`) and `index.mjs:10945` (admin/user no-assignee). **Neither call-site line is in the diff.** `assignment-ui-scope.test.mjs:1521` / `:2724` assert the snippet `const assignments = buildManagedAssignmentsForActor(req.authUser?.id, authRole, limit);` exists — still present verbatim, untouched.

## A3 — filter scope

**`dropDuplicateManagedAssignments` (`index.mjs:3621-3633`)** removes an assignment iff:
- `assignment_kind === "field" && state === "accepted"`, OR
- `state ∈ {submitted, resubmitted}`, OR
- `Number(assignee_user_id) === Number(actorId)`

reads `state = assignment.state || assignment.assignment_state`, `kind = assignment.assignment_kind`.
**Note (F3):** `=== "accepted"` / `=== "field"` / `Set.has(state)` are **case-sensitive, un-trimmed**, unlike `dropClosedAssignments` which does `.trim().toLowerCase()`. DB enums are lowercase so it works today; brittle if a caller ever passes mixed case.

**`/api/assignments/mine` default paths — `:10934` (freelance/editor), `:10940` (owner):**
both are exactly `.filter((a) => !(String(a?.assignment_kind||"") === "field" && String(a?.state||"").trim().toLowerCase() === "accepted"))`.
→ remove **only** field+accepted. **No** submitted/resubmitted removal, **no** `assignee` check, **no** `REVIEW_QUEUE_STATES` — confirmed nothing leaked from the managed helper into these paths.

**actionable / review / submitted lists:** no new `.filter` in the diff (`buildActionableAssignmentsForActor`, `buildSubmittedAssignmentsForActor`, `buildReviewAssignmentsForActor` and their handlers unchanged).

## A4 — revert proof (temporary, restored)

| # | revert | test | result | verdict |
|---|--------|------|--------|---------|
| ก | `index.mjs:3703` → `return dropClosedAssignments(repo.listAssignments(limit));` | `node --test tests/item-single-location.test.mjs` | **6/6 still pass** | **FAILURE — test does not cover the owner call site.** Tests 1-4 extract `dropDuplicateManagedAssignments` in isolation via `vm.Script`; tests 5-6 are `app.js resolveQueueBucket`. Nothing asserts `buildManagedAssignmentsForActor` actually invokes the dedup. |
| ข | `app.js:806` remove `if (ADVANCED_PRODUCTION_STATES.has(productionState)) return "unknown_workflow";` | same file | **5/6**, fails `writing_assigned + no open assignment + no field pack → unknown_workflow` | **PASS — test covers this call site.** |

Restore verified: `git rev-parse HEAD` = `5eeba64ea48164273f35ab3d3adfcc38c8133e63`; `git status --porcelain` tracked files = clean (only pre-existing untracked `audit/*.md`, `.gate-summary.json`); `git diff --check` clean; `node --check` OK on both files.

## A5 — targeted regression (no gate)

Both test files are **byte-identical** between `main` and the branch (`git diff main..5eeba64` touches neither). Ran branch in place; ran `main` via `git worktree add` (no `git checkout` in the Runtime repo), worktree removed after.

| test file | main | branch | delta |
|-----------|------|--------|-------|
| `drop-closed-assignments.test.mjs` | 3 pass / 0 fail | 3 pass / 0 fail | none |
| `assignment-ui-scope.test.mjs` | 35 pass / 33 fail | 35 pass / 33 fail | **identical failing-test set** (sorted `not ok` name diff = empty) |

The 33 `assignment-ui-scope` failures are pre-existing and unrelated to this diff.

---

## DB simulation (static, `collector/data/collector.db`, owner = user 2) — not runtime-verified

### Items still appearing in >1 non-diagnostic place after the fix

- **Items 28 & 39** — each in both `scope=submitted` (`buildSubmittedAssignmentsForActor`, `index.mjs:3639`) and `scope=review` (`buildReviewAssignmentsForActor`, `index.mjs:3654`) output, because the owner is both the assignee (field#21 / editorial#39, `state=submitted`) and the global reviewer. Rendered in mutually-exclusive page modes (work vs review), but under rule 569's "system-wide" wording that is 2 places. **Pre-existing; not addressed** — the diff's dedup covers only the managed table.

### Regression — item 1 now appears in ZERO non-diagnostic places (audit-deep-reasoner: CONFIRMED)

- Item 1: only non-closed assignment = field#27 (`kind=field`, `state=accepted`, `assignee_user_id=2`); head `production_state=field_review` (rolled back from `ready_for_writer` by a legal backward transition), `current_field_pack_id=35` (`ready_for_field`).
- Pre-diff: visible to the owner in exactly one place — the managed assignments table (`dropClosedAssignments` keeps `accepted`).
- Post-diff:
  - `dropDuplicateManagedAssignments` drops it (`field&&accepted` **and** `assignee===actor`) → gone from `scope=managed`
  - `/api/assignments/mine` owner path `:10940` drops it (`field&&accepted`)
  - not in `scope=actionable` (states `{assigned,in_progress,revision_requested}`) / `submitted` / `review` (`{submitted,resubmitted}`)
  - `resolveQueueBucket` → `"assignment"` (`app.js:771`, `accepted ∈ OPEN_ASSIGNMENT_STATES` — `publishable-assignment-candidate.mjs:65`), which is reached **before** the handoff / field-pack branch, and bucket `"assignment"` is rendered by **no** dashboard queue
  - only remaining surface: the in-flight diagnostic table (`repository.mjs:4383`) — the policy's sanctioned exception
- Net: the diff reduces item 1 from one actionable place to zero — a rule-569 violation for the exact item class (accepted field round, no editorial assignment yet; same shape also present on item 39's field#29). Contrast: items 14/17/31/40 survive via `buildActionableAssignmentsForActor`.
- Root cause is partly structural / pre-existing (`hasOpenAssignment` guard at `app.js:771` blocks any `accepted`-primary item from the handoff bucket); the diff removes the compensating managed-table row without adding a fallback surface.

### Items 19, 20, 21, 22 → `unknown_workflow`

- **All four move** from the raw-intake table to the "⚠ สถานะผิดปกติ" (`table-raw-workflow-unknown`) sub-table via `app.js:806` (no field pack + no open assignment + advanced `production_state`).
  - 19 `generated`, 20 `field_review`, 21 `writing_assigned`, 22 `generated`
- **No other item is pulled in unintentionally.** Every other advanced-`production_state` item is intercepted earlier: open assignment → `"assignment"` (1, 25, 27, 28, 31, 39, 40) or field pack → `handoff` / `field_pack_review` (26, 29, 30, 32) or `completed` → `published` (23). `analyzed` is deliberately **not** in the set, so items 2-7, 16 stay in raw-intake.
- Soft spot (audit-deep-reasoner, adjacent): items **19 & 22** (`generated`, no field pack, no assignment) are arguably a normal "awaiting field-pack creation" wait state; they now render under an anomaly header — possible false-alarm noise. No test covers `generated` / `brief_generated`.

### Table row counts — before → after (owner = user 2)

| surface | source | before | after | delta |
|---------|--------|--------|-------|-------|
| `raw_prep` bucket (total) | `resolveQueueBucket` | 13 | 9 | −4 (19,20,21,22 leave) |
| — `table-raw-intake` | + `!(claimed && cleaned)` split | 12 | 8 | −4 |
| — `table-clean-prep` | `claimed && cleaned` (item 2 only) | 1 | 1 | 0 |
| `table-raw-workflow-unknown` | bucket `unknown_workflow` | 0 | 4 | +4 (19,20,21,22) |
| `assignments_managed` (`scope=managed`) | `buildManagedAssignmentsForActor(2,"owner")` | 14 | 4 | −10 |
| `assignments_work` (`scope=actionable`) | `buildActionableAssignmentsForActor(2)` | 4 | 4 | 0 (builder untouched) |

`assignments_managed` after = editorial#1 (item 3), editorial#4 (item 9), field#6 (item 25), editorial#9 (item 27) — the 10 removed = 3 field:accepted (#27/item1, #2/item9, #8/item27), 2 submitted (#21/item28, #39/item39), 4 assignee===owner (#5/item14, #12/item17, #25/item31, #30/item40), and field:accepted #29/item39.

---

## Layer-2 candidate verdicts

| candidate | verdict |
|-----------|---------|
| C1 — `ADVANCED_PRODUCTION_STATES` (`app.js:759-764` / `:806`) causes cross-bucket misrouting | **FALSE POSITIVE.** Line 806 is only reachable after the published / `hasOpenAssignment` / `hasFieldPack` returns, so it can only re-label an item that would otherwise be `raw_prep`. 5 of 13 set entries are dead (pre-empted at `app.js:774-784`); harmless. |
| C2 — dedup asymmetry `scope=managed` vs owner no-scope `/api/assignments/mine` | **FALSE POSITIVE (user-visible).** Real code asymmetry (`:3628-3630` vs `:10940`) but `buildAssignmentsMinePath` (`app.js:6296-6326`) never routes the owner to the no-scope path while the managed table is on screen; the no-scope owner list is not rendered as a table. Worth a cleanup comment, not a bug. |
| C3 — `dropDuplicateManagedAssignments` makes an item vanish | **CONFIRMED.** Item 1 (see regression above). |

---

## Summary of findings (ranked)

1. **[HIGH] Regression — item 1 disappears from every non-diagnostic surface** (`index.mjs:3621-3633` @ `:3703` + `:10940`, structural interaction with `app.js:771`). The diff removes the managed-table row for an accepted-field / no-editorial item without providing any fallback queue. Rule-569 violation for the class rule 569 targets.
2. **[MED] A4(ก) — `item-single-location.test.mjs` does not cover the `buildManagedAssignmentsForActor` wiring.** Reverting `index.mjs:3703` leaves all 6 tests green. The dedup helper is only tested in isolation.
3. **[LOW] F1 — `PROJECT_POLICY.md:569` added to the English list only**; Thai "Rework Round (locked)" list not updated → drift in a *locked* section.
4. **[LOW] Adjacent — `generated` / `brief_generated` items with no field pack + no assignment now render under the anomaly header** (items 19, 22). May be a legitimate wait state; no test coverage for those states.
5. **[LOW] F3 — `dropDuplicateManagedAssignments` string compares are case-sensitive / un-trimmed** unlike the sibling `dropClosedAssignments`. Not currently broken.
6. **[INFO] Rule 569 not fully enforced** — items 28 & 39 still appear in both the submitted and review builders (`index.mjs:3639` + `:3654`).
7. **[INFO] C2 asymmetry** — owner sees stricter filtering via `scope=managed` than via no-scope `/api/assignments/mine`; not user-visible today.

**Prior-audit coverage:** problem 1 (actionable∩managed overlap) ✅, problem 2 (field:accepted leak) ✅, problem 3 (items 19-22 wrong table) ✅, problem 6 (policy line) ✅ (English only). Problems 4 (assignment lists not reconciled with `production_state`) and 5 (`workflow_status` legacy column) — untouched, out of stated scope.
