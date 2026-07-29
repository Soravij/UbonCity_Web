# ATTACK_SURFACE_REPORT

Attacker-minded review date: 2026-03-11

## 1) Attack surface summary

### Publicly reachable surfaces (expected in deployment)
- Backend API (`/api/*`) + static file serving:
  - `/uploads/*` and `/transport/*` from backend static mounts (`backend/server.js:24-25`).
- Admin SPA (browser app) stores bearer tokens in `localStorage` (`admin/src/App.jsx:32,101`).
- Collector web app serves public UI/static files and API under same origin (`collector-app/server/index.mjs:44-45,417`).

### High-risk trust boundaries
- UI role checks in admin are not a backend security boundary.
- Collector has authenticated endpoints where role checks are weak or effectively allow all roles (`requireRole("admin", "editor", "user")`).
- Backend includes endpoints that are authenticated but not ownership-scoped.

## 2) Most likely attack scenarios

1. Use low-privilege token to alter core content globally
- Why likely: place/event update endpoints are `protect` only, no ownership checks.
- Impact: defacement, misinformation, SEO abuse, data integrity loss.

2. Abuse translation endpoints for OpenAI-cost DoS
- Why likely: `/api/translate` and `/api/translate/preview` are unauthenticated.
- Impact: API budget drain, service instability.

3. Stored XSS inside collector UI to steal bearer token
- Why likely: collector UI uses `innerHTML` with untrusted data and intentionally returns raw HTML on `<`/`>`.
- Impact: session theft + unauthorized API actions (publish/export/sync).

4. Non-admin collector account triggers privileged workflow actions
- Why likely: many sensitive routes allow `user` role or no role gate beyond auth.
- Impact: unauthorized publishing/staging/export/sync to backend.

5. Enumerate unpublished backend content using normal user token
- Why likely: `include_unapproved=1` only checks for any valid token.
- Impact: disclosure of pending/unapproved content.

## 3) Privilege escalation paths

### Path A: "user" token -> content control (backend)
- Evidence:
  - `POST /places` and `PUT /places/:id` are `protect` only (`backend/routes/placeRoutes.js:19,22`).
  - `POST /events` and `PUT /events/:id` are `protect` only (`backend/routes/eventRoutes.js:16,17`).
- Result:
  - Any authenticated user can mutate shared records.

### Path B: collector user -> publish/export control
- Evidence:
  - Sensitive endpoints use `requireRole("admin", "editor", "user")` (`collector-app/server/index.mjs:1016,1021,1044,1082`).
  - Some run endpoints are auth-only (`/api/run/clean`, `/api/run/ai-draft`, `/api/run/quality`) (`collector-app/server/index.mjs:951,956,991`).
- Result:
  - Role separation is weak; low privilege can execute high-impact workflow.

### Path C: XSS -> token theft -> API takeover (collector)
- Evidence:
  - `collector_token` is in `localStorage` (`collector-app/server/public/app.js:2`).
  - Multiple `innerHTML` sinks with untrusted values (`collector-app/server/public/app.js:89,109,159`; `item-editor.js:163,241,413`).
- Result:
  - Script execution can exfiltrate token and chain into publish/export actions.

## 4) Sensitive data exposure paths

1. Plaintext secrets in env files
- `backend/.env` contains DB password, JWT secret, OpenAI and Google keys.
- `collector-app/.env` contains admin password and API keys.

2. Public maps key exposure endpoint
- `GET /api/transport/config` returns `GOOGLE_MAPS_API_KEY` (`backend/controllers/transportController.js:445`).

3. Internal path leakage from collector config endpoint
- `GET /api/config` returns raw/staging/export/media/db paths (`collector-app/server/index.mjs:554-566`).

4. Auth error messages aid account enumeration
- Login returns distinct `User not found` vs `Wrong password` (`backend/controllers/authController.js:65,73`).

5. Verbose server errors
- Many controllers return raw `err.message`, leaking internal details.

## 5) Frontend-only protection failures

1. Admin route access is gated in client router only
- `normalizePath` checks role in frontend (`admin/src/App.jsx:49-66`).
- This does not secure direct API requests.

2. Hiding admin menu does not prevent API calls
- Dashboard hides pages for non-admin in UI.
- Backend still permits dangerous non-admin mutations on several endpoints.

3. Collector UI role visibility != API authorization hardness
- Even if a tab/button is hidden, direct API calls remain possible where route checks are weak.

## 6) Quick wins an attacker would try first

1. Call `/api/translate/preview` in a loop with large payloads.
2. Login as any non-admin user and directly `PUT /api/places/:id` and `PUT /api/events/:id`.
3. Enumerate unpublished items with `include_unapproved=1` using low-privilege token.
4. Inject HTML/JS in collector content fields and open affected page in operator UI.
5. Use collector `user` account to call `/api/run/publish`, `/api/run/export`, `/api/run/sync-backend`.
6. Upload unexpected files to collector upload and deliver links from `/media/*`.

## 7) Must-fix findings before deploy

1. Remove exposed real secrets and rotate all leaked credentials.
2. Remove default collector admin password fallback and enforce strong bootstrap.
3. Remove JWT fallback secret and fail startup when secret is missing/weak.
4. Protect translation endpoints with auth+role and strong rate limiting.
5. Add brute-force and API abuse rate limiting (backend + collector).
6. Enforce RBAC + ownership checks on place/event/media mutations.
7. Restrict collector publish/export/sync/run endpoints to intended roles only.
8. Eliminate collector `innerHTML` XSS sinks; sanitize and encode all untrusted output.
9. Harden upload validation (signature-based) and serving model.
10. Reduce sensitive API/config leakage and replace verbose error responses.

## 8) Routes/paths not fully verified

- Network exposure model for each service in real deployment (not verified).
- Reverse proxy/security controls (nginx/pm2/docker) are not present in this workspace snapshot (not verified).
- Dependency CVE status through SCA/audit pipeline (not verified).
