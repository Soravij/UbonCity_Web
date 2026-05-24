# OWNER_ROLE_TEST_CHECKLIST

## Test accounts required
- `owner` account
- `admin` account
- `editor` account
- `user` account

## 1) Owner login/access tests
1. Login as owner on admin app and collector app.
- Pass: role shown as `owner`, protected pages load.

2. Call backend `/me` and collector `/api/auth/me` with owner token.
- Pass: response role is `owner`.

3. Owner creates users with roles `user`, `editor`, `admin`, `owner`.
- Pass: all succeed (except duplicate email).

4. Owner updates any user role.
- Pass: succeeds, including promoting/demoting admin/editor/user.

5. Owner accesses owner-only endpoints:
- `/api/config`
- `/api/run/publish`
- `/api/run/stage`
- `/api/run/approve`
- `/api/run/export`
- `/api/run/sync-backend`
- Pass: returns success (or normal business validation errors), not 403.

## 2) Admin blocked from owner-only actions
1. Login as admin and call:
- `PATCH /users/:id/role`
- `DELETE /users/:id`
- Pass: `403`.

2. Admin tries to create `admin` or `owner` user.
- Pass: `403`.

3. Admin tries to reset password of `admin` or `owner` target.
- Pass: `403`.

4. Admin calls owner-only collector endpoints listed above.
- Pass: `403`.

5. Admin attempts destructive owner-only deletes:
- backend `DELETE /places/:id`, `/events/:id`, `/media-assets/:id`, `/categories/:slug`, `/transport-routes/:id`
- collector `DELETE /api/items/:id`, `/api/assets/:id`
- Pass: `403`.

## 3) Editor blocked from admin/owner actions
1. Login as editor and access admin/user-management routes.
- Pass: blocked by UI and/or backend 403.

2. Editor direct API requests to user management and owner-only routes.
- Pass: `403`.

3. Editor tries delete endpoints above.
- Pass: `403`.

## 4) Last-owner protection tests
1. Ensure exactly one owner exists.
2. As owner, attempt to demote self to admin/editor/user.
- Pass: blocked with 400.

3. As owner, attempt to demote the only owner to admin/editor/user.
- Pass: blocked with 400 (`cannot remove the last owner`).

4. As owner, attempt to delete the only owner account.
- Pass: blocked with 400.

5. Create second owner, then demote/delete one owner.
- Pass: allowed while at least one owner remains.

## 5) Self-escalation prevention tests
1. As admin, attempt to create owner account.
- Pass: `403`.

2. As admin/editor/user, attempt direct role escalation by API payload (`role: owner`).
- Pass: `403` or ignored with safe role fallback.

3. As non-owner, attempt to reset owner/admin password.
- Pass: `403`.

## 6) Direct API abuse checks
1. Call all owner-only endpoints without token.
- Pass: `401`.

2. Call all owner-only endpoints with invalid token.
- Pass: `401`.

3. Call owner-only endpoints with admin/editor token.
- Pass: `403`.

## 7) Regression sanity checks
1. Admin still performs normal admin/content operations (non-owner-only actions).
- Pass: create/edit/approve flows still work.

2. Editor still performs editor operations.
- Pass: create/edit content flows still work.

3. Existing user login still works for non-owner roles.
- Pass: no auth regression.
