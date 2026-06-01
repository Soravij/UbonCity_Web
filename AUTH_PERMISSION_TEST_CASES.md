# AUTH_PERMISSION_TEST_CASES

## Setup
- Base API: `http://localhost:5000/api`
- Create/test tokens:
  - `ADMIN_TOKEN` (role `admin`)
  - `EDITOR_TOKEN` (role `editor`)
  - `USER_TOKEN` (role `user`)
  - `BAD_TOKEN` (invalid/modified JWT)

## 1) Unauthenticated request tests
1. `GET /api/me` without token
- Expected: `401` with safe error message.

2. `GET /api/users` without token
- Expected: `401`.

3. `POST /api/places` without token
- Expected: `401`.

4. `POST /api/translate/preview` without token
- Expected: `401`.

5. `POST /api/lifecycle/import-published` without `x-lifecycle-token`
- Expected: `401`.

## 2) Normal user vs admin tests
1. User calls admin-only route
- Request: `GET /api/users` with `Authorization: Bearer USER_TOKEN`
- Expected: `403`.

2. Editor calls admin-only route
- Request: `DELETE /api/users/{id}` with `EDITOR_TOKEN`
- Expected: `403`.

3. Admin calls admin-only route
- Request: `GET /api/users` with `ADMIN_TOKEN`
- Expected: `200`.

4. User calls editor/admin route
- Request: `POST /api/places` with `USER_TOKEN`
- Expected: `403`.

5. Editor calls editor/admin route
- Request: `POST /api/events` with `EDITOR_TOKEN`
- Expected: success path (`200`/`201` or validation error, but not `401/403`).

6. User translation abuse check
- Request: `POST /api/translate/preview` with `USER_TOKEN`
- Expected: `403`.

7. Editor translation preview check
- Request: `POST /api/translate/preview` with `EDITOR_TOKEN`
- Expected: success path (`200` or input validation failure).

## 3) ID tampering tests
1. Update role for non-existent user id
- Request: `PATCH /api/users/999999/role` with `ADMIN_TOKEN`, body `{ "role": "user" }`
- Expected: `404 User not found`.

2. Delete non-existent user id
- Request: `DELETE /api/users/999999` with `ADMIN_TOKEN`
- Expected: `404 User not found`.

3. Attempt delete self
- Request: `DELETE /api/users/{admin_own_id}` with `ADMIN_TOKEN`
- Expected: `400 cannot delete current logged in user`.

4. Attempt downgrade last admin
- Precondition: only one admin in DB.
- Request: `PATCH /api/users/{last_admin_id}/role` with body `{ "role": "user" }`.
- Expected: `400 cannot remove the last admin`.

5. Attempt delete last admin
- Precondition: only one admin in DB.
- Request: `DELETE /api/users/{last_admin_id}` by another admin test actor is impossible in this state; validate via controlled DB setup/migration script.
- Expected: `400 cannot delete the last admin` when applicable.

## 4) Direct API request tests (bypass UI)
1. Direct admin page endpoint as user
- Request: `POST /api/places/import-csv` with `USER_TOKEN`.
- Expected: `403`.

2. Direct approval endpoint as editor
- Request: `PATCH /api/events/{id}/approve` with `EDITOR_TOKEN`.
- Expected: `403` (admin-only).

3. Direct media delete as editor
- Request: `DELETE /api/media-assets/{id}` with `EDITOR_TOKEN`.
- Expected: `403`.

4. Direct transport admin write as user/editor
- Request: `POST /api/transport-routes` with `USER_TOKEN` and `EDITOR_TOKEN`.
- Expected: `403` for both (admin-only).

5. Direct lifecycle import with wrong token
- Request: `POST /api/lifecycle/import-published` with incorrect `x-lifecycle-token`.
- Expected: `401`.

## 5) Invalid token failure-safety tests
1. `GET /api/me` with malformed token (`BAD_TOKEN`)
- Expected: `401 Invalid token`.

2. `POST /api/places` with malformed token
- Expected: `401`.

## 6) Frontend false-confidence regression checks (admin app)
1. Modify local storage role to `admin` manually while using non-admin token.
- Expected:
  - App re-validates via `/api/me` and resets to backend role.
  - Admin-only routes/menu should not remain usable.

2. Set invalid/expired token in local storage and reload admin app.
- Expected:
  - Session is cleared and app redirects to `/login`.

## 7) Quick curl examples
```bash
# me check
curl -i http://localhost:5000/api/me -H "Authorization: Bearer $ADMIN_TOKEN"

# admin-only users endpoint with user token (should be 403)
curl -i http://localhost:5000/api/users -H "Authorization: Bearer $USER_TOKEN"

# editor/admin endpoint with user token (should be 403)
curl -i -X POST http://localhost:5000/api/places \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"attractions","lang":"th","title":"x","description":"x"}'

# lifecycle token check (should be 401 when bad)
curl -i -X POST http://localhost:5000/api/lifecycle/import-published \
  -H "x-lifecycle-token: bad-token" \
  -H "Content-Type: application/json" \
  -d '{"source_system":"collector-app","published":[],"translations":[]}'
```
