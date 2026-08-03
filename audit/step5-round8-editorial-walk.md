# Step 5 round 8: editorial walk for item 9

Date: 2026-08-03.  Runtime target: `http://127.0.0.1:5070`; SQLite was queried read-only only (`collector/data/collector.db`).  No direct SQLite mutation, workflow-model PUT, or alternate route was used.

The walk stopped at step 4 after the required editor submission returned HTTP 403.  No further route was attempted.

## Starting evidence

| Field | Value |
| --- | --- |
| Item | `9` (place) |
| Assignment 3 | editorial, editor local ID `10`, `assigned` |
| Workflow head | `field_review` / `draft` |
| `content_items.workflow_status` | `raw` |
| Latest `content_drafts` body length | `135` (non-empty) |

## 1. Close editorial assignment 3 as owner

Request: `PATCH /api/assignments/3/state` with `{"action":"close_assignment"}` using owner local ID 2.

HTTP: **200**.

Response body (material fields):

```json
{
  "ok": true,
  "assignment": {
    "id": 3,
    "content_item_id": 9,
    "assignment_kind": "editorial",
    "assignee_user_id": 10,
    "assigned_by_user_id": 2,
    "state": "closed",
    "updated_at": "2026-08-03 03:09:58"
  }
}
```

Read-only SQLite after the request: assignment #3 = `closed`; workflow = `field_review` / `draft`; `content_items.workflow_status` = `raw`.

## 2. Create a fresh editorial assignment for editor local ID 10

Request: `POST /api/items/9/article-editorial-assignments` with `{"assignee_user_id":10,"internal_note":"step5 round8 editorial assignment after field acceptance"}` using owner local ID 2.

HTTP: **201**.  This was not the duplicate-recipient early return: the response created assignment **#4**, whereas the closed prior record is #3.

Response body (material fields):

```json
{
  "ok": true,
  "assignment": {
    "id": 4,
    "content_item_id": 9,
    "assignment_kind": "editorial",
    "assignee_user_id": 10,
    "state": "assigned"
  },
  "article_process": {
    "status": "drafting",
    "workflow_model": {
      "production_state": "writing_assigned",
      "publication_state": "draft"
    }
  }
}
```

Read-only SQLite after the request: #3 = `closed`; #4 = editorial / editor `10` / `assigned`; workflow = `writing_assigned` / `draft`; `content_items.workflow_status` = `raw`.  This confirms the required `field_review -> writing_assigned` head movement; no silent no-op occurred.

## 3. Advance article process to drafting as owner

Request: `POST /api/items/9/article-process/transition` with `{"status":"drafting"}` using owner local ID 2.

HTTP: **200**.

Response body (material fields):

```json
{
  "ok": true,
  "item_id": 9,
  "status": "drafting",
  "workflow_model": {
    "content_item_id": 9,
    "production_state": "writing",
    "publication_state": "draft",
    "place_review_flag": "none"
  },
  "latest_draft": {
    "id": 1,
    "content_item_id": 9,
    "body": "<p>This is a synthetic editorial draft for item 9.</p><p>It exists only to test the workflow and makes no claim about a real place.</p>"
  }
}
```

Read-only SQLite after the request: #4 = `assigned`; workflow = `writing` / `draft` / review flag `none`; `content_items.workflow_status` = `raw`; latest draft body length = `135`.  This confirms the legal `writing_assigned -> writing` edge.

## 4. Submit review as editor local ID 10 — STOP

Pre-request SQLite check: latest `content_drafts` record #1 for item 9 has a non-empty body (length `135`).

Request: `POST /api/items/9/article-process/submit-review` with `{"note":"step5 round8 editor submit"}` using editor local ID 10.

HTTP: **403**.

Full response body:

```json
{
  "error": "editor ต้อง submit หรือ resubmit assignment ของตัวเองก่อนส่งบทความเข้าตรวจ"
}
```

Read-only SQLite after the failure:

| Evidence | Value |
| --- | --- |
| Assignment #4 state | `assigned` |
| Assignment #4 latest submission | `NULL` |
| Submission rows for #4 | none |
| Workflow production/publication | `writing` / `draft` |
| `content_items.workflow_status` | `raw` |
| Latest draft body length | `135` |

Expected end state (`#4 submitted`, article-process `ready_for_review`, production `in_review`) was **not** reached.  Per instruction, the audit stopped here and did not attempt a generic assignment submission or any workaround.
