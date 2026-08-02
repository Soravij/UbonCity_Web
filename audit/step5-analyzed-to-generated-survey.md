# Step 5 — analyzed-to-generated path survey

Date: 2026-08-02  
Scope: source and SQLite read-only inspection only. No endpoint was called, and no code, schema, or database data was changed.

## Conclusion

`analyzed → ai-draft → generated` is **incorrect for the Runtime route currently in use**. `POST /api/run/ai-draft` hard-codes `mode = "ai"` and no fallback (`collector/server/index.mjs:14157-14159`). In AI mode, the implementation generates and saves a **field pack**, then deliberately keeps the item at `analyzed` (`collector/services/workflow.mjs:2400-2433`).

`generated` is written by the separate deterministic branch (`workflow.mjs:2434-2507`), which is selected only when `runAiDraftStage` is invoked with a mode other than `ai`; the Runtime HTTP route does not offer that selection. Thus the observed result for items 8 and 9 — valid field pack, no draft, canonical state `analyzed / draft / analyzed` — matches source.

The intended place ladder from `analyzed` to `in_review` has **eight positional states**:

`analyzed → generated → ready_for_content → field_working → field_review → writing_assigned → writing → in_review`

It requires a distinct way to create a content draft/enter `generated` before the field-assignment layer can begin. The current owner AI-draft request is not that way.

## 1. Writers of the requested production states

The canonical enum and place-specific allowed edges are in `collector/db/repository.mjs:436-452` and `:505-535`. The generic state endpoint can also write any validated state; it is not a normal ladder actor and is listed separately below.

| State | Normal runtime writer(s) | File:line and result | Does a normal writer exist? |
| --- | --- | --- | --- |
| `brief_generated` | None found in normal pipeline, assignment, review, or article-process paths | Legacy status mapping recognizes it at `repository.mjs:664-674`; compatibility/repair callers can therefore materialize it from an existing legacy `workflow_status`. | **No normal forward writer found.** It is a legacy-compatible enum value, not a state produced by the current normal place ladder. |
| `ready_for_content` | P1 approval before field handoff | `POST /api/items/:id/place-ready-for-content` at `collector/server/index.mjs:8988-9034`; requires a place already at `generated`, a current valid field pack, and writes `ready_for_content` at `:9017-9021`. | Yes, but it is unreachable from Runtime AI-draft unless some other path first writes `generated`. |
| `content_in_progress` | Legacy/non-place assignment and create paths | Manual item creation at `server/index.mjs:8447-8456,8487-8496`; transport creation/update at `:8618-8626,8669-8695`; non-place field-assignment acceptance at `:11235-11253`; non-place editorial assignment at `:10581-10589`; article-process fallback for non-place at `:4528-4534`. | Yes for legacy/non-place. **No normal place-ladder writer**: place transition rules isolate this legacy state (`repository.mjs:505-535`). |
| `generated` | Deterministic AI-draft branch | `collector/services/workflow.mjs:2434-2507`: save item/draft at `:2445-2483`, then writes `production_state: "generated"` at `:2485-2507`. | Yes in source, but no public Runtime route selects that branch. |

Additional bypass/compatibility writers:

- `PUT /api/items/:id/workflow` accepts a validated `production_state` patch; the user-role restriction permits only `ready_for_content`, while owner/admin are not restricted by that clause (`collector/server/index.mjs:9690-9742`). This is a generic workflow endpoint, not evidence of a normal business-path actor.
- Repository legacy mapping maps stored legacy status `generated`, `content_in_progress`, `ready_for_content`, and `brief_generated` to their corresponding canonical head values (`collector/db/repository.mjs:664-674`).

## 2. Assignment-layer path

### What `field_pack_assignments` is — and is not

`field_pack_assignments` is a child table of a field pack with at most one metadata row per `assignment_scope` (`field` or `writer`). Its fields include optional `linked_assignment_id`, assignee identity/role, timestamps, and a note (`collector/database/schema.sql:709-727`; input normalization at `collector/db/repository.mjs:2669-2689`). It is populated only when a field-pack create/update payload explicitly supplies `field_pack_assignments` (`repository.mjs:9949-9964,10178-10194`), and linked assignment IDs are only checked to belong to the same item (`:9637-9653`).

It is **not** the operational assignment relationship and it is not automatically updated when an assignment is created. The operational records are `content_assignments`, their submissions, and `content_assignment_handoff_snapshots`; field assignment creation calls `repo.createAssignmentFromReadiness` and uses the current field pack as the handoff source (`collector/server/index.mjs:10789-10811`). Read-only Runtime DB evidence: `field_pack_assignments` has 0 rows, while `content_assignments` has one separate editorial assignment.

### Field work

| Actor/action | Endpoint or writer | Canonical state effect for a **place** |
| --- | --- | --- |
| Manager assigns field work | `POST /api/items/:id/assignments`, roles admin/user, field branch at `collector/server/index.mjs:10724-10811` | Creates assignment/handoff from field pack; it does not itself set the field-work state. The valid prior state is `ready_for_content`. |
| Assignee starts work | `PATCH /api/assignments/:id/state` at `server/index.mjs:11152-11257` → `repo.updateAssignmentState` | For a place field assignment, `in_progress` requests `field_working`; if it is a permitted place edge, repository writes it at `repository.mjs:5703-5747`. |
| Freelance submits/resubmits | `POST /api/assignments/:id/submissions` at `server/index.mjs:11397-11542`; it calls `repo.updateAssignmentState(... submitted/resubmitted ...)` at `:11463-11513` | Repository maps `submitted`/`resubmitted` to `field_review` for a place field assignment (`repository.mjs:5703-5747`). It does **not** create a `content_draft` and does not reach `generated`. |
| Manager accepts the field submission | `PATCH /api/assignments/:id/state` with `accepted` | For a place, route intentionally makes no extra head-state write: comment at `server/index.mjs:11229-11235` says it remains `field_review`. The underlying repository mapping also has no `accepted → production_state` mapping. |

Therefore a freelance submission moves a **place** only from `field_working` to `field_review`; it cannot be the missing `analyzed → generated` bridge.

### Editorial work and review

After field review, a manager creates the editorial assignment through the article process (`POST /api/items/:id/article-editorial-assignments`, implementation at `collector/server/index.mjs:10520-10649`). For a place it writes `writing_assigned` (`:10581-10589`). The article-process route maps drafting to `writing` for a place, and `ready_for_review` to `in_review` (`server/index.mjs:4516-4534`), using the transition code at `:4190-4257` and public routes at `:9425-9477` / `:9479-9640`.

The editorial route must have a usable article draft before its submit-review branch can proceed; it explicitly rejects a missing draft body (`server/index.mjs:9511-9535`). That is another confirmation that assignment submission does not synthesize a draft for the missing `generated` step.

## 3. Deterministic versus AI branch

`runAiDraftStage` sets `agentEngine = mode === "ai" ? createAgentGenerationEngine(aiConfig) : null` (`collector/services/workflow.mjs:2210-2214,2302-2306`).

| Invocation mode | Branch | Output/state |
| --- | --- | --- |
| `ai` | `agentEngine` exists; call provider `generateFieldPack`, save field pack, preserve `analyzed` | `workflow.mjs:2362-2433` |
| Any mode other than `ai` (for example the function default `deterministic`) | `agentEngine` is null; `generateContentDrafts` is used, then item/draft are saved and state is set to `generated` | `workflow.mjs:2211,2302-2306,2434-2507` |

Runtime configuration supports AI mode: with no DB policy overrides (`ai_feature_policies` has 0 rows), `collector/config/ai.mjs:1-32,164-215` defaults field packs to provider `google`, model `gemini-2.5-flash-lite`; `COLLECTOR_AGENT_ENGINE` defaults to `internal` at `:181`. The item-8/9 audit runtime snapshots record the same Google/model policy and a ready backend proxy. More importantly than configuration, the public route itself hard-codes `mode = "ai"` and `allowFallback = false` (`server/index.mjs:14157-14159`), so it necessarily selects the field-pack-only branch.

## Final answer: real ladder and ownership

| Position | Required action / owner | State transition |
| --- | --- | --- |
| 1 | A draft-producing deterministic path (current implementation-only branch) | `analyzed → generated` |
| 2 | Owner/admin/user P1 approval endpoint after checking the field pack | `generated → ready_for_content` |
| 3 | Field assignee starts the field assignment | `ready_for_content → field_working` |
| 4 | Freelance/assignee submits deliverables; reviewer accepts without further head move | `field_working → field_review` |
| 5 | Owner/admin/user creates editorial assignment | `field_review → writing_assigned` |
| 6 | Assigned editor/article process begins drafting | `writing_assigned → writing` |
| 7 | Editor submits a real article draft to review | `writing → in_review` |

The Runtime run stopped before position 1 because the only exercised public AI route is field-pack generation, not draft generation. No direct-state endpoint or database edit was used to bypass that missing bridge.
