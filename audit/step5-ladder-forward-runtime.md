# Step 5 ladder-forward runtime report

Run date: 2026-08-02 (Asia/Bangkok)  
Runtime checkout used: `D:\UbonRuntime\repos\UbonCity_Web` only. The stale `C:\UbonRuntime\repos\UbonCity_Web` checkout was not accessed.

## Runtime confirmation

| Check | Result |
| --- | --- |
| HEAD | `5a0de7b22a9209ca3e2488d2b6bbe1dbfcfc8f7b` (`merge: step 5B round 1 canonical workflow readers`) |
| Worktree before test | Clean |
| `GET http://127.0.0.1:5000/api/health` | `200`, `ok: true` |
| `GET http://127.0.0.1:5070/api/health` | `200`, `ok: true` |
| Migration/schema action | None. No migration command was run and no schema file/database schema was modified. |

## Token preflight — STOP

Tokens were read from `D:\UbonRuntime\tmp\step5-tokens.json` without printing, storing, or committing their values. Each already included its required `Bearer ` prefix and was used unchanged as the Authorization header. JWT payloads were decoded locally only to obtain role, email, and expiry. `GET /api/items` was then issued to Collector for every token.

| Token key | JWT role | JWT email | Expiry remaining (minutes) | `GET /api/items` | Result |
| --- | --- | --- | ---: | ---: | --- |
| owner | owner | soravij88@gmail.com | 10,074 | 200 | Pass |
| user | user | user@uboncity.com | 10,071 | 200 | Pass |
| editorA | editor | ked@123 | 10,075 | 403 | **Fail** — must be 200 |
| editorB | editor | editor@uboncity.com | 10,076 | 403 | **Fail** — must be 200 |
| freelance | freelance | kfl@123 | 10,073 | 403 | **Fail** — must be 200 |

Authentication token TTL in the backend login source is `expiresIn: "7d"` in `backend/controllers/authController.js`. The separate review-access token setting is `REVIEW_ACCESS_TTL_SECONDS`, defaulting to `600` seconds, in `backend/middleware/authMiddleware.js`; it is not the Collector login JWT used here.

The run stopped at token preflight because three required identities returned `403`, contrary to the required all-200 condition. No token was within 30 minutes of expiry, and no `401` occurred.

## No-mutation confirmation

Because the STOP condition occurred before step 1:

- No `POST /api/collect` was sent; none of the five disposable records was created.
- Raw place IDs 1 and 2 were not read, changed, or deleted.
- No state transition, review action, admin submission, backend approval, or claim was sent.
- No code, migration, or schema change was made.

## Required ladder and claim-pool matrix

All state triples are `production_state / publication_state / workflow_status` read from the actual database. They are `not read -> not changed` below because no item was created and the run correctly stopped at preflight.

| Step | Role | UI/API | 3 states before -> after | Pass/fail |
| --- | --- | --- | --- | --- |
| Create five disposable raw place records | owner/admin | `POST /api/collect` (manual) | Not read -> Not changed | Not run — token preflight STOP. |
| collected/draft -> clean | admin | Direct `POST /api/run/clean` | Not read -> Not changed | Not run — token preflight STOP. |
| clean -> analyzed | owner | Workflow UI/API | Not read -> Not changed | Not run — token preflight STOP. |
| analyzed -> ai-draft -> generated | owner | Generate-with-AI UI / API | Not read -> Not changed | Not run — token preflight STOP. |
| generated -> quality -> in_review | admin | Quality/review UI/API | Not read -> Not changed | Not run — token preflight STOP. |
| Review decision -> ready_for_publish/approved | admin | Review UI; reject path would be `POST /api/review/action` | Not read -> Not changed | Not run — token preflight STOP. |
| Submit admin review -> submitted_for_admin_review | owner | Submit Admin Review UI/API | Not read -> Not changed | Not run — token preflight STOP. |
| Backend Admin Approvals -> published | backend admin | Backend Admin Approvals UI/API | Not read -> Not changed | Not run — token preflight STOP. |
| Claim pool: non-raw excluded | owner/user/editor/freelance | `GET /api/items`, `POST /api/items/:id/claim` | Not read -> Not changed | Not run — editorA/editorB/freelance cannot access pool (`403`). |
| Claim scope: editorA vs editorB | editorA/editorB | `GET /api/items`, `POST /api/items/:id/claim` | Not read -> Not changed | Not run — both receive `403` at required preflight. |
| Claim scope: user management line | user | `GET /api/items`, `POST /api/items/:id/claim` | Not read -> Not changed | Not run — cross-role matrix cannot be completed while editor identities fail preflight. |
| Claim scope: freelance assignment-only | freelance | `GET /api/items`, `POST /api/items/:id/claim` | Not read -> Not changed | Not run — freelance receives `403` at required preflight. |

## Resume point

Repair or reissue only the `editorA`, `editorB`, and `freelance` credentials/tokens until each receives `200` from `GET /api/items`. Resume at token preflight; do not create the five disposable records until it passes. No in-progress content item or workflow state exists from this run.
