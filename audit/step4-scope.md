# Step 4 scope survey — current code

**Date:** 2026-07-30  
**Method:** static inspection of the current `main` checkout only. No database was opened or changed. File:line references below are current at the time of inspection. This is an inventory, not an implementation plan or patch.

Read first: `docs/place-workflow-policy.md` §2.1–2.3 and `docs/place-workflow-target-design.md` §2 and §5–7. The policy governs only `place`; `event` and transport must not inherit its ladder by assumption.

## A. 4a — put `contentType` in `TRANSITION_RULES`

### Current shape

`collector/db/repository.mjs:464-491` is one global object keyed only by state group:

```js
{ production: { fromState: Set<toState> },
  publication: { fromState: Set<toState> },
  assignment: { fromState: Set<toState> } }
```

The production rule set includes cross-ladder edges such as `collected -> content_in_progress`, `collected -> in_review`, `ready_for_content -> generated`, and state parking edges to `needs_revision` / `rejected` (`repository.mjs:466-477`). It has no content type key.

`canTransition(stateGroup, fromState, toState)` at `repository.mjs:5771-5779` accepts no item or type. `assertValidTransition` at `:5782-5786` simply delegates to it.

### Every current `canTransition()` caller

| Caller | File:line | Item/type available? | Where type can come from |
|---|---:|---|---|
| `assertValidTransition` | `collector/db/repository.mjs:5782-5786` | Not itself; it is the local wrapper | Its caller supplies context only indirectly today. |
| `updateAssignmentStateInternal` (assignment-state mirror reconciliation) | `collector/db/repository.mjs:6620` | Yes, indirectly | The already-loaded `existing` assignment has `content_item_id` (`:6600-6619`); `content_items.type` is retrievable from that id before validating the transition. |

The first validation in `updateAssignmentStateInternal` is `assertValidTransition("assignment", existingAssignmentState, normalizedState)` at `repository.mjs:6617`; this same function has the same `existing.content_item_id`, so it can pass type after its signature changes. The later direct `canTransition` at `:6620` has that id as well.

No other production caller of `canTransition` exists in `collector/` (the repository-local definition and the two calls above are the complete `rg` result). Therefore there is **no current caller that fundamentally cannot recover type**, and no current call that validates a transition before an item/assignment exists. Item creation routes write an initial workflow patch directly; they do not call `canTransition`.

### `ASSIGNMENT_STATES`: split by type?

Evidence supports keeping the assignment-state enum shared for now:

- There is one enum, `ASSIGNMENT_STATES`, at `repository.mjs:445`, and one rule graph at `:485-491`.
- Both `field` and `editorial` assignments are rows in the same `content_assignments` table, distinguished by `assignment_kind` (`schema.sql:994+`; the repository limits kinds at `repository.mjs:451`).
- `updateAssignmentStateInternal` applies the same validation for every kind (`repository.mjs:6596-6665`). The only kind-specific behavior after the state change is the field-`accepted` promotion in `server/index.mjs:11370-11387`; it is not a different assignment-state graph.

The target design also describes `content_assignments.state` as an activity record rather than the item position. There is no code evidence that field and editorial require different values or different *assignment* transitions. Type-specific rules are needed for the item `production_state` ladder, not demonstrated for `ASSIGNMENT_STATES`.

## B. 4b — actual ladder

### Current writers of `content_in_progress`

Direct production writers are below. The two `map...` functions are included because callers can write their returned patch.

| File:line | Current trigger / type | Policy-map disposition |
|---|---|---|
| `collector/server/index.mjs:4731` | `mapArticleProcessStatusToWorkflowPatch`; default article-process status maps to this. The helper has no item/type parameter. | For `place`, it cannot remain the generic result: `writing` is the closest map state only when the action is actual article writing; otherwise the caller needs an explicit type-aware mapping. Event/transport may retain it. |
| `collector/server/index.mjs:6811-6813` | `resolveCreateWorkflowPatch` maps a supplied legacy `workflow_status`. Type is available in request body/item creation context but not passed into this mapper. | `place`: legacy mapping must not create the retired ambiguous state; event/transport can keep it. |
| `collector/server/index.mjs:8681` | Creates an `event` item in `/api/events-manager/items`. | Keep `content_in_progress` for event. |
| `collector/server/index.mjs:8722` | Creates an `other_transport` item. | Keep for transport. |
| `collector/server/index.mjs:8855` | Creates a `public_transport_map` item. | Keep for transport. |
| `collector/server/index.mjs:8903,8922` | Updates a transport-map item and restores this state unless already there. | Keep for transport. |
| `collector/server/index.mjs:10743` | Creates an editorial assignment through article-process route, with no type branch. | `place`: `writing_assigned` (assignment created); event/transport retain current state unless their own map says otherwise. |
| `collector/server/index.mjs:11374-11385` | Field assignment becomes `accepted`; current code promotes collected/analyzed/brief_generated/ready_for_content straight to article drafting. | `place`: this is not `writing`; the policy example says accept field assignment → `writing_assigned`, but the field work itself needs its earlier `field_working` / `field_review` transitions. Event/transport behavior is not stated by policy; no safe replacement can be inferred. |
| `collector/db/repository.mjs:576` | Legacy status mapper used by workflow-head default/legacy paths. | `place`: remove/replace legacy mapping when legacy status is retired; non-place can retain. |

There are no other direct runtime object-literal writers in `collector/` outside these sites. Tests and smoke scripts contain fixtures, not application transitions.

### Existing rules versus policy §2.1

The policy ladder for `place` is:

`collected → analyzed → generated → brief_generated → ready_for_content → field_working → field_review → writing_assigned → writing → in_review → ready_for_publish → submitted_for_admin_review → completed`.

`TRANSITION_RULES.production` at `repository.mjs:466-477`:

- **Edges already aligned in direction:** `collected → analyzed`; `analyzed → brief_generated`; `brief_generated → ready_for_content`; `in_review → ready_for_publish`; `ready_for_publish → submitted_for_admin_review`; `submitted_for_admin_review → completed`.
- **Required edges absent because the states do not yet exist:** `ready_for_content → field_working`; `field_working → field_review`; `field_review → writing_assigned`; `writing_assigned → writing`; `writing → in_review`.
- **Policy ladder edge absent:** `analyzed → generated` exists, but the required adjacent edge `generated → brief_generated` does **not**; current `generated` only goes to `content_in_progress`, `in_review`, `needs_revision`, or `rejected` (`repository.mjs:471`).
- **Skip edges that policy would remove for `place`:** `collected` and `analyzed` can jump to later production states; `brief_generated` can jump to `content_in_progress`, `generated`, `in_review`, `needs_revision`, `ready_for_publish`, or `rejected`; `ready_for_content → generated/rejected`; `content_in_progress → generated/in_review/...`; `generated → content_in_progress/in_review/...`; plus direct parking edges to `needs_revision`/`rejected` from almost every state. Exact current set is `repository.mjs:466-477`.
- **Backward edges:** only a few exist now (`brief_generated → analyzed`, `rejected → analyzed|brief_generated|ready_for_content`, and state-parking reopen paths). They do not encode the policy's one-step/in-process and cross-process fallbacks.

### The four new states: identifiable trigger in current code

| New state | Trigger implied by policy | Current code support |
|---|---|---|
| `field_working` | Field assignment is accepted/worker starts field work. | **No direct trigger.** Current field acceptance at `index.mjs:11370-11385` skips to article drafting. |
| `field_review` | Field work/submission is sent for review. | **No direct item-state trigger.** Assignment has `submitted`/`resubmitted` transitions (`repository.mjs:485-491`), but no code maps them to production state. |
| `writing_assigned` | Editorial assignment is created/accepted for a place. | Existing editorial-assignment creation at `index.mjs:10690-10753` is the identifiable trigger, but it writes `content_in_progress`. |
| `writing` | Writer starts/continues article work. | **No direct production-state trigger.** Article-process `drafting` currently maps through `mapArticleProcessStatusToWorkflowPatch` (`index.mjs:4703-4733`) to `content_in_progress`; it has no item type. |

### `generated` is written in reality

`generated` is not only an enum/rule value. `runAiDraftStage` explicitly writes it at `collector/services/workflow.mjs:2484-2500`, after saving a generated draft. The route `/api/run/ai-draft` at `collector/server/index.mjs:14337-14403` invokes that service. Its candidate states currently include `analyzed`, `generated`, `needs_revision`, and `content_in_progress` (`workflow.mjs:2216-2228`). Thus the trigger is an admin/user AI-draft request that completes a candidate; the survey does not query the database and cannot corroborate the policy's reported zero historical rows.

## C. 4c — `needs_revision` and `rejected` flags

### Direct writers (current runtime)

| Value | File:line | Trigger |
|---|---:|---|
| `needs_revision` | `collector/services/workflow.mjs:2600-2613` | `runQualityStage` failed review report. |
| `needs_revision` | `collector/services/workflow.mjs:2683-2695` | `applyReviewAction(... request_changes)`. |
| `rejected` | `collector/services/workflow.mjs:2668-2681` | `applyReviewAction(... reject)`. |
| `needs_revision` | `collector/server/index.mjs:4493-4516` | `applyArticleNeedsRevisionWorkflowTransition`; callers include article-process transition handling at `:4455` and assignment-review path at `:10812`. |
| `needs_revision` | `collector/server/index.mjs:4724-4728` | Article-process `revision_requested` maps to a workflow patch. |
| both | `collector/server/index.mjs:6799-6814` | Legacy create-workflow-status mapper. |
| `needs_revision` | `collector/server/index.mjs:14506-14550` | Web-review feedback endpoint; only accepts that status and writes it. |
| both | `collector/db/repository.mjs:568-580` | Legacy workflow-status-to-model mapper used by head/default compatibility paths. |

### Readers (current runtime)

These are semantic readers of the workflow meanings, excluding unrelated words such as rejected deliverables or rejected pipeline rows.

| File:line | How it reads them |
|---|---|
| `repository.mjs:432-443, 464-477` | Enum membership and transition rules. |
| `repository.mjs:568-600` | Legacy model/status mapper in both directions. |
| `services/workflow.mjs:2216-2228` | AI-draft candidate selection includes `needs_revision`. |
| `services/workflow.mjs:2543-2547` | Quality queue includes `needs_revision`. |
| `services/workflow.mjs:2640-2644` | Governance conflict checks treat either as an occupied position. |
| `services/workflow.mjs:2738-2760` | `reopenRejected` allows reopening only from `rejected`, then writes `analyzed`. |
| `server/index.mjs:4584-4586` | Article ready-for-sync gate blocks when latest review report has `needs_revision`. |
| `server/index.mjs:4635-4652` | Article-process derivation maps production `needs_revision` to `revision_requested`. `rejected` falls through to `drafting`. |
| `server/index.mjs:4703-4733` | Article-process mapper maps `revision_requested` back to `needs_revision`. |
| `server/index.mjs:14506-14550` | Web-review endpoint contract requires `needs_revision`. |
| `server/public/app.js:703-754, 2924-2934, 4882-4907, 5013-5046` | Dashboard compatibility status, queue bucketing, labels and badge/stage grouping. |
| `server/public/item-editor.js:35-67` | Editor compatibility status and step-4 eligibility. |
| `server/public/article-intake.js:7-9, 188-207, 374-471` | Article queue candidate/label/group mapping. |
| `server/public/events-manager-page.js:107-125` and `other-transport-page.js:117-135` | Event/transport article-process views read `needs_revision`; `rejected` is not separately rendered there. |

### Storage and flag names

`content_workflow_models` has no spare flag column: it currently ends its workflow fields at `updated_by` (`collector/database/schema.sql:950-969`). SQLite therefore needs a schema migration that adds columns; no existing nullable column represents revision/rejection state.

Names that avoid collision with `content_assignments.state = 'revision_requested'` are:

- `has_revision_request` — boolean on `content_workflow_models`; describes a property of the item, not an assignment event/state.
- `is_rejected_for_review` — boolean on `content_workflow_models`; avoids the bare `rejected`, which already means a production state, review-report status, and deliverable status.

These names are proposed only as names. The target design calls them flags; it does not select storage names.

### Current exits and information that would be lost

- `needs_revision` exits to `content_in_progress`, `generated`, `in_review`, or `rejected` in `TRANSITION_RULES` (`repository.mjs:473`); its real callers also feed AI draft and quality queues (`workflow.mjs:2216,2546`) and article-process revision handling (`index.mjs:4642,4724-4728`).
- `rejected` exits only to `analyzed`, `brief_generated`, or `ready_for_content` (`repository.mjs:476`), and `reopenRejected` specifically requires it then returns to `analyzed` (`workflow.mjs:2738-2760`).

Both are currently used as **positions**, not merely display labels: rule-graph nodes, queue filters, governance conflicts, and the rejected-only reopen guard all rely on the value. Replacing them with flags without first preserving an actual ladder position would lose the answer to “where does the item resume?” This is the exact information the policy says must remain.

## D. Technically forced dependencies

This is dependency only, not an implementation ordering recommendation.

1. **4a must provide type-aware rule/validation inputs before 4b can enforce the new place-only production states.** `canTransition` and `assertValidTransition` currently cannot distinguish place from event/transport (`repository.mjs:5771-5786`); adding `field_working` et al. to a global graph would make them valid for all types or would reject non-place paths indiscriminately.
2. **4b must establish a retained ladder position before 4c removes `needs_revision`/`rejected` as production positions.** Current readers use those values as the only resume location (`repository.mjs:473,476`; `workflow.mjs:2738-2760`). A flag alone cannot reconstruct that position.
3. **Schema work for the 4c flags must exist before any writer is converted to flags.** There is no target column (`schema.sql:950-969`). This is a data-shape dependency, independent of UI work.

## E. Size and affected tests

| Slice | Current production files / primary change points | Tests visibly coupled today | Hard-to-reverse part |
|---|---|---|---|
| 4a | 2 core files: `repository.mjs` rules/validation/caller (`:464-491`, `:5771-5786`, `:6596-6665`) and `schema.sql` only if flags are included later. Call sites that write production state in `index.mjs` need type supplied where they rely on validation. | Repository transition tests, assignment transition/sync tests, plus UI queue tests that encode current global state assumptions. | Rule-table shape/signature change is source-compatible only after every caller passes type; adding type to global rules without preserving non-place rules would be difficult to unwind safely. |
| 4b | At least 5 runtime files: `repository.mjs`, `services/workflow.mjs`, `server/index.mjs`, `server/public/app.js`, `server/public/article-intake.js`; event and other-transport pages also derive shared status (`events-manager-page.js`, `other-transport-page.js`). The direct writer inventory above has 9 runtime sites plus legacy mappers. | At least 5 test files mention `content_in_progress`, and 10 mention `generated` (current `collector/tests` scan). Smoke fixtures also encode the old states. | Changing a persisted production value changes existing queue eligibility, article-process derivation, and transition history. Existing rows need a deliberate compatibility/migration rule; this survey did not choose one. |
| 4c | At least 7 runtime files: `schema.sql`, `repository.mjs`, `services/workflow.mjs`, `server/index.mjs`, and the three main UI readers; event/transport readers are additional if their existing `needs_revision` behavior is retained. Direct writers: 8 mapping/write sites listed above. | 4 test files mention `needs_revision`; 10 mention `rejected` (current `collector/tests` scan), in addition to workflow/quality and browser-smoke coverage. | It is the least reversible slice: collapsing a state into two booleans can destroy the stored position unless position is retained first; SQLite schema migration also persists beyond code rollback unless a reverse migration is supplied. |

## Uncertainties deliberately not inferred

- The policy deliberately gives no replacement ladder for `event`, `other_transport`, or `public_transport_map`; this survey does not assign one.
- Static inspection confirms `runAiDraftStage` writes `generated`; it does not verify why the runtime snapshot reported zero historical `generated` items.
- The policy says field acceptance example should lead to `writing_assigned`, but the full intended trigger boundary between field acceptance, field review, and editorial assignment is not implemented today. The report marks missing triggers rather than inventing them.
