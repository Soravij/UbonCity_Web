# Runtime deploy: e59a1da — 5B round 2 + crawl merge hotfix

Deployment date: 2026-08-03 (Asia/Bangkok).  Repository runtime worktree:
`D:\UbonRuntime\repos\UbonCity_Web`.  Target:
`e59a1dae7b69f3523089fa7c0cc151439b866f7e` from starting commit
`5a0de7b22a9209ca3e2488d2b6bbe1dbfcfc8f7b`.

No migration, DDL, code change, merge, rebase, branch deletion, stash deletion, or push of
the deployment branch was performed.  The only permitted push was the existing audit branch
preflight push in step 0.5.

## Step 0 — preflight

Commands:

```powershell
git status --short --branch
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git log --oneline --branches --not --remotes
git branch --list --no-color "fix/restore-cta-upstream" "fix/cta-article-confirmation-gate" "fix/raw-external-asset-workflow" "fix/translation-source-fingerprint-stale-gate" "codex/taxonomy-review-ui" "runtime-audit/2026-08-02"
git stash list
```

Initial preflight stopped correctly because `git log --branches --not --remotes` contained
the local-only runtime-audit report chain.  The current branch was `dev` at `5a0de7b`; the
worktree was clean.  All five protected branches, `runtime-audit/2026-08-02`, and both stashes
were present.

## Step 0.5 — backup local audit commits

Command:

```powershell
git push origin runtime-audit/2026-08-02
```

**PASS.**  Only this branch was pushed.  Remote and local both resolved to
`8fa211ed80f5b0424727d6a00808702cbdc3d6dc`; the remote accepted
`00241a8..8fa211e`.  Re-running `git log --branches --not --remotes` produced no output.

## Step 0.6 — reset-point confirmation

Commands:

```powershell
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-parse origin/dev
git rev-parse origin/main
```

**PASS.**  `dev` was at `5a0de7b22a9209ca3e2488d2b6bbe1dbfcfc8f7b`; both
`origin/dev` and `origin/main` were
`e59a1dae7b69f3523089fa7c0cc151439b866f7e`.

## Step 1 — stop service

The operator stopped cloudflared, admin, frontend, collector, and backend.  I did not issue
any taskkill/stop command.

Verification command:

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 5070,5000 }
```

**PASS.** Output: `NO_LISTENERS_5070_5000`.

## Step 2 — collector DB backup

Before backup, `collector.db-wal` and `collector.db-shm` were absent and no process command
line referenced this repository/DB.  Therefore a normal copy was safe; SQLite `.backup` was
not needed.

Commands:

```powershell
Copy-Item D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db D:\UbonRuntime\backups\collector-db\collector-20260803-pre-e59a1da-from-5a0de7b.db
Get-FileHash -Algorithm SHA256 <source>,<backup>
Get-Item <source>,<backup>
```

**PASS.**

| Check | Source | Backup |
| --- | --- | --- |
| Path | `collector/data/collector.db` | `D:\UbonRuntime\backups\collector-db\collector-20260803-pre-e59a1da-from-5a0de7b.db` |
| Bytes | 1,560,576 | 1,560,576 |
| SHA-256 | `878C644677D778CCC2DA0EFB06FC62CFD2902038EFBA9E3D123855E96F90E516` | identical |
| `PRAGMA integrity_check` | `ok` | `ok` |
| `content_items` rows | 9 | 9 |
| `content_workflow_models` rows | 9 | 9 |
| `content_workflow_transitions` rows | 46 | 46 |
| `field_packs` rows | 2 | 2 |
| `content_assignments` rows | 4 | 4 |

## Step 3 — pre-pull database snapshot

Read-only SQLite queries checked non-deleted items, total workflow transitions, the
`production_state/publication_state` distribution, and `PRAGMA table_info(content_items)`.

| Metric | Before pull |
| --- | --- |
| Non-deleted items | 9 |
| Workflow transitions | 46 |
| Workflow-head distribution | `analyzed / draft` = 9 |
| `content_items.workflow_status` | present: `TEXT NOT NULL DEFAULT 'raw'` (cid 21) |

## Step 4 — pull

Command:

```powershell
git pull --ff-only origin dev
git rev-parse HEAD
```

**PASS.**  Git fast-forwarded `5a0de7b..e59a1da`; HEAD became
`e59a1dae7b69f3523089fa7c0cc151439b866f7e`.  No merge or rebase was used.

## Step 5 — dependencies

Command:

```powershell
git diff 5a0de7b..HEAD --stat -- package-lock.json collector/package-lock.json
```

**PASS.**  The command produced no output: neither lockfile changed.  `npm install` was not
needed and was not run.

## Step 6 — post-pull database snapshot

The exact read-only query set from step 3 was re-run.

| Metric | Before pull | After pull |
| --- | --- | --- |
| Non-deleted items | 9 | 9 |
| Workflow transitions | 46 | 46 |
| Workflow-head distribution | `analyzed / draft` = 9 | `analyzed / draft` = 9 |
| `content_items.workflow_status` | present, `TEXT NOT NULL DEFAULT 'raw'` | identical |

**PASS.** All values match; pull did not alter runtime data.

## Step 7 — service start and verification

The operator started backend and Collector; I did not start either service.

Commands:

```powershell
Invoke-WebRequest http://127.0.0.1:5070/api/health
Invoke-WebRequest http://127.0.0.1:5000/api/health
Get-Content runtime/test-stack/logs/collector.out.log,collector.err.log,backend.out.log,backend.err.log -Tail 80
```

**PASS.**

| Endpoint | HTTP | Full response |
| --- | --- | --- |
| `http://127.0.0.1:5070/api/health` | 200 | `{"ok":true,"service":"collector-app","database":{"engine":"sqlite","path":"D:\\UbonRuntime\\repos\\UbonCity_Web\\collector\\data\\collector.db"}}` |
| `http://127.0.0.1:5000/api/health` | 200 | `{"ok":true,"service":"backend","database":{"engine":"mysql","name":"uboncity"}}` |

Collector boot log: `Collector app running on http://127.0.0.1:5070`.
Backend boot log: `Server running on port 5000`.
Both error logs were empty.  The only Collector stderr entry was Node's experimental SQLite
warning; no missing-column error, schema assertion, or boot error was present.

## Final state

Runtime `dev` is deployed at `e59a1dae7b69f3523089fa7c0cc151439b866f7e`, both health checks
pass, and the pre-deploy verified backup is retained at the path recorded above.
