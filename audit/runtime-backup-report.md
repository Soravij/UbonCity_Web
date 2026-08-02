# Runtime backup report

Audit date: 2026-08-02. The only repository-file change in this task is this permitted audit report. No checkout, pull, merge, rebase, reset, stash apply/drop, branch deletion, ref deletion, force push, service start, or modification of the original Collector DB was performed.

## Part 1 — local-only Git work preserved

Before creating or pushing a backup ref, each exact remote destination was checked with `git ls-remote --heads origin refs/heads/<name>`. All seven destinations were absent. Each push used a full local SHA to a new `refs/heads/runtime-backup/...` destination; no existing remote branch was updated.

### Pushed refs and SHA verification

| New remote ref | Local SHA | Remote SHA | Verified equal |
|---|---|---|---|
| `runtime-backup/fix/restore-cta-upstream` | `675e673336c439a54d7d58651b8d6c86072ca06a` | `675e673336c439a54d7d58651b8d6c86072ca06a` | Yes |
| `runtime-backup/fix/cta-article-confirmation-gate` | `3fff4f588f59b9da130b971fb2dff9245a83b5c9` | `3fff4f588f59b9da130b971fb2dff9245a83b5c9` | Yes |
| `runtime-backup/fix/raw-external-asset-workflow` | `1e7201d2e55000dc57167ef3b04278685afb9895` | `1e7201d2e55000dc57167ef3b04278685afb9895` | Yes |
| `runtime-backup/fix/translation-source-fingerprint-stale-gate` | `4ef08a29cbfd7128b916600d7f20123e95107643` | `4ef08a29cbfd7128b916600d7f20123e95107643` | Yes |
| `runtime-backup/codex/taxonomy-review-ui` | `4118b12442a16e1351ec583866d5bcd950445615` | `4118b12442a16e1351ec583866d5bcd950445615` | Yes |
| `runtime-backup/stash-0` | `d6f7fd316bb2209ffc0e03495e972a74b80f82d0` | `d6f7fd316bb2209ffc0e03495e972a74b80f82d0` | Yes |
| `runtime-backup/stash-1` | `c208929fac8d7081dff608352468d5cc552647bb` | `c208929fac8d7081dff608352468d5cc552647bb` | Yes |

The two local stash backup branches were created additively and point to the existing stash commits. The original local branches were not renamed or deleted. The stash list remains unchanged:

```text
stash@{0}: On fix/translation-source-fingerprint-stale-gate: temp public home frontend fix
stash@{1}: On codex/collector-root-cache-busting: temp-before-pull
```

### `git log --oneline --branches --not --remotes`

Before push:

```text
675e673 Restore CTA upstream provenance handling
3fff4f5 Compact CTA and taxonomy confirmation surface
1e7201d Repair evidence media reference assets
fc91bac Restore clean reference thumbnails safely
9bae621 Send clean reference media to agent
f526ff7 Align clean reference media status badges
e4ecbfe Polish clean AI reference media UI
f0a3efc Fix clean mode asset workflow guard
ed82a87 Refine AI reference asset workflow
13a5ee2 Fix raw external asset workflow guardrails
4ef08a2 Ignore draft fallback homepage layout on public home
4118b12 feat: add taxonomy review UI
```

After push: **empty** (count: **0**).

## Part 2 — Collector database backup

Source: `D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db`

Destination: `D:\UbonRuntime\backups\collector-db\collector-20260802-111638.db`

### Copy safety check

- No listener was present on port **5070**.
- The recorded Collector supervisor PID **8532** was not alive.
- Windows Restart Manager was used to register the exact source path and query locking processes; it returned **0** locking processes.
- `collector.db-wal` was absent: **0 files**.
- `collector.db-shm` was absent: **0 files**.

Method: **plain file copy**. This was safe because Collector was stopped, Restart Manager found no process holding the source, and no WAL/SHM sidecar existed. SQLite `.backup` was therefore not required. The source was only read; its size before and after copying remained **48,476,160 bytes**.

### Copy verification

| Check | Source | Copy | Match |
|---|---:|---:|---|
| Byte size | 48,476,160 | 48,476,160 | Yes |
| SHA-256 | `BFC81E02D092599FFCE6B5D96286C23D21B5E04F8C7579BA3B3BF17BE829811D` | `BFC81E02D092599FFCE6B5D96286C23D21B5E04F8C7579BA3B3BF17BE829811D` | Yes |
| `PRAGMA integrity_check` | `ok` | `ok` | Yes |
| `content_items` | 52 | 52 | Yes |
| `content_workflow_models` | 52 | 52 | Yes |
| `content_assignments` | 34 | 34 | Yes |
| `audit_logs` | 36,730 | 36,730 | Yes |

## Part 3 — not copied in this task

| Path | Exists | Files | Size |
|---|---|---:|---:|
| `collector/media` | Yes | 235 | 1,591,789,519 bytes |
| `collector/raw` | Yes | 0 | 0 bytes |
| `backend/uploads` | Yes | 0 | 0 bytes |
| `collector/data/tmp-collector-test-token-user-role.json` | Yes | 1 | 579 bytes |
| `collector/data/tmp-collector-test-token.json` | Yes | 1 | 619 bytes |

No Part 3 path was copied or changed.
