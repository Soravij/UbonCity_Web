# Step 4 — Fresh Collector DB Runtime Verification

**Runtime machine root:** `D:\UbonRuntime`  
**Repository worktree:** `D:\UbonRuntime\repos\UbonCity_Web`  
**Run date:** 2026-08-02 (Asia/Bangkok)

## Git precondition

- The runtime worktree was clean before and after `git pull origin main`.
- `git pull origin main` merged current `main` into `runtime-audit/2026-08-02` as `9fb9635`.
- The required Step 2 merge commit is present: `8a74705 merge: make schema.sql canonical and remove boot-time schema mutation`.

## DB preservation and fresh creation

- Collector was stopped before the DB was touched. The normal stop helper could not be used because its PID file was absent; the listener on `127.0.0.1:5070` was independently verified as `node server/index.mjs` and then stopped by its exact PID.
- Preserved existing DB by rename only: `collector.db` -> `collector.db.old-2026-08-02` (48,492,544 bytes).
- No `collector.db-wal` or `collector.db-shm` existed at preservation time.
- Confirmed no active `collector.db`, `collector.db-wal`, or `collector.db-shm` remained before creation.
- Created the new DB by running only `collector/database/schema.sql` through `node:sqlite` `DatabaseSync.exec`; no Collector initialization or migration script was used.

## Startup schema proof

Collector was started normally via `npm run backend:restart`, snapshot, restarted via the same command, and snapshot again. Each canonical snapshot includes all non-internal tables, every `PRAGMA table_xinfo` column, explicit indexes, and triggers.

| Snapshot | SHA-256 | Tables | Columns | Indexes | Triggers |
| --- | --- | ---: | ---: | ---: | ---: |
| After first normal boot | `6815705312a04cbd6228430316bde0fffe1b64026592f501b0f616fdad3aeaac` | 65 | 793 | 93 | 0 |
| After restart | `6815705312a04cbd6228430316bde0fffe1b64026592f501b0f616fdad3aeaac` | 65 | 793 | 93 | 0 |

**Schema diff after restart: 0.** The complete canonical snapshots have identical hashes and category counts, so boot added or changed no table, column, index, or trigger.

## First login and identity sync

- Immediately before login, fresh Collector DB `users` count was `0`.
- Login with the configured runtime admin credential succeeded and returned the normal authenticated response (token and user).
- The backend identity directory sync then populated `14` users in Collector.
- The login audit record is `auth.login.backend` with `auth_source: backend` and a backend user ID (`72`).
- Bootstrap audit record count is `0`; no boot bootstrap was used.

## Result

The fresh runtime Collector DB was created only from the canonical schema, remained schema-identical across a normal restart, and was populated through the normal backend identity-sync login path.
