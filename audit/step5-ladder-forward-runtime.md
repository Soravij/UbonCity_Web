# Step 5 ladder-forward runtime report

Run date: 2026-08-02 (Asia/Bangkok)  
Runtime checkout: `D:\UbonRuntime\repos\UbonCity_Web` only. The stale `C:\UbonRuntime\repos\UbonCity_Web` checkout was not accessed.

## Deployment confirmation

| Check | Result |
| --- | --- |
| Runtime branch and HEAD | `dev` at `5a0de7b22a9209ca3e2488d2b6bbe1dbfcfc8f7b` (`merge: step 5B round 1 canonical workflow readers`) |
| Worktree before test | Clean |
| Runtime stack | Restart completed by operator: backend 6420, collector 11992, frontend 15320, admin 15264, cloudflared 15980 |
| `GET http://127.0.0.1:5000/api/health` | `200`, `ok: true`, MySQL database `uboncity` |
| `GET http://127.0.0.1:5070/api/health` | `200`, `ok: true`, SQLite database `D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db` |
| Migration/schema action | None. No migration command was run and no schema file/database schema was modified. |

## Authentication blocker

The Collector UI at `http://127.0.0.1:5070/` showed the login page with the visible `อีเมล`, `รหัสผ่าน`, and `เข้าสู่ระบบ` controls. No owner/admin/editor/freelance test credentials were present in the Runtime environment. Existing token fixture files were not used because their JWT expiry timestamps pre-date this run.

Unauthenticated confirmation (no record was created or changed):

| Request | Result |
| --- | --- |
| `GET /api/items` | `401` |
| `POST /api/collect` with an empty manual payload | `401` |
| `POST /api/run/clean` with `{}` | `401` |

No password was guessed and no repeated login was attempted, to avoid account lockout/rate-limit effects. Because authenticated identities were unavailable, raw places `id=1` and `id=2` were not accessed or deleted, and none of the five disposable records was created.

## Forward ladder

All state triples below are `production_state / publication_state / workflow_status`.

| Step | Role | UI/API | 3 states before -> after | Pass/fail |
| --- | --- | --- | --- | --- |
| Create five disposable raw place records | owner or admin | `POST /api/collect` (manual) | Not read -> Not changed | Blocked — endpoint requires authenticated owner/admin; returned `401` without credentials. |
| collected/draft -> clean | admin | Direct `POST /api/run/clean` (no UI caller by design) | Not read -> Not changed | Blocked — authenticated admin required. |
| clean -> analyzed | authorized workflow actor | Relevant workflow UI/API | Not read -> Not changed | Blocked — no authenticated actor/session. |
| analyzed -> ai-draft | admin or permitted user | Generate with AI UI / `POST /api/run/ai-draft` | Not read -> Not changed | Blocked — no authenticated actor/session. |
| ai-draft -> generated | authorized workflow actor | Relevant workflow UI/API | Not read -> Not changed | Blocked — no authenticated actor/session. |
| generated -> quality | admin | Quality Check UI / `POST /api/run/quality` | Not read -> Not changed | Blocked — no authenticated admin session. |
| quality -> in_review | authorized workflow actor | Review UI/API | Not read -> Not changed | Blocked — no authenticated actor/session. |
| Review decision -> ready_for_publish/approved | admin | Review UI; reject route is direct `POST /api/review/action` by design | Not read -> Not changed | Blocked — no authenticated admin session. |
| Submit admin review -> submitted_for_admin_review | authorized submission role | Submit Admin Review UI / `POST /api/items/:id/submit-admin-review` | Not read -> Not changed | Blocked — no authenticated actor/session. |
| Backend Admin Approvals -> published | backend admin | Backend Admin Approvals UI/API | Not read -> Not changed | Blocked — no authenticated backend-admin session. |

## Claim-pool verification

Required scenario: two editors managed by different administrators, plus one freelance account, must prove that `GET /api/items` and `POST /api/items/:id/claim` exclude non-raw items and enforce management-line scope.

Result: **not executed / blocked by the same authentication prerequisite.** No editor or freelance credentials, user IDs, or existing authenticated browser sessions were available. `GET /api/items` returns `401` before the canonical-reader filtering can be observed, and no claim request was sent. Therefore this run does not assert that the canonical pool filter or management-line scopes pass.

## Required follow-up to complete this report

Provide non-expired credentials (or pre-authenticated sessions) for: one owner/admin, editor A and editor B under different management lines, and one freelance account. Then rerun the ladder using five newly created manual records, read the three states after every transition, and execute the claim-pool matrix. Do not use raw records 1 or 2.
