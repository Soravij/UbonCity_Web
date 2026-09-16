---
name: verify
description: Procedure for verifying a UbonCity_Web change on Runtime via process check + Chrome DOM/console/network. Use for any verify step.
---
# Verify procedure

## Inputs (must be given in the prompt; if missing, stop and ask)
- URL (e.g. https://test.uboncity.com). Never change host. Never use localhost.
- Changed files list.
- Checks: DOM selectors / expected text or numbers / expected network status.

## Step 1 — Process freshness
- Get mtime of each changed file and StartTime of the running backend/collector process.
- If StartTime < newest mtime: STOP. Report "process older than code — Sor must restart". Do not restart it yourself.

## Step 2 — Measure (numbers/text only)
- DOM: javascript_tool querySelector / textContent / counts / computed style values.
- Console: errors only.
- Network: URL + status code.
- Do NOT judge visual appearance or "how it looks". That is Sor's job.

## Step 3 — Auth phases
- Never log in or log out. If a check needs a different auth state:
  report Phase-1 results, then STOP and write "รอ Sor ล็อกอิน/ออก". Resume only when told.

## Rules
- A command that fails twice → stop and report. No third variant.
- No tests, no npm run gate, no DB writes. No code edits, no commits.
- Dev has no real DB; DB numbers only on Runtime.

## Report format (short)
PROCESS: fresh|stale (mtime vs StartTime)
CHECK n: expected → actual → PASS|FAIL
CONSOLE: errors count (+ first message)
NETWORK: url status
BLOCKED: reason (if any)
