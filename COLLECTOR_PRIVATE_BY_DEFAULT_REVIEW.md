# COLLECTOR_PRIVATE_BY_DEFAULT_REVIEW

## Scope reviewed
- `collector-app/server/index.mjs`
- `collector-app/.env.example`
- `collector-app/README.md`
- `collector-app/scripts/run-collect.ps1`
- `collector-app/postman/*.postman_collection.json`
- root `DEPLOY.md`
- cross-service env templates in `backend/.env.example`, `frontend/.env.example`, `admin/.env.example`

## Current private-by-default posture
1. Bind host default is private/local-safe.
- Evidence: `COLLECTOR_BIND_HOST` defaults to `127.0.0.1` in `collector-app/server/index.mjs`.

2. CORS is explicit and wildcard is blocked.
- Evidence: `CORS_ALLOWED_ORIGINS` parsing + rejection of `*` + production requirement.

3. Collector sync URL has HTTPS guard when sync token is set.
- Evidence: startup validation blocks insecure remote HTTP sync target.

4. Collector health endpoint is minimal.
- Evidence: `/api/health` returns only `ok` + `service`.

## Accidental exposure risks to watch
1. `COLLECTOR_BIND_HOST` changed to `0.0.0.0` without firewall restrictions.
2. VPS security group/firewall opens collector port (`5060`/`5070`) to internet.
3. Reverse proxy forwards collector routes publicly without allowlist/auth.
4. `CORS_ALLOWED_ORIGINS` set to broad/public origins.
5. Operator uses public DNS directly for collector endpoint.

## Changes made in this task
1. Hardened collector env template intent.
- `collector-app/.env.example` now clearly states collector is internal/private only.
- Internal example origins/URLs used:
  - `CORS_ALLOWED_ORIGINS=https://admin.internal.example`
  - `COLLECTOR_SYNC_BACKEND_API=https://backend.internal.example/api`

2. Clarified collector usage docs.
- `collector-app/README.md` now includes explicit private/internal deployment intent section.

3. Added root deploy note.
- `DEPLOY.md` now includes `Collector (internal-only)` section.

## What still depends on future VPS setup (not yet verifiable)
- Network ACL/security group rules
- Reverse proxy access restrictions
- VPN/private subnet design
- Host firewall state after provisioning

## Decision
- Code/config defaults are now aligned with private/internal collector operation.
- Final safety still depends on future VPS network isolation controls.
