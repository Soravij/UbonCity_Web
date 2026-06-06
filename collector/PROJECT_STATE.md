# PROJECT_STATE

Last Updated: 2026-06-06

## Active Branch

`main`

Current completed main baseline:
- Translation stale gate merged
- Translation repair merged
- AI policy rows merged
- Frontweb homepage draft-fallback issue fixed
- Assignment and item management-line scope enforcement merged

## Recent Completed Work

### 2026-06-06

Branch / PR:
- `fix/assignment-management-line-scope`
- PR `#5`

Status:
- merged

Summary:
- tightened assignment scope
- tightened item context read routes
- tightened item mutation and recompute routes
- tightened workflow and article-process routes
- tightened claim, takeover, and delete
- added static regression coverage for management-line scope guards

Checks and tests:
- `node --check collector/server/index.mjs` passed
- `node --check collector/db/repository.mjs` passed
- `node --check collector/server/public/app.js` passed
- `collector/tests/assignment-ui-scope.test.mjs` still has legacy failures unrelated to this patch
- new management-line scope assertions pass

Follow-up:
- clean up legacy `collector/tests/assignment-ui-scope.test.mjs` failures separately
- run manual UAT with `owner` / `admin` / `user` / `editor` / `freelance` accounts
- verify `admin` cannot see owner or out-of-branch assignments
- verify `admin` cannot direct-hit item context outside subtree
- verify `admin` cannot claim, takeover, delete, recompute, or generate on out-of-branch item
- verify `user` cannot assign upward or across branch
- verify `owner` remains global

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
`uboncity`

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

## Current main baseline
- `19b4d27` Merge AI policy rows for translation repair and SEO agent
- `3f9d2d6` Merge translation repair from recheck issues
- `f8a1d99` Merge translation source fingerprint stale gate
- `20d7967` Ignore draft fallback homepage layout on public home

## Runtime Machine
- runtime repo confirmed on `main`
- runtime repo confirmed at commit `19b4d27`

## Collector source
- collector/main now includes translation stale gate, translation repair, and AI feature policy updates

## Reusable local ops
- `ops/windows/test-stack.ps1` added for Windows test-stack start/stop/status orchestration
- cloudflared preflight guard added:
  - fail-fast when `C:\cloudflared\config.yml` is missing/empty
  - fail-fast when `credentials-file` is missing
  - fail-fast when ingress rules are missing
  - reduces mis-run from direct `cloudflared tunnel run <name>` without config

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
- internal AI execution path moved behind backend proxy for core collector flows
- local provider fallback removed from translation workflow path (backend-only secret boundary for internal path)
- source fingerprint based stale detection for translations completed
- fingerprint excludes `draft_id` and `review_report_id` to avoid false stale on no-op revision cycles
- mismatched `source_fingerprint` now blocks translation technical readiness, recheck readiness, submit-admin-review, and final send
- article submit page now loads live export readiness on init
- generate/regenerate translations now refresh live readiness after completion
- bulk backend sync is fingerprint-aware and excludes stale or mismatched translations
- Translation Recheck evaluates semantic quality only; it does not modify translated fields
- Translation Repair flow added:
  - appears for warning/failed recheck rows with `recheck_issues`
  - repairs a single locale using source + current translation + recheck issues
  - resets recheck status to `not_checked` after repair
  - keeps Final Send blocked until recheck passes again
  - rejects stale fingerprint mismatch and non-eligible rows
- manual repair flow validated:
  - `warning/failed -> Repair translation -> not_checked -> Recheck enabled -> Final Send blocked -> Recheck passed -> Final Send enabled`

## Backend
- backend install successful
- backend boot successful
- MySQL local integration operational
- backend now hosts internal AI execution endpoint for collector internal path
- approved place/event media now served from backend uploads
- public place response rewrites self-hosted media URLs correctly
- `/uploads` static route now allows frontend cross-origin image embedding

## Admin
- Vite dev environment operational
- backend connectivity operational
- review-to-public preview flow validated against local backend/frontend alignment
- Cloudflare test-domain access stabilized via explicit Vite host configuration
- AI Feature Policy page now shows Translation Repair and SEO Agent rows

## Frontend
- light theme scenic shell layering fixed for review/detail rendering
- place/event public detail and list surfaces verified to consume normalized backend media fields
- test domain routing established via Cloudflare Tunnel
- public homepage ignores `draft_fallback` homepage layout unless there is a published curation layout
- frontweb test passed after the homepage draft-fallback fix

---

# AI Feature Policy Status

Current feature rows:
- Field Pack
- Translation
- Translation Recheck
- Translation Repair
- Visual Context
- Article Generator
- SEO Agent

Current defaults and routing:
- Translation remains Gemini 2.5 Flash-Lite (economy) by default
- Translation Recheck can be configured separately
- Translation Repair is active and defaults to Gemini 2.5 Flash
- SEO Agent is reserved for future Article Workspace work and defaults to Gemini 2.5 Flash-Lite
- Repair workflow reads `aiConfig.features.translationRepair` first, then falls back only if that feature config is absent

---

# Article Workspace Test Policy

Before production deploy, Article Workspace should be tested through the full pipeline up to test frontweb.

Current pre-deploy test policy:
- external research data and external/placeholder photo manifests may be used as test fixtures
- this is a temporary test-mode override, not a production policy change
- test fixture content may sync to test frontweb
- test fixture content must be labelled clearly as:
  - `source_mode = "test_external_research"`
  - `publish_policy = "test_only"`
  - `production_publish_allowed = false`
- production publish and final production export must remain blocked for external research fixtures unless replaced by field-verified data and owned assets
- before real deploy, test data must be purged:
  - test content items
  - draft articles
  - generated articles
  - translation rows
  - repair/recheck rows
  - external/placeholder media manifests
  - generated frontend test outputs if applicable
- do not treat Google/Search data as field verified
- do not claim field verification unless `field_return.source_mode` is `field_verified`
- Article AI must surface `missing_info` and `uncertain_fields` instead of inventing facts

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

# Next Priority

1. Start `feat/article-workspace-test-harness`
2. Define Article AI input contract:
   - `field_pack`
   - `research_seed`
   - `field_return_mock`
   - `photo_manifest_mock`
   - `source_policy` metadata
3. Add test fixture/dry-run mode for Article Workspace
4. Allow pipeline testing through test frontweb only
5. Keep production publish blocked for `test_external_research` data
6. Add cleanup/purge path before real deploy

---

# Admin Review Media Policy

- Fieldpack may contain external images only as reference/evidence media.
- Final handoff submit / review acceptance automatically clears external images from usable article media.
- External images must never appear as usable Article Workspace media.
- Article Workspace media must be local-assets-only.
- External media is not promoted into cover/gallery/inline usable media.
- External media is not auto-imported into collector assets/content_assets.
- Usable article/review media must come only from selected local `content_assets`.
- Eligible usable media must be collector-controlled assets with `storage_disk` in `local` or `nas`, a non-http(s) `storage_path`, and image mime type when available.
- Body `<img>` URLs do not create media eligibility.
- Backend must not fetch external images for Admin Review ingest.
- Backend must not fall back to Cloudflare-protected collector media URLs.
- Admin Review media must become backend-owned after ingest.
- Collector uploads selected local media binaries to backend during Admin Review submit.
- Article Workspace for new items should receive only local usable media or missing-cover state.
- This branch does not patch old broken content; runtime verification should use a new item.
- Submit Admin Review requires selected local cover/assets.
- To use an external image, an operator must first verify rights, import it into collector-controlled local storage, and then select it as a local asset.
- Do not regress this policy when changing fieldpack handoff, Article Workspace media, or Admin Review ingest.

---

# Article Body Image Asset Mapping Policy

- Article compose body images must come only from uploaded/imported local collector assets.
- Compose body image insertion must preserve stable asset identity, at minimum `asset_id` when available.
- Collector public URL is not the source of truth for approved article/review body images.
- Admin Review ingest must rewrite known selected/uploaded body images to backend-owned URLs.
- Backend rewrite is a final guard, not the only mapping mechanism.
- Frontend review/public pages must never intentionally render collector media URLs.
- Backend must not fetch arbitrary external images for body rendering.
- External images remain reference-only unless manually rights-verified, imported into collector storage, and selected as local assets.

---

# Documentation State

## UAT documents
- role-based markdown checklists are primary artifacts
- previous interactive UAT artifacts were removed from active workflow
- print usage should use markdown-based role files (or generated local print pack outside git tracking)

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
