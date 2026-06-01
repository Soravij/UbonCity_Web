# MANUAL_PRIVATE_DEPLOY_TEST_PLAN

## 0) How to use this plan
- Goal: run this checklist before private deployment and decide go/no-go.
- Audience: non-software-engineer founder/operator.
- Test environment: private staging that matches production settings as closely as possible.
- Record results: for each test, write `PASS` or `FAIL` and short notes.

## 1) Pre-test setup

### Test accounts needed
1. Admin account (full access)
2. Editor account (content access, no admin-only actions)
3. Normal user account (lowest access, if app supports it)

### Tools
1. Browser (Chrome/Edge)
2. Private/Incognito browser window
3. API tool (Postman) or simple curl runner

### URLs to prepare
1. Frontend URL
2. Admin URL
3. Backend API base URL
4. Collector-app URL (if accessible in your private network)

### Pass criteria
- All URLs open correctly where expected.

### Fail criteria
- Any required URL is inaccessible or points to wrong environment.

## 2) Login / logout / session tests

### 2.1 Valid login
1. Open Admin URL.
2. Login with Admin account.
3. Confirm dashboard loads.

Pass:
- Login succeeds and expected dashboard appears.

Fail:
- Cannot login with valid credentials.

### 2.2 Invalid login
1. Logout.
2. Try wrong password.

Pass:
- Login is rejected with safe message (no stack trace, no SQL/technical details).

Fail:
- Login succeeds incorrectly or detailed internal error is shown.

### 2.3 Session expiry / invalid token behavior
1. Login.
2. Open browser dev tools and clear stored auth token/session data.
3. Refresh page.

Pass:
- App redirects to login or shows unauthorized state safely.

Fail:
- User remains authenticated unexpectedly.

### 2.4 Logout
1. Login.
2. Click Logout.
3. Use browser Back button.

Pass:
- User is still logged out and cannot access protected pages.

Fail:
- Back button restores protected access.

## 3) Admin vs normal user permission tests

### 3.1 Admin-only pages
1. Login as normal user (or editor if no normal user).
2. Try opening admin-only sections (users, approvals, imports, settings requiring admin).

Pass:
- Access denied or redirected safely.

Fail:
- Non-admin can access admin-only pages/actions.

### 3.2 Editor limitations
1. Login as editor.
2. Try admin-only actions (user role changes, destructive deletes, approval-only operations if admin-only).

Pass:
- Editor blocked from admin-only operations.

Fail:
- Editor can perform admin-only actions.

### 3.3 Direct URL attempt
1. As non-admin, manually type protected admin page URLs.

Pass:
- Access denied/redirected.

Fail:
- Page and actions are available.

## 4) Create / edit / delete content tests

### 4.1 Create content
1. Login as editor/admin.
2. Create a place and an event with normal valid values.

Pass:
- Content is created successfully and appears where expected.

Fail:
- Save fails for valid data.

### 4.2 Edit content
1. Edit title/description/image of existing content.
2. Save and reload page.

Pass:
- Changes persist correctly.

Fail:
- Changes are lost or wrong record is changed.

### 4.3 Delete content (admin)
1. Login as admin.
2. Delete one test item.
3. Confirm item is gone from listing and detail view.

Pass:
- Item is deleted and not retrievable.

Fail:
- Item still visible or wrong item deleted.

## 5) Upload image/file tests

### 5.1 Valid image upload
1. Upload a normal JPG/PNG/WebP image under size limit.

Pass:
- Upload succeeds and image renders correctly.

Fail:
- Valid image is rejected.

### 5.2 Invalid type upload
1. Rename a `.txt` or `.js` file to `.jpg` and upload.

Pass:
- Upload rejected with safe error.

Fail:
- Fake image is accepted.

### 5.3 Oversize upload
1. Upload image larger than allowed limit.

Pass:
- Upload rejected with clear size message.

Fail:
- Oversized file accepted or server crashes.

### 5.4 Mismatch MIME/signature
1. Upload file with mismatched type (if easy via API tool).

Pass:
- Request rejected.

Fail:
- Mismatched file accepted.

## 6) Malformed input tests

### 6.1 Required fields missing
1. Submit create/edit forms with required fields blank.

Pass:
- Safe validation error shown.

Fail:
- Record saved with broken data or internal error shown.

### 6.2 Very long input
1. Paste extremely long text in title/slug/meta fields.

Pass:
- Rejected with validation message.

Fail:
- App hangs/crashes or accepts clearly unsafe lengths.

### 6.3 Dangerous strings (XSS probe)
1. Use test strings like `<script>alert(1)</script>` in title, caption, alt text, notes.
2. Save and reopen list/detail pages.

Pass:
- Script does not execute; content is escaped/sanitized.

Fail:
- Any script popup/execution happens.

## 7) Direct API abuse checks

Use Postman/curl with backend API base URL.

### 7.1 Unauthenticated protected request
1. Call protected endpoints without token (create/update/delete routes).

Pass:
- Returns 401/403 only.

Fail:
- Request succeeds.

### 7.2 Role bypass attempt
1. Use non-admin token to call admin-only endpoints.

Pass:
- Returns 403.

Fail:
- Action succeeds.

### 7.3 ID tampering
1. Try editing/deleting records by changing ID in API call to another record.

Pass:
- Unauthorized/invalid operations blocked appropriately.

Fail:
- Data from unintended records is modified/read.

### 7.4 Lifecycle sync misuse
1. Call lifecycle import endpoint without sync token.
2. Call with invalid token.

Pass:
- Rejected every time.

Fail:
- Request accepted without valid token.

## 8) Error message safety checks

### 8.1 Trigger controlled errors
1. Send intentionally bad payloads.
2. Observe API responses and UI messages.

Pass:
- Errors are clean and generic enough (no stack trace, file paths, SQL text, secrets).

Fail:
- Internal technical details leak to UI/API response.

### 8.2 Health endpoints
1. Open backend and collector health endpoints.

Pass:
- Minimal status output only.

Fail:
- Sensitive paths/config/secrets exposed.

## 9) Restart / recovery checks

### 9.1 Service restart
1. Restart backend service.
2. Restart admin/frontend service if separate.
3. Restart collector service (if used).
4. Re-test login + one create flow.

Pass:
- Services recover cleanly and core flows still work.

Fail:
- Service fails to start or critical flow breaks after restart.

### 9.2 Rate-limit sanity after restart
1. Perform rapid login attempts before and after restart.

Pass:
- Rate limit behavior remains functional and predictable.

Fail:
- No limit enforcement at all.

## 10) Backup / restore dry-run checks

### 10.1 Backup execution
1. Run documented DB/media backup procedure.
2. Verify backup files are created with current timestamp.

Pass:
- Backup artifacts exist and are readable.

Fail:
- Backup job fails or outputs incomplete files.

### 10.2 Restore dry run (staging copy)
1. Restore backup into a separate staging database/storage.
2. Open app against restored copy.
3. Verify random sample records, images, and recent edits.

Pass:
- Restored environment is usable and data looks complete.

Fail:
- Missing records/media or app errors after restore.

## 11) Collector-app isolation checks

### 11.1 Public exposure test
1. From outside private network/VPN, try opening collector URL.

Pass:
- Collector is not publicly reachable.

Fail:
- Collector loads publicly.

### 11.2 Bind/ingress test
1. Confirm collector bind host and ingress/firewall rules match private-only design.

Pass:
- Only internal/private route can access collector.

Fail:
- Any public direct route exists.

### 11.3 Collector-to-backend sync safety
1. Trigger sync with valid token.
2. Trigger sync with invalid token.

Pass:
- Valid sync works; invalid sync denied.

Fail:
- Invalid token still accepted.

## 12) Final go / no-go checklist

Mark each item before deploy:
1. [ ] All critical auth/permission tests passed.
2. [ ] Upload and malformed input tests passed.
3. [ ] No script execution from dangerous test strings.
4. [ ] No sensitive error leakage observed.
5. [ ] Restart/recovery checks passed.
6. [ ] Backup + restore dry run passed.
7. [ ] Collector isolation confirmed at network level.
8. [ ] Lifecycle sync token protections verified.
9. [ ] Any failed test has a documented fix and retest result.

## Decision rule
- **GO**: all checklist items pass.
- **NO-GO**: any critical security or data-recovery item fails.
