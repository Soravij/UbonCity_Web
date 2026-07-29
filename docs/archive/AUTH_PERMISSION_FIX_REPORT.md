# AUTH_PERMISSION_FIX_REPORT

## Problems found
1. Admin UI trusted locally stored `role` value for routing decisions.
- Risk: A user could tamper `localStorage` and unlock admin pages in UI (false confidence), even though backend might reject actions.
- Where: `admin/src/App.jsx`.

2. No backend endpoint to re-validate session identity/role after login.
- Risk: Frontend relied on cached session fields rather than backend-confirmed role.
- Where: backend auth routes/controllers.

3. Admin user-management protections were incomplete.
- Risk:
  - Role update/delete on non-existent user IDs did not return safe 404 behavior.
  - Last admin could be removed/deleted.
  - Role enum mismatch (`editor` unsupported in user controller while supported elsewhere).
- Where: `backend/controllers/userController.js`.

4. Internal lifecycle token comparison used plain string equality.
- Risk: avoidable side-channel weakness in token check.
- Where: `backend/controllers/lifecycleController.js`.

## Fixes applied
1. Added backend session identity endpoint.
- Added `GET /api/me` behind `protect` middleware.
- Returns normalized authenticated identity: `id`, `email`, `role`.
- Files:
  - `backend/controllers/authController.js`
  - `backend/routes/authRoutes.js`

2. Removed UI-only trust of stored role for admin routing confidence.
- Admin app now re-validates token with backend `/api/me` and updates session from server response.
- Invalid/expired token now forces logout and redirects to `/login`.
- Files:
  - `admin/src/App.jsx`

3. Strengthened admin route protections in user management.
- Added target existence checks (`404 User not found`) for role update/delete.
- Added last-admin protections:
  - prevent downgrading the final admin
  - prevent deleting the final admin
- Unified valid roles with current platform model: `admin`, `editor`, `user`.
- Files:
  - `backend/controllers/userController.js`

4. Hardened lifecycle token verification.
- Replaced direct string equality with `crypto.timingSafeEqual` (length-checked first).
- Files:
  - `backend/controllers/lifecycleController.js`

## Files changed
- `backend/controllers/authController.js`
- `backend/routes/authRoutes.js`
- `backend/controllers/userController.js`
- `backend/controllers/lifecycleController.js`
- `admin/src/App.jsx`

## Remaining risks
1. Content ownership model is still role-based, not per-record owner-based.
- Current behavior allows privileged roles (`admin`/`editor`) to modify any managed content by design.
- If per-user ownership is required later, DB schema + ownership middleware are needed.

2. Token storage remains in browser storage for admin app.
- Backend authorization is enforced correctly, but XSS-resistant HttpOnly cookie sessions would be stronger.

3. Lifecycle sync endpoint remains token-header based (service-to-service), not user/JWT based.
- Acceptable for internal machine route if token remains secret and rotated.
