# Role-matrix verification (against `audit/role-matrix-survey.md`)

Verification pass, Runtime `D:\UbonRuntime\repos\UbonCity_Web` @ `main` (`0cda620`).
Read-only: no code changed, no HTTP, no tests run, no users/data created.
Method: `audit-scanner` ×2 (auth+provisioning; dead-path grep) → `audit-deep-reasoner` ×1
(3 cross-file candidates). Every line number below re-checked against current source; the
survey's own line numbers have drifted (file grew) and are noted where relevant.

Legend: **STILL TRUE** = survey claim holds against current code · **DRIFTED** = claim
holds but cited line numbers moved · **CHANGED** = claim no longer matches code.

---

## A. Authorization traps

### A1. `authorizeEditorOrAdmin` = admin+owner only; review routes still use it — **STILL TRUE** (DRIFTED)

- `backend/middleware/authMiddleware.js:122-129` — `authorizeEditorOrAdmin` body is
  `if (role !== "admin" && role !== "owner") return 403`. Byte-identical to `authorizeAdmin`
  (`:104-111`). Name implies editors; predicate excludes them.
- Review routes still bind it — now **7** routes (survey cited a 62-67 range):
  - `backend/routes/reviewContentRoutes.js:64` `POST /review-content/:id/access-token`
  - `:65` `POST /review-content/:id/approve`
  - `:66` `POST /review-content/:id/needs-revision`
  - `:67` `POST /review-content/:id/reject`
  - `:68` `POST /review-content/legacy-needs-revision`
  - `:69` `POST /review-content/legacy-reject`
  - `:60` `POST /review-content/ingest` via `requireCollectorTokenOrPrivilegedUser` →
    `authMiddleware`… (`reviewContentRoutes.js:44-48`) falls back to
    `protect`+`authorizeEditorOrAdmin` when no sync token is present.
- Backend `editor` / `freelance` therefore cannot drive admin review despite the middleware
  name. Corroborated by `authMiddleware.js:14` `REVIEW_CONTENT_INTERNAL_ROLES = {"owner","admin"}`
  used by the read gate (`:60-76`, `:95-102`).

### A2. Collector `requireRole` grants `owner` unconditionally — **STILL TRUE** (DRIFTED)

- `collector/server/auth-integration.mjs:563-583`. Owner short-circuit at `:571-573`
  (`if (currentRole === "owner") { next(); return; }`) runs **before** the
  `roles.includes(currentRole)` check at `:576`. Survey cited `:570-582`.
- `requireAuth` (`:552-561`) accepts **backend-issued JWTs only**
  (`verifyBackendTokenIdentity`, `:312-339`); there is no Collector-local login path into
  `req.authUser`.

### A3. `POST /api/collect` has no role list — **STILL TRUE** (DRIFTED)

- `collector/server/index.mjs:14037` — `app.post("/api/collect", requireAuth, workflowRateLimit, …)`.
  No `requireRole`. Any authenticated backend identity (any of the 5 roles) can collect.
  Survey cited `:14147`.
- Direct item create / import stay admin-gated: `/api/items` (`:14017` area) and the import
  endpoints use `requireRole("admin")` / owner — not re-verified line-by-line this pass, flagged
  as unchanged-by-inspection.

### A4. Six unguarded read routes — **STILL TRUE, and broader than the survey states**

All six have **no middleware at all** — not even `requireAuth`:

| Route | Line | Middleware chain |
|---|---|---|
| `GET /api/review-queue` | `collector/server/index.mjs:14319` | *(none)* `(_req, res) =>` |
| `GET /api/internal-links` | `:14522` | *(none)* |
| `GET /api/published` | `:14536` | *(none)* |
| `GET /api/quality` | `:14633` | *(none)* |
| `GET /api/staging` | `:14637` | *(none)* |
| `GET /api/exports` | `:14641` | *(none)* |

Survey cited `:14422, 14508, 14522, 14619-14627` and called them "intentionally unguarded".
Confirmed unguarded; these are anonymous-readable (no token needed).

---

## B. Nested authorization layers

Order for an item-mutation route: **`requireRole(...)` → handler business/state gate →
`ensureItemMutationAccess` (or a sibling) → (list routes only) visibility scope filter.**

| Layer | Location | Decides |
|---|---|---|
| `requireRole(...roles)` | `auth-integration.mjs:563-583` | Is `req.authUser` present (backend JWT), and is its role in the route's list? `owner` always passes (`:571-573`). Pure role-string check; item-independent. |
| handler state gate | per route (e.g. `canTransitionArticleProcess` `index.mjs:4485-4492` / table `:2849-2856`; `publication_state === "published"` for unpublish `:14540+`) | Is the item's workflow state legal for this action? Role-independent. |
| `ensureItemMutationAccess(req,res,item,options={})` | `index.mjs:4158-4171` | owner → always (`:4160`). admin/user → `canMutateItemByManagementLine` (`:4163`). editor/freelance → **only if `options.allowAssignedSelf === true`** AND `hasEditorialAssignmentEditAccess` (`:4166`). Else 403. |
| `canMutateItemByManagementLine` | `index.mjs:3837-3861` | admin/user pass iff the item's `claimed_by_user_id`, or an assignment's `assignee_user_id`, resolves into the actor's **downward** management line (`canSeeManagedWorkForUser` `:3058-3069` → `canAssignToUserByManagementLine` → `canSeeUserByManagementLine` `:3035-3056`, walking `users.managed_by_user_id`). |
| visibility scope (`isItemVisibleToActor`) | `index.mjs:3897-3915` | List/read filtering only. owner → all; else actor must be the claimant/assignee or manage them; raw-pool items visible to admin/user (`canSeeRawPoolInItemsQueue` `:3891-3895`). |

### `allowAssignedSelf` — which handlers set it: **NONE. The survey's "opt-in" set is empty.** — **CHANGED**

`allowAssignedSelf` appears in the whole `collector/` tree at exactly one location — the
`ensureItemMutationAccess` definition itself (`index.mjs:4166`). All **37** call sites pass
no options object:

```
4476, 8489, 8845, 9210, 9651, 9735, 9796, 9863, 9968, 10033, 10099, 10138, 10185,
10445, 10611, 10672, 12330, 12355, 12449, 12501, 12531, 12784, 12826, 12874, 13112,
13266, 13440, 13468, 13508, 13544, 13587, 13624, 13664, 13680, 13741, 14469, 14551
```

Consequence: the editor/freelance branch of `ensureItemMutationAccess` is **dead code**.
Every editor/freelance request that reaches this function returns
`403 "role นี้ไม่มีสิทธิ์แก้บทความในขั้นนี้"`.

Survey text (`role-matrix-survey.md:57`, `:99`) — "item mutation only permits assigned
editor/freelance when handler sets `allowAssignedSelf`" — describes an opt-in that no longer
exists. See finding **F1**.

Editor/freelance item-backed work that **does** function goes through different gates:
- `ensureArticleComposerEditAccess` (`index.mjs:4210-4226`) — editor branch at `:4217`
  (`role === "editor" && hasEditorialAssignmentEditAccess`), **not** `allowAssignedSelf`-gated.
  Used by `PUT /api/items/:id/editor-work` (`:8879`), `POST …/seo-suggestion` (`:9020`),
  `POST …/article-suggestion` (`:9079`). `freelance` is **not** in this branch — editor only.
- Assignment routes `/api/assignments/:id/*` — use `hasAssignmentAccess` (`:3089-3106`) /
  `hasAssignmentSubmissionAccess`, never `ensureItemMutationAccess`. Role lists include
  editor+freelance: draft `:11033/:11070`, submissions `:11348`, submission deliverables
  `:11994`, asset uploads `:14794 / :14876 / :14949 / :15217`.

---

## C. Six "dead paths"

Control check (search method sanity): `/api/collect` → caller found at
`collector/server/public/app.js:10909` via the `api()` helper. Method works.

| # | Path | Role gate | Status now |
|---|---|---|---|
| 1 | `POST /api/run/clean` | `requireRole("admin")` `index.mjs:14179` | **STILL DEAD** — no caller in `collector/server/public`, `admin/src`, `frontend`, `backend`, `scripts`, `ops`. |
| 2 | `POST /api/review/reopen` | `requireRole("admin")` `:14308` | **STILL DEAD** — no caller anywhere. |
| 3 | `POST /api/items/:id/unpublish` | `requireRole("admin","owner")` `:14540` | **STILL DEAD** — no caller anywhere. |
| 4a | `POST /api/review/action` (Collector reject/approve) | `requireRole("admin")` `:14298` | **STILL DEAD** — no caller anywhere. |
| 4b | `POST /review-content/:id/reject` (backend) | `protect`+`authorizeEditorOrAdmin` `reviewContentRoutes.js:67` | **NOT DEAD** — caller `admin/src/pages/Approvals.jsx:786` (`api.post(\`/review-content/${id}/reject\`, …)`), legacy fallback `:779`. |
| 5 | `POST /api/items/:id/article-process/submit-review` | `requireRole("owner","admin","editor","user")` `:9411` | **NOT DEAD, BUT BROKEN for `editor`** — callers `article-workspace-page.js:2174-2192`, `article-submit-page.js`, `event-submit-page.js`. Editor role can never pass (finding **F2**). |
| 6 | assignment layer after field-pack return-to-clean | route `requireRole("owner","admin","user")` `:13729` | **NOT A DEAD PATH — an incompleteness.** Route has a caller (`item-editor.js:4415`); it never closes `content_assignments` rows (finding **F3**). |

Bonus: `POST /api/run/quality` (`:14293`, `requireRole("admin")`) — also **STILL DEAD**, no
caller. The five batch-release routes (`/api/run/publish|stage|approve|export|sync-backend`)
remain hard-disabled via `respondBatchReleaseDisabled` (survey §C).

**Still genuinely dead (route exists, zero callers): 5** — `run/clean`, `run/quality`,
`review/action`, `review/reopen`, `items/:id/unpublish`.

---

## Findings (new / confirmed defects)

### F1 — editor/freelance branch of `ensureItemMutationAccess` is unreachable; some routes list `editor` then 403 it

- `index.mjs:4166` requires `options.allowAssignedSelf === true`; **no caller passes it**.
- Routes that put `editor` (and sometimes `freelance`) in `requireRole` and then gate on
  bare `ensureItemMutationAccess(req, res, item)`:
  - `:13573` `PATCH /api/items/:id/assets/:assetId/selected` — role list `owner,admin,editor,user`
  - `:13610` `PATCH /api/items/:id/assets/:assetId/role` — `owner,admin,editor,user`
  - `:13652` `PATCH /api/items/:id/assets/:assetId/caption` — `owner,admin,editor,user`
  - `:13099` `PATCH /api/items/:id/reference-media/:id/selected` — `owner,admin,editor,freelance,user`
  - `:14718` `POST /api/assets/upload`, `:15373` `POST /api/assets/register` — via
    `ensureComposerMediaEditAccess`, now a bare alias of `ensureItemMutationAccess` (`:4475-4477`)
- Regression origin (deep-reasoner, git-traced): commit `92c38ee` moved
  `assets/:assetId/selected` and `/role` from `ensureComposerMediaEditAccess`
  (which routed to `ensureArticleComposerEditAccess`, editor-capable at `:4217`) to
  `ensureItemMutationAccess`. `assets/:assetId/caption` and `reference-media/:id/selected`
  appear to have been born this way.
- Editor article-workspace asset controls (`article-workspace-page.js:2123-2133, 2335-2352`
  → set-cover / gallery toggle / inline / caption) now 403 for editors.
- Severity: medium-high. `freelance` is latent everywhere (never served by the composer
  branch either); `editor` on `assets/role` + `assets/selected` is a proven regression.

### F2 — `editor` can never complete `POST /api/items/:id/article-process/submit-review` (double bind)

- **Gate A** `index.mjs:9427` → `ensureArticleProcessTransitionAccess(req,res,item,"ready_for_review")`,
  editor branch `:4240-4246`: requires an editorial assignment in state
  **`{submitted, resubmitted}`**.
- **Gate B** `index.mjs:9445-9451`: the handler's own submission-creation block only selects an
  editorial assignment in state **`{assigned, in_progress, revision_requested}`**; if none and
  `role === "editor"` → `403` at `:9551-9553`.
- The two state sets are disjoint (`ASSIGNMENT_TRANSITION_RULES`, `repository.mjs:590-598`), so
  one assignment cannot satisfy both. Pre-submitting via `/api/assignments/:id/submissions`
  (`:11348`) to reach `submitted` makes Gate A pass but Gate B's `.find(...)` return null → 403.
- The state gate `canTransitionArticleProcess` (`:9434`, table `:2849-2856`) is **not** the
  conflict — its from-states `{drafting, revision_requested, ready_for_review}` line up fine
  with the assignment states; Gate A alone is the blocker.
- Regression origin: commit `fef7250` added the `:9427` Gate-A call. Before it, an editor with
  an `assigned`/`in_progress` editorial assignment could submit.
- Editor UI has no alternative route (`article-workspace-page.js` contains zero
  `/api/assignments/` calls).
- Severity: high — the editorial submit step is impossible for the `editor` role.

### F3 — field-pack return-to-clean orphans an active editorial assignment (place items)

- `returnFieldPackToCleanAtomic` (`collector/db/repository.mjs:10011-10106`) archives the field
  pack and walks `production_state` back to `analyzed`; it never touches `content_assignments`.
  `returnFieldPackToClean` (`collector/services/workflow.mjs:2744-2757`) and the route
  (`index.mjs:13729-13766`) add nothing.
- For a **place** item returned to clean from `in_review` (backward hops all carry
  `return_to_clean:true`, `repository.mjs:543-577`) while its editorial assignment is
  `submitted`/`resubmitted`, the assignment row stays active. Re-assignment later hits
  `409 "active editorial assignment already exists; set replace_active=true"`
  (`index.mjs:10511-10515`; active = `submitted`/`resubmitted`, `:4662-4666`).
- The independent close route `PATCH /api/assignments/:id/state`
  (`action:"close_assignment"`) is **owner/admin only** (`index.mjs:11099`, `user` blocked
  `:11118-11125`) — a `user` who ran return-to-clean cannot clear it.
- Non-place items are **not** affected: an editorial assignment holds them at
  `content_in_progress`, and `content_in_progress → analyzed` is not a legal transition
  (`repository.mjs:491`), so the atomic returns `400 INVALID_TRANSITION` first.
- No DB constraint on `content_assignments (content_item_id, assignment_kind, state)` — the
  conflict is purely application-level (`schema.sql:1004-1038`, only `assignment_uid` is UNIQUE).
- Severity: medium — recoverable by owner/admin; blocks a `user`-run flow.

### F4 — survey §B canonical `production_state` list is stale — **CHANGED**

Survey `role-matrix-survey.md:33` lists 11 production states and cites
`collector/server/index.mjs:2805-2817`. Current source: `PRODUCTION_STATES` is defined in
`collector/db/repository.mjs:440-458` (imported by `index.mjs:32`) and holds **17**:

```
collected, analyzed, brief_generated, ready_for_content, field_working, field_review,
ready_for_writer, writing_assigned, writing, content_in_progress, generated, in_review,
needs_revision, ready_for_publish, submitted_for_admin_review, rejected, completed
```

New since the survey: `field_working`, `field_review`, `ready_for_writer`,
`writing_assigned`, `writing`, `generated` (distinct from `brief_generated`). No DB CHECK
constraint enforces the set — `content_workflow_models.production_state` is a plain
`TEXT DEFAULT 'collected'` (`schema.sql:960`); validation is code-only
(`assertKnownWorkflowModelStates`, `index.mjs:2858-2861`).

### F5 — stale citations in the survey (informational)

`role-matrix-survey.md` cites `index.mjs:4328-4340` / `:4336-4338` for
`ensureItemMutationAccess`; it is now `:4158-4171`. §A cites `auth-integration.mjs:570-582`
for the owner override; now `:571-573` within `:563-583`. §C/§E route line numbers are all
~100-170 lines low.

### F6 — admin/user cannot mutate an item they claimed themselves with no sub-assignee (needs runtime confirm)

`ensureItemMutationAccess` → `canMutateItemByManagementLine` → `canSeeManagedWorkForUser`
(no `allowSelf`) → `canAssignToUserByManagementLine`, which returns `false` when
`actorId === targetId` (`index.mjs:3031`). So an admin/user whose only tie to an item is
`claimed_by_user_id === self` (no assignment to a downline user) appears to fail the mutation
gate. Not confirmed against the claim/handoff flow — flagged for the smoke matrix (row group
"admin, self-claimed, no assignee").

---

## E. Provisioning answers (for the smoke-test fixture)

### E1. Create user + assign role

Two backend routes, both need a valid backend JWT (Bearer, see E4):

| Route | Auth middleware | Controller | Role it can set |
|---|---|---|---|
| `POST /register` | `protect, authorizeAdmin` — `backend/routes/authRoutes.js:30` | `authController.register` `authController.js:61-148` | `parseCanonicalRole(role,"")` then `canActorManageTargetRole(actorRole, role)` gate (`:87-93`); falls back to `user` if not allowed |
| `POST /users` | `protect` **only** — `backend/routes/userRoutes.js:21` | `userController.createUser` `userController.js:296-374` | same `canActorManageTargetRole` check via `resolveAutoManagerForCreate` (`:30-37`, `:317-320`); default `user` (`:315`) |

`canActorManageTargetRole` (`backend/services/userRoleService.js:67-79`):
owner → any non-owner · admin → user/editor/freelance · user → editor/freelance ·
editor/freelance → nobody. **`owner` is not creatable through either route.**

- Table touched: **`users`** (backend MySQL). `INSERT INTO users (email, password, role,
  managed_by_user_id, profile_json)` — `userController.js:331-334`, `authController.js:105-108`.
- Mandatory columns / rules:
  - `email` — required, `UNIQUE`, no format regex enforced (`createUser:299-313`)
  - `password` — required, **≥ 6 chars**, stored `bcrypt.hash(pw, 10)` (`:303-304, 330`)
  - `role` — `VARCHAR(20) NOT NULL DEFAULT 'user'` (`userRoleService.js:89`), must be one of
    the 5 canonical strings or it is coerced to `user`
  - `managed_by_user_id` — `BIGINT UNSIGNED NULL` (`:94`); auto-set to the **actor's** id
    (`resolveAutoManagerForCreate:36`); `validateManagedByLifecycle` (`userRoleService.js:332-361`)
    requires: admin→manager must be owner; user→owner/admin; editor/freelance→owner/admin/user;
    owner→must be NULL
  - `profile_json` — `JSON NULL` (`:99`), built by `buildStoredUserProfile`
- `ensureUserLifecycleColumns` (`userRoleService.js:81-116`) auto-adds the columns + the
  `idx_users_managed_by_user_id` index on first call.
- Role change after creation: `PATCH /users/:id/role` — **owner only**
  (`userRoutes.js:26` `authorizeOwner`; `updateUserRole:376-386`).

### E2. `owner` account

Not via any route. `bootstrapOwnerService.ensureBootstrapOwner`
(`backend/services/bootstrapOwnerService.js:14-96`) runs at backend boot from env
`OWNER_EMAIL` + `OWNER_PASSWORD` (`:5-11`, password ≥6). It either promotes an existing row
(`UPDATE users SET password=?, role='owner', managed_by_user_id=NULL`, `:34-37`) or
`INSERT INTO users (email,password,role,managed_by_user_id) VALUES (?,?,'owner',NULL)`
(`:57`, `:80`). For the fixture: set the env vars, or seed the backend `users` row directly
with `role='owner'`, `managed_by_user_id=NULL`.

### E3. management-line scope (Collector) — what admin/user need to pass `ensureItemMutationAccess`

- Stored in the **Collector-local `users` table** (SQLite), column `managed_by_user_id`
  (`collector/database/schema.sql:9`). "Actor manages target" = actor's id is an ancestor in
  the target's `managed_by_user_id` chain (`canSeeUserByManagementLine`, `index.mjs:3035-3056`).
- Collector `users` rows are **auto-provisioned on first backend-token login**
  (`auth-integration.mjs:312-339` → `resolveCollectorUserForBackendIdentity`).
  `managed_by_user_id` is projected from the backend token's
  `managed_by_backend_user_id` claim, mapped through local ids (`:270-302`); if the manager
  hasn't logged in yet the projection is **pending** and local `managed_by_user_id` stays
  NULL (`:290-295`). `POST /api/users/sync` (owner/admin) forces a directory sync.
- To make an item mutable by admin/user X, the fixture needs **either**:
  - `content_items.claimed_by_user_id` = a Collector user in X's downline
    (`index.mjs:3846-3849`), **or**
  - a `content_assignments` row with `assignee_user_id` = a Collector user in X's downline
    (`:3850-3858`).
  - Note F6: `claimed_by_user_id === X` (self) with no downline assignee may **not** be
    enough.

### E4. Token the Collector accepts

- Issued by backend `POST /login` — `backend/controllers/authController.js:151`,
  `jwt.sign` at `:183-197`.
- **Lifetime: `expiresIn: "7d"`** (`:193`). No refresh endpoint (`authRoutes.js` = register,
  login, me only) — refresh = re-login. Login rate-limited: 10 / 15 min prod, 30 / 15 min dev
  (`authRoutes.js:14-28`).
- Claims: `id, email, role, display_name, managed_by_backend_user_id` (`:184-190`).
- `issuer: "uboncity-backend"`, `audience: ["uboncity-backend", "uboncity-collector"]`
  (`:194-195`) — the same login token is accepted by the Collector.
- Collector verifies with `jwt.verify(token, backendJwtSecret, { issuer: "uboncity-backend",
  audience: "uboncity-collector" })` (`auth-integration.mjs:315-318`). Shared `JWT_SECRET`
  must be ≥ 32 chars and not contain "change" (`authMiddleware.js:16-18`).
- Separate short-lived token: `issueReviewAccessToken` (`authMiddleware.js:131-162`) —
  audience `uboncity-review`, scope `review_content:read`, TTL
  `REVIEW_ACCESS_TTL_SECONDS` default **600s** (min 60), issued by
  `POST /review-content/:id/access-token` (protect + authorizeEditorOrAdmin).

### E5. Existing seeding / fixture scripts — **no combined role+state fixture exists**

| Path | Covers |
|---|---|
| `collector/scripts/lib/test-fixtures.mjs` | `ensureItemClaimed` / `releaseItemClaim` only — via `POST /api/items/:id/claim` / `/release` |
| `collector/tests/test-helpers/fixture-ladder.mjs` | `advancePlaceProductionState(repo, itemId, targetState)` — **place items only**, walks `production_state` forward with direct `repo.upsertWorkflowModel` writes |
| `collector/scripts/lib/test-auth.mjs`, `test-client.mjs`, `shared-smoke-auth.mjs`, `get-test-token.mjs`, `ensure-owner-login.mjs` | auth/token helpers for smoke scripts |
| `collector/scripts/claim-test-item.mjs`, `find-smoke-item.mjs`, `cleanup-smoke-items.mjs`, `seed-mock-work-stage-jobs.mjs`, `reset-collector-content-domain.mjs`, `init-db.mjs` | ad-hoc smoke setup/teardown |
| `collector/scripts/smoke-lifecycle-authority-live.mjs`, `smoke-lifecycle-authority-phasef.mjs` | role/lifecycle smoke (backend authority) |

No script creates "all 6 roles + item in every state". No end-to-end test in
`collector/tests/` exercises F1/F2/F3 (only source-snippet assertions in
`assignment-ui-scope.test.mjs`).

### E6. Reaching each item state

`content_workflow_models` (`schema.sql:957-977`): `content_item_id` `NOT NULL UNIQUE`,
FK → `content_items` `ON DELETE CASCADE`, `production_state`/`publication_state` are plain
`TEXT` with **no CHECK constraint**. So **any state pair is reachable by a direct
INSERT/UPDATE** to that one row (`repo.upsertWorkflowModel(itemId, {production_state,
publication_state}, actorEmail, meta)` is the sanctioned helper).

Caveat: a *coherent* item for behaviour tests needs satellite rows the state string alone
doesn't create — e.g. submit-review's "latest draft body required" check
(`index.mjs:9456-9467`) needs a `content_drafts` row (`current_draft_id`); assignment-gated
actions need `content_assignments`.

Route per rung if you want the real side effects instead of a raw upsert:

| Rung | Route | Role gate |
|---|---|---|
| `collected` | `POST /api/collect` `:14037` | `requireAuth` |
| `analyzed` | `POST /api/run/clean` `:14179` | admin (+owner) |
| `generated` | `POST /api/run/ai-draft` `:14184` | admin, user (+owner) |
| `in_review` / `needs_revision` | `POST /api/run/quality` `:14293` | admin (+owner) |
| `ready_for_publish` / `rejected` | `POST /api/review/action` `:14298` | admin (+owner) |
| `submitted_for_admin_review` | `POST /api/items/:id/submit-admin-review` `:13245` | admin, owner |

### E7. Tables the fixture touches / must clean

Backend MySQL: **`users`** (no cascade — delete explicitly).

Collector SQLite (all FK → `content_items` `ON DELETE CASCADE` unless noted):
`users` (⚠ **no cascade**; `content_assignments.assignee_user_id` FK is `ON DELETE RESTRICT`
→ delete assignments/items **before** users), `content_items`, `content_workflow_models`,
`content_workflow_transitions`, `content_assignments`, `content_assignment_submissions`,
`content_assignment_submission_drafts`, `content_drafts`, `content_review_reports`,
`content_field_packs`, `source_records`, `reviews_raw`, `audit_logs`, plus the auth
directory-state KV.

`__test-` prefix + LIKE escape `\_\_`:

| Table | Prefixable identity column | Notes |
|---|---|---|
| `users` (both) | `email` (`__test-x@e.test`), `display_name` (Collector `NOT NULL`) | email `UNIQUE`, no format regex — OK |
| `content_items` | `item_uid` `NOT NULL UNIQUE` (`schema.sql:17`) | `title`, `description_raw`, `type` are `NOT NULL` — set them; `slug` nullable, no format check |
| `content_assignments` | `assignment_uid` `NOT NULL UNIQUE` (`:1006`) | prefix OK |
| `source_records` | `source_url` has a `UNIQUE` partial index (`:59`) | vary per row (`__test-…/1`) |
| `content_workflow_models`, `_transitions`, `content_assignment_submissions`, `_drafts`, `content_drafts`, `content_review_reports`, `content_field_packs` | *(no text identity column)* | **can't be prefixed** — rely on `ON DELETE CASCADE` from `content_items`, or filter by `content_item_id IN (test items)` |
| `audit_logs` | `actor_email` (`__test-…`) | free text |

No table forces a format that blocks `__test-` on its *own* identity column; the ones that
can't take a prefix have no such column and are reached by cascade / `content_item_id` filter.

---

## D. Test matrix (role × route-with-role-list × item state)

Roles: **O**=owner **A**=admin **U**=user **Ea**=editor *with* active editorial assignment
on the item · **Eu**=editor *without* · **F**=freelance.
"Deciding layer" points at the row that produces the status. Fixture column → §E.

Duplicate cells collapsed: rows are kept only where the outcome differs by role, by state,
or by which layer decides.

### D1. Collector run/pipeline routes (role list, state-independent for the role gate)

| Route (`index.mjs`) | O | A | U | Ea | Eu | F | Deciding layer | Fixture |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| `POST /api/collect` `:14037` | 200 | 200 | 200 | 200 | 200 | 200 | `requireRole` absent; `requireAuth` only (`auth-integration.mjs:552-561`) | any role token (E1/E4) |
| `POST /api/run/clean` `:14179` | 200 | 200 | 403 | 403 | 403 | 403 | `requireRole("admin")` + owner override `:571-573` | O/A token; item at `collected` |
| `POST /api/run/ai-draft` `:14184` | 200 | 200 | 200 | 403 | 403 | 403 | `requireRole("admin","user")` | O/A/U token; item at `analyzed` |
| `POST /api/run/quality` `:14293` | 200 | 200 | 403 | 403 | 403 | 403 | `requireRole("admin")` | O/A token; item at `generated`/`in_review`/`needs_revision` |
| `POST /api/review/action` `:14298` | 200 | 200 | 403 | 403 | 403 | 403 | `requireRole("admin")` | O/A token; item at `in_review` |
| `POST /api/review/reopen` `:14308` | 200 | 200 | 403 | 403 | 403 | 403 | `requireRole("admin")` | O/A token; item at `rejected`/`ready_for_publish` |
| `POST /api/items/:id/unpublish` `:14540` | * | * | 403 | 403 | 403 | 403 | `requireRole("admin","owner")` then `publication_state==="published"` gate | O/A token; item `completed/published` (`*`=200 if published else 409) |

### D2. Collector item-mutation routes — where `requireRole` and `ensureItemMutationAccess` disagree

State assumed legal for the action; cells show the **authorization** outcome.
"scope✓" = actor is owner, or admin/user whose downline covers the item's claimant/assignee (§E3).

| Route (`index.mjs`) | O | A scope✓ | A no-scope | U scope✓ | Ea | Eu | F | Deciding layer | Fixture |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| `PATCH /api/items/:id/assets/:assetId/role` `:13610` | 200 | 200 | 403 | 200 | **403** | 403 | **403** (role list) | `requireRole(O,A,ed,U)` → `ensureItemMutationAccess` `:4158-4171`; editor branch dead → **F1** | item + assignment to downline user; editor with assignment |
| `PATCH /api/items/:id/assets/:assetId/selected` `:13573` | 200 | 200 | 403 | 200 | **403** | 403 | 403 (role list) | same as above — **F1** | " |
| `PATCH /api/items/:id/assets/:assetId/caption` `:13652` | 200 | 200 | 403 | 200 | **403** | 403 | 403 (role list) | same — **F1** (born broken) | " |
| `PATCH /api/items/:id/reference-media/:id/selected` `:13099` | 200 | 200 | 403 | 200 | **403** | 403 | **403** | same — **F1**; role list here *does* include freelance, still 403 | " |
| `POST /api/assets/upload` `:14718` | 200 | 200 | 403 | 200 | **403** | 403 | 403 (role list) | `ensureComposerMediaEditAccess` = alias of `ensureItemMutationAccess` (`:4475-4477`) — **F1** | " |
| `PUT /api/items/:id/editor-work` `:8879` | 200 | 200 | 403 | 200 | **200** | 403 | 403 (role list) | `ensureArticleComposerEditAccess` editor branch `:4217` (not `allowAssignedSelf`-gated) | item at `content_in_progress`; editor assignment `assigned`/`in_progress` |
| `POST /api/items/:id/article-process/transition` (≠ `ready_for_review`) `:9357` | 200 | 200 | 403 | 200 | 200 | 403 | 403 (role list) | `ensureArticleProcessTransitionAccess` `:4248` → composer branch | " |
| `POST /api/items/:id/article-process/submit-review` `:9411` | 200 | 200 | 403 | 200 | **403** | 403 | 403 (role list) | Gate A `:4240-4246` needs assignment `submitted`/`resubmitted`; Gate B `:9445-9451` needs `assigned`/`in_progress`/`revision_requested` — disjoint → **F2** | editor assignment in *any* state — all fail |
| `POST /api/items/:id/submit-admin-review` `:13245` | 200 | 200 | 403 | 403 | 403 | 403 | `requireRole("admin","owner")` + scope + `ready_for_sync` gate `:13245+` | O/A; item `ready_for_publish/approved` + article-process `ready_for_sync` |

### D3. Collector assignment routes (editor/freelance functional path)

| Route (`index.mjs`) | O | A | U (assigner) | Ea | F (assigned) | Eu / unrelated | Deciding layer | Fixture |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| `PUT /api/assignments/:id/draft` `:11033` | 200 | scope | scope | 200 | 200 | 403 | `hasAssignmentAccess` `:3089-3106` (assignee self, or manages assignee) | assignment row, assignee = actor |
| `POST /api/assignments/:id/submissions` `:11348` | 200 | scope | scope | 200 | 200 | 403 | `hasAssignmentSubmissionAccess` | assignment `assigned`/`in_progress`/`revision_requested` |
| `POST /api/assignments/:id/assets/upload` `:15217` | 200 | scope | scope | 200 | 200 | 403 | `hasAssignmentAccess` | " |
| `GET /api/assignments/:id/deliverables/summary` `:12054` | 200 | scope | scope | **403** | 200 | 403 | `requireRole("admin","user","freelance")` — **editor not listed** | assignment + freelance assignee |

### D4. Backend review routes

| Route (`reviewContentRoutes.js`) | backend O | backend A | backend editor | backend freelance | backend user | Deciding layer | Fixture |
|---|:-:|:-:|:-:|:-:|:-:|---|---|
| `POST /review-content/:id/approve` `:65` | 200 | 200 | **403** | 403 | 403 | `authorizeEditorOrAdmin` = admin+owner only (`authMiddleware.js:122-129`) | backend review-content row pending; backend O/A token |
| `POST /review-content/:id/needs-revision` `:66` | 200 | 200 | 403 | 403 | 403 | same | " |
| `POST /review-content/:id/reject` `:67` | 200 | 200 | 403 | 403 | 403 | same | " |
| `GET /review-content/:id` `:63` | 200 | 200 | 403 | 403 | 403 | `protectReviewContentReadAccess` → `REVIEW_CONTENT_INTERNAL_ROLES` = owner+admin, **or** a valid `review_content:read` scoped token | O/A token, or review-access token (E4) |
| `POST /review-content/ingest` `:60` | 200† | 200† | 403† | 403† | 403† | `x-review-sync-token` header bypasses role; else `authorizeEditorOrAdmin` | `COLLECTOR_REVIEW_SYNC_TOKEN` for the header path |

† = with no sync-token header; the Collector always calls this with the header.

**Matrix cell count:** D1 = 7 routes × 6 role-classes = 42 · D2 = 9 × 7 = 63 · D3 = 4 × 6 = 24 ·
D4 = 5 × 5 = 25. **Total distinct cells after collapsing duplicates: 154.**
(Raw grid before collapsing: 6 roles × 27 role-listed routes × ~4 relevant states ≈ 648.)

---

## Summary

**Survey claims still TRUE:** A1, A2, A3, A4 (all four traps), the §C dead-path set (bar the
two re-classified below), the §B layering description.

**Survey claims CHANGED:**
- **F1 / §B** — `allowAssignedSelf` opt-in set is now empty; editor/freelance branch of
  `ensureItemMutationAccess` is dead code; 6 routes list `editor`/`freelance` then 403 them.
- **F4 / §B** — canonical `production_state` list is stale (11 → 17; moved to
  `repository.mjs:440-458`).
- **F5** — most §C/§E line citations are ~100-170 lines low; `ensureItemMutationAccess` moved
  to `:4158-4171`.

**Dead paths still dead: 5** — `POST /api/run/clean`, `POST /api/run/quality`,
`POST /api/review/action`, `POST /api/review/reopen`, `POST /api/items/:id/unpublish`.
Re-classified: backend `/review-content/:id/reject` **has** a caller
(`Approvals.jsx:786`); `article-process/submit-review` and `field-pack/return-to-clean`
have callers but are **broken/incomplete** (F2, F3).

**New defects:** F1 (editor asset routes 403), F2 (editor submit-review double bind),
F3 (return-to-clean orphans assignment), F6 (self-claim mutation gap — needs runtime confirm).

**Set E answered:** E1–E7 all answered. Partial: E6 caveat (satellite rows needed for
coherent behaviour-test items); E7 (some tables uncleanble by prefix — covered by cascade).
Nothing in E is unanswerable.

**Matrix: 154 distinct cells** (D1 42 · D2 63 · D3 24 · D4 25).

---

# ADDENDUM — branch `fix/item-mutation-assigned-self` @ `2dcaad8` (2026-09-09)

Read-only audit on Runtime. Scope: the 5-line fix (`1f6df72`) + the new route-level test
(`2dcaad8`), the global `/api` freelance middleware, and this doc's matrix. No code changed
(the §1 revert was applied to the working tree, tested, and reverted — tree confirmed clean,
`HEAD = 2dcaad8b8c329e7716a536b0d3308698341979b0`).

## 1. Revert proof — **PASS** (the new test IS a real regression guard)

`node --test "collector/tests/item-mutation-route-access.test.mjs"` from repo root, via
`test-runner`:

| Working tree | Result | exit |
|---|---|---|
| `2dcaad8` as-is (fix present) — baseline | `# tests 5 / # pass 5 / # fail 0` | 0 |
| 5 lines `{ allowAssignedSelf: true }` reverse-applied (`git apply -R` of `1f6df72`'s `index.mjs` hunks, working tree only) | `# tests 5 / # pass 2 / # fail 3` | 1 |

Failures on revert:
- `editor + editorial assignment state=assigned → PATCH assets/:assetId/role not 403`
  → `should not be 403, got 403`
- `editor + editorial assignment state=in_progress → PATCH reference-media/:id/selected not 403`
  → `got 403: {"error":"role นี้ไม่มีสิทธิ์แก้บทความในขั้นนี้"}` (from `index.mjs:4169`)
- parent `ensureItemMutationAccess route-level — allowAssignedSelf` → `2 subtests failed`

Unlike `item-mutation-assigned-self.test.mjs` (finding **V2** — tautology; green both ways),
`item-mutation-route-access.test.mjs` spawns the real server (`:56`), hits the HTTP routes
(`:179`, `:201`, `:225`, `:248`), and goes red when the fix is removed. F1 is now guarded.
Restore verified: `grep -c "allowAssignedSelf: true" collector/server/index.mjs` → `5`,
`node --check` OK, `git diff` empty, `git status --short` shows only the two untracked
`audit/*-verify.md` outputs.

## 2. Global `/api` freelance middleware — `collector/server/index.mjs:7355-7403`

`app.use("/api", (req, res, next) => { … })` — added 2026-05-13 (`165e66a`), long before the
survey and this doc. **The role-matrix audit never modeled it.**

- **Auth gate** (`:7356-7360`): runs `requireAuth` for every `/api/*` **except** `/api/health`,
  `/api/auth/login`, `/api/web-review-feedback`.
- **Role filtered: `freelance` only** (`:7362` — `if (role !== "freelance") { next(); return; }`).
  `owner` / `admin` / `editor` / `user` pass this layer unconditionally — **`editor` is not
  gated here at any path.**
- **freelance allowlist** (`:7368-7392`), method + exact-path (paths are post-mount, i.e.
  minus `/api`):
  - `GET /auth/me`, `GET /assignments/mine` (`:7369`)
  - `POST /auth/logout` (`:7370`)
  - `GET /assignments/\d+` (`:7371`)
  - `GET|PUT|DELETE /assignments/\d+/draft` (`:7372-7374`)
  - `POST|GET /assignments/\d+/submissions` (`:7375-7376`)
  - `GET /assignments/\d+/deliverables/latest-bundle` (`:7377`)
  - `GET|POST /assignments/\d+/submissions/\d+/deliverables` (`:7378-7379`)
  - `POST /assignments/\d+/assets/upload` (`:7380`)
  - conditional: `GET /items/\d+/field-pack/current` **iff** `hasItemBriefAccess` (`:7381-7382`,
    `:7389-7392`, gate at `:3726-3744`)
  - conditional: `GET /assets?content_item_id=N` **iff** `hasItemBriefAccess` (`:7383-7388`)
- Everything else for freelance → `403 {"error":"freelance access is limited to assigned
  submissions"}` (`:7398`).

### Routes that list `freelance` in `requireRole` but this middleware blocks it (the "role list lies")

**27 routes — blocked unconditionally** (freelance 403s at `:7398`, never reaches the handler
or its `requireRole`):

| index.mjs | Route |
|---|---|
| `:7858` | `GET /api/workflow-states` |
| `:8241` | `GET /api/items/:id` |
| `:9706` | `GET /api/items/:id/intelligence-model/latest` |
| `:9747` | `GET /api/items/:id/readiness/latest` |
| `:11523` | `GET /api/assignments/:id/deliverables` |
| `:12054` | `GET /api/assignments/:id/deliverables/summary` |
| `:12078` | `POST /api/assignments/:id/deliverables/summary/evaluate` |
| `:12116` | `GET /api/assignments/:id/deliverables/readiness` |
| `:12140` | `POST /api/assignments/:id/deliverables/readiness/evaluate` |
| `:12179` | `GET /api/assignments/:id/handoff-source` |
| `:12227` | `GET /api/assignments/:id/history` |
| `:12297` | `GET /api/items/:id/search-enrichment` |
| `:12379` | `GET /api/items/:id/place-intelligence` |
| `:12417` | `GET /api/items/:id/social-signals` |
| `:12462` | `GET /api/items/:id/momentum` |
| `:12548` | `GET /api/items/:id/content-direction` |
| `:12590` | `GET /api/items/:id/evidence-blocks` |
| `:12641` | `GET /api/items/:id/approved-context` |
| `:12943` | `GET /api/items/:id/draft-input-preview` |
| `:12981` | `GET /api/items/:id/media-candidates` |
| `:13059` | `GET /api/items/:id/image-workflow` |
| `:13081` | `GET /api/items/:id/reference-media` |
| `:13099` | `PATCH /api/items/:id/reference-media/:referenceMediaId/selected` |
| `:13192` | `GET /api/items/:id/export-readiness` |
| `:14794` | `POST /api/assignments/:id/assets/uploads/start` |
| `:14876` | `POST /api/assignments/:id/assets/uploads/:uploadId/chunks` |
| `:14949` | `POST /api/assignments/:id/assets/uploads/:uploadId/finalize` |

**1 route — partially honored (conditional):** `:12721` `GET /api/items/:id/field-pack/current`
— freelance reaches it only when `hasItemBriefAccess` passes (`:7389-7392`).

**11 routes where `freelance` in `requireRole` is genuine** (in the allowlist, freelance
passes `:7355`): `:10855`, `:10981`, `:11000`, `:11033`, `:11070`, `:11348`, `:11499`,
`:11547`, `:11959`, `:11994`, `:15217`.

(11 + 27 + 1 = 39 = every single-line `requireRole(...freelance...)` in `index.mjs`.)

### Effect on the branch fix

`1f6df72` added `{ allowAssignedSelf: true }` to `ensureItemMutationAccess` at `:4476`
(`ensureComposerMediaEditAccess` → `POST /api/assets/upload` `:14718`, `POST /api/assets/register`
`:15373`), `:13112` (`reference-media/:id/selected`), `:13587` (`assets/:assetId/selected`),
`:13624` (`assets/:assetId/role`), `:13664` (`assets/:assetId/caption`). **None of those 5
paths is in the freelance allowlist**, so freelance 403s at `:7398` before reaching any of
them. The `role === "freelance"` half of `index.mjs:4166` remains unreachable for freelance
on every one of these routes — the fix is **editor-only in effect**. Not a regression, but
the commit message ("editor/freelance self-access") and this doc's F1 wording ("`freelance`
is latent everywhere") understate it: for these routes freelance is *structurally* blocked
two layers earlier, not merely un-opted-in.

## 3. Matrix cells wrong because `:7355` was not counted

**2 cells — both the `freelance` role, both cases where the matrix shows freelance ALLOWED
but `:7355` blocks it:**

| Matrix | Route | Cell | Matrix says | Actual | Cause |
|---|---|---|---|---|---|
| D1 (`:398`) | `POST /api/collect` `:14037` | **F** | `200` ("requireRole absent; requireAuth only") | **403** `"freelance access is limited to assigned submissions"` | `/collect` not in `:7368-7392` allowlist |
| D3 (`:430`) | `GET /api/assignments/:id/deliverables/summary` `:12054` | **F (assigned)** | `200` | **403** (same) | `/assignments/\d+/deliverables/summary` not in allowlist |

This also falsifies **§A3** (`:44-51`) — "Any authenticated backend identity (any of the 5
roles) can collect" is **not** true for `freelance`.

**~7 further cells: status value coincidentally correct (403 either way) but the "Deciding
layer" attribution is wrong** — the block is `:7355`, not the layer named:
- D1 F cells for `run/clean` `:399`, `run/ai-draft` `:400`, `run/quality` `:401`,
  `review/action` `:402`, `review/reopen` `:403`, `unpublish` `:404` (matrix credits
  `requireRole`; freelance actually 403s earlier at `:7398`).
- D2 F cell for `reference-media/:id/selected` `:416` — matrix note "role list here *does*
  include freelance, still 403 [via F1]"; the real stop is `:7355`, and the error body is
  `"freelance access is limited to assigned submissions"`, not
  `"role นี้ไม่มีสิทธิ์แก้บทความในขั้นนี้"`.

**Structural gap (not a cell):** §B's layer table (`:77-82`) and the "Order for an
item-mutation route" line (`:73`) omit `:7355` entirely. For `freelance` it is the *first*
authorization layer and rejects almost every item/assignment route before `requireRole` runs.
The §B table should gain a row above `requireRole(...)`:
`global /api freelance allowlist | index.mjs:7355-7403 | freelance only: 403 unless method+path in the :7368-7392 allowlist (or a hasItemBriefAccess brief path)`.

D2/D4: no `:7355` miscount (D2 F cells already 403; D4 is backend, different process).
Separately, D2's `Ea` column is now stale against this branch — editor-with-assignment is
`200` (not `403`) on `:13587 / :13624 / :13664 / :13112 / :4476` after `1f6df72` — but that
is the branch's intended effect, not a `:7355` issue.

## 4. Test-file path hygiene — clean

- `collector/tests/item-mutation-route-access.test.mjs`: every path from `import.meta.url`
  — `__dirname` `:15`, `collectorRoot` `:16`, `schemaPath` `:17`, `serverPath` `:18`; temp
  DB under `os.tmpdir()` `:78-79`; spawned server gets `cwd: collectorRoot` + explicit
  `COLLECTOR_ROOT` / `DB_PATH` / `PORT` / `BACKEND_JWT_SECRET` env `:56-66`. No
  `process.cwd()`, no `path.resolve(<relative>)`, no absolute literal.
- `collector/tests/item-mutation-assigned-self.test.mjs:101` — the finding **V1** bug is
  fixed in `2dcaad8`: `path.resolve("collector/database/schema.sql")` →
  `path.join(root, "database", "schema.sql")` (`root` from `import.meta.url` at `:12-13`).
  Confirmed by `git show 2dcaad8` and by reading the file. No cwd-relative or absolute paths
  remain in either file.

## 5. Leftover `__test-` rows in the Runtime collector DB (`collector/data/collector.db`)

Read-only, `LIKE ? ESCAPE '\'`, pattern `\_\_test-%` (and the two test-specific prefixes):

| Table / column | Count |
|---|---|
| `content_items.title` | **0** |
| `content_items.item_uid` | **0** |
| `content_items.slug` | **0** |
| `content_assignments.assignment_uid` | **0** |
| `content_assignments` joined to a `__test-` item | **0** |
| `users.email` | **0** |
| `users.display_name` | **0** |
| `content_items` / `users` LIKE `\_\_test-route-access-%` | **0** / **0** |
| `content_items` / `users` LIKE `\_\_test-mutation-access-%` | **0** / **0** |

Zero leftover everywhere — both test files write only to disposable temp SQLite DBs
(`os.tmpdir()`) that they `fs.rmSync` on teardown.

## 6. Merge readiness

- **Revert proof: PASS** — `item-mutation-route-access.test.mjs` genuinely guards F1
  (2/5 pass on revert vs 5/5 with the fix). V2 is now answered.
- **V1 fixed** — no cwd-relative/absolute paths in either test file.
- **Leftover: 0.**
- **F1 code fix is correct and minimal for `editor`** (already verified in
  `item-mutation-assigned-self-verify.md` §1-2).
- **One caveat, not a blocker:** the `freelance` half of the fix is inert — `:7355` blocks
  freelance from all 5 fixed paths. If freelance asset/reference-media editing is actually
  wanted, that needs a *separate* change to the `:7368-7392` allowlist and is out of scope
  for this branch. If it is not wanted, drop `|| role === "freelance"` framing from the
  commit narrative.
- **This doc now needs the `:7355` layer folded into §B and the 2 D1/D3 cells corrected**
  (captured above).

**Ready to merge:** yes for the F1 fix + regression test — the branch does what it claims for
`editor`, is minimal, and is now guarded. The freelance caveat and the matrix corrections are
follow-ups, not merge blockers. Not merging on my own initiative — Sor's call.
