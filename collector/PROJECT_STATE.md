# PROJECT_STATE

Last Updated: 2026-05-25

## Active Branch

codex/tester-build-v1-place-event-collector-fixes

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
- Cloudflare Tunnel test exposure

Environment:
- Windows 11
- AnyDesk operational
- local MySQL installed
- local integration stack operational
- runtime root migrated to `D:\UbonRuntime`

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
http://127.0.0.1:5173

Status:
- operational
- can connect to backend
- local auth integration testing active
- Vite host allowlist now required for Cloudflare test domain access

## frontend (Next dev)
http://127.0.0.1:3000

Status:
- operational when started for test domain routing
- public test frontend can route through Cloudflare Tunnel

## Cloudflare test domains

Status:
- active through Cloudflare Tunnel on runtime machine
- backend health verified at `https://api-test.uboncity.com/api/health`
- admin reachable at `https://admin-test.uboncity.com`
- collector reachable at `https://collector-test.uboncity.com`
- public frontend test entry uses `https://test.uboncity.com`

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
codex/tester-build-v1-place-event-collector-fixes

latest tester build commit:
e050bee

## Collector source
Now committed and synchronized properly.

## Reusable local ops
- `ops/windows/test-stack.ps1` added for Windows test-stack start/stop/status orchestration

---

# Major Completed Milestones

## Infrastructure
- runtime machine setup complete
- runtime root moved to M.2-backed `D:\UbonRuntime`
- AnyDesk remote access operational
- local runtime folder structure established
- Cloudflare Tunnel test access established without router port-forward dependency

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
- translation regenerate flow fixed
- translation provider config fallback fixed
- zh compact meta title blocker removed
- google translator generic `apiKey/baseUrl/model` mapping fixed

## Backend
- backend install successful
- backend boot successful
- MySQL local integration operational
- approved place/event media now served from backend uploads
- public place response rewrites self-hosted media URLs correctly
- `/uploads` static route now allows frontend cross-origin image embedding

## Admin
- Vite dev environment operational
- backend connectivity operational
- review-to-public preview flow validated against local backend/frontend alignment
- Cloudflare test-domain access stabilized via explicit Vite host configuration

## Frontend
- light theme scenic shell layering fixed for review/detail rendering
- place/event public detail and list surfaces verified to consume normalized backend media fields
- test domain routing established via Cloudflare Tunnel

---

# Current Runtime Folder Layout

```txt
D:\UbonRuntime\
|-- repos\
|   `-- UbonCity_Web
|
|-- runtime\
|   |-- logs
|   |-- tmp
|   |-- browser-profiles
|   `-- test-stack
|
|-- data\
|   `-- collector
|
|-- config\
|
`-- scripts\
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
- Cloudflare tunnel credentials
- machine-local Cloudflare config

## Avoid
- hardcoded Windows absolute paths
- giant rewrites
- mixing collector runtime into public deployment
- treating Cloudflare test exposure as production hardening

---

# Current Priorities

1. tester validation on branch `codex/tester-build-v1-place-event-collector-fixes`
2. stabilize Windows test-stack startup/shutdown on runtime machine
3. validate review/publish lifecycle on real content items through test domains
4. validate workflow integrations
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
- Cloudflare/domain staging auto-start hardening

---

# Notes

Current architecture direction:

Main Machine
-> development/orchestration/database source

GitHub
-> canonical source of truth

Runtime Machine
-> isolated execution/integration/runtime testing node

Cloudflare Tunnel
-> public test entry for team access without direct router exposure

This separation should be preserved moving forward.

Collector remains higher-risk than the public site even when exposed through test-domain login flow.
