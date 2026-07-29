# Role and item-state survey

Source-only survey of `collector/`, `backend/`, and the actual admin/frontend UI callers. No database was opened. “UI” means a checked-in browser page/script sends the route; it does not establish that the page is linked from every navigation surface. Where a route has no matching UI caller in the searched source, it is labelled **API-only/not found**, not “unusable.”

## A. Roles that exist in code

### Canonical roles and ownership hierarchy

The same five strings are the accepted role set in Collector (`collector/server/index.mjs:2802`) and backend (`backend/services/userRoleService.js:4`): `owner`, `admin`, `editor`, `freelance`, `user`.

| Role | Who can create/manage it in backend | Evidence |
|---|---|---|
| `owner` | Bootstrap environment configuration creates or overwrites an owner; regular hierarchy management excludes target `owner`. | `backend/services/bootstrapOwnerService.js:28-36, 52-81`; `backend/services/userRoleService.js:65-77` |
| `admin` | Owner is its allowed manager; owner may manage any non-owner. | `backend/services/userRoleService.js:57-62, 65-77` |
| `user` | Owner or admin may be its manager; owner/admin may manage it. | `backend/services/userRoleService.js:57-62, 65-77` |
| `editor` | Owner, admin, or user may be its manager; owner/admin/user may manage it. | `backend/services/userRoleService.js:57-62, 65-77` |
| `freelance` | Same manager and actor rules as `editor`. | `backend/services/userRoleService.js:5, 57-77` |

Backend rejects values outside the five-role set in lifecycle handling (`backend/controllers/userController.js:147-164`) and validates manager/role combinations (`backend/controllers/userController.js:181-199`; `backend/services/userRoleService.js:261-280`). Backend route protection for role/lifecycle changes is owner-only (`backend/routes/userRoutes.js:26-29`).

### Backend → Collector role mapping and provisioning

Collector accepts a backend JWT only when its role is one of the same five strings (`collector/server/auth-integration.mjs:12, 23-45`). It verifies issuer and the Collector audience, resolves/creates the local Collector projection, and returns the **Collector row's** `role` (`:312-335`). The login endpoint is constructed as `${backendApiBase}/login` (`:341-345`) and directory sync as `${backendApiBase}/users` (`:347-351, 401-486`). Directory rows are normalized from backend `id/email/role/display_name/managed_by_user_id` (`:353-360`), then locally resolved/upserted (`:450-467`); missing backend projections are marked inactive in profile metadata (`:379-398`).

`collector/server/index.mjs:2775-2794` installs this integration. The Collector's `POST /api/users/sync` is restricted to owner/admin (`:7969`); its direct `POST /api/users` and `PATCH /api/users/:id/role` endpoints return the lifecycle-moved behavior rather than provisioning local users (`:8052-8065`). Thus, for normal Collector login/provisioning, the backend user directory is the source used by code.

Collector's `requireRole` has an owner override: owner passes every `requireRole(...)` list; other roles must be explicitly listed (`collector/server/auth-integration.mjs:563-582`).

## B. Canonical item states and legacy `workflow_status`

The canonical per-item row is `content_workflow_models` (one row per `content_item_id`), with `production_state` default `collected` and `publication_state` default `draft` (`collector/database/schema.sql:950-975`). Collector defines these accepted values:

- `production_state`: `collected`, `analyzed`, `brief_generated`, `ready_for_content`, `content_in_progress`, `in_review`, `needs_revision`, `ready_for_publish`, `submitted_for_admin_review`, `rejected`, `completed` (`collector/server/index.mjs:2805-2817`).
- `publication_state`: `draft`, `approved`, `published`, `unpublished`, `archived`, `deleted` (`:2818`).
- Assignment state is separate: `assigned`, `in_progress`, `submitted`, `revision_requested`, `resubmitted`, `accepted`, `closed` (`:2819-2835`). Article-process status is also separate (`:2837-2845`).

Observed normal state progression in source:

`collected/draft` → clean service writes `analyzed/draft` (`collector/services/workflow.mjs:1774-1814`) → AI draft writes `generated/draft` (`:2455-2483`) → quality pass writes `in_review/draft` and quality fail writes `needs_revision/draft` (`:2527-2588`) → review approval writes `ready_for_publish/approved`; review reject writes `rejected/draft`; review revision writes `needs_revision/draft` (`:2620-2669`) → Collector handoff writes `submitted_for_admin_review/approved` (`collector/server/index.mjs:13505-13516`) → backend final approve publishes the backend content (`backend/services/reviewDecisionService.js:386-651`). The backend service's final database fields are not the Collector `content_workflow_models` row; the cross-system feedback path is relevant for revision (`backend/controllers/reviewContentController.js:199-218`).

`workflow_status` is legacy, not absent:

- It remains a `content_items` column with default `raw` (`collector/database/schema.sql:37`) and is read/written in repository compatibility/reconciliation code (`collector/db/repository.mjs:5261-5308, 5722-5738, 5785-5944, 6139-6159`).
- APIs expose it as `legacy_workflow_status` in queue responses (`collector/server/index.mjs:1810-1981`) and delete it from new item/import payloads (`:8684-8698, 14017-14037`).
- Legacy-to-canonical mapping is explicit: `published` → `completed/published`, `approved` → `ready_for_publish/approved`, `in_review` → `in_review/draft`, `generated` → `generated/draft`, `analyzed` → `analyzed/draft`, `needs_revision` → `needs_revision/draft`, `rejected` → `rejected/draft`, `content_in_progress` → `content_in_progress/draft`, otherwise `collected/draft` (`collector/server/index.mjs:6745-6785`).
- It also remains an independent workflow field for `transport_routes_v2` (`collector/database/schema.sql:348, 375`; `collector/server/transport-v2-router.mjs:1009, 1781-1833`).

## C. State × role matrix

This table records item actions actually implemented. State gates named below are business checks in handlers/services; role middleware is independent of state. `management scope` means the item must also pass `ensureItemMutationAccess` (`collector/server/index.mjs:4328-4340`): owner is global; admin/user require management-line scope; editor/freelance need an active editorial assignment only where the handler opts in.

| Canonical state(s) | Role | Actual action | Enforced by | UI path | Next state(s) |
|---|---|---|---|---|---|
| `collected/draft` | any authenticated role | Collect request itself may create collected items. | `requireAuth`, no role list: `collector/server/index.mjs:14147`; item creation/import direct endpoints are admin-only at `:14017,14068`. | Collector main UI calls `/api/collect`: `collector/server/public/app.js:10740-10742`. | `collected/draft`; clean service can progress it. |
| `collected` | admin (owner override) | Run clean stage. | `requireRole("admin")` at `collector/server/index.mjs:14282`; service selects collected at `collector/services/workflow.mjs:1774`. | No matching `/api/run/clean` caller found in checked-in public scripts. | `analyzed/draft` (`workflow.mjs:1805-1814`). |
| `analyzed`, `brief_generated`, `ready_for_content`, `content_in_progress`, `needs_revision` where eligible | admin or user (owner override) | Generate draft / edit field-pack and management-scoped content. | AI route `requireRole("admin", "user")`: `collector/server/index.mjs:14287`; mutation scope `:4328-4340`; field-pack routes `:12884-13001`. | Item editor calls AI draft (`collector/server/public/item-editor.js:2003-2005, 5711-5713`) and field-pack UI calls create/update (`:4351-4365`). | draft generation: `generated/draft`; field/assignment flows use `content_in_progress/draft` in route writes (`collector/server/index.mjs:8628-8629, 11325-11326`). |
| assignment-backed work, any production state | editor/freelance | Read assignment, save draft, submit/resubmit, upload deliverables. | Assignment routes list roles at `collector/server/index.mjs:10998-11216, 11484, 12102-12137, 14780-15203`; item mutation only permits assigned editor/freelance when handler sets `allowAssignedSelf` (`:4336-4338`). | Role portals exist for editor/freelance (`collector/server/public/editor-home.js:44-48`) and article/event submit pages call assignment revision/submit routes (`article-submit-page.js:1012-1014`; `event-submit-page.js:657-659`). | Assignment state changes; some management actions set item `content_in_progress/draft`. |
| `generated`, `in_review`, `needs_revision` | admin (owner override) | Run quality; apply/reopen Collector review decision. | `requireRole("admin")`: `collector/server/index.mjs:14396-14419`; quality candidates are those three states: `collector/services/workflow.mjs:2527-2531`. | No matching `/api/run/quality`, `/api/review/action`, or `/api/review/reopen` caller found in checked-in public scripts. | quality pass `in_review/draft`; fail/revision `needs_revision/draft`; decision code can set `ready_for_publish/approved` or `rejected/draft` (`workflow.mjs:2554-2588, 2620-2669`). |
| `ready_for_publish/approved` with article process `ready_for_sync` | admin or owner | Submit to backend admin review. | `requireRole("admin", "owner")`, management scope, readiness/translation gates, and `ready_for_sync` check: `collector/server/index.mjs:13354-13419`. | Yes: Article Submit and Event Submit call it (`collector/server/public/article-submit-page.js:1285-1289`; `event-submit-page.js:729-733`). | `submitted_for_admin_review/approved` (`collector/server/index.mjs:13505-13516`). |
| `submitted_for_admin_review/approved` (backend review item pending) | backend admin or owner | Final approve, needs revision, or reject. | `protect` + `authorizeEditorOrAdmin` routes: `backend/routes/reviewContentRoutes.js:62-67`; middleware accepts admin/owner despite its name (`backend/middleware/authMiddleware.js:122-129`). | Yes: Admin Approvals calls approve/revision/reject (`admin/src/pages/Approvals.jsx:715, 753, 786`). | backend approve publishes; revision/reject transitions are performed by `reviewDecisionService` (`backend/services/reviewDecisionService.js:386-751`). Collector receives revision feedback via token endpoint, which sets `needs_revision` (`collector/server/index.mjs:14426-14497`). |
| `completed/published` | admin or owner | Unpublish Collector-side published article record. | `requireRole("admin", "owner")`, scope guard, and `publication_state === "published"`: `collector/server/index.mjs:14526-14583`. | No matching public UI caller found. | `completed/unpublished` (or preserved production state) at `:14554-14566`. |
| deleted/archived-related | owner | Inspect deleted items, cleanup references, purge. | owner role routes at `collector/server/index.mjs:13814-13970`; item deletion requires admin/owner plus mutation scope at `:13782-13802`. | Yes: Collector main UI calls cleanup/reference/purge endpoints (`collector/server/public/app.js:3330, 3375, 3394, 3410, 10998-11000`). | deletion/purge outcome; no canonical recovery transition is established here. |

Routes with roles but explicitly disabled batch-release behavior are not treated as a state transition: `/api/run/publish`, `/api/run/stage`, `/api/run/approve`, `/api/run/export`, and `/api/run/sync-backend` call `respondBatchReleaseDisabled` (`collector/server/index.mjs:14514-14519, 14607-14616`).

## D. One normal end-to-end route

1. A logged-in Collector actor submits `POST /api/collect`; route uses `requireAuth` and stores collected workflow state (`collector/server/index.mjs:14147-14229`). The checked-in main UI calls it (`collector/server/public/app.js:10740-10742`).
2. An admin runs `POST /api/run/clean` (`collector/server/index.mjs:14282`); source selects `collected` and writes `analyzed` (`collector/services/workflow.mjs:1774-1814`). No public-script caller was found for this route.
3. Admin/user runs `POST /api/run/ai-draft` (`collector/server/index.mjs:14287`). Item Editor calls it (`collector/server/public/item-editor.js:2003-2005`); service stores a draft and sets `generated` (`collector/services/workflow.mjs:2455-2483`).
4. Admin runs quality/review decision. Quality changes accepted work to `in_review`; failed work to `needs_revision` (`collector/services/workflow.mjs:2527-2588`). A review approval leads to `ready_for_publish/approved`; rejection/revision use the states noted in section C (`:2620-2669`). UI caller for these Collector-level routes was not found.
5. Admin/owner uses the submit button in Article Submit or Event Submit. It sends `POST /api/items/:id/submit-admin-review` (`article-submit-page.js:1285-1289`; `event-submit-page.js:729-733`). Collector validates readiness and posts `/review-content/ingest` to backend using `x-review-sync-token` (`collector/server/index.mjs:13354-13419, 13476-13482`), then records `submitted_for_admin_review/approved` (`:13505-13516`).
6. Backend admin/owner uses Admin Approvals. It calls `/review-content/:id/approve`, `/needs-revision`, or `/reject` (`admin/src/pages/Approvals.jsx:715, 753, 786`); backend routes apply `protect` and `authorizeEditorOrAdmin` (`backend/routes/reviewContentRoutes.js:62-67`). The backend approval service is the code path that promotes the reviewed content (`backend/services/reviewDecisionService.js:386-651`).
7. A backend needs-revision result returns to Collector through `POST /api/web-review-feedback`, guarded by `x-review-sync-token` (`collector/server/index.mjs:14426-14435`), and writes `needs_revision` (`:14467-14497`).

## E. Observed gaps and mismatches

### States/actions with no demonstrated UI caller

- No checked-in Collector public-script caller was found for `POST /api/run/clean` (`collector/server/index.mjs:14282`), `/api/run/quality` (`:14396`), `/api/review/action` (`:14401`), `/api/review/reopen` (`:14411`), or the enabled-state form of batch publish/export (all five batch endpoints are disabled at `:14514-14519, 14607-14616`). This is a UI-coverage finding, not a claim that a hidden/manual UI cannot exist.
- `/api/items/:id/unpublish` is implemented and guarded (`collector/server/index.mjs:14526-14583`); no matching checked-in public-script caller was found.

### States with no visible next action in this source survey

- `rejected/draft` has no route in the surveyed canonical item handlers that explicitly moves it onward. `reopenReviewDecision` exists but is an admin-only Collector review endpoint (`collector/server/index.mjs:14411-14419`); whether it accepts a rejected item depends on service transition logic and is not asserted here.
- `completed/unpublished`, `archived`, and `deleted` have no normal content-production next transition demonstrated by the canonical route flow above. Deleted-item owner cleanup/purge routes exist (`collector/server/index.mjs:13814-13970`).

### Actions without ordinary user-role middleware

- `POST /api/collect` requires authentication but no role list (`collector/server/index.mjs:14147`).
- Several read routes are intentionally unguarded: `/api/review-queue`, `/api/published`, `/api/internal-links`, `/api/quality`, `/api/staging`, and `/api/exports` (`collector/server/index.mjs:14422, 14508, 14522, 14619-14627`).
- `POST /api/web-review-feedback` has no `requireAuth`, but it verifies a configured shared sync token before acting (`collector/server/index.mjs:14426-14435`); it is therefore not unguarded in the literal sense.

### Provisioning and authorization mismatches/uncertainties

- Collector recognizes `freelance` in backend tokens and local role checks (`collector/server/auth-integration.mjs:12, 23-45`; `collector/server/index.mjs:2802`), but direct Collector create/role routes are deliberately moved; backend provisioning is required (`collector/server/index.mjs:8052-8065`). The backend does support `freelance` as a canonical role (`backend/services/userRoleService.js:4-5`).
- `authorizeEditorOrAdmin` is named as if editors are allowed, but its actual predicate permits only `admin` and `owner` (`backend/middleware/authMiddleware.js:122-129`). The corresponding review routes therefore do not permit backend `editor` despite the name (`backend/routes/reviewContentRoutes.js:62-67`).
- Collector’s `requireRole` always grants owner even when `owner` is not named in the route list (`collector/server/auth-integration.mjs:570-582`). This is an intentional effective-permission difference from reading route role lists literally.
- Collector item visibility is scope-based after the role check: owner sees all; admin/user can see raw pool or managed work; editor/freelance need a matching claim/assignment (`collector/server/index.mjs:4099-4123`). A route may list a role but still reject a particular item through `ensureItemMutationAccess` (`:4328-4340`).
