# Runtime deploy d2911fb — execution report

- Repository: `D:\UbonRuntime\repos\UbonCity_Web`; runtime only.
- Branch: `dev`; initial HEAD `c67dcd4`, pulled with `git pull --ff-only origin dev` to `d2911fb4039d4e53331c34792024d88f39801876`.
- Preflight: clean working tree; required branches and two stashes present. The only outstanding local report commit was `7042d4a`; only `runtime-audit/2026-08-02` was pushed and `git log --branches --not --remotes` became empty.
- Step 1: user stopped services; verified no listeners on ports 5070/5000.
- Backup: `D:\UbonRuntime\backups\collector-db\collector-20260804-pre-d2911fb.db`; no `-wal/-shm`; source and backup were both 1,622,016 bytes with SHA-256 `2F519FF2C51BC73DFB4F9DE12A937F57A72D3D4BBA3F6E63C072108B834B025F`; both integrity checks `ok`; all table counts matched.
- Pre-DDL snapshot: non-deleted items `9`; transitions `46`; state distribution `analyzed/draft=9`; `cleaned_at` absent.
- Exactly one DDL was run once, before service start: `ALTER TABLE content_workflow_models ADD COLUMN cleaned_at TEXT;` Result: `DDL_OK`.
- Post-DDL: `cleaned_at` is `TEXT`; integrity `ok`; non-deleted items `9`; transitions `46`; state distribution unchanged; non-NULL `cleaned_at=0`; row counts unchanged.
- Dependency diff `git diff c67dcd4..HEAD --stat -- package-lock.json collector/package-lock.json` was empty; no `npm install`.
- After user restart: `http://127.0.0.1:5070/api/health` and `http://127.0.0.1:5000/api/health` both returned 200. Collector reported the target SQLite DB; backend reported MySQL `uboncity`.
- Boot logs: backend stderr empty; collector stderr contained only Node experimental SQLite warning; no schema assertion or missing-column error.
- No code was changed; no merge/rebase; no push to `dev`/`main`; no files under `D:\UbonCity_Web` or `C:\UbonRuntime\...` were touched.
