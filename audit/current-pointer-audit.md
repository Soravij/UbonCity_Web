# Current-pointer audit

Audit date: 2026-07-29. Read-only source audit of `collector/`. No database was opened; item 62 and draft 93 are treated as supplied facts, not independently queried. Line references are to `main` commit `95043945`.

## A. Pointer columns

`content_workflow_models` has four columns that identify another record:

| Column | File:line | Target | Constraint declared? |
|---|---|---|---|
| `content_item_id` | `collector/database/schema.sql:952,967` | `content_items.id` | Yes: `UNIQUE`, `NOT NULL`, FK |
| `current_draft_id` | `collector/database/schema.sql:956,972` | `content_drafts.id` | No FK; semantic pointer only |
| `current_review_report_id` | `collector/database/schema.sql:957,973` | `review_reports.id` | No FK; semantic pointer only |
| `current_field_pack_id` | `collector/database/schema.sql:958,974` | `field_packs.id` | No FK; semantic pointer only |

No other `current_*_id` columns exist in this table. `assignment_state` is a value mirror, not an ID pointer. The absence of FKs means the schema does not prevent a null, stale, or cross-item `current_*` value.

## B. Every pointer writer

The common write path is `buildWorkflowHeadPayload`, which preserves a pointer when absent from payload and converts explicit `null`/empty to null: `collector/db/repository.mjs:5812-5849`. `createWorkflowHead` and `upsertWorkflowModel` then persist all three via one UPSERT at `:5892-5905,6002-6006`.

| Pointer | Writer | File:line | Time/value |
|---|---|---|---|
| all 3 | initial head default builder | `repository.mjs:5785-5809` | head creation/repair; latest draft, latest review, current field pack, each real ID or null |
| all 3 | explicit head-pointer sync | `repository.mjs:6039-6059` | on explicit call only; latest/current IDs or null |
| all 3 | full backfill | `repository.mjs:6062-6099` | each listed item; latest/current IDs or null |
| `current_field_pack_id` | agent field-pack flow | `services/workflow.mjs:2384-2417` | writes saved pack ID; if head update throws, error is logged as `workflow.sync.skipped` and no pointer is written |
| `current_field_pack_id`, `current_draft_id` | deterministic draft flow | `services/workflow.mjs:2418-2484` | writes saved field-pack ID and latest draft ID; both null only if lookup returns no ID |
| `current_review_report_id` | quality pass | `services/workflow.mjs:2546-2568` | writes newly inserted report ID or null |
| `current_review_report_id` | quality fail | `services/workflow.mjs:2575-2597` | writes newly inserted report ID or null |
| `current_review_report_id` | review action approve/reject/request changes | `services/workflow.mjs:2635-2676` | writes selected latest report ID or null |
| `current_field_pack_id` | field-pack return to clean | `repository.mjs:11012-11025` | explicitly writes null after deleting current field pack |
| all 3 | reference cleanup | `repository.mjs:13610-13636` | explicit null before deleting selected artifact group; details in D |

The generic workflow endpoint can pass pointer fields only if its request body reaches repository payload, but its own handler builds only production/publication/assignment/note at `collector/server/index.mjs:9766-9805`; it does not expose these three pointer fields.

## C. Artifact creators: who should set but does not

### C.1 Drafts

| Artifact creation path | File:line | Updates head pointer? | What source proves |
|---|---|---|---|
| deterministic draft | `services/workflow.mjs:2455-2484` | Yes, `current_draft_id=latestDraft.id` | `saveDraft` then `latestDraftByItem`, then head UPSERT. Separate repository calls; no surrounding transaction is visible in this service path. |
| manual editor draft save | `server/index.mjs:9239-9279` | No | `repo.saveDraft` is followed by audit/response only. No head update or `syncWorkflowHeadPointers` call. |
| accepted-assignment metadata draft save/update | `repository.mjs:6609-6629` | No | calls `saveDraft`; no pointer payload in this function. |
| repository `saveDraft` itself | `repository.mjs:10545-10568` | No | persists and returns latest draft only; no head operation. |

Therefore a draft may exist while `current_draft_id` remains null whenever it is created through manual editor, accepted-assignment metadata, or any other direct `saveDraft` caller. The code does not state an intended later synchronizer for those paths.

### C.2 Field packs

| Artifact creation/update path | File:line | Updates head pointer? | What source proves |
|---|---|---|---|
| agent field pack with `agentEngine` | `services/workflow.mjs:2384-2417` | Yes on successful `upsertWorkflowModel`; otherwise no | pack save and head write are separate. Catch logs and suppresses pointer/state sync failure. |
| deterministic/no-agent field pack | `services/workflow.mjs:2418-2484` | Yes | saved pack ID is included in head update after draft save. |
| `createFieldPack` | `repository.mjs:10847-10953,11050-11052` | No | creates current pack (`is_current` can clear prior current pack) and returns it; no workflow-head write. |
| `updateFieldPack` | `repository.mjs:11054-11184` | No | can alter `is_current`, but no workflow-head write. |
| editor save with field pack | `repository.mjs:11187-11206`; route `server/index.mjs:9230-9287` | No | transaction saves item/field pack; route separately saves draft; neither shown code writes head pointer. |

The missing updates above are not transaction failures: the relevant functions contain no call to `upsertWorkflowModel` or `syncWorkflowHeadPointers`. A current field pack can consequently exist while `current_field_pack_id` remains null.

### C.3 Review reports

| Artifact creation path | File:line | Updates head pointer? | What source proves |
|---|---|---|---|
| quality pass | `services/workflow.mjs:2549-2568` | Yes | `addReviewReport`, then pointer set to returned `reportId`. Separate calls; no common transaction shown. |
| quality fail | `services/workflow.mjs:2578-2597` | Yes | same pattern. |
| repository `addReviewReport` | `repository.mjs:10586-10600` | No | inserts report and returns ID only. |

No other production `addReviewReport` caller was found outside the quality flow. If insertion succeeds but the following head write fails, source shows no local repair; the quality paths do not catch that failure.

## D. Pointer clearing

| Path | File:line | Clears | Timing | Sets back? |
|---|---|---|---|
| return field pack to clean | `repository.mjs:11006-11025` | `current_field_pack_id=null` | deletes current pack and dependencies inside one transaction, then clears head | No within this path |
| reference cleanup `drafts` | `repository.mjs:13610-13618` | `current_draft_id=null` only if it points at a draft belonging to item | immediately before selected draft group delete | No within cleanup |
| reference cleanup `review_reports` | `repository.mjs:13619-13627` | `current_review_report_id=null` if it points at that item’s report | before delete | No within cleanup |
| reference cleanup `field_packs` | `repository.mjs:13628-13636` | `current_field_pack_id=null` if it points at that item’s pack | before delete | No within cleanup |

`deleteFieldPackById` at `repository.mjs:10956-10970` deletes a pack without clearing `current_field_pack_id`. No direct delete functions for drafts/review reports were found outside reference cleanup. Purge behavior is not sure: a `content_items` delete may cascade its workflow row through schema FK `schema.sql:967`; that removes the head rather than clearing its pointers. No source path was found that clears a pointer and then resets it in the same operation.

## E. Readers and null behavior

| Reader | File:line | Null result |
|---|---|---|
| row normalization | `repository.mjs:1737-1746` | returns null |
| deletion eligibility | `repository.mjs:5484-5488` | no `current_*_exists` blocker; does not inspect latest artifact here |
| eligibility response payload | `repository.mjs:5592-5596,5658-5662` | returns null |
| head default/repair/backfill | `repository.mjs:5785-5809,6039-6059,6062-6099` | explicitly falls back to latest draft/review and current field pack, then can populate pointers |
| server list adapter | `server/index.mjs:1295-1345` | **field pack only:** ignores head pointer and finds current/latest pack; draft/review stay null from head |
| server item response adapter | `server/index.mjs:1371-1388` | **field pack only:** falls back `head pointer → current pack → latest pack`; draft/review remain null |
| article draft preview | `server/index.mjs:4617-4620` | ignores `current_draft_id`, calls `latestDraftByItem`; a draft can be returned while pointer is null |
| article-process response | `server/index.mjs:4805-4815` | returns `latest_draft`, not the current-draft pointer; publishes `publishable_source_issues` |
| publishable source | `repository.mjs:9848-10030` | ignores all three head pointers. It calls `getCurrentFieldPackByItem` at `:9854`; if no current pack is found it adds literal `Missing current field pack` at `:9950`. It selects assignment/submission deliverables separately. |

Thus the reported string does **not** prove `content_workflow_models.current_field_pack_id` itself was read. It proves `getCurrentFieldPackByItem(itemId)` returned no pack with the repository’s definition of current. The source returns `field_pack_id` from that independent lookup at `repository.mjs:9981-9987`.

## F. Fallback inventory and pointer necessity

Fallbacks exist:

| Artifact | Fallback | File:line |
|---|---|---|
| draft | latest draft | `repository.mjs:5788,6043,6069`; `server/index.mjs:4617-4620`; quality reads latest at `services/workflow.mjs:2535,2549,2578` |
| review | latest review | `repository.mjs:5789,6044,6070` |
| field pack | current pack, and server presentation fallback to latest | `repository.mjs:5790,6045,6071`; `server/index.mjs:1301-1302,1375-1385` |
| publishability | current field pack + assignment latest submission/deliverables | `repository.mjs:9854-10030` |

Consequences from source:

- The pointers are used by deletion eligibility and exposed workflow payloads, but many operational paths derive latest/current records independently.
- `current_draft_id` and `current_review_report_id` have no fallback in the normal item response adapter; they remain null there even if the artifact is returned by a separate article-process endpoint.
- `current_field_pack_id` is presentation-repaired by server adapters, while `buildPublishableSourceByItem` independently queries the current field pack.
- Therefore the pointers are not the sole artifact source; whether they are intentionally redundant is **not sure**. Their writers are incomplete, and `syncWorkflowHeadPointers` exists but no production caller was found (`repository.mjs:6039-6059,13714`).

## G. Item 62 route versus normal flow

Supplied route: `collected → content_in_progress` with reason `field_assignment_accepted_promote_article`, without normal clean/AI draft.

The matching source is `collector/server/index.mjs:11314-11336`. After a field assignment enters `accepted`, it reads the head and, from `collected|analyzed|brief_generated|ready_for_content`, writes only:

```text
production_state: "content_in_progress"
publication_state: draft or published
last_transition_note
```

It does not include `current_draft_id`, `current_field_pack_id`, or `current_review_report_id`. Because the repository preserves omitted pointer fields (`repository.mjs:5812-5838`), all three remain their old values; a newly created head with null pointers stays null. This directly explains how that transition can preserve the supplied null triple. It does not, from source alone, prove it created draft 93 or explain its exact creation route.

Differences from normal deterministic flow:

| Flow | Field-pack pointer | Draft pointer | Review pointer |
|---|---|---|---|
| field-assignment accepted promotion | no write (`server/index.mjs:11322-11335`) | no write | no write |
| deterministic AI path | writes saved pack + latest draft (`services/workflow.mjs:2455-2484`) | writes | later quality writes report (`:2549-2597`) |
| agent field-pack path | writes pack only if head sync succeeds (`services/workflow.mjs:2384-2417`) | no draft is created in that branch | later quality may write report only if it has an eligible draft |
| manual editor save | no pointer write (`server/index.mjs:9230-9287`) | no pointer write | no review creation |

If an item completes the **deterministic normal path**—field pack/draft save at `services/workflow.mjs:2418-2484`, then quality at `:2546-2597`—source shows all three pointers are set. This is not atomic across the artifact and head operations, so source does not guarantee they remain complete if an intervening write fails or a later cleanup/deletion occurs.

If “normal” instead means the `agentEngine` branch, source does **not** show a draft write or `current_draft_id` update there; it only sets the field-pack pointer and logs/suppresses a head-sync failure. Therefore a universal statement that every normal AI route sets all three would be incorrect.

No patch, remediation proposal, or task ordering is included in this audit.
