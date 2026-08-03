# Step 5 backward ladder walk — UbonCity_Web Collector

Audit date: 2026-08-03 (Asia/Bangkok).  Runtime Collector was reachable at
`127.0.0.1:5070` and reported its SQLite path as
`D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db`.

Scope: source inspection first, then the requested backward walk against item 9.
No source/schema/DB direct write, no `PUT /api/items/:id/workflow-model`, retry, pull,
branch change, merge, or push was used.  SQLite was opened read-only for every snapshot.
The only mutating HTTP attempt was the one B request recorded below.  The audit stopped at
that failure, so C was not called.

## Step 0 — backward transition map and real callers

`PLACE_BACKWARD_PRODUCTION_TRANSITIONS` declares 11 edges at
`collector/db/repository.mjs:537-567`.  Every declared edge has one writer:
`POST /api/items/:id/workflow/backward-transitions`
(`collector/server/index.mjs:9345-9404`), which validates the current legal target and
calls `repo.upsertWorkflowModel` (`:9360-9383`).  The endpoint requires a non-empty
`reason`; it is not the prohibited workflow-model PUT.

| From | To | surface in table | endpoint that writes | real checked-in caller? | caller evidence |
| --- | --- | --- | --- | --- | --- |
| generated | analyzed | item_editor | `POST /api/items/:id/workflow/backward-transitions` | Yes | `collector/server/public/item-editor.js:5275-5278` |
| field_working | ready_for_content | handoff | same | Yes | `collector/server/public/app.js:3636-3642` |
| field_review | field_working | assignment_work | same | Yes | `collector/server/public/app.js:3636-3642` |
| field_review | generated | item_editor | same | Yes | `collector/server/public/item-editor.js:5275-5278` |
| ready_for_content | generated | item_editor | same | Yes | `collector/server/public/item-editor.js:5275-5278` |
| writing_assigned | field_review | assignment_review | same | Yes | `collector/server/public/app.js:3636-3642` |
| writing | writing_assigned | article_intake | same | **No** | no backward-control markup or POST in `collector/server/public/article-intake.js`/HTML |
| in_review | writing | article_workspace | same | Yes | `collector/server/public/article-workspace-page.js:1890-1893` |
| in_review | field_review | assignment_review | same | Yes | `collector/server/public/app.js:3636-3642` |
| ready_for_publish | in_review | article_submit | same | Yes | `collector/server/public/article-submit-page.js:987-990` |
| submitted_for_admin_review | in_review | article_submit | same | Yes | `collector/server/public/article-submit-page.js:987-990` |

Repo-wide grep covered `collector/server/public`, `admin/src`, `frontend`, `backend`,
root `scripts`, and `ops`.  No additional caller was found outside Collector.  The
field-pack smoke script is test-only and was not treated as a real caller.

## Runtime snapshots and walk

Snapshot query (before and after every attempted step):

```sql
SELECT ci.id, ci.type, ci.workflow_status, ci.claimed_by_user_id,
       wm.production_state, wm.publication_state, wm.place_review_flag,
       wm.current_field_pack_id
FROM content_items ci
LEFT JOIN content_workflow_models wm ON wm.content_item_id = ci.id
WHERE ci.id = 9;

SELECT id, assignment_kind, state, revision_round, accepted_at,
       assignee_user_id, assigned_by_user_id, latest_submission_id,
       accepted_submission_id, created_at, updated_at
FROM content_assignments WHERE content_item_id = 9 ORDER BY id;
```

The field-pack confirmation query was also run:

```sql
SELECT id, status, is_current, archived_at, content_item_id, updated_at
FROM field_packs WHERE content_item_id = 9 ORDER BY id;
```

| Step | Result | one HTTP call / evidence | state before → after |
| --- | --- | --- | --- |
| A. Back from writing | **FAIL** | Item 9 was `writing / draft / raw`.  Its only declared backward edge is `writing → writing_assigned`, but Step 0 found no real caller for its `article_intake` surface.  Per instruction to try only a route with a real caller, no API request exists to make here. | `writing / draft / raw` → `writing / draft / raw` (read-only confirmation) |
| B. Field-assignment rework (#2) | **FAIL** | Owner-token request, once only: `POST /api/assignments/2/return-to-field` with non-empty `note` and the available owner re-authentication password. HTTP **401** body: `{"error":"รหัสผ่านไม่ถูกต้อง"}`. No retry. | `writing / draft / raw`; #2 `accepted`, submission #1 → exactly unchanged; no replacement assignment was created. |
| C. Return field pack to clean | **Not run** | Stopped after B failed, as required. The real route was identified but never invoked: `POST /api/items/9/field-pack/return-to-clean`, payload `{comment}`. | Before stop: pack #1 `ready_for_field`, `is_current=1`, `archived_at=NULL`; unchanged because C was not called. |

Detailed SQLite evidence for B before and after was identical:

| Record | Before | After |
| --- | --- | --- |
| Item 9 head / legacy | `production_state=writing`, `publication_state=draft`, `workflow_status=raw`, `current_field_pack_id=1` | identical |
| Assignment 2 | `field`, `accepted`, `latest_submission_id=1`, `accepted_submission_id=1`, assignee 14, assigner 2 | identical |
| Editorial 3 | `closed`, no submission | identical |
| Editorial 4 | `submitted`, no submission row | identical |
| Field pack 1 | `ready_for_field`, current, unarchived | identical |

### Source check for B and C (not executed after B failure)

B has a real UI/API path: `POST /api/assignments/:id/return-to-field`
(`collector/server/index.mjs:11309-11383`), called by
`collector/server/public/app.js:9406-9409`.  It requires owner/admin/user, a non-empty
note, and successful backend-password re-authentication.  If it passes, repository code
requires field + `accepted`, closes the original assignment, then creates a new `field`
assignment in `assigned` (`collector/db/repository.mjs:9225-9271`); the regression test
asserts this contract at `collector/tests/assignment-accept-confirmed-metadata.repository.test.mjs:518-553`.
It does **not** write the production head, so even a 200 would be a silent no-op for the
specific expected `field_review → field_working` head movement.

C also has a real UI/API path: `collector/server/public/item-editor.js:4369-4372` calls
the route at `collector/server/index.mjs:13725-13759`.  On success its repository helper
archives the current pack, clears `current_field_pack_id`, and follows the legal
`return_to_clean` backward hops to `analyzed` (`collector/db/repository.mjs:9970-10064`).
It was deliberately not substituted with the smoke script.

## New dead paths

1. **`writing → writing_assigned` is capability-only.**  The table advertises its
   `article_intake` surface, but the checked-in article-intake page/script has neither a
   backward control nor the backward-transition POST.  This is a new dead path under the
   requested “capability but no caller” criterion.

2. **B's expected head rollback is capability-only at repository level.**  The real rework
   route can close an accepted field assignment and issue a new assigned round, but its
   close/create operations do not call a workflow-head writer.  Consequently it cannot
   implement the stated `field_review → field_working` head rollback without some separate
   action.  This was not reached live because re-authentication failed.
