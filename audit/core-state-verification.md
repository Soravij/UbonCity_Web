# Core-state verification: is the workflow head the sole source of truth?

Audit date: 2026-07-29. Source-only review on `main`; no database was opened and no production code was changed. Read first from their respective branches: `audit/collector-pipeline-audit.md` (`codex/prompt-audit-collector-pipeline`), `audit/handoff-tracks-audit.md` (`codex/prompt-audit-handoff-tracks`), and `audit/role-matrix-survey.md` (`codex/role-matrix-survey`).

## Verdict

**No.** `content_workflow_models` is the canonical persisted store for `production_state` and `publication_state`, and canonical state writes go through the repository. It is not the sole source of truth for the total workflow decision: article-process status additionally depends on field packs, assignments, submissions, deliverables, and readiness; field-pack status is stored separately and can change without a head update. `content_items.workflow_status` also remains a legacy mirror that can be written independently.

## 1. Does every item have a head?

### Creation and absence

- Normal item creation routes use `createItemWithWorkflowHead`, which first inserts `content_items` and then creates the head: `collector/db/repository.mjs:5319-5331`. Checked production callers are manual import (`collector/server/index.mjs:6867`), item creation routes (`:8625`, `:8666`, `:8694`, `:8785`, `:14033`), and collection auto-import (`:14207`).
- The two operations are not shown as one transaction in `createItemWithWorkflowHead` (`collector/db/repository.mjs:5319-5331`). Therefore, from source alone, an error after `saveItem` and before `createWorkflowHead` can leave an item without a head. The schema's one-row-per-item intent does not make that sequence atomic.
- `saveItem` itself can create a `content_items` row without creating a head (`collector/db/repository.mjs:5286-5310`). Its checked production callers in this source only update existing items (`collector/services/workflow.mjs:1779-1800,2428-2453`; `collector/server/index.mjs:6002,13711,13751`); this does not prove there are no other runtime callers outside the searched source.

### Missing-head behavior

- `ensureWorkflowModel` does **not** create or fall back. It returns an existing head, throws `content item not found` if the item is absent, and otherwise throws `workflow head missing for item`: `collector/db/repository.mjs:5923-5931`.
- `upsertWorkflowModel` also throws when the head is missing: `collector/db/repository.mjs:5948-5954`.
- A repair path exists, but is explicit rather than a read fallback: `repairWorkflowHeadFromLegacy` creates a head from `content_items.workflow_status` (`collector/db/repository.mjs:5933-5945`), and `backfillWorkflowHeads` invokes it across listed items (`:6062-6069`). No production caller of either repair function was found outside the repository export.
- Missing heads are detectable as drift (`workflow_head_missing: true`) but that diagnostic does not repair them: `collector/db/repository.mjs:6131-6148`.

Result: a missing head normally **fails** callers that require it. It is not automatically created and it does not fall back to `workflow_status`; only an explicit repair/backfill uses the legacy value.

## 2. Production/publication state writers and validation bypasses

### State writes in production source

All entries below use the canonical repository function `upsertWorkflowModel`, except creation through `createWorkflowHead` and the generic wrapper `updateItemWithWorkflowHead`; both ultimately use the same repository head write path. The actual SQL statement is private to that repository (`collector/db/repository.mjs:4689-4710`, called at `:5892-5905` and `:5999-6012`). No production-source caller was found that directly executes SQL to set `production_state` or `publication_state` outside this repository implementation.

| Writer and state(s) | File:line | Classification |
| --- | --- | --- |
| Create a head from supplied/default state | `collector/db/repository.mjs:5319-5331,5871-5920` | Canonical repository creation |
| Legacy repair/backfill seed | `collector/db/repository.mjs:5933-5945,6062-6099` | Canonical repository creation/update |
| Clean: `analyzed` | `collector/services/workflow.mjs:1802-1810` | Canonical repository |
| Agent field-pack generation: `analyzed` | `collector/services/workflow.mjs:2396-2410` | Canonical repository |
| Deterministic draft: `generated` | `collector/services/workflow.mjs:2469-2484` | Canonical repository |
| Quality pass/fail: `in_review` / `needs_revision` | `collector/services/workflow.mjs:2554-2568,2583-2597` | Canonical repository |
| Review approve/reject/request changes: `ready_for_publish/approved`, `rejected/draft`, `needs_revision/draft` | `collector/services/workflow.mjs:2635-2676` | Canonical repository |
| Reopen: `analyzed/draft` | `collector/services/workflow.mjs:2729-2742` | Canonical repository |
| Return field pack to clean: `analyzed` | `collector/db/repository.mjs:10986-11027` | Canonical repository |
| Article revision request | `collector/server/index.mjs:4429-4444,4458-4474` | Canonical repository |
| Article ready-for-sync direct field source: `ready_for_publish/approved` | `collector/server/index.mjs:4478-4510` | Canonical repository |
| Transport-map item update: `content_in_progress/draft` | `collector/server/index.mjs:8849-8870` | Canonical wrapper |
| Transport backend sync: `ready_for_publish/published` | `collector/server/index.mjs:8942-8954` | Canonical repository |
| Item edit with `workflow_action=mark_cleaned`: `analyzed` | `collector/server/index.mjs:9141-9162` | Canonical wrapper |
| Generic workflow-model endpoint: any validated enum state | `collector/server/index.mjs:9751-9805` | Canonical repository |
| Editorial assignment creation: `content_in_progress/draft` | `collector/server/index.mjs:10687-10699` | Canonical repository |
| Accepted field assignment: `content_in_progress` (from listed pre-draft states) | `collector/server/index.mjs:11316-11336` | Canonical repository |
| Successful admin-review ingest: `submitted_for_admin_review/approved` | `collector/server/index.mjs:13505-13517` | Canonical repository |
| Backend revision feedback: `needs_revision` plus `draft` or `unpublished` | `collector/server/index.mjs:14469-14487` | Canonical repository |
| Unpublish: retain production state, set `unpublished` | `collector/server/index.mjs:14540-14567` | Canonical repository |

`content_items.workflow_status` is separately mutable: `saveItem` writes the item's legacy column (`collector/db/repository.mjs:5286-5310`) and `setWorkflowStatus` runs direct SQL against that column (`:5722-5726`). The only production caller of `setWorkflowStatus` found is `reconcileLegacyWorkflowStatusMirror`, after canonical head create/update (`:5852-5868`). This is a mirror, not a `production_state`/`publication_state` writer.

Outside production paths, four smoke scripts directly `INSERT INTO content_workflow_models` to build fixtures: `collector/scripts/smoke-ai-input-cleanup-post-assignment.mjs:42-44`, `collector/scripts/smoke-field-pack-return-to-clean.mjs:51-53`, `collector/scripts/smoke-publish-sync-compensation.mjs:98-100`, and `collector/scripts/smoke-reference-cleanup.mjs:79-81`. These are direct-SQL test/script writers, not runtime workflow paths. The repository's other direct SQL updates to this table clear only pointer columns during reference cleanup (`collector/db/repository.mjs:13612-13635`); they do not write production/publication state.

### Skip flags

- The repository supports three bypass flags: assignment, production, and publication transition validation (`collector/db/repository.mjs:5968-5979`).
- `skip_production_transition_validation` and `skip_publication_transition_validation`: no production caller setting either flag was found. They remain accepted by the repository.
- `skip_assignment_transition_validation` is set in two places:
  - Assignment state updates set it only when synchronizing the assignment row's legal transition into a head whose prior mirror state cannot legally transition to that same target (`collector/db/repository.mjs:6652-6691`). The reason code distinguishes normal sync from reconcile sync (`:6685-6689`).
  - Opening a field rework round explicitly moves the mirror from `closed` to the new assignment's `assigned`, which the assignment transition table disallows; the code comments state this reason and sets the bypass (`collector/db/repository.mjs:10238-10253`).

## 3. Can assignment mirrors disagree?

Yes. `content_assignments.state` and `content_workflow_models.assignment_state` are distinct persisted values.

- Assignment creation inserts `content_assignments.state` first (`collector/db/repository.mjs:6406-6422`). Its following mirror sync **does not write the head if it already has any assignment state**; it returns `existing_assignment_state_preserved` (`:6271-6307`). Thus a newly created assignment can be `assigned` while the head preserves a different prior assignment state. The rework-round code explicitly documents the `closed`/`assigned` example (`:10238-10253`).
- Normal assignment state changes write `content_assignments.state` first, then synchronize the head when different (`collector/db/repository.mjs:6636-6694`). This wrapper is transactional (`:6632-6634`), so the normal update path does not intentionally leave only one side changed on a successful return.
- Field-pack creation and updates can change `field_packs.status` without either assignment mirror changing (`collector/db/repository.mjs:10847-10890,11054-11184`; routes `collector/server/index.mjs:12884-12911,12919-12957`).

When values differ, the code does not implement one universal reader preference:

- `buildPublishableSourceByItem` reads `content_assignments.state`, not `workflow_models.assignment_state`, for acceptance and candidate ranking (`collector/db/repository.mjs:9854-9903,9950-9979`).
- Generic head/queue/UI payloads expose `workflow_models.assignment_state`; list filtering also uses it (`collector/db/repository.mjs:6106-6125`).
- The only inspected drift helper checks `workflow_status` against the head; it does not compare either assignment mirror (`collector/db/repository.mjs:6131-6161`).
- Reconciliation occurs only as a side effect of assignment create/update and the explicit rework-round path (`collector/db/repository.mjs:6271-6307,6636-6694,10238-10253`), not as a scheduled or read-time reconciler found in the source.

## 4. Is the head sufficient for the article-process decision?

No.

`deriveArticleProcessStatus` directly reads head `production_state` and `publication_state`, and additionally reads `publishableSource.ready_for_publish_source`; its `item` parameter is not read in this function (`collector/server/index.mjs:4593-4610`). Therefore even its `ready_for_review` result is not head-only.

`buildPublishableSourceByItem` reads the following data outside the head:

- current field-pack existence (`collector/db/repository.mjs:9854,9950`);
- all item assignments and each `content_assignments.state` (`:9855,9866-9903`);
- latest assignment submission (`:9870-9879,9958`);
- assignment deliverables, including an `article_draft` deliverable and its text/source URL (`:9870-9903,9959-9961`);
- deliverable utility/governance readiness (`:9871-9872,9896-9903,9963-9964`);
- item summary as an excerpt fallback (`:9851,9943-9947`).

For the actual admin-review handoff payload, additional non-head inputs are necessary: item type/language/content and draft-or-item fallbacks (`collector/server/index.mjs:5513-5529`), selected local assets and inline-media resolution (`:5531-5550`), and translations passing a current-source fingerprint recheck (`:5552-5572`). Those data determine whether the handoff can be built; they are not fields in `content_workflow_models`.

## 5. Field-pack status versus head

`ready_for_field`, `field_in_progress`, and `field_done` are values of `field_packs.status`, not fields of the head (`collector/database/schema.sql:599`; normalization `collector/db/repository.mjs:2286-2289`). Field-pack creation/update persist this status without a head write (`collector/db/repository.mjs:10847-10890,11054-11184`; routes `collector/server/index.mjs:12884-12911,12919-12957`).

- A field assignment can be created only while the current field pack is exactly `ready_for_field` (`collector/server/index.mjs:2903-2921`).
- Handoff preview treats all three values as ready for handoff (`collector/db/repository.mjs:9639-9649,9676-9691`).
- Article-process derivation does not read field-pack status directly (`collector/server/index.mjs:4593-4610`). It can therefore report `drafting`, `ready_for_review`, or `ready_for_sync` solely from head and publishable-source facts while the current field pack is independently `ready_for_field`, `field_in_progress`, or `field_done`.

Concrete divergence is possible: update a current field pack from `ready_for_field` to `field_in_progress` through the route above; the head is unchanged. Conversely, a head may be set to `ready_for_publish/approved`, which derives `ready_for_sync`, while the current pack remains any of these three values because no reciprocal update exists in that state write path (`collector/server/index.mjs:4478-4510`).

## 6. Enum values with no dedicated writer

There is a live generic writer for every validated enum: `PUT /api/items/:id/workflow-model` normalizes both enum sets and passes its patch to `upsertWorkflowModel` (`collector/server/index.mjs:9751-9805`; enum sets `collector/db/repository.mjs:430-445`). Consequently, no enum value is a dead value in the strict sense of “cannot be written by checked production code.”

There are, however, values with **no normal dedicated named transition writer found**:

- `brief_generated`: no normal dedicated transition writer found; generic endpoint can write it. It is also a legacy-repair seed when `workflow_status` has that value (`collector/db/repository.mjs:568-580,5933-5945`). It is present in transition rules and acceptance checks (`:433,467-468`; `collector/server/index.mjs:11321`).
- `ready_for_content`: no normal dedicated named writer found; the generic endpoint expressly permits a `user` actor only this production target (`collector/server/index.mjs:9785-9792`). It too can be seeded by legacy repair (`collector/db/repository.mjs:568-580,5933-5945`).
- `completed`: no normal dedicated transition writer found; generic endpoint can write it, the transition table permits it from `ready_for_publish` or `submitted_for_admin_review`, and legacy `workflow_status=published` seeds `completed/published` during repair (`collector/db/repository.mjs:474-477,568-580,5933-5945`).
- `archived` and `deleted` publication values: no dedicated named writer found; generic endpoint can write validated publication enum values (`collector/server/index.mjs:9767-9805`; `collector/db/repository.mjs:444,480-485`).

The remaining production enum values have a dedicated writer listed in section 2. This is a source finding only; runtime database contents were not inspected.
