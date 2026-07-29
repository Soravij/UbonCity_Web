# OWNER_ROLE_REAUDIT_REPORT

Date: 2026-03-11
Scope: owner-role enforcement re-audit (backend + collector + relevant admin/frontend guards)

## Verdict
- `owner` role protections are **mostly correctly enforced on backend APIs** for the audited high-risk actions.
- No owner-only action in this scope was found to be protected by frontend checks alone.
- No blocker found for the 5 requested verification points.

## Verification Results

### 1) owner-only restrictions are actually enforced on the backend
Status: **PASS**

Evidence:
- Backend owner middleware exists: `backend/middleware/authMiddleware.js:44-50` (`authorizeOwner`).
- Backend destructive/privileged routes use owner middleware:
  - `backend/routes/userRoutes.js:9-10` (`PATCH /users/:id/role`, `DELETE /users/:id`)
  - `backend/routes/placeRoutes.js:24` (`DELETE /places/:id`)
  - `backend/routes/eventRoutes.js:19` (`DELETE /events/:id`)
  - `backend/routes/mediaRoutes.js:22` (`DELETE /media-assets/:id`)
  - `backend/routes/categoryRoutes.js:17` (`DELETE /categories/:slug`)
  - `backend/routes/transportRoutes.js:22` (`DELETE /transport-routes/:id`)
- Collector high-risk/system routes are owner-only:
  - `collector-app/server/index.mjs:782` (`GET /api/config`)
  - `collector-app/server/index.mjs:1040` (`DELETE /api/items/:id`)
  - `collector-app/server/index.mjs:1483` (`DELETE /api/assets/:id`)
  - `collector-app/server/index.mjs:1240,1245,1263,1268,1306` (`run/publish|stage|approve|export|sync-backend`)
- Collector role change endpoint is owner-only: `collector-app/server/index.mjs:699`.

### 2) admin cannot access owner-only actions
Status: **PASS**

Evidence:
- Backend owner-only routes are all behind `authorizeOwner`, which checks exact role `owner`: `backend/middleware/authMiddleware.js:46-48`.
- Collector owner-only routes use `requireRole("owner")`.
- Collector `requireRole` allows owner bypass but does not allow admin into owner-only endpoints: `collector-app/server/index.mjs:285-303`.
- Admin cannot create admin/owner users in collector: `collector-app/server/index.mjs:668`.
- Admin cannot reset admin/owner passwords in collector: `collector-app/server/index.mjs:743-746`.

### 3) editor cannot escalate privileges
Status: **PASS**

Evidence:
- Backend user role changes are owner-only route-protected: `backend/routes/userRoutes.js:9`.
- Backend admin/owner account creation is blocked for non-owner in controller logic: `backend/controllers/userController.js:54`.
- Backend `/register` requires admin-level auth (`authorizeAdmin`) so editor cannot hit it: `backend/routes/authRoutes.js:15`.
- Collector role updates are owner-only route-protected: `collector-app/server/index.mjs:699`.

### 4) the last remaining owner cannot be deleted or demoted
Status: **PASS (for available endpoints)**

Evidence:
- Backend demotion guard in role update: `backend/controllers/userController.js:93-97`.
- Backend self-downgrade owner guard: `backend/controllers/userController.js:78-79`.
- Backend delete guard prevents deleting last owner: `backend/controllers/userController.js:125-129`.
- Collector demotion guard prevents removing last owner via role change: `collector-app/server/index.mjs:724-727`.
- Collector self-downgrade guard: `collector-app/server/index.mjs:719-721`.

Note:
- Collector does not expose a user-delete endpoint in audited code; last-owner **deletion** logic there is not applicable because deletion route does not exist.

### 5) no route relies only on frontend checks for owner protection
Status: **PASS**

Evidence:
- Admin UI and collector UI contain owner/admin UX guards, but privileged actions map to backend-protected routes.
- Example UI calls and corresponding backend enforcement:
  - Admin users page role update call (`admin/src/pages/Users.jsx`) -> backend owner-only route (`backend/routes/userRoutes.js:9`).
  - Collector user-role/password calls (`collector-app/server/public/app.js:206,231`) -> backend owner/owner+admin-with-target-check routes (`collector-app/server/index.mjs:699,738+743`).
  - Collector delete item/asset calls (`collector-app/server/public/app.js:156`, `collector-app/server/public/item-editor.js:519`) -> owner-only backend routes (`collector-app/server/index.mjs:1040,1483`).

## Findings (Actionable)

### F1. No owner-only bypass found via alternate API path
Severity: Informational

What was checked:
- Alternate create/update/delete user paths in backend and collector.
- Route-level and controller-level checks for role mutation and privileged account operations.

Result:
- No alternate unaudited path was found that allows admin/editor to perform owner-only actions in this scope.

## Residual Risk / Not Verified
- Dynamic runtime validation via live HTTP tests was **not verified** in this pass (static code re-audit only).
- Existing database data quality (e.g., legacy malformed role values) was **not verified**.
- Infrastructure-level access controls (reverse proxy ACLs, network isolation) were **not verified** in this specific re-audit.
