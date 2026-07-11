---
name: audit
description: Audit UbonCity_Web code against this repo's own documented contracts (root and component-level PROJECT_POLICY.md / PROJECT_STATE.md), not generic best-practice review. Use this whenever the user says "audit", "ตรวจ project", "ตรวจทั้ง project", asks whether the code still matches policy/state docs, or wants to verify a diff just produced by the implement skill actually resolved prior findings. Prefer this over a generic code-review pass whenever policy/state documents exist for the area in scope.
---

# Audit (contract-vs-code)

This repo documents its own rules in `PROJECT_POLICY.md` (permanent contracts) and `PROJECT_STATE.md`
(current status/changelog), at root and per-component (`collector/`, `backend/`, `frontend/`, `admin/`
each have their own pair). `agent.md` documents the intended engineering workflow. Read whichever of
these apply to the requested scope before forming any finding — a finding is only worth reporting if
it's checked against what this project actually promises, not against generic conventions.

## Two modes — detect which one applies before starting

**Verification mode** — use this when there is a recent uncommitted diff in the working tree (check
`git status --short` / `git diff`) AND this conversation already produced audit findings earlier for
the same area. In this mode:
- Only check whether that diff actually resolves each prior finding (confirmed / partially / not addressed).
- Separately flag any *new* problem the diff itself introduces (a regression), scoped to the changed files and their direct callers — don't widen scope back out.
- Do not re-run a fresh full audit of the whole area; that throws away the point of a tight iteration loop.

**Discovery mode** — the default otherwise. Audit the requested scope fresh (a feature area, a file set,
a branch's diff against main, or the whole project if asked). Look for four distinct kinds of problem,
in this priority order:

1. **Contract violations** — code does something the applicable `PROJECT_POLICY.md` explicitly forbids, or contradicts a "locked" rule (e.g. this repo's CTA/taxonomy and media policies use the word "locked" for rules that must not silently drift).
2. **Stale/contradicted state** — `PROJECT_STATE.md` claims something (a branch name, a merge status, "pending", "complete") that current `git log` / the code itself contradicts.
3. **Broken doc links** — a `PROJECT_STATE.md` or `PROJECT_POLICY.md` reference to another file in the repo that doesn't exist.
4. **Undocumented contracts** — code enforces something as a hard rule (a gate, an invariant, a validation) with real consequences, but no policy doc mentions it at all. These are worth flagging even though nothing is "wrong" — an unwritten rule is a rule nobody else can maintain correctly.

## Boundaries (read before scoping the audit)

- **Never commit, push, or modify files.** This is a read-only pass. `PROJECT_POLICY.md` §7B requires
  explicit approval before any merge/commit/push, and this skill doesn't touch that boundary at all —
  it only reports.
- **No live Runtime data.** Runtime DB/test data exists only on the separate Runtime machine
  (`D:\UbonRuntime\repos\UbonCity_Web`), never locally. Do static/code-level analysis only. If the user
  has pasted live request/response or DB output into the conversation, you may use it as corroborating
  evidence, but don't assume anything about live state that wasn't actually shown to you.
- If the requested scope is genuinely "the whole project," say up front which components you're
  covering and in what order, since this repo has 5 subsystems (`frontend`, `backend`, `admin`,
  `collector`, root) each with their own policy/state pair — don't silently narrow scope without saying so.

## Reporting findings

Use the `ReportFindings` tool if it's available in this session (same shape the project's `code-review`
skill uses) so findings render consistently. If it isn't available, use a plain ranked list, most severe
first, each with: file:line, a one-line summary of the defect, and a concrete failure scenario (what
input/state leads to what wrong behavior). Rank contract violations and undocumented-but-enforced
contracts above cosmetic doc staleness — a broken link is real but low-stakes compared to code silently
violating a locked policy rule.

Don't fix anything in this pass, even a one-line typo — that's the `implement` skill's job on the next
turn of the audit → implement → audit → implement cycle this project runs.
