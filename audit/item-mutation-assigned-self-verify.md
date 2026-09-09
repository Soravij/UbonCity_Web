# Diff verification — `fix/item-mutation-assigned-self` @ `1f6df72`

Verification-mode audit of `git diff main..1f6df72`. Follow-up to finding **F1** in
`audit/role-matrix-verify.md`. Read-only except the sanctioned revert-proof in §5
(reverted in working tree, test run, restored, tree confirmed clean).

`git show --stat 1f6df72`: 2 files — `collector/server/index.mjs` (+5/-5),
`collector/tests/item-mutation-assigned-self.test.mjs` (new, 320 lines).

---

## 1. The 5 code changes — all intentional, nothing more, nothing less

`git grep -c "ensureItemMutationAccess(" collector/server/index.mjs` → **38** (1 definition
`:4158` + 37 call sites). The diff adds `{ allowAssignedSelf: true }` to exactly 5 of them:

| index.mjs line | Enclosing route / function | Route decl | Role list |
|---|---|---|---|
| `:4476` | `function ensureComposerMediaEditAccess` — feeds `POST /api/assets/upload` (`:14718`) + `POST /api/assets/register` (`:15373`) | — | `owner,admin,editor,user` |
| `:13112` | `PATCH /api/items/:id/reference-media/:referenceMediaId/selected` | `:13099` | `owner,admin,editor,user,freelance` |
| `:13587` | `PATCH /api/items/:id/assets/:assetId/selected` | `:13573` | `owner,admin,editor,user` |
| `:13624` | `PATCH /api/items/:id/assets/:assetId/role` | `:13610` | `owner,admin,editor,user` |
| `:13664` | `PATCH /api/items/:id/assets/:assetId/caption` | `:13652` | `owner,admin,editor,user` |

Each edited line is the access gate at the top of the named handler (confirmed by reading
`:13095-13115`, `:13570-13592`, `:13648-13668`, `:4473-4478`). This is exactly the F1 route
set (5 edit points cover all 6 F1 routes — `upload`/`register` share `ensureComposerMediaEditAccess`).
**No scope creep.** `ensureItemMutationAccess` definition (`:4158-4171`) unchanged.

## 2. Other 32 call sites untouched; no unintended option bleed

`git grep -n "ensureItemMutationAccess(" collector/server/index.mjs` — the remaining **32**
call sites (37 − 5) all read `ensureItemMutationAccess(req, res, item)` / `(req, res, current)`
with **no 4th argument** (verified full list). The diff's only `index.mjs` hunks are the 5 above.

No unintended effect from the new option object: for the admin/user branch,
`ensureItemMutationAccess` passes `options` on to
`canMutateItemByManagementLine(req.authUser, item, options)` (`:4163`), which reads
`mutationOptions.allowSelf === true` (`:3845`) — a **different key** from `allowAssignedSelf`.
So `allowSelf` stays `false`; admin/user behaviour is unchanged. The key-name divergence is
deliberate and correct.

## 3. `hasEditorialAssignmentEditAccess` / `hasEditorialAssignmentAccess` — untouched

`git show 1f6df72 -- collector/server/index.mjs | grep hasEditorialAssignment` → no matches.
Definitions at `:4141-4156` are outside every diff hunk. Confirmed unmodified.

## 4. The test does NOT exercise the 5 changed lines — all direct calls

`collector/tests/item-mutation-assigned-self.test.mjs`:

- `:14` reads `server/index.mjs` as **text** (`fs.readFileSync`).
- `:18-31` `extractFunction()` — brace-matches a function body out of that text.
- `:60-62` extracts the **source text of the 3 function definitions**
  (`hasEditorialAssignmentAccess`, `hasEditorialAssignmentEditAccess`,
  `ensureItemMutationAccess`) — none of which the diff changed.
- `:84-90` `vm.runInNewContext(...)` compiles those 3 definitions in an isolated sandbox.
- `:92-95` returns the sandboxed `ensureItemMutationAccess`.
- Every subtest (`:182, :204, :224, :244, :264, :281, :300`) calls that function **directly**,
  supplying `{ allowAssignedSelf: true }` itself (e.g. `:193, :215, :236, :258, :278, :291`).
  The one exception (`:300` "dead code fix verification") calls it with **no option** and
  asserts `false`/403.
- **No `import` of the Express app, no route, no HTTP, no supertest.**

**Decisive lines: `:62` (extracts the unchanged definition) + `:193` et al. (test passes the
option by hand).** The 5 lines the commit changed are call sites in route handlers — the test
never reaches them. **Answer: YES, all direct calls; reverting the 5 lines cannot change this
test's result.**

## 5. Revert proof

Runner note: this test resolves `schema.sql` via `path.resolve("collector/database/schema.sql")`
(`:101`) — cwd-relative, so it must run from the **repo root** (like `scripts/testAll.mjs`
enforces), not from `collector/`. From `collector/` it fails 8/8 with
`ENOENT ...collector/collector/database/schema.sql` (see finding **V1**).

Run from repo root, `node --test "collector/tests/item-mutation-assigned-self.test.mjs"`:

| Working tree | Result |
|---|---|
| `1f6df72` as-is (fix present) — baseline | `# tests 8 / # pass 8 / # fail 0` |
| 5-line fix **reverse-applied** (`git apply -R`) | `# tests 8 / # pass 8 / # fail 0` |

**Identical. The test does not catch the F1 regression.** With the fix reverted, editors are
once again 403'd on all 6 routes at runtime, yet the test stays green.

Restore verified: `git apply` (forward) → `git grep "allowAssignedSelf: true"` shows all 5
lines back · `git diff` empty · `git status --short` shows only the untracked
`audit/role-matrix-verify.md` · `HEAD = 1f6df72`.

## 6. Fixtures — own, prefixed, cleaned; but on a throwaway DB

- `:16` `TEST_PREFIX = "__test-mutation-access-"`.
- `:98-101` each `createContext()` opens a **fresh temp SQLite DB**
  (`fs.mkdtempSync` + `openDatabase`) — never `collector/data/collector.db`.
- `:108-117` `createUser` — `INSERT INTO users`, email
  `__test-mutation-access-<suffix>-<Date.now()>@local.test` (own row, prefixed, unique per run).
- `:119-130` `createItem` — `repo.createItemWithWorkflowHead`, title `__test-mutation-access-<t>`.
- No existing rows are read or reused.
- `:154-175` `cleanup()` — deletes tracked assignment/item/user ids, then re-queries leftovers
  (`content_items.title LIKE ? ESCAPE '\'`, `users.email LIKE ? ESCAPE '\'`), then `db.close()`
  + `fs.rmSync(tempDir, {recursive:true,force:true})`. Every subtest asserts `leftover === 0`
  (`:200, :221, :241, :261, :281?, :296, :316`).
- Because the DB is disposable, the cleanup is belt-and-braces; the real isolation is the
  temp DB.

## 7. Leftover in the Runtime collector DB (`collector/data/collector.db`)

Read-only query (`LIKE ? ESCAPE '\'`, patterns `\_\_test-%` and `\_\_test-mutation-access-%`):

| Table / filter | Count |
|---|---|
| `content_items` (title\|item_uid) LIKE `__test-%` | **0** |
| `content_items` LIKE `__test-mutation-access-%` | **0** |
| `content_assignments` where item is a `__test-` item | **0** |
| `content_assignments` (assignee_name\|assignment_uid) LIKE `__test-%` | **0** |
| `users` email LIKE `__test-%` | **0** |
| `users` email LIKE `__test-mutation-access-%` | **0** |

Zero leftover — expected, since the test only ever writes to temp DBs it then deletes.

---

## Findings

### V1 — test file uses a cwd-relative `schema.sql` path (minor; CLAUDE.md working-agreement violation)

`collector/tests/item-mutation-assigned-self.test.mjs:101`:
`openDatabase(dbPath, path.resolve("collector/database/schema.sql"))` — resolves against
`process.cwd()`, so the test only runs from the repo root and fails from `collector/`.
The file already computes `root` from `import.meta.url` at `:13`; `:101` should be
`path.join(root, "database", "schema.sql")`. CLAUDE.md: "Resolve paths from `import.meta.url`
… don't reintroduce absolute paths when adding new tests." Matches an existing bad pattern in
~6 other tests (named in `scripts/testAll.mjs` header comment), so it does run green under
`npm run test:all`, but it is a fresh instance of the thing the working agreement forbids.

### V2 — the new test does not guard the regression it was added for (the point of §5)

The test verifies the `ensureItemMutationAccess` **definition** behaves correctly when handed
`{ allowAssignedSelf: true }` — which was already true before `1f6df72` (the definition was
never broken; it was dead only because no call site passed the option). It asserts nothing
about the 5 call sites the fix actually changed. Reverting the fix → test still 8/8 green
(proven). A regression guard would need a route-level test (an editor with an active editorial
assignment gets non-403 from `PATCH /api/items/:id/assets/:assetId/role`, and a 403 once the
option is removed) — e.g. via the app + a supertest-style call, matching the pattern in
`audit/submission-endpoint-test-pattern.md`.

### Not addressed by this branch (out of scope, still open from `role-matrix-verify.md`)

- **F2** — editor `article-process/submit-review` double bind (`index.mjs:4240-4246` vs `:9445-9451`).
- **F3** — field-pack return-to-clean orphans an active editorial assignment.
- **F6** — admin/user self-claim mutation gap (needs runtime confirm).

---

## Verdict

- **5 changed points: exactly as intended.** Minimal, correct, cover the whole F1 route set,
  no side effects on other roles or the other 32 call sites. F1 is resolved in the code.
- **Test does NOT catch the regression** (revert proof: 8/8 pass both ways).
- **Leftover: 0** in every checked table.
- **Ready to merge?** The *code fix* is clean and complete for F1. Two caveats for the merge
  decision: (a) V2 — no true regression guard; the test is close to a tautology. (b) V1 —
  cwd-relative path (minor). Neither is a correctness risk in the shipped code. If a
  route-level regression test is wanted before merge, that is one more small commit on this
  branch; otherwise the fix itself is safe to merge. Not merging on my own initiative — Sor's call.
