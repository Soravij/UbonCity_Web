# PROJECT_STATE

Last Updated: 2026-05-13

## Active Branch

codex/sync-fix

---

# System Architecture

## frontend
Public tourism website (Next.js)

## admin
Internal moderation/review/content operations UI (React + Vite)

## backend
Main API/auth/content lifecycle system (Node.js + Express + MySQL)

## collector
Isolated AI-assisted ingestion/runtime/workflow system

Collector is intentionally separated from the public deployment surface.

---

# Current Infrastructure

## Main Machine
Purpose:
- coding
- AI orchestration
- refactor
- audits
- Git operations
- database source machine

Environment:
- Windows 11
- MySQL80 installed and operational

## Runtime Machine
Purpose:
- runtime execution
- collector workflows
- integration testing
- browser automation
- headless operation

Environment:
- Windows 11
- headless capable
- AnyDesk operational
- local MySQL installed
- local integration stack operational

---

# Current Runtime Services

## backend
http://127.0.0.1:5000

Status:
- operational
- Express boot successful
- connected to local MySQL after DB import

## collector
http://127.0.0.1:5070

Status:
- operational
- SQLite initialized
- health checks passing

## admin (Vite dev)
Typically:
http://127.0.0.1:5173

Status:
- operational
- can connect to backend
- local auth integration testing active

---

# Database Status

## backend database
MySQL 8.0

Database:
uboncity

## Migration State
- database dump exported from main machine
- imported successfully into runtime machine
- runtime machine now contains local DB copy

## Current Backend ENV Pattern

```env
PORT=5000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=LOCAL_PASSWORD
DB_NAME=uboncity
```

---

# Repository State

## GitHub
Acts as source of truth.

## Runtime Machine
Now successfully synced from:

branch:
codex/sync-fix

## Collector source
Now committed and synchronized properly.

---

# Major Completed Milestones

## Infrastructure
- runtime machine setup complete
- headless operation validated
- AnyDesk remote access operational
- reboot/reconnect validated
- local runtime folder structure established

## Repository Cleanup
- runtime artifacts removed from tracking
- portable collector test paths implemented
- gitignore cleanup completed
- runtime/data separation improved

## Collector
- npm install complete
- SQLite initialized
- collector boot successful
- collector health checks operational

## Backend
- backend install successful
- backend boot successful
- MySQL local integration operational

## Admin
- Vite dev environment operational
- backend connectivity operational

---

# Current Runtime Folder Layout

```txt
C:\UbonRuntime\
 ├── repos\
 │    └── UbonCity_Web
 │
 ├── runtime\
 │    ├── logs
 │    ├── tmp
 │    └── browser-profiles
 │
 ├── data\
 │    └── collector
 │
 ├── backups\
 │
 ├── config\
 │
 └── scripts\
```

---

# Important Rules

## Never commit
- node_modules
- .env
- collector/data
- collector/staging
- runtime artifacts
- browser profiles
- generated exports/media
- temporary logs

## Avoid
- hardcoded Windows absolute paths
- giant rewrites
- exposing collector publicly
- mixing collector runtime into public deployment

---

# Current Priorities

1. stabilize local auth flows
2. validate review/publish lifecycle
3. validate workflow integrations
4. validate transport/content workflows
5. local-first testing before VPS deployment
6. preserve runtime isolation architecture

---

# Deployment Direction

Current phase:
LOCAL INTEGRATED TESTING

Not production-ready yet.

Pending:
- production auth hardening
- reverse proxy
- HTTPS
- VPS isolation
- backup automation
- process management
- monitoring
- production DB strategy
- security review
- Cloudflare/domain staging setup

---

# Notes

Current architecture direction:

Main Machine
→ development/orchestration/database source

GitHub
→ canonical source of truth

Runtime Machine
→ isolated execution/integration/runtime testing node

This separation should be preserved moving forward.

Collector remains intentionally isolated from direct public exposure.