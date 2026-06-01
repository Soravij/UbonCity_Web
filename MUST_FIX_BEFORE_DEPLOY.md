# MUST FIX BEFORE DEPLOY

Audit gate date: 2026-03-11

These items are blocking issues for private deployment.

## 1) Rotate and remove exposed secrets immediately
- Evidence:
  - `D:\UbonCity_Web\backend\.env:5,8,11,12`
  - `D:\UbonCity_Web\collector-app\.env:3,6,11`
- Required action:
  - Revoke/rotate DB password, JWT secret, OpenAI keys, Google Maps keys.
  - Remove real values from workspace env files and keep placeholders only.
  - Move secrets to deployment secret manager.

## 2) Remove default collector admin credential fallback
- Evidence:
  - `D:\UbonCity_Web\collector-app\db\client.mjs:22`
  - `D:\UbonCity_Web\collector-app\README.md:23-25`
- Required action:
  - Fail startup if admin password is missing/weak.
  - Remove `admin1234` fallback and default credential guidance for production.

## 3) Remove JWT fallback secret and enforce strong secret policy
- Evidence:
  - `D:\UbonCity_Web\backend\middleware\authMiddleware.js:3`
- Required action:
  - Remove hardcoded fallback (`"uboncity_secret"`).
  - Startup must fail without strong `JWT_SECRET`.

## 4) Lock down translation endpoints and add abuse controls
- Evidence:
  - `D:\UbonCity_Web\backend\routes\translateRoutes.js:7,10`
  - `D:\UbonCity_Web\backend\services\translationService.js:61`
- Required action:
  - Require auth + role for translation preview.
  - Add per-IP/per-user rate limits and quotas.

## 5) Add login and API rate limiting
- Evidence:
  - `D:\UbonCity_Web\backend\server.js:22-23`
  - `D:\UbonCity_Web\collector-app\server\index.mjs:390`
- Required action:
  - Add brute-force protection for `/login` (backend + collector).
  - Add rate limiting for costly routes (`translate`, pipeline runs, export/sync).

## 6) Enforce real RBAC and ownership checks on write paths
- Evidence:
  - `D:\UbonCity_Web\backend\routes\placeRoutes.js:19,22`
  - `D:\UbonCity_Web\backend\routes\eventRoutes.js:16,17`
  - `D:\UbonCity_Web\backend\routes\mediaRoutes.js:25,26`
- Required action:
  - Restrict write operations to intended roles (`admin/editor`).
  - Add ownership checks where non-admin writes are allowed.

## 7) Tighten collector permission model
- Evidence:
  - `D:\UbonCity_Web\collector-app\server\index.mjs:725,745,862,996,1016,1021,1039,1044,1082`
  - `D:\UbonCity_Web\collector-app\server\index.mjs:951,956,991`
- Required action:
  - Remove `user` from privileged run/publish/export/sync endpoints.
  - Apply explicit role checks on currently auth-only workflow routes.

## 8) Fix collector XSS sinks
- Evidence:
  - `D:\UbonCity_Web\collector-app\server\public\app.js:89,109,159`
  - `D:\UbonCity_Web\collector-app\server\public\item-editor.js:138,163,241,413`
- Required action:
  - Replace `innerHTML` rendering for untrusted content.
  - Sanitize rich text strictly or render as text.
  - Add CSP and token-hardening strategy.

## 9) Harden upload validation and serving strategy
- Evidence:
  - `D:\UbonCity_Web\collector-app\server\index.mjs:194,216,1175`
  - `D:\UbonCity_Web\backend\controllers\uploadController.js:72,76,90`
- Required action:
  - Validate file signatures (magic bytes), not only MIME from request.
  - Restrict uploaded file types and isolate storage from direct executable serving.

## 10) Remove sensitive information disclosure in APIs and errors
- Evidence:
  - `D:\UbonCity_Web\backend\controllers\transportController.js:445`
  - `D:\UbonCity_Web\collector-app\server\index.mjs:554`
  - multiple `res.status(500).json({ error: err.message })` in backend controllers
- Required action:
  - Avoid exposing internal paths/config to low-privilege users.
  - Return generic 5xx messages; keep full details only in server logs.

## 11) Add baseline HTTP hardening
- Evidence:
  - `D:\UbonCity_Web\backend\server.js:22`
- Required action:
  - Add `helmet` and strict CORS allowlist.
  - Explicitly restrict allowed origins/methods/headers.

## Deploy decision
- Status: **Do not deploy** until all items above are fixed and re-tested.
