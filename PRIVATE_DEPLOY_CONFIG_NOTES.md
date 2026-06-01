# PRIVATE_DEPLOY_CONFIG_NOTES

## Deployment Verdict (Config Security)
- **Deploy only after applying these environment and infra settings.**

## Required Environment Variables

### Backend
- `NODE_ENV=production`
- `JWT_SECRET` (strong random, min 32 chars)
- `CORS_ALLOWED_ORIGINS` (explicit frontend/admin origins, comma-separated, no `*`)
- `LIFECYCLE_SYNC_TOKEN` (strong random shared token for collector sync)
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `BACKEND_PUBLIC_URL`

### Collector-App
- `NODE_ENV=production`
- `COLLECTOR_BIND_HOST=127.0.0.1` (or private interface only)
- `ADMIN_PASSWORD` (strong, non-default)
- `CORS_ALLOWED_ORIGINS` (explicit collector admin UI origin)
- `COLLECTOR_SYNC_BACKEND_API` (HTTPS URL in production)
- `LIFECYCLE_SYNC_TOKEN` (same value as backend)

### Frontend/Admin
- Frontend: `NEXT_PUBLIC_API_URL`
- Admin: `VITE_API_URL`

## Collector Isolation Requirements (Manual Infra)
- Collector is a higher-risk internal service and should **not** be internet-exposed directly.
- Put collector behind one of these:
  1. Private network + VPN/bastion access only
  2. Reverse proxy with IP allowlist + auth in front
  3. Cloud private service networking (no public ingress)
- Ensure collector port is blocked from public ingress at firewall/security-group layer.

## Reverse Proxy / Routing Notes
- If frontend/admin use same-domain reverse proxy, production fallback `"/api"` is now supported in code.
- If using separate backend domain, set explicit `NEXT_PUBLIC_API_URL` and `VITE_API_URL`.

## CORS Notes
- Wildcard CORS is now rejected by startup validation.
- In production, backend and collector require explicit `CORS_ALLOWED_ORIGINS`.

## Logging / Error Handling Notes
- API responses remain generic for server errors (no stack trace leakage in JSON responses).
- Keep server logs private; do not expose process logs publicly.
- Collector audit actor now depends on authenticated user identity only.

## Quick Pre-Deploy Checks
1. Start backend with production env: verify startup fails if `JWT_SECRET` weak/missing or CORS invalid.
2. Start collector with production env: verify startup fails if CORS invalid.
3. Verify collector listens on `127.0.0.1` (or private interface), not public interface.
4. Verify `/api/lifecycle/import-published` is reachable only with valid token and now rate-limited.
5. Verify frontend/admin point to intended API URL in production.

## Not Verified In Codebase
- nginx/pm2/docker configs (not present in this repository snapshot).
- External firewall, WAF, and cloud network ACL/security-group rules.
