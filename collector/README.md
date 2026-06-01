# Collector App (Internal Content Factory)

Internal-only system for collecting and preparing tourism content before importing into the main UbonCity website.

## What it includes
- Internal UI: Raw Inbox, Review/Cleaner, AI Draft, Quality Check, Staging, Export
- Auth + role control via backend JWT identity (collector is not auth authority)
- Asset flow: upload/register images into `assets` and map to `content_assets`
- Pipeline modules: `collector/`, `cleaner/`, `ai/`, `quality/`, `staging/`, `publisher/`, `pipeline/`
- Local backend API and SQLite database
- Export files for downstream import (`JSON`, `CSV`, `Markdown`)

## Private deployment intent
- Collector is an internal service and must remain private-only.
- Do not publish collector directly to the public internet.
- Default bind host is loopback (`COLLECTOR_BIND_HOST=127.0.0.1`).
- If remote operator access is needed, use VPN/private network or IP-restricted reverse proxy with authentication.

## Run locally
```bash
cd collector
npm install
npm run db:init
npm start
```

Required env before login will work:
- `COLLECTOR_PUBLIC_BASE_URL=https://collector.yourdomain.com`
- `COLLECTOR_SYNC_BACKEND_API=https://api.yourdomain.com/api`
- `BACKEND_JWT_SECRET=...`
- `BACKEND_JWT_ISSUER=uboncity-backend`
- `COLLECTOR_BACKEND_JWT_AUDIENCE=uboncity-collector`

Required env before `release-main` with backend sync will work:
- `COLLECTOR_PUBLIC_BASE_URL` must be the real externally reachable collector URL
- do not rely on loopback/private NAS URL if backend must mirror media from collector

Open: `http://127.0.0.1:5070` (or your configured `PORT`)

One-command backend bring-up:
```bash
cd collector
npm run backend:ready
```

This runs:
- `npm run db:init`
- sync configured owner identity from `OWNER_*` or `ADMIN_*`
- `npm run verify:evaluate-comparator`
- `npm start`

Operator commands:
- health check: `npm run backend:health`
- backend status: `npm run backend:status`
- tail backend logs: `npm run backend:logs`
- full operator smoke (non-mutating startup mode): `npm run backend:smoke`
- auth routing smoke (backend auth contract): `npm run backend:smoke:auth-routing`
- stop backend started via `backend:ready`: `npm run backend:stop`

Smoke auth env (required for login checks):
- `BACKEND_AUTH_EMAIL`
- `BACKEND_AUTH_PASSWORD`

Production/NAS note:
- collector is not standalone auth
- if the central backend is down, collector login and permission checks fail
- deploy backend first if you want collector to be usable 24/7

Collect script auth env:
- `BACKEND_AUTH_EMAIL` or `COLLECTOR_API_EMAIL`
- `BACKEND_AUTH_PASSWORD` or `COLLECTOR_API_PASSWORD`

Windows shortcut:
```powershell
.\scripts\backend-ops.ps1 -Action ready
.\scripts\backend-ops.ps1 -Action health
.\\scripts\\backend-ops.ps1 -Action status
.\\scripts\\backend-ops.ps1 -Action logs -Lines 80
.\scripts\backend-ops.ps1 -Action smoke
.\scripts\backend-ops.ps1 -Action stop
```

Windows auto-start task:
```powershell
.\scripts\backend-task.ps1 -Action install
.\scripts\backend-task.ps1 -Action status
.\scripts\backend-task.ps1 -Action remove
```

`install` first attempts per-user Windows Scheduled Task.  
If Scheduled Task is unavailable due to permission/API constraints, it falls back to `HKCU\...\Run` for per-user logon auto-start.

Bootstrap owner identity (first run):
- preferred env is `OWNER_EMAIL` / `OWNER_NAME`
- collector local password/session auth is removed in phase 5; sign-in must use backend JWT auth

You can override bind/runtime with env vars such as `PORT`, `COLLECTOR_BIND_HOST`, `DB_PATH`, `RAW_DIR`, `STAGING_DIR`, `EXPORT_DIR`, `MEDIA_DIR`.

Backend sync hardening:
- leave `LIFECYCLE_SYNC_TOKEN` empty until real private backend sync is ready
- placeholder values such as `CHANGE_ME` or `REPLACE_WITH_...` are treated as not configured

## CLI pipeline
```bash
npm run build-export
```

UI release policy:
- release ไปเว็บไซต์หลักใช้แบบทีละ content ผ่าน `POST /api/items/:id/release-main`
- batch HTTP routes เดิม (`/api/run/publish`, `/api/run/stage`, `/api/run/approve`, `/api/run/export`, `/api/run/sync-backend`) ถูกปิดแล้วเพื่อกันการปล่อยข้ามหลาย content โดยไม่ตั้งใจ

## Storage config (future NAS-ready)
Optional env vars:
- `RAW_DIR`
- `STAGING_DIR`
- `EXPORT_DIR`
- `MEDIA_DIR`
- `DB_PATH`

Defaults use local project directories. Later you can move these paths to mounted NAS without changing business logic.

## Export outputs
- `staging/content/content-import.json`
- `staging/content/content-import.csv`
- `staging/content/content-import.md`
- `staging/content/rejected-items.json`
- item-scoped release จะเขียนไฟล์ใต้ `staging/content/items/<content_item_id>/`

## Database schema
See: `database/schema.sql`

## AI model (optional)
- Default deterministic draft works without external AI.
- To enable real AI draft from UI button `Generate with AI`, configure backend-side AI secrets only:
  - `backend/.env -> OPENAI_API_KEY=...`
  - `backend/.env -> GOOGLE_AI_API_KEY=...`
- Collector must still know how to reach backend:
  - `COLLECTOR_SYNC_BACKEND_API=https://.../api`
  - `LIFECYCLE_SYNC_TOKEN=...`
- Feature-to-model selection is controlled from the owner panel inside collector, not from env.
- If AI call fails, system automatically falls back to deterministic draft.
