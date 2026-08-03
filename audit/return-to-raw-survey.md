# Survey: return from Clean to Raw (read-only)

Scope: source audit on `main` plus read-only query of `collector/data/collector.db`. No application code, DB data, commit, or push was changed.

## Dev DB snapshot: item 2

Read-only query result at audit time:

| id | type | production_state | publication_state | claimed_by_user_id | current_field_pack_id |
|---:|---|---|---|---|---|
| 2 | `place` | `collected` | `draft` | `NULL` | `NULL` |

Therefore the dev DB currently says item 2 is already Raw, unclaimed, and has no current field pack. It should be included by the Raw-tab client predicate below. Being reachable at `/clean-item.html?id=2` does not itself change state; the URL can be opened directly. This conflicts with the reported runtime impression that it is in Clean and cannot return; it is not reproducible from the current DB state alone.

## 1. What Clean supplies for selection, and whether it is frozen

### Fact

The selectable table “ข้อมูลอ้างอิงที่รวบรวมมา” is loaded from `GET /api/items/:id/evidence-blocks`; the selected table “Approved Context” comes from `GET /api/items/:id/approved-context`; and the preview comes from `GET /api/items/:id/draft-input-preview` ([item-editor.js](../collector/server/public/item-editor.js#L1903-L1922)).

The backing tables and columns are:

- `evidence_blocks`: `content_item_id`, `block_type`, `source_type`, `source_record_type`, `source_record_id`, `source_url`, `source_label`, `lang`, `attribution_text`, `text_value`, `numeric_value`, `list_value_json`, `payload_json`, `status`. The insert statement is explicit in [repository.mjs](../collector/db/repository.mjs#L3053-L3066).
- `approved_context_blocks`, joined to `evidence_blocks`: `content_item_id`, `evidence_block_id`, `context_type`, `selected_text`, `selected_numeric`, `selected_list_json`, `note`, `editor_note`, `sort_order`, `confidence`, `status`, `approved_by`; the join and sort are in [repository.mjs](../collector/db/repository.mjs#L3068-L3089).
- The Clean structured preview additionally reads `content_items` fields (title/type/category/source/map/location), selected reference media, and selected local images ([clean-context.mjs](../collector/services/clean-context.mjs#L107-L207)). Its primary source is active `approved_context`; active `evidence_blocks` are supporting context ([clean-context.mjs](../collector/services/clean-context.mjs#L112-L121), [clean-context.mjs](../collector/services/clean-context.mjs#L183-L204)).

`GET /api/items/:id/evidence-blocks` invokes `seedEvidenceBlocksForItem(item)` on **every GET** and reads the table again if it added rows ([index.mjs](../collector/server/index.mjs#L12622-L12645)). It derives candidates from current `source_records` / item fallback and deduplicates against current evidence ([index.mjs](../collector/server/index.mjs#L7099-L7147)). `GET /api/items/:id/approved-context` is also a current read ([index.mjs](../collector/server/index.mjs#L12673-L12691)).

Conclusion: **the Clean selection set is not frozen on entry into Clean; it is queried live whenever the three endpoints are requested.** A distinct snapshot is created only if `GET /draft-input-preview?snapshot=1` is requested, which inserts `draft_input_snapshots` ([index.mjs](../collector/server/index.mjs#L12960-L12970)); the AI action does this immediately before running the agent ([item-editor.js](../collector/server/public/item-editor.js#L1990-L2012)).

Server or UI: neither is imposing a “freeze at Clean entry” rule. The data model is live; the browser must issue a refresh/read.

## 2. Can source data be added without returning state? (main finding)

### Fact: yes, through two supported paths

1. **Add manually on the current Clean page**: `POST /api/items/:id/evidence-blocks` creates a new active evidence row ([index.mjs](../collector/server/index.mjs#L12648-L12670)); the Clean UI sends the request for both batch and advanced forms and then calls `loadEvidenceContextAndPreview()` ([item-editor.js](../collector/server/public/item-editor.js#L5929-L5967)). It requires role `admin` or `user`, and `ensurePrepItemEditAccess`: a preparation role and a claim held by the current user ([index.mjs](../collector/server/index.mjs#L4039-L4065)). **It has no production/publication-state condition.**

2. **Add a newly collected raw source to the existing item**: first collect into `source_raw_items`, then `POST /api/source-raw-items/import` with `decision: "merge"` and `existing_item_id: 2`. The import endpoint is admin-only and validates the batch/raw item/target item, but does **not** test production or publication state ([index.mjs](../collector/server/index.mjs#L13953-L14029)). Its merge implementation attaches/updates a `source_records` row, seeds fresh evidence blocks, and does not update the workflow head ([index.mjs](../collector/server/index.mjs#L6648-L6676)). `attachCollectedSourceRecord` writes `source_records(content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)` ([index.mjs](../collector/server/index.mjs#L6605-L6645)).

The source-collection endpoint is `POST /api/collect`; it creates `source_raw_items` and, if auto-import is used, creates **new** items at `collected`/`draft` ([index.mjs](../collector/server/index.mjs#L14032-L14155)). For attaching to item 2, the explicit import-merge endpoint above is the applicable endpoint.

### Visibility / refresh

The browser initially loads evidence/context/preview together ([item-editor.js](../collector/server/public/item-editor.js#L1903-L1922)). After the manual-add buttons it automatically reloads them. For a source import performed elsewhere, Clean has no push/subscription: use its “รีเฟรชตัวอย่าง” action, which calls the same loader ([item-editor.js](../collector/server/public/item-editor.js#L5973-L5983)), or reload the page. New evidence then appears. It is not automatically selected into `approved_context`; the user must use the evidence row’s approve action (`POST /approved-context`) ([item-editor.js](../collector/server/public/item-editor.js#L1697-L1718)).

Conclusion: **no state rollback is needed to acquire more source data.** For external collected data, an admin can merge it into item 2 at any workflow state; then refresh Clean and approve the new evidence. For pasted/manual data, the already-present Clean UI handles the add + refresh directly, but requires the item to be claimed by the editor.

Server or UI: no server state blocker for import-merge; the only missing UI affordance is a “collect/merge source into this item” flow on Clean. Refresh is UI-level, not a state action.

## 3. Raw-tab filter and state required for item 2

### Fact

The dashboard fetches the unfiltered `GET /api/items` ([app.js](../collector/server/public/app.js#L10284-L10293)); server-side it reads `repo.listItems()` (excluding deleted rows through the repository statement) and applies role/claim/assignment visibility, not a Raw-state SQL filter ([index.mjs](../collector/server/index.mjs#L8180-L8218)).

The client classifies the visible rows. The Raw intake predicate is exactly:

```js
resolveQueueBucket(item) === "raw_prep" && productionState === "collected"
```

([app.js](../collector/server/public/app.js#L735-L778)). `resolveQueueBucket` excludes published/completed states, accepted assignments, publication approved/unpublished and several later production states, as well as items with a current field pack; otherwise it returns `raw_prep` ([app.js](../collector/server/public/app.js#L749-L772)). `publication_state` is part of that preceding bucket decision, but the final Raw predicate itself tests `production_state === collected`.

`claimed_by_user_id` does **not** decide Raw vs Clean. It controls visibility: owner sees all; an unclaimed item is visible to owner/admin/user as Raw pool; a claimed item is visible only to the claimant/management line ([index.mjs](../collector/server/index.mjs#L3863-L3880)). Claims also block editing unless held by the current user ([index.mjs](../collector/server/index.mjs#L4039-L4065)).

For item 2 to show as Raw to an eligible viewer it needs:

- `content_items.is_deleted = 0`;
- `content_workflow_models.production_state = 'collected'`;
- no condition requiring `publication_state='draft'` in the Raw predicate, although the normal collected state uses draft;
- no accepted assignment and no current field-pack pointer/status (otherwise bucket changes before the Raw predicate);
- visibility: unclaimed, claimed by the viewer/descendant, or owner. For raw-pool visibility specifically, `claimed_by_user_id IS NULL`.

Current item 2 meets these as read from dev DB: `collected`, `draft`, `NULL`, and no current field pack.

Server or UI: state classification is UI code after server visibility filtering. There is no server endpoint query such as `WHERE production_state='collected'` for `?tab=raw`.

## 4. Clean-page buttons/actions and return capability

`clean-item.html` contains these actions ([clean-item.html](../collector/server/public/clean-item.html#L29-L55), [clean-item.html](../collector/server/public/clean-item.html#L171-L343)):

| UI action | Actual behavior | State rollback? | Guard / hidden condition |
|---|---|---|---|
| กลับ / กลับหน้ารับข้อมูลดิบ (`btn-back`, `btn-prev-step`) | navigation only; `btn-prev-step` goes to `/?tab=raw` in Clean mode ([item-editor.js](../collector/server/public/item-editor.js#L2020-L2022), [item-editor.js](../collector/server/public/item-editor.js#L5581-L5594)) | No | None; it can navigate to Raw even when the item will not qualify there. |
| บันทึก (`btn-save`, also `btn-save-ai-context`) | `PUT /api/items/:id`; Clean save passes `workflow_action: mark_cleaned` ([item-editor.js](../collector/server/public/item-editor.js#L5641-L5697)) | No, forward/update | disabled unless role owner/admin/user and item is claimed by current user ([item-editor.js](../collector/server/public/item-editor.js#L136-L158), [item-editor.js](../collector/server/public/item-editor.js#L182-L190)). |
| ถัดไป: ส่งเข้า Agent / ประมวลผลด้วย Agent | save, validate, snapshot, `POST /api/run/ai-draft` ([item-editor.js](../collector/server/public/item-editor.js#L1990-L2017), [item-editor.js](../collector/server/public/item-editor.js#L5734-L5764)) | No, forward | same edit/claim guard; additionally Clean minimum requires title, a reference, and at least one active approved context ([clean-context.mjs](../collector/services/clean-context.mjs#L66-L104)). |
| รับงาน / ปล่อยงาน / Take over | `POST /claim`, `/release`, `/takeover` ([item-editor.js](../collector/server/public/item-editor.js#L5600-L5639)) | No | Claim unclaimed; release only self; takeover only higher-ranked admin/owner. |
| เพิ่มข้อมูลอ้างอิงเอง; เพิ่ม Raw Evidence; เพิ่ม Evidence แบบกำหนดเอง | show form; `POST /evidence-blocks`; reload evidence/context/preview ([item-editor.js](../collector/server/public/item-editor.js#L5919-L5967)) | No | add actions require same edit/claim guard. |
| approve/unapprove/deactivate/reactivate in evidence/context rows | creates or changes `approved_context` status ([item-editor.js](../collector/server/public/item-editor.js#L1697-L1738), [item-editor.js](../collector/server/public/item-editor.js#L1825-L1860)) | No | rendered/editable only with current edit permission. |
| รีเฟรชตัวอย่าง | reloads current evidence/context/preview ([item-editor.js](../collector/server/public/item-editor.js#L5973-L5983)) | No | no explicit edit guard; read access still applies. |
| dynamic backward-transition panel | rendered only when server returns `can_transition=true` and targets nonempty ([workflow-backward-transitions.js](../collector/server/public/workflow-backward-transitions.js#L20-L40)) | Can step backward, but never to `collected` | place-only, role/mutation scope, and a currently legal target ([index.mjs](../collector/server/index.mjs#L4128-L4143)). |

There is no button whose action writes `production_state='collected'`. The visible “กลับหน้ารับข้อมูลดิบ” wording is navigation, not a state transition.

Server or UI: the misleading part is UI labeling/navigation. The absence of a collected transition is server policy, not a hidden/disabled Clean button.

## 5. Is there any edge back to `collected`?

No. This was checked across all `TRANSITION_RULES` types, not just place:

- `place` has only `collected -> analyzed`; its ladder never targets `collected` ([repository.mjs](../collector/db/repository.mjs#L506-L530)).
- `event`, `other_transport`, and `public_transport_map` share the legacy graph ([repository.mjs](../collector/db/repository.mjs#L479-L504), [repository.mjs](../collector/db/repository.mjs#L569-L576)); its `collected` row only targets later states, and no row targets `collected`.
- The explicitly exposed backward metadata is place-only and its listed targets are `analyzed`, `ready_for_content`, `field_working`, `generated`, `field_review`, `writing_assigned`, `writing`, and `in_review`—not `collected` ([repository.mjs](../collector/db/repository.mjs#L534-L567)). The helper immediately returns `[]` for any non-place type ([repository.mjs](../collector/db/repository.mjs#L4759-L4776)).

The existing backward endpoint is `GET/POST /api/items/:id/workflow/backward-transitions`. POST is place-only, requires a reason, and accepts only a target returned by `listLegalBackwardProductionTransitions` ([index.mjs](../collector/server/index.mjs#L9321-L9406)). Its callers are the generic UI helper used by `collector/server/public/item-editor.js`, `app.js`, `article-workspace-page.js`, `article-submit-page.js`, and `article-workflow-core.js`; the repository-wide grep found no caller in `admin/src`, `frontend`, `backend`, `scripts`, or `ops` for a collected rollback.

The field-pack “return to Clean” endpoint also does not help: `POST /api/items/:id/field-pack/return-to-clean` archives the field pack and returns the workflow to `analyzed`, traversing legal place hops as needed ([repository.mjs](../collector/db/repository.mjs#L9852-L9945), [index.mjs](../collector/server/index.mjs#L13724-L13760)).

Conclusion: **there is no `* -> collected` edge and no endpoint/caller that can invoke one.** This is a server transition-policy limitation, not merely UI omission.

## Non-implementation options

1. Prefer the existing source-merge path: collect -> raw review -> `POST /api/source-raw-items/import` with `merge` into the existing item -> refresh Clean -> approve evidence. Pros: no workflow change, preserves audit/source provenance, already implemented. Cons: admin-only and no direct Clean UI flow; staff must know how to target the existing item.

2. Add a narrow Clean UI for “collect/merge more source data into this item,” then refresh evidence. Pros: matches the real task and requires no new state edge. Cons: needs careful duplicate/source ownership UX and role design.

3. Add an explicit server-authorized `* -> collected` rollback edge only if Raw must mean “restart intake,” with audit reason and clear policy for field packs/assignments. Pros: makes the tab semantics literal. Cons: broad lifecycle risk, can orphan later workflow artifacts, and is unnecessary for the stated need to add evidence.
