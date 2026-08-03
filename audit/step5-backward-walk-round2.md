# Step 5 backward walk round 2 — C: return field pack to Clean

Audit date: 2026-08-03 (Asia/Bangkok).  Scope is exactly one live request:
`POST /api/items/9/field-pack/return-to-clean`.  The Collector health endpoint identified
the live database as `D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db`.

No smoke script, direct SQLite write, source/schema change, pull, branch change, merge, push,
retry, or `PUT /api/items/:id/workflow-model` was used.  SQLite snapshots below were opened
read-only.  The request used the owner token for the owner who holds item 9's claim.

## Result: PASS

The route was called once with:

```http
POST /api/items/9/field-pack/return-to-clean
Content-Type: application/json

{"comment":"Runtime backward-walk round 2: return the current field pack to Clean."}
```

HTTP status: **200**

Full body:

```json
{
  "ok": true,
  "content_item_id": 9,
  "deleted_field_pack_id": 1,
  "action": "return_to_clean",
  "redirect_url": "/clean-item.html?id=9",
  "previous_state": "writing",
  "next_state": "analyzed"
}
```

This is a **PASS**, not a silent no-op: SQLite independently confirms the head reached
`analyzed`, the workflow pointer was cleared, and the field pack was archived.  The legacy
`workflow_status` also changed to `analyzed`.

## SQLite evidence

Read-only queries:

```sql
SELECT id, workflow_status FROM content_items WHERE id=9;
SELECT content_item_id, production_state, publication_state,
       current_field_pack_id, place_review_flag
FROM content_workflow_models WHERE content_item_id=9;
SELECT id, status, is_current, archived_at
FROM field_packs WHERE content_item_id=9 ORDER BY id;
SELECT id, assignment_kind, state, revision_round, latest_submission_id,
       accepted_submission_id, assignee_user_id, assigned_by_user_id,
       created_at, updated_at
FROM content_assignments WHERE content_item_id=9 ORDER BY id;
```

| Store / record | Before | After |
| --- | --- | --- |
| `content_items` item 9 | `workflow_status=raw` | `workflow_status=analyzed` |
| workflow head | `production_state=writing`, `publication_state=draft`, `current_field_pack_id=1`, `place_review_flag=none` | `production_state=analyzed`, `publication_state=draft`, `current_field_pack_id=NULL`, `place_review_flag=none` |
| field pack 1 | `status=ready_for_field`, `is_current=1`, `archived_at=NULL` | `status=ready_for_field`, `is_current=0`, `archived_at=2026-08-03 05:05:35` |
| assignment 2 | `field`, `accepted`, round 0, `latest_submission_id=1`, `accepted_submission_id=1`, assignee 14, assigner 2 | unchanged |
| assignment 3 | `editorial`, `closed`, round 0, no submission IDs, assignee 10, assigner 2 | unchanged |
| assignment 4 | `editorial`, `submitted`, round 0, no submission IDs, assignee 10, assigner 2 | unchanged |

The persisted transition evidence shows the exact legal path, all under
`reason_code=field_pack_return_to_clean` and the request comment:

| Transition id | From | To |
| --- | --- | --- |
| 43 | writing | writing_assigned |
| 44 | writing_assigned | field_review |
| 45 | field_review | generated |
| 46 | generated | analyzed |

## Source correlation

The production route is `collector/server/index.mjs:13725-13759`; it applies mutation and
prep-edit access checks, then invokes `returnFieldPackToClean`.  The real UI caller is
`collector/server/public/item-editor.js:4369-4372`; no smoke script was used.

`returnFieldPackToCleanAtomic` in `collector/db/repository.mjs:9970-10064` first resolves
the legal place-only `return_to_clean` path, archives the current pack, then calls
`upsertWorkflowModel` for each hop.  That implementation explains both the four persisted
transition rows and the final `analyzed/draft` head with `current_field_pack_id=NULL`.

## Assignment consequence

The route does not update `content_assignments`; none of assignments 2, 3, or 4 changed.
Item 9 is therefore now **`analyzed / draft / analyzed` with no current field pack, while it
still retains a field assignment accepted with submission 1, one closed editorial assignment,
and one submitted editorial assignment.**  This is a retained, out-of-stage assignment set:
the workflow head has returned to Clean but historical/active assignment rows remain associated
with the item.  It is an observed state divergence, not a silent no-op of C—the requested
field-pack/head rollback itself completed fully.
