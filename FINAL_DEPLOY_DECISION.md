# FINAL_DEPLOY_DECISION

## 1. Executive summary
This project is **not ready for private deployment** in its current state. Multiple independently confirmed reports converge on the same blocker set: exposed secrets, weak/default auth fallbacks, missing abuse controls, excessive write permissions, collector privilege and XSS risk, and incomplete operational resilience (health checks, process supervision, backup/restore validation). These are exploitable in realistic conditions and are not acceptable to carry into private production.

## 2. Critical issues
1. Exposed real secrets and credentials in env files (`backend/.env`, `collector-app/.env`).
2. Collector default admin credential/fallback behavior (`admin1234`) and insecure bootstrap pattern.
3. Collector high-risk service can be dangerously exposed without enforced isolation model.
4. No proven backup/restore readiness for MySQL + SQLite + media (no tested recovery gate).

## 3. High priority issues
1. JWT fallback secret allows forgery risk on misconfiguration.
2. Public translation endpoints can be abused for cost/DoS.
3. Missing rate limiting (login + expensive endpoints).
4. Backend write endpoints allow non-admin authenticated mutation without ownership guardrails (places/events/media usage paths).
5. Collector role model permits low-privilege workflow operations (publish/export/sync and related run paths).
6. Collector stored/DOM XSS risk via unsafe `innerHTML` rendering and token-in-localStorage model.
7. Upload validation is weak (MIME-trust/no robust signature checks).
8. Permissive CORS and missing baseline security headers.

## 4. Medium/low issues
1. Verbose internal error messages leak operational details.
2. Sensitive config/path exposure via collector config endpoint and transport config behavior.
3. Missing backend health endpoint; collector health payload exposes internal path info.
4. No repo-level deployment reproducibility artifacts for process management/reverse proxy (`pm2/nginx/docker` absent).
5. `render.yaml` only models backend; service deployment boundaries are undocumented in code.

## 5. Must fix before private deploy
1. Rotate/revoke all exposed secrets and remove plaintext production secrets from workspace/env files.
2. Remove default credential and JWT fallback behaviors; enforce startup hard-fail on missing/weak secrets.
3. Restrict translation endpoints with auth + role + strict rate limits/quotas.
4. Add login and endpoint abuse rate limiting across backend and collector.
5. Enforce RBAC + ownership checks on all mutable content/media routes.
6. Lock down collector workflow endpoints to intended roles only (admin/editor), not generic `user`.
7. Remove unsafe HTML rendering paths; close XSS sinks; harden session handling.
8. Harden upload validation with signature/magic-byte checks and safer serving boundaries.
9. Replace permissive CORS with strict allowlists and add security headers middleware.
10. Implement safe error handling (no raw internal error details in client responses).
11. Add and validate health/readiness probes (non-sensitive payloads).
12. Finalize and test backup/restore runbooks (MySQL, SQLite, media) against RTO/RPO targets.
13. Enforce collector network isolation (internal-only access path).

## 6. Can defer temporarily
1. Full infrastructure-as-code standardization (`docker/nginx/pm2`) can be deferred only if managed platform controls are documented and enforced.
2. Advanced observability enhancements (dashboards depth, long-term analytics) can be phased after baseline alerting is live.
3. Cosmetic documentation cleanup can be deferred after security/ops blockers are closed.

## 7. Recommended fix order
1. **Containment first**: rotate secrets, remove defaults/fallbacks, enforce collector isolation.
2. **Exploit path closure**: lock translation abuse, add rate limits, enforce RBAC/ownership.
3. **Client-side risk closure**: fix collector XSS sinks and token/session exposure model.
4. **Platform hardening**: strict CORS, security headers, safe error handling, upload hardening.
5. **Operational safety**: health checks, process supervision model, logging/alerts baseline.
6. **Recovery assurance**: backup schedules + restore drills + sign-off criteria.

## 8. 7-day action plan

### Day 1
- Rotate all leaked secrets/keys/passwords.
- Remove plaintext secrets from local env files and templates.
- Remove JWT and admin-password fallback logic.

### Day 2
- Lock down translation endpoints (auth + role).
- Implement global and route-specific rate limiting (auth, translate, upload, publish/export/sync).

### Day 3
- Enforce backend RBAC/ownership checks for place/event/media writes.
- Restrict collector privileged workflow endpoints to admin/editor only.

### Day 4
- Eliminate collector `innerHTML` sinks for untrusted data.
- Add sanitization/encoding and session hardening adjustments.

### Day 5
- Harden upload validation (content signature checks, stricter type policy).
- Implement strict CORS allowlists and security headers.

### Day 6
- Add backend health endpoint and sanitize collector health/config exposure.
- Establish process supervision/restart policy and baseline monitoring/alerts.

### Day 7
- Execute full backup + restore drill (MySQL, SQLite, media).
- Run security regression tests from manual attack cases.
- Final go/no-go review and deployment sign-off.

## 9. Final verdict
**Not ready**

Do not deploy now. Re-evaluate only after all must-fix items are implemented and validated with targeted retesting.
