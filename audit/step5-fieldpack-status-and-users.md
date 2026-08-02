# Step 5 — field-pack status and collector-user survey

Date: 2026-08-02 (Asia/Bangkok)  
Scope: source and SQLite inspection only on `D:\UbonRuntime\repos\UbonCity_Web`. No state-changing endpoint, migration, schema operation, source edit, or direct database write was performed.

## 1. Field pack `draft` → `ready_for_field`

### Actual endpoint and minimum payload

For an existing current field pack, use:

```http
PUT /api/field-packs/:fieldPackId
Authorization: Bearer <owner/admin/user token>
Content-Type: application/json

{"status":"ready_for_field"}
```

The route is `collector/server/index.mjs:12809-12852`. It permits `owner`, `admin`, or `user` (owner bypasses ordinary role-list checks), loads the pack and its item, and requires `ensureItemMutationAccess` (`:12816-12830`). The repository merges the supplied patch with the existing pack (`collector/db/repository.mjs:10071-10090`), so the one-field payload retains the existing checklist/reference/metadata values.

The equivalent UI action is the Step 4 field-pack editor: choose **เปลี่ยนเป็นพร้อมส่ง handoff**, then save. The control proposes `ready_for_field` at `collector/server/public/item-editor.js:3978-3989`; saving sends `PUT /api/field-packs/:id` at `:4346-4354`.

`POST /api/items/:id/field-packs` (`collector/server/index.mjs:12774-12806`) can create a *new* pack with `status: "ready_for_field"`, but it is not the appropriate operation for converting an existing current pack.

### What is actually required before the status can be set

Server-side there is **no semantic readiness gate** specific to changing the existing pack to `ready_for_field`. The actual hard conditions are only:

1. valid existing field-pack id and its content item;
2. caller has `owner/admin/user` plus item mutation access; and
3. a valid enum value. `normalizeFieldPackStatus` accepts the five values below and aliases legacy `ready_for_handoff` to `ready_for_field` (`collector/db/repository.mjs:2381-2386`).

The updater validates the *shape* of any supplied checklist rows; a `must_capture` row must have a non-empty `item_text` plus `capture_type` in `photo|video|both` (`repository.mjs:2598-2614`). It does not require that any checklist, image, reference, summary, or draft exist before accepting the status patch.

There are stronger **UI packaging checks**, but they are not server enforcement for this PUT: missing editor summary (when description is short), no `must_verify_fact`, and no `must_capture` are marked hard by `buildPackagingRequirements`; missing selected image, question list, story angle, source reference, and field notes are soft (`collector/server/public/item-editor.js:4380-4470`). Assignment creation/P1 is the later hard server gate: it checks only that the current pack status is exactly `ready_for_field` (`collector/server/index.mjs:2944-2959`, `:10788-10811`).

### Field-pack statuses and lifecycle

| Status | Meaning / observed writer |
| --- | --- |
| `draft` | Default and current AI-agent output. The agent converter deliberately maps agent-requested `ready_for_field`/`ready_for_handoff` back to `draft` (`collector/services/workflow.mjs:1991-2002`). |
| `ready_for_field` | Curator has marked the brief ready for field handoff. This is the only status accepted by the P1/field-assignment route. |
| `field_in_progress` | Enum/UI label only in the inspected paths; the ordinary field assignment state machine, not this field-pack status, is what writes canonical `field_working`. |
| `field_done` | Enum/UI label only in the inspected paths; field submission writes canonical `field_review` through the assignment state machine. |
| `on_hold` | Paused brief. UI offers a return to `ready_for_field`. |

There is no server transition matrix for these five values: the update route accepts any valid enum as a patch. The intended UI path is `draft → ready_for_field`; `ready_for_field → draft` is offered for return-to-edit; `on_hold → ready_for_field` is offered for resumption. `field_in_progress` and `field_done` have no UI status-change button (`item-editor.js:3978-3989`).

### Corrected relation to the eight-position place ladder

The prior survey's eight **canonical production states** remain:

`analyzed → generated → ready_for_content → field_working → field_review → writing_assigned → writing → in_review`

But `field_pack.status` is a separate sidecar state, not a ninth `production_state`. The corrected operational sequence is:

1. At `analyzed`, AI mode creates the current field pack as `draft` (and deliberately remains `analyzed`).
2. Owner/admin/user curates it with `PUT /api/field-packs/:id {"status":"ready_for_field"}`.
3. Separately, the still-missing public draft-producing path must create `generated` (the prior audit used one explicit manual bridge only for testing).
4. Only once **both** `production_state=generated` and current pack `status=ready_for_field` hold can P1 `POST /api/items/:id/place-ready-for-content` produce `ready_for_content` (`collector/server/index.mjs:8987-9034`).
5. The remaining positional ladder proceeds through field assignment, field review, editorial assignment, drafting, and submit review.

Thus the missing field-pack transition belongs **before P1 / `ready_for_content`**, in parallel with—not a replacement for—the missing `analyzed → generated` business path.

## 2. When collector users are created

### Calls to `resolveCollectorUserForBackendIdentity`

`resolveCollectorUserForBackendIdentity` is defined at `collector/server/auth-integration.mjs:190-310` and writes/updates `users` by normalized email, preserving the backend user id in `_auth_sync` profile metadata.

It is called from two paths:

| Caller | File:line | When it writes |
| --- | --- | --- |
| `verifyBackendTokenIdentity` | `collector/server/auth-integration.mjs:312-337`, call at `:321` | Every valid bearer-token authentication attempt: creates or refreshes the local projection before route authorization. `requireAuth` calls this at `:552-559`. |
| `syncCollectorUsersFromBackendDirectory` | `collector/server/auth-integration.mjs:401-486`, call at `:451` | Directory-wide sync: invoked after successful internal-staff collector login when sync is stale (`collector/server/index.mjs:7438-7485`), optionally by owner diagnostics with `sync_backend=1` (`:7609-7614`), or owner/admin `POST /api/users/sync` (`:7780-7785`). |

Therefore a valid backend token is provisioned/refreshed at **authentication**, before `requireRole` decides whether it is allowed. A request that subsequently receives **403** has already passed `requireAuth`; its local user row is created/refreshed. An invalid/expired token receives 401 and does not create a row.

### Current SQLite evidence

`collector/data/collector.db` currently has **14** `users` rows, created at `2026-08-02 08:30:57`:

| Local collector id | Role |
| ---: | --- |
| 1 | owner |
| 2 | owner |
| 3 | owner |
| 4 | admin |
| 5 | admin |
| 6 | admin |
| 7 | user |
| 8 | user |
| 9 | user |
| 10 | editor |
| 11 | editor |
| 12 | freelance |
| 13 | freelance |
| 14 | freelance |

The `_auth_sync` mapping shows that backend identity 62 maps to local collector id **10** (editor), and backend identity 61 maps to local collector id **14** (freelance). Those backend ids are not local primary keys.

### Correction to Round 4's “only owner id 1” claim

That claim is **refuted**. The Round 4 diagnostic query was restricted to `WHERE id IN (1,57,61,62)`, which only returned local id 1. It did not count `users` and incorrectly treated backend token ids 61/62 as collector-local ids. The database had 14 rows, including the correctly projected assignees at local ids 10 and 14.

Accordingly, the actual reason the Round 4 assignment attempts returned the role-list error is: `assignee_user_id` expects the **collector-local** id, but the requests supplied backend identity ids 61 and 62. It is not evidence that the fresh DB had lost user projections. The prior report `step5-ladder-forward-runtime.md` should be read with this correction.

