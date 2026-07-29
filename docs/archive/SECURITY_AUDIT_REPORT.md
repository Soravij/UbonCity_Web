# SECURITY AUDIT REPORT

Scope audited:
- `frontend`
- `backend`
- `admin`
- `collector-app`
- deployment/config files (`render.yaml`, env files, scripts, deploy docs)

Audit date: 2026-03-11

## Issue 1: Production Secrets Stored in Plaintext Env Files
- Severity: Critical
- Where found:
  - `D:\UbonCity_Web\backend\.env:5,8,11,12`
  - `D:\UbonCity_Web\collector-app\.env:3,6,11`
- Evidence:
  - `DB_PASSWORD`, `OPENAI_API_KEY`, `JWT_SECRET`, `GOOGLE_MAPS_API_KEY` are present in plaintext.
  - Collector `.env` also includes `ADMIN_PASSWORD=admin1234`.
- Why it is risky:
  - Compromise of filesystem/backups/logs/desktop sync leaks credentials and API keys immediately.
  - Exposed keys allow unauthorized API usage and potential data compromise.
- Realistic abuse scenario:
  - A leaked workspace archive or accidental sharing exposes DB/password/API keys; attacker logs in to DB and abuses paid APIs.
- Recommended fix:
  - Revoke/rotate all exposed credentials now.
  - Remove real secrets from all project env files; keep only placeholders in `*.env.example`.
  - Store production secrets only in deployment secret manager.
- Must fix before private deploy: Yes

## Issue 2: Default Admin Credentials and Auto-Seeding in Collector
- Severity: Critical
- Where found:
  - `D:\UbonCity_Web\collector-app\db\client.mjs:22`
  - `D:\UbonCity_Web\collector-app\README.md:23-25`
  - `D:\UbonCity_Web\collector-app\.env:2-3`
- Evidence:
  - Fallback password is `admin1234` if env is unset.
  - README documents default login.
- Why it is risky:
  - Misconfigured deploys will boot with known credentials.
- Realistic abuse scenario:
  - Internal app is exposed to network; attacker logs in with default credentials and triggers publish/export.
- Recommended fix:
  - Remove default password fallback entirely; hard-fail startup if `ADMIN_PASSWORD` is weak/missing.
  - Force password change/one-time bootstrap on first run.
  - Remove plaintext default credentials from docs used in production context.
- Must fix before private deploy: Yes

## Issue 3: JWT Secret Fallback Allows Token Forgery if Misconfigured
- Severity: High
- Where found:
  - `D:\UbonCity_Web\backend\middleware\authMiddleware.js:3`
  - `D:\UbonCity_Web\backend\controllers\placeController.js:6`
  - `D:\UbonCity_Web\backend\controllers\eventController.js:6`
- Evidence:
  - `process.env.JWT_SECRET || "uboncity_secret"` is used.
- Why it is risky:
  - If deploy forgets `JWT_SECRET`, attacker can mint valid admin/user JWTs using known default.
- Realistic abuse scenario:
  - Attacker signs own token with `"uboncity_secret"` and calls protected endpoints as admin.
- Recommended fix:
  - Remove fallback; fail fast on startup when `JWT_SECRET` is missing/weak.
  - Rotate JWT secret and invalidate existing tokens after fix.
- Must fix before private deploy: Yes

## Issue 4: Unauthenticated Translation Endpoint Can Burn OpenAI Budget
- Severity: High
- Where found:
  - `D:\UbonCity_Web\backend\routes\translateRoutes.js:7,10`
  - `D:\UbonCity_Web\backend\controllers\translateController.js:6`
  - `D:\UbonCity_Web\backend\services\translationService.js:61`
- Evidence:
  - `/api/translate` and `/api/translate/preview` are public and call `openai.chat.completions.create(...)`.
- Why it is risky:
  - Anyone can trigger paid API calls repeatedly.
- Realistic abuse scenario:
  - Bot floods translate endpoint, causing high cost and service degradation.
- Recommended fix:
  - Require authentication + role for translation preview.
  - Add strict per-IP and per-user rate limits and request size caps.
  - Add quota/budget guardrails and abuse monitoring.
- Must fix before private deploy: Yes

## Issue 5: Missing Rate Limiting and Brute-Force Protection
- Severity: High
- Where found:
  - `D:\UbonCity_Web\backend\server.js:22-23` (no limiter middleware)
  - `D:\UbonCity_Web\backend\controllers\authController.js:65,73`
  - `D:\UbonCity_Web\collector-app\server\index.mjs:390` (login endpoint, no limiter)
- Evidence:
  - No global/per-route rate limiter on auth or expensive endpoints.
- Why it is risky:
  - Enables credential stuffing, password guessing, and resource abuse.
- Realistic abuse scenario:
  - Automated login attempts against admin/collector accounts.
- Recommended fix:
  - Add rate limiting + account/IP lockout backoff on login and costly endpoints.
  - Add audit alerts for repeated failures.
- Must fix before private deploy: Yes

## Issue 6: Authorization and Ownership Gaps on Content Mutation Endpoints
- Severity: High
- Where found:
  - `D:\UbonCity_Web\backend\routes\placeRoutes.js:19,22`
  - `D:\UbonCity_Web\backend\routes\eventRoutes.js:16,17`
  - `D:\UbonCity_Web\backend\controllers\placeController.js:494,564`
  - `D:\UbonCity_Web\backend\controllers\eventController.js:248,312`
  - `D:\UbonCity_Web\backend\routes\mediaRoutes.js:25,26`
- Evidence:
  - Any authenticated token can create/update place/event and manipulate media usage.
  - No ownership check (`req.user.id`) is enforced on updates.
- Why it is risky:
  - Any low-privilege account can alter or deface content globally.
- Realistic abuse scenario:
  - Compromised editor/user token edits published records and swaps media.
- Recommended fix:
  - Enforce RBAC by route (`admin/editor` only for write operations).
  - Add explicit ownership/tenant checks where non-admin writes are allowed.
  - Add immutable audit trails for sensitive updates.
- Must fix before private deploy: Yes

## Issue 7: Collector Role Model Too Permissive for High-Impact Actions
- Severity: High
- Where found:
  - `D:\UbonCity_Web\collector-app\server\index.mjs:725,745,862,996,1016,1021,1039,1044,1082`
  - `D:\UbonCity_Web\collector-app\server\index.mjs:951,956,991`
- Evidence:
  - `requireRole("admin", "editor", "user")` on publish/export/sync-related operations.
  - Some run endpoints have no role gate (auth only).
- Why it is risky:
  - `user` role can execute workflow actions that should be restricted.
- Realistic abuse scenario:
  - Non-admin account publishes/syncs incorrect or malicious content.
- Recommended fix:
  - Restrict workflow-critical routes to `admin`/`editor` only.
  - Reserve `user` for read-only or narrowly scoped actions.
- Must fix before private deploy: Yes

## Issue 8: Stored/DOM XSS Risk in Collector UI
- Severity: High
- Where found:
  - `D:\UbonCity_Web\collector-app\server\public\app.js:89,109,159`
  - `D:\UbonCity_Web\collector-app\server\public\item-editor.js:138,163,241,413`
- Evidence:
  - Untrusted fields are injected via `innerHTML`.
  - `toPreviewBodyHtml` returns raw HTML when `<`/`>` appears.
- Why it is risky:
  - Scraped content or user-entered content can execute script in operator browser.
  - Tokens are stored in `localStorage`, increasing impact of XSS.
- Realistic abuse scenario:
  - Malicious source text injects script; script steals `collector_token` and performs privileged API actions.
- Recommended fix:
  - Remove raw `innerHTML` for untrusted content; render via text nodes or vetted sanitizer.
  - Store auth token in secure HttpOnly cookie if architecture permits.
  - Add CSP and output encoding.
- Must fix before private deploy: Yes

## Issue 9: Insecure File Upload Controls
- Severity: High
- Where found:
  - `D:\UbonCity_Web\collector-app\server\index.mjs:194,216,1175`
  - `D:\UbonCity_Web\collector-app\server\index.mjs:44` (`/media` static serving)
  - `D:\UbonCity_Web\backend\controllers\uploadController.js:72,76,90`
  - `D:\UbonCity_Web\backend\controllers\mediaController.js:302,306,316`
- Evidence:
  - Collector upload lacks robust MIME/signature filtering; static hosting serves uploaded files.
  - Backend trusts client-supplied mime type for base64 uploads; no magic-byte validation.
- Why it is risky:
  - Malicious files can be uploaded/stored; may lead to XSS/phishing/internal abuse.
- Realistic abuse scenario:
  - Attacker uploads HTML/script payload and shares internal link with operator.
- Recommended fix:
  - Enforce server-side file signature validation and strict allowlist.
  - Reject non-image content regardless of client-provided MIME.
  - Store uploads outside direct web root or serve through controlled download handler.
- Must fix before private deploy: Yes

## Issue 10: Sensitive Config Exposure via API
- Severity: Medium
- Where found:
  - `D:\UbonCity_Web\backend\controllers\transportController.js:445`
  - `D:\UbonCity_Web\collector-app\server\index.mjs:554`
- Evidence:
  - Backend returns `GOOGLE_MAPS_API_KEY` publicly.
  - Collector `/api/config` returns filesystem paths and db location to any authenticated user.
- Why it is risky:
  - Exposes internal topology and keys that may be abused if unrestricted.
- Realistic abuse scenario:
  - Low-privileged user enumerates internal paths and uses leaked key outside allowed domains.
- Recommended fix:
  - Use restricted browser keys only for client exposure.
  - Limit `/api/config` fields by role and remove sensitive path disclosures.
- Must fix before private deploy: Yes

## Issue 11: Verbose Internal Error Leakage to Clients
- Severity: Medium
- Where found:
  - Examples:
    - `D:\UbonCity_Web\backend\controllers\mediaController.js:210`
    - `D:\UbonCity_Web\backend\controllers\eventController.js:160`
    - `D:\UbonCity_Web\backend\controllers\categoryController.js:44`
- Evidence:
  - Many handlers return `res.status(500).json({ error: err.message })`.
- Why it is risky:
  - DB/stack/internal implementation details can be exposed to attackers.
- Realistic abuse scenario:
  - Malformed requests trigger SQL/schema error details used for targeted follow-up attacks.
- Recommended fix:
  - Return generic client-safe errors; log full details server-side only.
- Must fix before private deploy: Yes

## Issue 12: Missing Baseline Security Middleware in Backend
- Severity: Medium
- Where found:
  - `D:\UbonCity_Web\backend\server.js:22` (`cors()` with default permissive behavior)
- Evidence:
  - No `helmet`/security headers middleware.
  - No explicit CORS allowlist; permissive by default.
- Why it is risky:
  - Weakens browser-side protections and widens cross-origin API exposure.
- Realistic abuse scenario:
  - Future cookie-based auth or sensitive browser endpoints become cross-origin exploitable.
- Recommended fix:
  - Add `helmet` and strict CORS origin allowlist per environment.
  - Explicitly configure allowed methods/headers.
- Must fix before private deploy: Yes

---

## A. Top 10 Issues Summary
1. Plaintext production secrets in env files
2. Default collector admin credentials + auto-seeding
3. JWT fallback secret enables forgery on misconfig
4. Public translation endpoint can incur uncontrolled OpenAI spend
5. No rate limiting / brute-force defense
6. Backend ownership/authorization gaps for write operations
7. Collector role model allows low-privilege high-impact actions
8. Collector stored/DOM XSS via `innerHTML`
9. Insecure upload validation and serving model
10. Sensitive config/key exposure via APIs

## B. Must-fix before deploy
- Issue 1 through Issue 12 should be treated as pre-deploy blockers for a private deployment.

## C. Can fix later
- None recommended for deferment based on current risk posture.

## D. Missing security controls checklist
- [ ] Authentication brute-force/rate limiting
- [ ] Endpoint-level authorization policy matrix (admin/editor/user)
- [ ] Ownership checks on mutable resources
- [ ] Secure secret lifecycle (vault + rotation + scanning)
- [ ] Upload content validation by file signature
- [ ] Output encoding / XSS-safe rendering in collector UI
- [ ] Centralized safe error handling
- [ ] Security headers (`helmet`) + strict CORS policy
- [ ] Session expiration/invalidation policy (collector token TTL)
- [ ] Security monitoring/alerting for auth and export/publish flows

## E. Areas not verified
- Dependency CVE status via `npm audit`/SCA in CI (not verified)
- Runtime network controls, firewall rules, and reverse proxy hardening (not verified)
- TLS termination/certificate configuration for deployment targets (not verified)
- Database account privilege model and backup encryption (not verified)
- Any external nginx/pm2/docker configs not present in this workspace snapshot (not verified)
