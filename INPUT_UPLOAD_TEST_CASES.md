# INPUT_UPLOAD_TEST_CASES

## Invalid Input Cases

1. **Missing required title**
- Goal: verify required field enforcement
- Endpoint: `POST /api/events`
- Request idea: `{ "description": "x" }`
- Expected: `400` with clean validation error, no stack trace

2. **Invalid slug format**
- Goal: reject unsafe/invalid slug
- Endpoint: `POST /api/categories`
- Request idea: `{ "slug": "../../admin<script>", "lang": "th", "title": "Cat" }`
- Expected: `400` (`slug format is invalid`)

3. **Invalid URL in image/source_url**
- Goal: reject non-http(s) URL / traversal-like path
- Endpoint: `POST /api/media-assets/register`
- Request idea: `source_url: "javascript:alert(1)"`
- Expected: `400`

4. **Invalid numeric IDs**
- Goal: prevent malformed ID access paths
- Endpoint: `PUT /api/places/:id`, `PUT /api/events/:id`
- Request idea: use `id=abc`
- Expected: `400` invalid ID

## Oversized Payload Cases

1. **CSV import too large**
- Goal: reject oversized CSV input
- Endpoint: `POST /api/places/import-csv`
- Request idea: `csvText` > configured max (`LIMITS.CSV_TEXT_MAX`)
- Expected: `400` (`csvText is too large`)

2. **Bulk import too many rows**
- Goal: reject large batch abuse
- Endpoint: `POST /api/places/import`
- Request idea: `items.length > LIMITS.IMPORT_ITEMS_MAX`
- Expected: `400`

3. **Lifecycle import oversized arrays**
- Goal: reject oversized collector payload
- Endpoint: `POST /api/lifecycle/import-published`
- Request idea: `published` or `translations` above configured max
- Expected: `400`

4. **Transport oversized points/stops**
- Goal: prevent JSON/DB abuse via huge route payloads
- Endpoint: `POST /api/transport-routes` and `/api/transport-routes/import-geojson`
- Request idea: points > `LIMITS.ROUTE_POINTS_MAX` or stops > `LIMITS.ROUTE_STOPS_MAX`
- Expected: `400`

## Dangerous String Cases

1. **Stored XSS in plain text field**
- Goal: reject HTML in plain metadata
- Endpoint: `POST /api/media-assets/register`
- Request idea: `title: "<img src=x onerror=alert(1)>"`
- Expected: `400` (`must not contain HTML`)

2. **Script payload in rich text body**
- Goal: strip/reject high-risk HTML vectors
- Endpoint: `POST /api/places`
- Request idea: `description: "<script>alert(1)</script><p>safe</p>"`
- Expected: request accepted/rejected per field rules, but script payload not stored as executable script content

3. **Event handler injection in rich text**
- Goal: neutralize inline JS handlers
- Endpoint: `POST /api/events`
- Request idea: `description: "<p onclick=alert(1)>x</p>"`
- Expected: sanitized output / no executable handler retained

## Upload Rejection Cases

1. **Unsupported MIME**
- Goal: reject disallowed file types
- Endpoint: `POST /api/upload/image`
- Request idea: `mimeType: "image/svg+xml"`
- Expected: `400` unsupported image type

2. **MIME/signature mismatch**
- Goal: block spoofed extension/MIME
- Endpoint: `POST /api/upload/image` and `POST /api/media-assets/upload`
- Request idea: send PNG bytes with `mimeType: "image/jpeg"`
- Expected: `400` signature mismatch

3. **Oversized base64 upload**
- Goal: enforce max upload size
- Endpoint: `POST /api/upload/image` and `POST /api/media-assets/upload`
- Request idea: payload > endpoint size limit
- Expected: `400` file too large

4. **Malformed base64**
- Goal: reject invalid binary encoding
- Endpoint: `POST /api/upload/image`
- Request idea: `dataBase64: "@@@notbase64@@@"`
- Expected: `400`

## Valid Upload Success Cases

1. **Valid JPEG upload (editor/admin token)**
- Goal: verify success path still works
- Endpoint: `POST /api/upload/image`
- Request idea: correct JPEG base64 + `mimeType: "image/jpeg"`
- Expected: `200`, returns `fileName` and `url`

2. **Valid media upload with metadata**
- Goal: verify media DB record creation
- Endpoint: `POST /api/media-assets/upload`
- Request idea: valid image base64 + safe metadata fields
- Expected: `201`, returns created media item with `public_url`

3. **Valid media usage link**
- Goal: ensure entity-linking remains functional
- Endpoint: `POST /api/media-usages`
- Request idea: valid `asset_id`, `entity_type`, `entity_id`, safe caption
- Expected: `201`

## API/Auth Checks

1. Unauthenticated upload/media write request should return `401/403` based on middleware.
2. Non-admin should not be able to call admin-only endpoints.
3. Validation errors should always return clean JSON and never stack traces.

## UI Checks

1. Admin create/edit forms should show backend validation errors without crashing.
2. Media upload UI should handle rejected file types/sizes cleanly.
3. Transport import UI should surface max-size validation responses.

## Deploy/Config Checks

1. Confirm reverse proxy/body-size limits are >= backend accepted payloads and not unlimited.
2. Confirm upload directory permissions allow write for app user only.
3. Confirm public static `/uploads` serves files but does not allow directory listing.
