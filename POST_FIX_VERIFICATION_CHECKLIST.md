# POST_FIX_VERIFICATION_CHECKLIST

## 1) Secret and startup checks
- [ ] Backend fails to start if `JWT_SECRET` is missing or weak (<32 chars / placeholder-like).
- [ ] Collector fails to start if `ADMIN_PASSWORD` is missing/weak/default.
- [ ] `.env` files in workspace contain placeholders only (no live production secrets).
- [ ] Production secret manager values are present for backend + collector.

## 2) API auth and permission checks
### Backend
- [ ] `POST /api/translate/preview` without token returns `401`.
- [ ] `POST /api/translate/preview` with `user` token returns `403`.
- [ ] `POST /api/translate/preview` with `editor/admin` token succeeds.
- [ ] `POST /api/places` with `user` token returns `403`.
- [ ] `POST /api/places` with `editor/admin` token succeeds.
- [ ] `PUT /api/events/:id` with `user` token returns `403`.
- [ ] `PUT /api/events/:id` with `editor/admin` token succeeds.
- [ ] `POST /api/media-usages` with `user` token returns `403`.
- [ ] `POST /api/media-usages` with `editor/admin` token succeeds.
- [ ] `GET /api/places?include_unapproved=1` with non-privileged token does not return unapproved items.
- [ ] `GET /api/places?include_unapproved=1` with `editor/admin` token includes unapproved items.

### Collector
- [ ] `POST /api/run/clean` with `user` role returns `403`.
- [ ] `POST /api/run/ai-draft` with `user` role returns `403`.
- [ ] `POST /api/run/export` with `user` role returns `403`.
- [ ] `POST /api/run/sync-backend` with `user` role returns `403`.
- [ ] `POST /api/items` with `user` role returns `403`.
- [ ] `POST /api/items` with `editor/admin` succeeds.
- [ ] `GET /api/config` with non-admin returns `403`.
- [ ] `GET /api/config` with admin succeeds and does not include internal path fields.

## 3) Rate-limit checks
### Backend
- [ ] Repeated login attempts to `POST /api/login` trigger `429` after configured threshold.
- [ ] Burst calls to `POST /api/translate/preview` from same user trigger `429`.

### Collector
- [ ] Repeated `POST /api/auth/login` requests trigger `429`.
- [ ] Burst calls to `/api/run/*` and `/api/collect` trigger `429` for same user.
- [ ] Burst uploads to `POST /api/assets/upload` trigger `429`.

## 4) Upload security checks
### Backend
- [ ] `POST /api/upload/image` with valid JPEG/PNG/WEBP/GIF passes.
- [ ] `POST /api/upload/image` with spoofed MIME (e.g., JS file labeled image/jpeg) fails `400`.
- [ ] `POST /api/media-assets/upload` with spoofed MIME/signature mismatch fails `400`.

### Collector
- [ ] `POST /api/assets/upload` rejects unsupported MIME types.
- [ ] `POST /api/assets/upload` rejects signature mismatch and removes invalid file.

## 5) XSS and frontend checks
- [ ] Collector login and dashboard still function with session token storage.
- [ ] Refresh tab clears session if browser tab/session is closed (sessionStorage behavior).
- [ ] Create item title containing `<script>alert(1)</script>` and verify it renders as text, not script execution.
- [ ] Inject payloads in source adapter fields, user display names, and image metadata; verify no script execution in:
  - `collector-app` dashboard tables
  - item editor preview blocks
  - picker/gallery cards
- [ ] Content preview still renders text body safely (escaped) without executing HTML.

## 6) Health/config exposure checks
- [ ] `GET /api/health` (backend) returns minimal payload and no secrets/paths.
- [ ] `GET /api/health` (collector) returns minimal payload and no DB path.
- [ ] `GET /api/config` (collector) excludes `rawDir`, `stagingDir`, `exportDir`, `mediaDir`, `dbPath`.
- [ ] `GET /api/transport/config` only returns browser-safe key value (if configured via `GOOGLE_MAPS_BROWSER_KEY`).

## 7) CORS/security headers checks
### Backend responses
- [ ] `X-Content-Type-Options: nosniff` present.
- [ ] `X-Frame-Options: DENY` present.
- [ ] `Referrer-Policy` present.
- [ ] Only allowlisted origins receive CORS allow headers.

### Collector responses
- [ ] CSP header present.
- [ ] Disallowed cross-origin requests receive `403` from CORS middleware.
- [ ] Allowlisted origin works for browser calls.

## 8) Error-leak checks
- [ ] Force backend 5xx (e.g., DB down) and verify client receives generic `Internal server error`.
- [ ] Force collector 5xx and verify generic `Internal server error` (no stack/details in API response).
- [ ] Confirm detailed errors remain available in server logs for debugging.

## 9) Deploy/config checks
- [ ] `CORS_ALLOWED_ORIGINS` set explicitly per environment for backend and collector.
- [ ] `JWT_SECRET` and `ADMIN_PASSWORD` provided via deployment secret manager.
- [ ] Collector is deployed internal-only (VPN/private network/IP allowlist), not public internet.

## 10) Regression smoke checks
- [ ] Backend auth/login/register still function for expected admin/editor flows.
- [ ] Places/events create/update/approve/delete flows work with intended roles.
- [ ] Media upload/register/usage flows work for editor/admin roles.
- [ ] Collector end-to-end flow (collect -> clean -> ai draft -> quality -> publish/stage/export) works for editor/admin.
