# Step 5 round 9: editorial to publish walk (stopped)

Date: 2026-08-03. Runtime target: `http://127.0.0.1:5070`. SQLite observations used read-only queries only. No code change, direct SQLite write, workflow-model PUT, or workaround route was used.

The walk stopped at the requested editor `submit-review` step. Approval, admin review, and publish were not attempted.

## Initial state

| Evidence | Value |
| --- | --- |
| Item 9 workflow head | `writing` / `draft` |
| `content_items.workflow_status` | `raw` |
| Editorial assignment #4 | `assigned` |

## 1. One manual state push — audit-only dead-path bypass

Request: `PATCH /api/assignments/4/state` as owner with:

```json
{
  "state": "submitted",
  "internal_note": "round9 manual push: audit-only dead-path bypass"
}
```

This is **not a business path**. It deliberately bypasses the editor initial-submit dead path established by the preceding audit.

HTTP: **200**.

Response body:

```json
{
  "ok": true,
  "assignment": {
    "id": 4,
    "content_item_id": 9,
    "assignment_kind": "editorial",
    "assignee_user_id": 10,
    "state": "submitted",
    "latest_submission_id": null,
    "internal_note": "round9 manual push: audit-only dead-path bypass",
    "updated_at": "2026-08-03 03:44:28"
  }
}
```

Read-only SQLite after request: assignment #4 = `submitted`, workflow = `writing` / `draft` / flag `none`, `content_items.workflow_status` = `raw`.

## 2. Editor submit-review — STOP

Request: `POST /api/items/9/article-process/submit-review` as editor local ID 10 with:

```json
{
  "note": "round9 editor submit after audit-only manual state push"
}
```

HTTP: **403**.

Full response body:

```json
{
  "error": "editor ต้องมี editorial assignment ที่พร้อม submit หรือ resubmit ก่อนส่งบทความเข้าตรวจ"
}
```

Read-only SQLite after failure:

| Evidence | Value |
| --- | --- |
| Assignment #4 | `submitted` |
| Assignment #4 latest submission | `NULL` |
| Submission rows for #4 | none |
| Workflow head | `writing` / `draft` / flag `none` |
| `content_items.workflow_status` | `raw` |

The first editor gate (`submitted`/`resubmitted`) was satisfied by the manual owner push, but the later selector in the handler accepts only editorial assignment states `assigned`, `in_progress`, or `revision_requested`; it finds none for #4 and rejects the editor. The expected transition to `ready_for_review` / `in_review` did not occur. Per instruction, no alternate route and no review/approve/admin-review/publish operation was attempted.
