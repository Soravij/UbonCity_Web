# MANUAL_ATTACK_TEST_CASES

Purpose: practical attacker-style manual checks against this codebase.

Notes:
- Replace `<HOST>` with deployed base URL.
- Replace `<USER_TOKEN>` with a valid non-admin token unless stated otherwise.
- These are test ideas derived from code paths; execute only in authorized test environments.

## Test Case 1
- Goal: Burn translation API budget without login
- Endpoint or area: `POST /api/translate/preview`
- Request idea:
  - Repeated unauthenticated requests with large title/description payloads.
- Expected insecure behavior:
  - 200 responses and OpenAI-backed processing without auth/rate control.
- Severity: High

## Test Case 2
- Goal: Confirm low-privilege can create place records
- Endpoint or area: `POST /api/places`
- Request idea:
  - Send valid place payload with `Authorization: Bearer <USER_TOKEN>`.
- Expected insecure behavior:
  - Place created even if caller is not admin/editor.
- Severity: High

## Test Case 3
- Goal: Confirm low-privilege can overwrite existing place
- Endpoint or area: `PUT /api/places/:id`
- Request idea:
  - Pick another user's/admin-created place ID and update title/body/image.
- Expected insecure behavior:
  - Update succeeds without ownership check.
- Severity: High

## Test Case 4
- Goal: Enumerate unpublished places
- Endpoint or area: `GET /api/places?category=...&lang=th&include_unapproved=1`
- Request idea:
  - Use any valid non-admin token.
- Expected insecure behavior:
  - Response includes unapproved content.
- Severity: Medium

## Test Case 5
- Goal: Confirm low-privilege can create events
- Endpoint or area: `POST /api/events`
- Request idea:
  - Send event payload using non-admin token.
- Expected insecure behavior:
  - Event created with non-admin role.
- Severity: High

## Test Case 6
- Goal: Confirm low-privilege can modify existing events
- Endpoint or area: `PUT /api/events/:id`
- Request idea:
  - Change title/description/image of existing event with non-admin token.
- Expected insecure behavior:
  - Update accepted without ownership check.
- Severity: High

## Test Case 7
- Goal: Enumerate unpublished events
- Endpoint or area: `GET /api/events?include_unapproved=1`
- Request idea:
  - Query as non-admin authenticated user.
- Expected insecure behavior:
  - Returns unapproved events.
- Severity: Medium

## Test Case 8
- Goal: Tamper media usage mappings across entities
- Endpoint or area: `POST /api/media-usages`
- Request idea:
  - Attach attacker-controlled asset to arbitrary `entity_type/entity_id` as non-admin.
- Expected insecure behavior:
  - Mapping accepted without ownership/role enforcement.
- Severity: High

## Test Case 9
- Goal: Overwrite legacy cover image via media usage side-effect
- Endpoint or area: `POST /api/media-usages` with `apply_legacy_cover=true`
- Request idea:
  - Set `usage_type=cover` and target another entity ID.
- Expected insecure behavior:
  - Place/event `image` is updated indirectly.
- Severity: High

## Test Case 10
- Goal: Probe login account enumeration
- Endpoint or area: `POST /api/login`
- Request idea:
  - Send one known-bad email and one existing email with bad password.
- Expected insecure behavior:
  - Different error messages (`User not found` vs `Wrong password`) reveal account existence.
- Severity: Medium

## Test Case 11
- Goal: Brute-force login feasibility
- Endpoint or area: `POST /api/login` and `POST /api/auth/login` (collector)
- Request idea:
  - Rapid repeated login attempts from same IP.
- Expected insecure behavior:
  - No lockout/rate-limit response.
- Severity: High

## Test Case 12
- Goal: Test collector user privilege over workflow execution
- Endpoint or area: collector `POST /api/run/publish`, `/api/run/export`, `/api/run/sync-backend`
- Request idea:
  - Login as collector role `user`, then call those endpoints directly.
- Expected insecure behavior:
  - Endpoints execute due permissive role list.
- Severity: High

## Test Case 13
- Goal: Test auth-only workflow routes without role gate
- Endpoint or area: collector `POST /api/run/clean`, `/api/run/ai-draft`, `/api/run/quality`
- Request idea:
  - Call as lowest authenticated role.
- Expected insecure behavior:
  - High-impact workflow actions succeed without strict role checks.
- Severity: High

## Test Case 14
- Goal: Stored XSS in collector raw list
- Endpoint or area: collector UI `app.js` table rendering
- Request idea:
  - Insert content item title like `<img src=x onerror=alert(1)>` through import/collect path.
- Expected insecure behavior:
  - Script executes when table row renders via `innerHTML`.
- Severity: High

## Test Case 15
- Goal: Stored XSS in collector preview/body rendering
- Endpoint or area: collector item editor `item-editor.js`
- Request idea:
  - Set description containing `<script>alert(1)</script>` or JS event payload.
- Expected insecure behavior:
  - `toPreviewBodyHtml` returns raw HTML and `root.innerHTML` renders executable content.
- Severity: High

## Test Case 16
- Goal: Upload dangerous non-image file in collector
- Endpoint or area: `POST /api/assets/upload`
- Request idea:
  - Upload `.html` or script-like file with crafted MIME.
- Expected insecure behavior:
  - File accepted and reachable under `/media/...`.
- Severity: High

## Test Case 17
- Goal: Bypass file type assumptions in backend base64 upload
- Endpoint or area: `POST /api/upload/image` and `POST /api/media-assets/upload`
- Request idea:
  - Send non-image bytes in base64 while declaring allowed MIME.
- Expected insecure behavior:
  - Server stores payload because no signature verification.
- Severity: High

## Test Case 18
- Goal: Discover sensitive configuration data
- Endpoint or area:
  - `GET /api/transport/config`
  - collector `GET /api/config`
- Request idea:
  - Call directly (collector with any auth token).
- Expected insecure behavior:
  - Returns Google Maps key and internal filesystem/database paths.
- Severity: Medium

## Test Case 19
- Goal: Trigger verbose server error leakage
- Endpoint or area: multiple backend controllers returning `err.message`
- Request idea:
  - Send malformed JSON/body types and invalid IDs to force DB/runtime errors.
- Expected insecure behavior:
  - Internal error messages are returned to client.
- Severity: Medium

## Test Case 20
- Goal: Validate frontend-only admin guard bypass by direct API
- Endpoint or area: admin UI vs backend write routes
- Request idea:
  - As non-admin token, skip UI and call `PUT /api/places/:id`, `PUT /api/events/:id` directly.
- Expected insecure behavior:
  - Requests succeed despite hidden UI/admin-only navigation.
- Severity: High

## Quick attacker sequence (first 30 minutes)
1. Hit `/api/translate/preview` unauthenticated in loop.
2. Login with any low-priv user.
3. Enumerate unapproved places/events.
4. Modify target place/event IDs directly.
5. Attempt collector `user` workflow endpoints (`publish/export/sync`).
6. Inject XSS payload into collector-rendered fields.
7. Upload unexpected file types and test `/media/*` serving.

## Must-fix findings before deploy
- Unauthenticated translation abuse path.
- Missing rate limiting for login and expensive routes.
- Backend mutation endpoints lacking strict RBAC/ownership checks.
- Collector role model allowing low-privileged workflow execution.
- Collector stored XSS sinks (`innerHTML` + raw HTML path).
- Upload validation weaknesses.
- Sensitive config/key exposure endpoints.
- Verbose error leakage.

## Not verified
- External reverse proxy/WAF behavior (not verified).
- Real production network segmentation/access restrictions (not verified).
- Dependency CVE scan output in CI (not verified).
