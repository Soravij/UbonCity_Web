# DEPLOY_READINESS_REPORT

## A. Deployment readiness verdict
- Verdict: **Not ready for private deploy**
- Why:
  - High-risk secret handling and credential defaults are present.
  - Security controls required for production operations (rate limiting, strict CORS, hardened auth defaults, process supervision, monitoring, backup runbook) are incomplete or missing.
  - `collector-app` is an internal high-risk service but currently designed in a way that can be dangerously exposed if not isolated.

## B. Findings table

| Issue | Severity | Area | Impact | Fix |
|---|---|---|---|---|
| Real credentials in `backend/.env` and `collector-app/.env` | Critical | Secrets management | Credential/API-key compromise; unauthorized DB/API access | Rotate all exposed secrets now; remove real values from repo/workspace templates; use secret manager |
| Collector default admin fallback (`admin1234`) | Critical | Auth/bootstrap | Weak/default credential compromise if env misconfigured | Remove password fallback; fail startup if admin secret missing/weak |
| JWT fallback secret (`"uboncity_secret"`) | High | Backend auth | Token forgery risk on bad env config | Remove fallback and hard-fail startup without strong `JWT_SECRET` |
| Translation endpoints public (`/api/translate*`) | High | Backend API abuse | OpenAI cost burn / DoS | Require auth+role + request quotas + rate limits |
| No rate limiting on auth and expensive routes | High | Production security | Brute force and abuse risk | Add per-IP/per-account limiters and lockout/backoff |
| Permissive CORS (`app.use(cors())`) | High | Backend HTTP security | Cross-origin API exposure and future auth risk | Replace with strict allowlist by environment |
| No security headers middleware (helmet/CSP baseline missing) | Medium | Edge/web security | Reduced browser hardening | Add `helmet`; define CSP and related headers |
| Backend has no health endpoint | Medium | Operational readiness | Weak load balancer/startup health probing | Add `/api/health` (minimal, non-sensitive), plus readiness check |
| Collector `/api/health` exposes DB path | Medium | Information exposure | Internal path leakage | Return minimal health payload only |
| Collector `/api/config` reveals directories/DB path to any authenticated user | High | Internal service hardening | Recon and sensitive topology leakage | Restrict to admin; remove sensitive paths from response |
| Collector workflow endpoints allow `user` role (`requireRole("admin","editor","user")`) | High | RBAC/operational control | Unauthorized publish/export/sync actions | Restrict critical endpoints to admin/editor only |
| Some collector run endpoints only require auth (no role gate) | High | RBAC | Any logged-in user can run high-impact jobs | Add strict role checks for all run endpoints |
| Collector UI stores token in `localStorage` with known XSS sinks | High | Session security | Token theft and workflow takeover | Remove unsafe `innerHTML`; sanitize outputs; prefer HttpOnly cookie model if possible |
| Upload validation weak (collector multer and backend base64 MIME trust) | High | File handling | Malicious file storage/serving risk | Validate signatures/magic bytes, strict allowlists, safer serving path |
| Verbose error responses (`err.message`) | Medium | Runtime error handling | Info leakage in production | Return generic errors to clients; keep detailed logs server-side |
| No process manager config (pm2/systemd/ecosystem absent) | Medium | Process management | Fragile restart behavior and poor crash recovery | Add process supervision strategy per service |
| No docker/nginx/reverse-proxy config in repo | Medium | Deployment reproducibility | Undocumented edge assumptions and inconsistent deployments | Add versioned infra configs or explicit managed-platform runbook |
| `render.yaml` only defines backend service | Medium | Service separation | Missing declarative deploy model for frontend/admin/collector | Add explicit deploy definitions and network boundaries |
| Collector uses SQLite inside app directory without backup policy | High | Data durability | Data loss risk on disk failure/redeploy | Define scheduled backups, restore tests, and storage retention |
| Backup/restore procedures not documented for MySQL + SQLite + media | High | DR readiness | Inability to recover safely after incident | Create and test backup/restore runbooks and RTO/RPO targets |

## C. Pre-deploy checklist
- See [PRE_DEPLOY_CHECKLIST.md](D:\UbonCity_Web\PRE_DEPLOY_CHECKLIST.md).

## D. Production config checklist
- Enforce secret injection via platform secret manager only.
- Harden backend startup:
  - fail if `JWT_SECRET` missing/weak
  - fail if DB vars missing
- Harden collector startup:
  - fail if `ADMIN_PASSWORD` weak/default
  - disable public exposure by default
- Define strict CORS allowlists per service/domain.
- Add security headers (`helmet`) and safe error handler.
- Add rate limiting for login, translate, publish/export/sync, upload.
- Add explicit environment split (`dev`, `staging`, `prod`) and immutable config.
- Ensure frontend/admin point only to production API URLs.
- Ensure TLS termination + HSTS at edge.
- Ensure upload/media directories have explicit retention and permissions.

## E. Backup / restore checklist
- See [BACKUP_RESTORE_CHECKLIST.md](D:\UbonCity_Web\BACKUP_RESTORE_CHECKLIST.md).

## F. Logging / monitoring checklist
- Centralize logs for backend + collector (structured JSON preferred).
- Separate access logs and application error logs.
- Add alerting for:
  - repeated auth failures
  - sudden `/api/translate*` spikes
  - publish/export/sync failures
  - upload anomalies (size/type/frequency)
- Add service health dashboards and uptime probes.
- Add DB connectivity and saturation metrics (MySQL pool + SQLite disk/IO).
- Add storage capacity alerts for media and export paths.
- Ensure audit logs are retained and tamper-evident for admin/workflow actions.

## G. Safe private deployment recommendations
1. Deploy `backend`, `frontend`, `admin` separately with strict network boundaries.
2. Treat `collector-app` as internal-only:
   - put behind VPN/private subnet/IP allowlist
   - do not expose directly on public internet
   - require strong admin auth and hardened role checks
3. Use reverse proxy/WAF with TLS, rate limits, and request size limits.
4. Serve uploaded media through controlled path (not raw direct static for internal assets when avoidable).
5. Define explicit RTO/RPO and test restore before go-live.

## H. Items temporarily acceptable for private testing
- Minimal observability can be acceptable only if:
  - access is tightly restricted
  - data is non-production
  - test window is short and monitored
- Generic README defaults are tolerable only in isolated dev, not deploy targets.

## I. Items that must be fixed before any deploy
1. Remove and rotate all exposed secrets.
2. Remove weak/default credential fallbacks.
3. Remove JWT fallback secret and enforce secret validation on startup.
4. Add auth/rate limits to translation endpoints.
5. Add login and abuse rate limiting.
6. Enforce strict RBAC on collector run/publish/export/sync routes.
7. Lock down CORS and add baseline security headers.
8. Implement safe error handling (no raw internal error messages).
9. Define and test backup/restore for MySQL, SQLite, and media.
10. Isolate `collector-app` from public network exposure.
