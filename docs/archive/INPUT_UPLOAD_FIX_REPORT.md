# INPUT_UPLOAD_FIX_REPORT

## Scope
- `backend`
- `admin`/`frontend` only where API request shape is relevant

## Problems Found And Fixed

### 1) Incomplete/unsafe backend validation on create/update endpoints
- **Fixed in**:
  - `D:\UbonCity_Web\backend\validators\inputSanitizer.js`
  - `D:\UbonCity_Web\backend\validators\placeValidator.js`
  - `D:\UbonCity_Web\backend\validators\eventValidator.js`
  - `D:\UbonCity_Web\backend\validators\categoryValidator.js`
  - `D:\UbonCity_Web\backend\controllers\placeController.js`
  - `D:\UbonCity_Web\backend\controllers\eventController.js`
  - `D:\UbonCity_Web\backend\controllers\translateController.js`
  - `D:\UbonCity_Web\backend\controllers\transportController.js`
  - `D:\UbonCity_Web\backend\controllers\lifecycleController.js`
- **What changed**:
  - Added shared validation/sanitization utilities for plain text, rich text, slug, URL, numeric ranges, array size limits, and filename safety.
  - Enforced strict payload validation in create/update/import flows.
  - Added numeric ID validation for update/detail/delete routes where IDs were previously weakly handled.
  - Added hard limits for bulk import array sizes and CSV payload size.
  - Added clean 400 responses for malformed client input instead of silent acceptance.
- **Why safe**:
  - Uses explicit allowlists/length limits and centralized reusable helpers.
  - Fails closed on malformed and oversized input.

### 2) File upload safety gaps (type/size/base64 validation)
- **Fixed in**:
  - `D:\UbonCity_Web\backend\controllers\uploadController.js`
  - `D:\UbonCity_Web\backend\controllers\mediaController.js`
- **What changed**:
  - Enforced MIME allowlist and normalized MIME casing.
  - Enforced strict base64 character validation and pre-decode size checks.
  - Enforced max upload size (`5MB` for `/upload/image`, `8MB` for media upload).
  - Verified image signature bytes match declared MIME type.
  - Sanitized stored filename/path fields and blocked traversal-like path input.
- **Why safe**:
  - Prevents spoofed content-type, malformed binary payloads, and oversized payload abuse.

### 3) Unsafe metadata/content handling (stored XSS risk)
- **Fixed in**:
  - `D:\UbonCity_Web\backend\validators\inputSanitizer.js`
  - `D:\UbonCity_Web\backend\controllers\mediaController.js`
  - `D:\UbonCity_Web\backend\controllers\transportController.js`
  - `D:\UbonCity_Web\backend\controllers\lifecycleController.js`
- **What changed**:
  - Sanitized rich text by removing script/style tags, inline event handlers, and `javascript:` patterns.
  - Rejected HTML in plain text fields (`title`, `slug`-adjacent plain metadata, alt/caption/credit type fields).
  - Added strict length limits for SEO and metadata fields.
- **Why safe**:
  - Reduces stored XSS injection surface in content/admin-managed text.

### 4) Regression fixes discovered during hardening pass
- **Fixed in**:
  - `D:\UbonCity_Web\backend\controllers\placeController.js`
  - `D:\UbonCity_Web\backend\controllers\eventController.js`
- **What changed**:
  - Fixed undefined variable usage in update paths and enforced valid ID checks.
- **Why safe**:
  - Prevents runtime failures and unintended updates.

## Remaining Risks
- Rich text sanitization is intentionally simple (regex-based) and not equivalent to a full HTML policy sanitizer. For higher assurance, migrate to a vetted HTML sanitizer with explicit allowed tags/attributes.
- `article` existence checks in media usage are not verified against a local table (entity is external/not guaranteed in this codebase).
- End-to-end UI regression for all admin forms was **not fully verified** in this run.

## Manual Follow-up Required
- Validate admin UI flows still submit accepted payloads after stricter backend validation (especially media register/update, transport import/create, lifecycle import).
- Verify reverse proxy/body-size settings align with backend limits to avoid inconsistent failures.

## Validation Performed
- Syntax verification completed with `node --check` on all updated backend controllers/validators.
