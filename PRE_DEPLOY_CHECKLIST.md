# PRE_DEPLOY_CHECKLIST

Use this checklist before any private deployment.

## 1) Secrets and environment
- [ ] Rotate all currently exposed secrets (DB, JWT, OpenAI, Google Maps, admin passwords).
- [ ] Remove real secrets from local env files and keep placeholders only in `*.env.example`.
- [ ] Configure secrets only via deployment secret manager.
- [ ] Verify backend has strong `JWT_SECRET` (no fallback allowed).
- [ ] Verify collector has strong non-default `ADMIN_PASSWORD`.
- [ ] Confirm `BACKEND_PUBLIC_URL`, `NEXT_PUBLIC_API_URL`, and `VITE_API_URL` match production domains.

## 2) Security hardening
- [ ] Replace permissive CORS with strict origin allowlist.
- [ ] Add security headers middleware (`helmet`) for backend and collector.
- [ ] Add login rate limiting and brute-force controls.
- [ ] Add rate limiting for expensive endpoints (`/api/translate*`, run/export/sync, uploads).
- [ ] Ensure no endpoint returns raw internal error messages in production.
- [ ] Validate file signature/magic bytes on uploads.

## 3) Access control
- [ ] Enforce backend RBAC/ownership checks for content mutation endpoints.
- [ ] Restrict collector critical actions (publish/export/sync/run) to admin/editor roles only.
- [ ] Verify non-admin accounts cannot access admin-only APIs by direct request.

## 4) Service topology and isolation
- [ ] Keep `collector-app` internal-only (VPN/private subnet/IP allowlist).
- [ ] Do not expose collector public UI/API on internet-facing domain.
- [ ] Separate backend/frontend/admin/collector deployment boundaries.
- [ ] Confirm reverse proxy enforces HTTPS and request size/time limits.

## 5) Operational readiness
- [ ] Add backend health endpoint (`/api/health`) with non-sensitive payload.
- [ ] Ensure collector health endpoint does not leak internal filesystem/DB paths.
- [ ] Define process supervision/restart strategy (pm2/systemd/platform equivalent) for backend and collector.
- [ ] Confirm startup failure behavior on bad/missing env vars.

## 6) Logging and monitoring
- [ ] Centralize logs for backend and collector.
- [ ] Enable alerts for auth failures, translate abuse, publish/export failures, and storage saturation.
- [ ] Verify audit trail retention for admin and workflow actions.

## 7) Data durability
- [ ] Define backup schedules for MySQL, collector SQLite, and media files.
- [ ] Verify backup encryption and retention policy.
- [ ] Execute at least one full restore rehearsal in staging.

## 8) Final go/no-go gate
- [ ] All critical/high findings are closed.
- [ ] Pre-deploy smoke tests pass for backend/frontend/admin.
- [ ] Collector remains isolated and reachable only by trusted operators.
- [ ] Deployment sign-off recorded with rollback plan.
