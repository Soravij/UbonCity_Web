---
name: implement
description: Apply fixes for issues found by this repo's own audit skill (or, run standalone, for whatever the user directly describes) following UbonCity_Web's own engineering discipline from agent.md and PROJECT_POLICY.md. Use this whenever the user says "implement", "fix", "แก้", or "ทำต่อ" right after an audit pass, or asks for a scoped code change in this repo. Prefer this over an unstructured edit whenever there's a prior audit finding list in this conversation to work from.
---

# Implement (fix from audit findings)

This is the write-code half of this project's `audit -> implement -> audit -> implement` cycle. If the
most recent turn in this conversation produced audit findings (from the `audit` skill or otherwise),
treat those as the work order — fix them, don't go looking for new problems (that's the next audit's
job). If there's no prior audit, work from whatever the user describes directly.

Read `agent.md` at the repo root before finalizing any patch — it's this repo's actual engineering
contract, not generic advice, and these rules come from it:

## Discipline (from agent.md)

- **1 issue = 1 patch.** Keep the diff single-purpose. Don't drag in unrelated refactors, renames, or
  mass formatting even if you notice something else nearby worth fixing — flag it instead of fixing it.
- **Run `node --check` on every touched `.js`/`.mjs` file**, and `git diff --check` before considering
  the change done. These are cheap and this repo expects them as a matter of course.
- **Commit message format** (only if/when the user actually asks you to commit — never commit or push
  on your own initiative; `PROJECT_POLICY.md` §7B requires explicit approval for that regardless of how
  confident the fix is): `fix(<scope>): <what>`, `chore(<scope>): <what>`, or `refactor(<scope>): <what>`.

## Where this repo's rule differs from what agent.md says for you specifically

agent.md's "stop and reassess if a change touches more than 3 files" rule was written for a smaller model
(DeepSeek via Continue) that genuinely loses coherence past a certain diff size — it does not describe a
risk that scales with file count for you. Let the diff be as large as the issue actually requires.

What *does* still deserve a pause — regardless of file count — is blast radius, not size: **stop and ask
the user explicitly before proceeding** if the change touches authentication/permission boundaries,
database migrations or schema changes, a public API contract, or data-integrity-sensitive logic. Those
are the same categories agent.md already escalates to Codex/human review for — the reasoning holds for
any model, because the cost of being wrong there is high regardless of who's writing the patch.

## Reporting back

After applying a fix, report:
- **Files changed**, and why this is the smallest change that actually addresses the finding.
- **Verification performed** — what you ran locally (`node --check`, targeted tests, manual trace through
  the code path). If the change touches auth, runtime flow, collector flow, or anything
  environment-specific, say explicitly that it still needs re-verification on the Runtime machine per
  agent.md's Main/Runtime machine split — don't imply local verification alone is sufficient for those.
- **Impact** — what behavior actually changes for a user/caller, in one or two sentences.

Don't write a summary longer than the fix itself. If the fix turns out to need more than a patch — a real
design decision, an ambiguous requirement, missing context about intended behavior — stop and say so
instead of guessing; that's exactly the kind of thing agent.md wants surfaced before continuing.
