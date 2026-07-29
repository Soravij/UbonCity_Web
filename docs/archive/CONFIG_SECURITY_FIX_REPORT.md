# CONFIG_SECURITY_FIX_REPORT

## Scope Covered
- backend
- frontend
- admin
- collector-app
- deployment config/templates (`render.yaml`, `.env.example` files)

## Fixes Applied

### 1) Tightened backend CORS safety and production guardrails
- **Files**:
  - `D:\UbonCity_Web\backend\middleware\securityMiddleware.js`
  - `D:\UbonCity_Web\backend\server.js`
- **Changes**:
  - Added strict origin normalization and validation.
  - Blocked wildcard `*` in `CORS_ALLOWED_ORIGINS`.
  - Added startup validation: production now requires explicit `CORS_ALLOWED_ORIGINS`.
  - Added CORS preflight defaults (`optionsSuccessStatus`, `maxAge`).
- **Risk reduced**:
  - Prevents permissive/wildcard CORS misconfiguration before deploy.

### 2) Added endpoint-specific rate limiting for lifecycle import
- **File**:
  - `D:\UbonCity_Web\backend\routes\lifecycleRoutes.js`
- **Changes**:
  - Added route-level limiter for `/api/lifecycle/import-published`.
- **Risk reduced**:
  - Reduces abuse/brute-force pressure on internal sync endpoint.

### 3) Improved collector-app exposure defaults and config validation
- **File**:
  - `D:\UbonCity_Web\collector-app\server\index.mjs`
- **Changes**:
  - Added `COLLECTOR_BIND_HOST` support; default bind now `127.0.0.1`.
  - Added production config validation for collector CORS.
  - Rejects wildcard collector CORS configuration.
  - Enforces HTTPS backend sync target when `LIFECYCLE_SYNC_TOKEN` is used (except localhost).
  - Removed header-based audit actor spoofing fallback (`x-actor-email`), now uses authenticated user only.
- **Risk reduced**:
  - Lowers accidental public exposure risk for collector service.
  - Improves integrity of admin/security audit logs.

### 4) Reduced unsafe API URL defaults in frontend/admin runtime
- **Files**:
  - `D:\UbonCity_Web\frontend\lib\api.js`
  - `D:\UbonCity_Web\admin\src\api\api.js`
  - `D:\UbonCity_Web\admin\src\pages\Settings.jsx`
- **Changes**:
  - Production fallback now prefers `"/api"` (proxy path) instead of hardcoded localhost.
  - Dev fallback remains localhost for local workflow.
  - Settings page now displays real configured API base URL.
- **Risk reduced**:
  - Avoids accidental production dependence on localhost endpoints.

### 5) Updated env/config templates for required security settings
- **Files**:
  - `D:\UbonCity_Web\backend\.env.example`
  - `D:\UbonCity_Web\frontend\.env.example`
  - `D:\UbonCity_Web\admin\.env.example`
  - `D:\UbonCity_Web\collector-app\.env.example`
  - `D:\UbonCity_Web\render.yaml`
- **Changes**:
  - Added/clarified `NODE_ENV`, `CORS_ALLOWED_ORIGINS`, `LIFECYCLE_SYNC_TOKEN`.
  - Added `COLLECTOR_BIND_HOST` guidance.
  - Added missing backend envs in `render.yaml` (`CORS_ALLOWED_ORIGINS`, `LIFECYCLE_SYNC_TOKEN`, `GOOGLE_MAPS_BROWSER_KEY`, `NODE_ENV`).
- **Risk reduced**:
  - Improves deploy-time correctness and secret/config completeness.

## What Was Not Found / Not Verified
- Docker/docker-compose, nginx, pm2/ecosystem files: **not found in this repo snapshot**.
- External firewall/network ACL rules: **not verified in codebase**.
- Runtime cloud security group settings: **not verified**.

## Validation Performed
- Syntax checks:
  - `node --check` on modified backend/collector/frontend/admin runtime JS files.

## Remaining Manual Tasks
- Apply infra-level network isolation for collector-app (see `PRIVATE_DEPLOY_CONFIG_NOTES.md`).
- Ensure all new secret env vars are set in deployment platform secret manager.
