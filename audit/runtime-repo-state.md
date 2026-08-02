# Runtime repository and branch state

Audit date: 2026-08-02. Scope observed: `git fetch origin --prune` only; no pull, merge, rebase, checkout, reset, stash operation, branch deletion, or project-file edit was performed. This report is the permitted audit artifact.

## 1. Fetched divergence — mechanically derived

Commands run:

```text
git fetch origin --prune
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git merge-base HEAD origin/main
git rev-list --left-right --count origin/main...HEAD
git merge-base --is-ancestor HEAD origin/main
```

Results:

- Current branch: `codex/harden-runtime-smoke-target-guard`
- `HEAD`: `cacb737f459c6fb3f217193369319fce0e255b73`
- Fetched `origin/main`: `51796ecc57d0c9ce5dfd4dbd9c78614a16a5a25b`
- Merge base (`HEAD`, `origin/main`): `cacb737f459c6fb3f217193369319fce0e255b73` (the current HEAD)
- `git rev-list --left-right --count origin/main...HEAD`: **`17 0`**

For this command order, the first value is commits reachable only from the **left** side (`origin/main`), and the second is commits reachable only from the **right** side (`HEAD`). Therefore, **origin/main is ahead of this runtime HEAD by 17 commits; HEAD is ahead of origin/main by 0 commits.**

`git merge-base --is-ancestor HEAD origin/main` exited **0**. Thus, HEAD is an ancestor of `origin/main`: `codex/harden-runtime-smoke-target-guard` has already been merged.

## 2. Commits on origin/main missing from this working copy

`git log --oneline HEAD..origin/main`:

```text
51796ec merge: complete step 5A assignment-state mirror removal
1cad8ea docs(audit): preserve step5a mirror findings
b9211bc fix(collector): scope assignment supersession by kind
a6443dc fix(collector): retain latest closed assignment
e4b9917 fix(collector): unify current assignment acceptance
48057c1 refactor(collector): remove assignment state mirror
e05eb90 merge: Bug B publish sync
c571f1d fix(backend): reject non-positive-integer COLLECTOR_SYNC_TIMEOUT_MS values
1898d9a fix(collector): stop publish-sync contract test from reading a hardcoded absolute path
3ab337f Merge branch 'main' into codex/impl-bugb-publish-sync
0c1824b merge: harden runtime smoke target guard + deterministic test:all
136964e chore(tooling): add a deterministic npm run test:all and its baseline docs
e1d6ccd fix(backend): bound the pre-existing needs-revision Collector sync with a timeout
24c2210 fix(backend): bound Collector publish sync with a real request timeout
4651144 test: cover publish sync callbacks
d49946d fix(collector): scope publication pull status
cba21a8 feat: sync collector publication status
```

Count: **17**.

## 3. Local work not on any remote

Command used:

```text
git log --oneline --branches --not --remotes
```

There are **12** local commits reachable from local branches that are not reachable from any remote. They would be stranded by a checkout only insofar as their local branch refs are later removed; they are not on the current branch.

```text
675e673336c439a54d7d58651b8d6c86072ca06a | fix/restore-cta-upstream | Restore CTA upstream provenance handling
3fff4f588f59b9da130b971fb2dff9245a83b5c9 | fix/cta-article-confirmation-gate | Compact CTA and taxonomy confirmation surface
1e7201d2e55000dc57167ef3b04278685afb9895 | fix/raw-external-asset-workflow | Repair evidence media reference assets
fc91bacd7d3801a2f2f22fec058f06ed45d8d2eb | fix/raw-external-asset-workflow | Restore clean reference thumbnails safely
9bae621b5da22ef0a128e1f3c93c85754c68fb0a | fix/raw-external-asset-workflow | Send clean reference media to agent
f526ff713a35c5a7ad529e599128e3b71892737f | fix/raw-external-asset-workflow | Align clean reference media status badges
e4ecbfe7349f34b783042727fc54a4a958f3c7cc | fix/raw-external-asset-workflow | Polish clean AI reference media UI
f0a3efc382de19ad7e4b9cbc0411705df4a45b2a | fix/raw-external-asset-workflow | Fix clean mode asset workflow guard
ed82a874ef29e2152789779086485ec651893868 | fix/raw-external-asset-workflow | Refine AI reference asset workflow
13a5ee2d8cea868b0b11c58ab8869a7f24e0b2ee | fix/raw-external-asset-workflow | Fix raw external asset workflow guardrails
4ef08a29cbfd7128b916600d7f20123e95107643 | fix/translation-source-fingerprint-stale-gate | Ignore draft fallback homepage layout on public home
4118b12442a16e1351ec583866d5bcd950445615 | codex/taxonomy-review-ui | feat: add taxonomy review UI
```

Stashes: **2**.

```text
stash@{0}: On fix/translation-source-fingerprint-stale-gate: temp public home frontend fix
stash@{1}: On codex/collector-root-cache-busting: temp-before-pull
```

## 4. Working-tree status

Command run before creating this report:

```text
git status --porcelain=v1 --ignored=matching
```

Untracked: **1**.

```text
?? audit/step5b-runtime-db-inventory.md
```

Ignored: **26**.

```text
!! admin/.env
!! admin/dist/
!! admin/node_modules/
!! backend/.env
!! backend/node_modules/
!! backend/uploads/
!! collector-cta-trace-filtered.log
!! collector-cta-trace.log
!! collector/.env
!! collector/data/collector.db
!! collector/data/tmp-collector-test-token-user-role.json
!! collector/data/tmp-collector-test-token.json
!! collector/logs/
!! collector/media/
!! collector/node_modules/
!! collector/raw/
!! collector/runtime/
!! collector/tmp-runtime-article-revision-loop-smoke-commit636/
!! collector/tmp-runtime-article-revision-loop-smoke/
!! data/
!! frontend/.env
!! frontend/.env.api-test.backup
!! frontend/.next/
!! frontend/node_modules/
!! runtime/
!! tmp-runtime-facebook-url-frontend/
```

Paths a branch switch could disturb include the ignored runtime data under `collector/data/` (notably `collector/data/collector.db` and the two token JSON files) and `backend/uploads/`. No tracked-file modification appeared in the pre-report porcelain output. Creating this requested report adds the expected untracked path `audit/runtime-repo-state.md` after that snapshot.

## 5. Service start provenance

The configured test-stack task starts backend with working directory `D:\UbonRuntime\repos\UbonCity_Web\backend` and Collector with working directory `D:\UbonRuntime\repos\UbonCity_Web\collector`, both using `npm.cmd start`.

- Current HEAD was created at **2026-07-31 14:03:02 +07:00**.
- `git reflog` shows no later HEAD movement after that commit.
- Backend supervisor PID 8392 was recorded as started at **2026-08-02 10:51:14 +07:00** and is alive; its log shows `node server.js` listening on port 5000.
- Collector supervisor PID 8532 was recorded as started at **2026-08-02 10:51:14 +07:00**, but is no longer alive. Its log shows it launched `node server/index.mjs` from this worktree and then failed because `content_workflow_models.place_review_flag` is missing.

Because both starts occurred after the last HEAD movement and use this runtime worktree directly, **backend and the failed Collector start were launched from current HEAD `cacb737f459c6fb3f217193369319fce0e255b73`, not an older checkout.** Collector is currently stopped; backend is currently running.
