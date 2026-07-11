# Project skills

- `audit/` — audits code against this repo's own `PROJECT_POLICY.md` / `PROJECT_STATE.md` contracts (root and per-component). Read-only, never commits/pushes.
- `implement/` — applies fixes for findings from `audit`, following this repo's `agent.md` engineering discipline.

Together these support the `audit -> implement -> audit -> implement` cycle used on this project.

`eval-defs/evals.json` holds the test prompts used to validate both skills (3 test cases, run with-skill vs. baseline via parallel subagents). Kept for re-running when either skill is revised.

## Known limitation: new/edited skills need a session restart

Project skills under `.claude/skills/<name>/SKILL.md` are enumerated once when a Claude Code session
starts. Creating or editing a `SKILL.md` mid-session does not make it discoverable via the `Skill` tool
until a new session begins — this was verified directly while building these two skills: invoking
`Skill` with `skill: "audit"` failed with `Unknown skill: audit` even from the very session, and same
process, that had just written the file, both from the main thread and from subagents spawned within
that session (which share the parent session's cached skill list rather than rescanning the directory).

This is not a bug in either skill's `SKILL.md` — both are correctly placed and formatted, and produced
good results when their instructions were read and followed manually during testing. If you add or edit
a skill here, **start a fresh `claude` session** before relying on the `Skill` tool to pick it up; don't
assume a missing "Unknown skill" error means the file itself is wrong.
