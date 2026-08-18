# UbonCity_Web — working agreement for Claude Code

This file loads automatically at the start of every Claude Code session in this repo.
It exists because past sessions (via another agent) fixed one regression by breaking
another, repeatedly, on the Assignment Work flow. Read this before touching
`collector/server/public/app.js`, `collector/server/public/styles.css`, or
`collector/db/repository.mjs`.

## Environment
- Dev machine: `D:\UbonCity_Web`
- Runtime (24/7, pull-deployed): `D:\UbonRuntime\repos\UbonCity_Web`
- Tests must not hardcode either path. Resolve paths from `import.meta.url`. (14 test
  files under `collector/tests/` were fixed for this on 2026-07-10 — don't reintroduce
  absolute paths when adding new tests.)
- Test runner: `node --test "collector/tests/*.test.mjs"` (must be run from `collector/`)

## Assignment Work behavior contract
These behaviors must keep working across any change. If a change would affect one of
these, stop and say so before proceeding — do not silently fold it into an unrelated fix.

- Requested check renders as a single compact row
- CTA and Curation live in the same Assignment Work flow
- Save/Return works exactly as before
- Revision round shows round number and reason once round > 1
- Images and videos are split into previous-round (read-only) and current-round
  (upload/replace) buckets — never mixed
- Payload for one round never carries data from another round
- Draft save is never blocked by final-acceptance validation
- Final acceptance rejects malformed data

## Freeze rules — do not do these unless the task is explicitly about them
- Do not modify Save/Return handlers
- Do not modify API endpoints
- Do not modify payload structure/shape
- Do not create new CSS classes — reuse existing ones
- Do not refactor the renderer wholesale
- Do not rewrite `styles.css`
- Do not delete or weaken an existing test to make it pass

> Sanctioned exception (2026-08, branch `fix/pipeline-round-15aug`): the pageMode DOM
> split — separating `#panel-assignments` into `#assignment-panel-handoff` / `-work` /
> `-review` — was explicitly requested by Sor and necessarily breaks two of the freeze
> rules above (it adds the `.assignment-panel-mode` class and refactors the assignment
> renderer). This exception covers that migration only. See `audit/dom-split-plan.md`.
> Once the split is complete, the freeze rules apply again in full.

## Patch discipline
One concern per patch/commit. Before starting, name which single behavior you're
touching and which files that requires. If touching `app.js` for a UI fix also seems to
require touching `repository.mjs` for validation, that's two patches, not one — stop and
say so.

Suggested allowlists by concern:
- UI-only patch → `app.js`, `styles.css`, related `*.test.mjs`
- Validation-only patch → `repository.mjs`, related `*.repository.test.mjs`
- Do not mix UI and validation changes in the same patch.

## Before calling anything "done"
1. Run the full suite: `node --test "collector/tests/*.test.mjs"` from `collector/`
2. Confirm the failure count didn't go up vs. before your change (note the before/after
   pass count in your summary)
3. If a test fails and you believe it's a stale snippet-test (asserts on a literal
   line of source code rather than behavior), say so explicitly and propose rewriting it
   as a behavior test — do not delete it or edit it silently to pass.
4. Never claim a regression is fixed without having actually run the relevant test.

## Agents and skills (use these, not generic ones)
- Code audit → skill `audit` (discovery or verification mode).
  Pipeline: `audit-scanner` (Layer 1 triage) first, then pass only candidates with
  needs_deep_review=true to `audit-deep-reasoner` (Layer 2). Never skip Layer 1.
- Applying fixes → skill `implement`.
- Running tests → agent `test-runner` only. Do not run the suite ad hoc and interpret it yourself.
- Do not substitute a generic agent for these when the work qualifies.

## Work cycle
audit → implement → audit the diff → fix → browser verify (once, at the end).
- If a step has wide blast radius, audit before writing code, not after.
- Browser verification happens once after the fix lands — not alongside each audit pass.
- Work is driven from Runtime and verified on Runtime — audit, implement, commit, and
  push all happen there; Main cannot reach Runtime, so this isn't optional.
- Owner-managed on Runtime (agents must not run these; Sor runs them by hand): `git pull`
  / `git checkout` in `D:\UbonRuntime\repos\UbonCity_Web`, and starting/stopping/
  restarting the collector via `ops\windows\test-stack.ps1`. Everything else on
  Runtime — reading, editing, testing, committing, pushing — is normal agent work.

## Reporting rules
- Every claim needs a path:line citation. If something can't be found, write "not found" —
  never guess.
- Stop after 2 consecutive failures and report where you got stuck.
- Never merge to main on your own initiative.
- Verify with `node --check` on every touched .js/.mjs plus `git diff --check`.
- Report what actually happened, not what the diff implies. There has been at least one
  case of a commit message claiming an element was moved when it had not been —
  confirm the resulting state, don't infer it from the patch.
