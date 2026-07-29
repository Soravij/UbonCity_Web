# Workflow gap to map — place

Audit date: 2026-07-29. Scope is `collector/`, with the required target type `place`. This is a source audit only: no database was opened and no production code was changed. It was compared against `docs/place-workflow-policy.md` at `main` commit `95043945`, after reading the four earlier audits named in policy §11. A line reference is to the checked-out `main` source.

`content_type` qualification below means the source itself checks or constructs that type. “Not sure” means it does not prove the type from the referenced source.

## A. Enum definitions

### A.1 Defined production/publication lists

There are exactly **two executable full enum definitions** in `collector/`:

| Definition | File:line | production difference | publication difference |
|---|---|---|---|
| HTTP input validator | `collector/server/index.mjs:2805-2818` | omits `generated` | none |
| Repository normalizer/validator | `collector/db/repository.mjs:430-445` | includes `generated` | none |

Search covered `collector/` including `server/public/`, `tests/`, `scripts/`, and `docs/` for `PRODUCTION_STATES`, `PUBLICATION_STATES`, and the two state-field names. No third full executable enum list was found. UI label maps and conditional lists are readers, not validators; scripts/tests contain fixtures and assertions, not a third complete enum definition. `docs/place-workflow-policy.md:31-48` is the target map and therefore enumerates place states, but is not a current runtime enum definition.

`generated` is the documented mismatch: it is accepted by repository validation at `repository.mjs:436`, but rejected by the server API validator because absent at `index.mjs:2805-2817`.

The database is **not MySQL** in this checkout: `collector/database/schema.sql` uses SQLite syntax such as `INTEGER PRIMARY KEY AUTOINCREMENT` at `:951`. `content_workflow_models.production_state` and `.publication_state` are SQLite `TEXT NOT NULL` columns at `:953-954`, with default values; neither is an ENUM. Therefore adding a value does **not** require a schema enum alteration under this schema. It does require code validators/readers to recognize it. No `revision_requested` or workflow-level `rejected` flag column exists in that table (`:950-967`).

### A.2 Required new values and what each replaces

| New policy value | Replaces | Evidence of current substitute |
|---|---|---|
| `field_working` | place use of ambiguous `content_in_progress` for 2.2 | field acceptance writes `content_in_progress` at `collector/server/index.mjs:11322-11328` |
| `field_review` | **new pure state**; current 2.3 is only assignment `submitted/resubmitted` plus assignment UI | assignment state machine `repository.mjs:487-495`; review UI `server/public/index.html:649-703` |
| `writing_assigned` | **new pure state**; current assignment creation writes `content_in_progress` | `server/index.mjs:10687-10694` |
| `writing` | place use of ambiguous `content_in_progress` for 3.2 | article-process fallback map `server/index.mjs:4687-4690` |

The policy’s two flags are also additions: `revision_requested` replaces `production_state=needs_revision`; a workflow-level `rejected` flag replaces `production_state=rejected` (`docs/place-workflow-policy.md:53-69`). Neither has an existing workflow-head column. This is a **new addition** at workflow-head level; assignment-level `revision_requested` already exists but is not a substitute because it belongs to `content_assignments.state` (`repository.mjs:445,6655-6659`).

## B. Production-state writers compared to the map

All normal production writes below reach `repo.upsertWorkflowModel`; direct SQL fixture writes are separated at the end. “Keep” and “replace” describe the policy comparison, not an implementation instruction.

| Writer | File:line | Value written | Type evidence | Map comparison |
|---|---|---|---|---|
| head creation/default | `repository.mjs:5319-5331,5871-5920` | caller/default `collected` | caller-dependent | 1.1 only when caller supplies `collected`; generic creation can seed any valid state |
| legacy repair | `repository.mjs:568-580,5933-5945` | map from legacy, including `needs_revision`, `rejected`, `content_in_progress` | not type-scoped | remove/replace those three only for place; event/transport use of `content_in_progress` must remain |
| clean pipeline | `services/workflow.mjs:1802-1810` | `analyzed` | queue begins with head `collected`, no item-type filter at `:1774` — not sure | keep: 1.2 |
| AI field-pack generation | `services/workflow.mjs:2396-2410` | `analyzed` | not sure | keep: 1.2; it does not advance to 1.3 |
| deterministic AI draft | `services/workflow.mjs:2469-2484` | `generated` | not sure | keep: 1.3 |
| quality pass | `services/workflow.mjs:2554-2568` | `in_review` | not sure | keep only as 3.3, but current caller may invoke it from stage-1/3 flows |
| quality fail | `services/workflow.mjs:2581-2597` | `needs_revision` | not sure | replace for place with previous ladder position plus `revision_requested` flag |
| review approve | `services/workflow.mjs:2635-2646` | `ready_for_publish` / `approved` | not sure | keep: 3.3+ |
| review reject | `services/workflow.mjs:2650-2660` | `rejected` / `draft` | not sure | replace for place with current ladder position plus `rejected` flag |
| review changes | `services/workflow.mjs:2664-2676` | `needs_revision` / `draft` | not sure | replace for place with prior stage plus `revision_requested` flag |
| reopen rejected item | `services/workflow.mjs:2720-2742` | `analyzed` / `draft` | not sure | replace place semantics: current `rejected` is no longer a stage; policy does not authorize a fixed reset to 1.2 |
| return field pack to clean | `repository.mjs:10972-11035` | `analyzed` | no content-type check — not sure | conflicts with policy §4.2 because it deletes field-pack children at `:11006-11010`; target stage is 1.2 |
| article process revision | `server/index.mjs:4385-4472` | `needs_revision` / `draft` | article process is shared; no place filter — not sure | replace only for place with 3.2 + `revision_requested` flag for an in-process return; cross-process target depends on selected return |
| article ready-for-sync, direct source | `server/index.mjs:4475-4510` | `ready_for_publish` / `approved` | shared/no place check — not sure | keep: 3.3+ |
| article ready-for-sync fallback | `server/index.mjs:4513-4559` | indirectly `in_review`, then hardcoded `approve` produces `ready_for_publish` | shared/no place check — not sure | 3.3/3.3+ values match, but this is the policy §3 prohibited automatic approval |
| article status mapper | `server/index.mjs:4660-4690` | `in_review`, `ready_for_publish`, `submitted_for_admin_review`, `needs_revision`, fallback `content_in_progress` | shared/no place check — not sure | retain mapped 3.3/3.3+/4; replace place `needs_revision`; split place fallback into `writing_assigned` or `writing` based on actual transition |
| imported item | `server/index.mjs:6867-6874` | `collected` / `draft` | import route; type supplied by request — not sure | keep: 1.1 |
| manual item-create routes | `server/index.mjs:8625-8632,8666-8673` | `content_in_progress` / `draft` | route payload can set type; not sure | replace for place; do not replace event/transport use |
| generic item create | `server/index.mjs:8685-8701` | request-supplied validated value | no place restriction | bypasses ladder; every place target except valid creation state is contrary to map |
| transport route create/update | `server/index.mjs:8799-8805,8866-8873` | `content_in_progress` / `draft` | transport route | keep for transport; exclude place |
| transport backend sync | `server/index.mjs:8942-8954` | `ready_for_publish` / `published` | transport map | does not implement place step 5; it is the only checked writer of `published` |
| item edit `mark_cleaned` | `server/index.mjs:9149-9162` | `analyzed` | item route, no type filter | keep: 1.2 |
| generic workflow endpoint | `server/index.mjs:9751-9809` | any value accepted by server enum | no type rule | policy §8.1/§9.4 bypass; for new place values it can write them without a place ladder rule |
| editorial assignment creation | `server/index.mjs:10687-10699` | `content_in_progress` / `draft` | assignment is editorial; item type not checked | replace for place with `writing_assigned`; event/transport status is not proven here |
| field assignment acceptance | `server/index.mjs:11314-11336` | `content_in_progress` | assignment kind field; item type not checked | replace for place with `writing_assigned` (not 2.2: this occurs after acceptance) |
| submit admin review | `server/index.mjs:13505-13517` | `submitted_for_admin_review` / `approved` | route does not show type restriction | keep: 4 |
| backend web-review feedback | `server/index.mjs:14448-14497` | `needs_revision` plus `draft`/`unpublished` | explicitly `place` or `event` | replace for place with flag plus selected ladder position; event remains outside this policy |
| unpublish | `server/index.mjs:14554-14567` | keeps production; `unpublished` | not sure | policy excludes post-publication states |

Direct-SQL state writers outside runtime production are fixtures only: `collector/scripts/smoke-ai-input-cleanup-post-assignment.mjs:42-44`, `smoke-field-pack-return-to-clean.mjs:50-53`, `smoke-publish-sync-compensation.mjs:98-100`, `smoke-reference-cleanup.mjs:78-81`, plus test helper `collector/tests/in-flight-items.test.mjs:45-54`. They must recognize any added test fixture value, but do not write production runtime state.

## C. Readers that silently break with new values

Unknown values generally do not throw; they fall through to a legacy/default label, empty filter result, or a derived status. This table includes executable backend and `server/public/` readers; test/script readers are listed afterwards.

| Reader family | File:line | Unknown-new-value result |
|---|---|---|
| repository normalization | `repository.mjs:5742-5748` | new value is normalized to empty string and rejected as invalid before write/filter |
| legacy mirror derive | `repository.mjs:583-623` | `field_*`/`writing_*` fall through to legacy `raw`; a new state is therefore mirrored incorrectly into `content_items.workflow_status` |
| transition rules | `repository.mjs:5751-5765,5972-5979` | unknown `from` has no rule and throws `invalid production transition`; new `to` is rejected by normalization until enum is extended |
| workflow-head filtering | `repository.mjs:6106-6125` | values absent from an explicit list disappear silently from that list |
| in-flight classifier/filter | `repository.mjs:5380-5397,5484-5485` | not equal to named terminal/raw values; classification is not sure without runtime payload shape |
| field-pack return guard | `repository.mjs:10986-11025` | new from-state lacks a transition to `analyzed`, so it throws before deletion |
| AI draft eligibility | `services/workflow.mjs:2200-2213` | `field_working`, `field_review`, `writing_assigned`, `writing` fail with an explicit not-eligible error |
| quality candidate queue | `services/workflow.mjs:2530-2531` | new values are omitted silently |
| review duplicate guards | `services/workflow.mjs:2620-2625,2720-2722` | only old flags/states recognized; new flag model has no input here; fallback behaviour is normal action execution |
| API enum validation | `server/index.mjs:2805-2818,9767-9797` | HTTP returns 400/no valid fields; additionally current `generated` already fails here |
| article-process derive/map | `server/index.mjs:4593-4610,4660-4690,4830-4831,9488-9519` | unrecognized production state derives the fallback drafting map (`content_in_progress`) or offers no transition; exact route response depends on status/role |
| place/work-scope restrictions | `server/index.mjs:4003-4017,4084-4105` | new states fall through as non-terminal/non-special; may permit work scope that a new stage should restrict |
| legacy request/create mapper | `server/index.mjs:6745-6789` | unknown legacy status maps to `collected/draft`, silently losing stage |
| web-review feedback | `server/index.mjs:14469-14487` | always overwrites current state with `needs_revision`; it has no branch for future place flags |
| compatibility status adapter | `server/public/app.js:694-745` | unrecognized state falls through to legacy/raw compatibility display |
| Thai production badge map | `server/public/app.js:2910-2926` | no key gives an empty/undefined label (render depends on caller); no labels for four new states |
| dashboard queues/badges | `server/public/app.js:4872-4880,5000-5030,5043-5135,5647-5649` | explicit state buckets omit new values; items land in fallback bucket or no matching queue |
| editor status and permissions | `server/public/item-editor.js:28-59,153-158` | unknown status falls through to raw/default editor behaviour; no new-stage labels/gates |
| article intake | `server/public/article-intake.js:183-193,368-384,412-453` | unknown production state becomes fallback process status; assignment-required checks do not run |
| event/transport shared readers | `server/public/events-manager-page.js:100-126,150`; `other-transport-page.js:110-126` | preserve `content_in_progress` there; adding place-only values to global label/derivation without type branching can show fallback/incorrect status |

Test/script readers with explicit old values: `scripts/find-smoke-item.mjs:49,83`; `scripts/smoke-field-flow-publish-translation.mjs:75-94,150-151`; `scripts/trigger-field-pack.js:81`; `tests/in-flight-items.test.mjs:70-112,228-256`; `tests/raw-delete.test.mjs:207-325`; `tests/release-queue-surface.test.mjs:36`; `tests/assignment-ui-scope.test.mjs:758,2717-2719,2931-2936,3258`. They either select no new-state fixture, assert old output, or display legacy `workflow_status`; none will throw solely because a database row has a new TEXT value.

## D. `TRANSITION_RULES`

### D.1 Exact current structure and callers

`TRANSITION_RULES` is one frozen object keyed only by `production`, `publication`, `assignment` at `collector/db/repository.mjs:464-496`. Its production entries are at `:466-477`; assignment entries including terminal `closed` are `:487-495`.

`canTransition(stateGroup, fromState, toState)` at `repository.mjs:5751-5760` takes no item or content type. Callers are:

| Call | File:line | Effect of adding `contentType` key |
|---|---|---|
| `assertValidTransition` | `repository.mjs:5762-5765` | must receive/pass the type or it cannot select a type rule |
| production/publication checks in `upsertWorkflowModel` | `repository.mjs:5972-5976` | must obtain item type before validation and pass it |
| assignment-state check in `upsertWorkflowModel` | `repository.mjs:5978-5979` | needs an explicit decision whether assignment rules stay shared; current signature still needs adaptation if table shape changes |
| assignment-row validation | `repository.mjs:6651` | must carry type from the assignment’s item before lookup |
| assignment mirror feasibility | `repository.mjs:6655` | same |
| return-field-pack guard | `repository.mjs:11003` | must carry type from its item/head |

No other production caller of repository `canTransition()` was found. `server/index.mjs:4584-4831,9488-9545` has a different `canTransitionArticleProcess` machine; it does not read `TRANSITION_RULES`.

### D.2 Gap versus the place ladder

Current normal production edges not in the policy’s adjacent place ladder include all skips: `collected→content_in_progress/generated/in_review/needs_revision/ready_for_publish/rejected`; `analyzed→content_in_progress/generated/in_review/needs_revision/ready_for_publish/rejected`; `brief_generated→analyzed/content_in_progress/generated/in_review/needs_revision/ready_for_publish/rejected`; `ready_for_content→content_in_progress/generated/rejected`; `content_in_progress→generated/in_review/needs_revision/rejected`; `generated→content_in_progress/in_review/needs_revision/rejected`; `in_review→needs_revision/rejected`; `needs_revision→content_in_progress/generated/in_review/rejected`; `ready_for_publish→completed/needs_revision/rejected`; `submitted_for_admin_review→needs_revision/rejected/completed`; `rejected→analyzed/brief_generated/ready_for_content`; `completed→needs_revision` (`repository.mjs:466-477`). `needs_revision` and `rejected` entries themselves are incompatible with the policy’s flag model for place.

Missing normal ladder edges are: `collected→analyzed` exists; `analyzed→generated` is missing; `generated→brief_generated` is missing; `brief_generated→ready_for_content` exists; `ready_for_content→field_working` missing; `field_working→field_review` missing; `field_review→writing_assigned` missing; `writing_assigned→writing` missing; `writing→in_review` missing; `in_review→ready_for_publish` exists; `ready_for_publish→submitted_for_admin_review` exists; `submitted_for_admin_review→completed` exists. All specified down edges are missing except the legacy `brief_generated→analyzed`; neither `generated→analyzed` nor `in_review→generated` exists (policy §9.3, `docs/place-workflow-policy.md:225-232`).

Every addition in this paragraph replaces either the listed skip/ambiguous `content_in_progress` edge or is **new pure state** as declared in A.2; it is not an implementation plan.

## E. `needs_revision` / `rejected` to flags

### E.1 Writers

| Value | Writers | Current onward route |
|---|---|---|
| `needs_revision` | quality fail `services/workflow.mjs:2581-2597`; review request-changes `:2664-2676`; article process `server/index.mjs:4412-4472,4660-4685`; backend feedback, explicitly place/event, `server/index.mjs:14448-14497`; generic endpoint `:9751-9809`; legacy repair/map `repository.mjs:568-580,5933-5945` | production table permits `needs_revision→content_in_progress/generated/in_review/rejected` at `repository.mjs:473`; article UI has revision/drafting transitions, `server/index.mjs:4393-4409` |
| `rejected` | review reject `services/workflow.mjs:2650-2660`; generic endpoint `server/index.mjs:9751-9809`; legacy repair/map `repository.mjs:568-580,5933-5945` | `rejected→analyzed/brief_generated/ready_for_content` only, `repository.mjs:476`; service reopen only accepts rejected then forces `analyzed`, `services/workflow.mjs:2720-2742` |

### E.2 Readers/branches

`needs_revision`/`rejected` are read or branched on in: legacy mapping/derivation `repository.mjs:568-601`; transition rules `:466-477`; AI candidate and quality queues `services/workflow.mjs:2200-2213,2530-2531`; review/reopen guards `:2620-2625,2720-2722`; article map and derivation `server/index.mjs:4412-4472,4660-4690`; backend feedback `:14456-14497`; API enum `:2805-2818,9767-9797`; UI adapter/badge/queues `server/public/app.js:694-745,2910-2926,4872-4880,5000-5030`; editor `item-editor.js:28-59,153-158`; article intake `article-intake.js:183-193,368-384,412-453`; and shared event/transport pages listed in C. Tests/scripts with literal references are listed in C.

No existing workflow-head field can store either flag: see schema `database/schema.sql:950-967`. `last_transition_note` is text and `state_version` is numeric, not boolean flags. `review_reports.status`/`review_actions` retain review history but are not an item-level flag (`services/workflow.mjs:2581-2582,2650-2667`). Therefore the policy flags are **new pure persisted workflow data**, not replacements for an existing column. Assignment `revision_requested` is a separate assignment state and cannot identify the item’s ladder position.

## F. UI compared with map

Only controls with markup and an observed binding are counted as buttons. A route alone is not counted.

| Map step | Existing page/control evidence | Forward button / binding | Back button / binding | Missing or mismatch |
|---|---|---|---|---|
| 1.1 collected | raw panel `server/public/index.html:164-332` | collect markup `:278`; binding was not located in the checked UI-source search — not sure | Home only `:164`; no state back button seen | no verified `collected→analyzed` button from this panel |
| 1.2 analyzed | clean page `clean-item.html:21-41` | `#btn-next-ai` markup `:34`; its binding is outside the located source set — not sure | `#btn-prev-step` markup `:32`; binding not sure | no verified map-state advance control |
| 1.3 generated | clean page shows Agent action `#btn-run-ai-context` `clean-item.html:320-322` | markup exists; binding not sure | no distinct generated→analyzed control found | no verified generated→brief_generated state transition |
| 1.4 brief_generated | field-pack editor `item-editor.html:47-67` | `#btn-next-export` `:61`, binding redirects after save at `item-editor.js:5740-5744` | `#btn-prev-step` `item-editor.html:58`, binding not sure; `#btn-return-to-clean` `:356` is destructive return path | does not show a verified `brief_generated→ready_for_content` head transition; return conflicts with no-delete rule |
| 2.1 ready_for_content | assignment handoff page `index.html:337-420` | `#btn-assignment-create` `:419`; binding `app.js:11210-11218`, API writer `:10152-10154` | no map backward control; only navigation | assignment create does not set `field_working` |
| 2.2 field_working | assignment work UI `index.html:573-628` | submit `#btn-assignment-submit` `:628`; binding `app.js:11260-11268` | no stage-back button; assignment state update control `:568`, binding `app.js:11249-11257` | current head remains/uses `content_in_progress`, not `field_working` |
| 2.3 field_review | review panel `index.html:649-703` | accept `#btn-assignment-accept-submission` `:684`; binding `app.js:11343-11355` | revision `#btn-assignment-request-revision` `:683`; binding `app.js:11327-11341`; rework `#btn-assignment-return-to-field` `:703`, binding `:11357-11369` | no `field_review` head state; revision is assignment state, not policy flag |
| 3.1 writing_assigned | no dedicated map step page found. Editorial-assignment endpoint exists, but route is not UI evidence. | no verified markup/binding | none found | absent |
| 3.2 writing | article workspace markup `article-workspace.html:32`; API calls/bindings `article-workspace-page.js:1881,2040-2058` | submit-review call at `:2058`; exact button markup was not found in current search — not sure | article request-revision markup exists in `article-submit.html:86`, binding `article-submit-page.js:992`; scope is article submit, not proven workspace | no `writing` head state |
| 3.3 in_review | article process is rendered on article pages (`article-workspace.html:32`, `article-submit.html:32`) | API transition exists `article-workspace-page.js:2040`, submit `:2058`; markup button not verified | request revision above | approval control is not verified from markup in scope |
| 3.3+ ready_for_publish | no dedicated verified UI control | none verified | none verified | API-only/automatic path remains (`server/index.mjs:4513-4559`) |
| 4 submitted_for_admin_review | no markup/binding found for `POST /api/items/:id/submit-admin-review` | none verified | policy-required return button absent; prior audit also found API-only rollback | route exists but is not counted |
| 5 completed/published | no place UI writer found | none | out of policy after public | place completion writer absent; only transport sync writes `published` |

The policy specifically names no UI buttons for `/api/run/clean` and `/api/run/quality`, reopen, request-changes, and Admin Review rollback (`docs/place-workflow-policy.md:225-232`); the checked public files show no markup/event binding for those exact workflow operations. `request-revision` assignment controls above are not the repository review `request_changes` route.

## G. Policy §9.1 four bugs

| Bug | Exact change surface | Impact boundary | Independent? |
|---|---|---|---|
| A enum mismatch | server list `collector/server/index.mjs:2805-2818`; repository list `collector/db/repository.mjs:430-445`; generic endpoint uses server list `:9767-9805`; service writes `generated` `collector/services/workflow.mjs:2469-2484` | API recovery/update of a generated item currently rejects it; any unified list changes all content types because validator is global | independent of ladder semantics, but the same enum surfaces are needed by 9.2 |
| B place cannot reach published | only checked `published` writer is transport sync `server/index.mjs:8942-8954`; place submit stops at `:13505-13517` | place stays submitted even after public state; transport route behavior must not be conflated with place | independent of four new states; depends on an external public-state source still undecided in policy §9.5.3 |
| C swallowed deliverable error | deliverable creator `server/public/app.js:9963-9979`; ignored error at `:10029-10031`; publishability requires deliverable `repository.mjs:9848-10030` | UI reports successful submission even when required deliverable creation failed; publishable source remains false | independent of state ladder; affects field-assignment path |
| D non-transactional item/head creation | sequential item/head writes `repository.mjs:5319-5331`; missing head throws `:5923-5931,5948-5954` | an error between calls leaves a `content_items` row without head and subsequent operations throw; all callers of create wrapper are affected | independent of ladder; not independent of removal of generic recovery endpoint, because that endpoint may currently help repair state but cannot create a missing head |

## H. Policy §9.4 removal/consolidation inventory

| Item | Definition | Users/dependencies | Can it be removed now? |
|---|---|---|---|
| `PUT /api/items/:id/workflow-model` | route `server/index.mjs:9751-9824` | generic writer; current recovery route for valid repository enum values; tests indirectly cover workflow head generic behavior (not sure which test is a direct HTTP call) | **No** per policy: it remains a bypass/recovery route until the normal ladder exists (`policy:238`) |
| `assignment_state` on workflow head | schema `database/schema.sql:955`; validator/rules `repository.mjs:445,487-495`; sync create/update `:6271-6307,6632-6694` | API item payload `server/index.mjs:1327,1381`; generic endpoint `:9769-9781`; head queues/filters `repository.mjs:6106-6125`; scripts/tests in C; duplicates `content_assignments.state` | **No**: active readers and two reconcile bypass sites depend on it |
| `skip_assignment_transition_validation` | metadata read `repository.mjs:5968-5979` | set by assignment mirror sync `:6676-6691` and field rework `:10238-10253` | **No**: both live paths use it because head mirror can differ |
| `skip_production_transition_validation` / `skip_publication_transition_validation` | metadata reads `repository.mjs:5969-5976` | no checked caller sets either true | **Yes from source evidence**; no runtime caller found |
| legacy `workflow_status` | `content_items` schema (not shown in this audit’s state table); mappings `repository.mjs:568-623`; item save/mirror `:5286-5310,5852-5868`; server legacy create adapter `server/index.mjs:6745-6789`; UI queue/status compatibility `server/public/app.js:694-745,5000-5135` | many scripts/tests in C and E; repair/backfill uses it `repository.mjs:5933-5945,6062-6099` | **Not sure / no**: it is still a persisted mirror, fallback input, repair seed, and UI compatibility reader; policy itself says decision pending |
| five disabled batch endpoints | helper `server/index.mjs:5649-5659`; callers are `/api/run/publish`, `/stage`, `/approve`, `/export`, `/sync-backend` verified by `collector/tests/release-surface-guard.test.mjs:10-15` | helper audits then returns 410; release-surface test asserts all five | **Not sure**: no public UI caller found, but tests and the explicit 410 compatibility contract depend on their continued existence |
| assignment state `closed` | enum `repository.mjs:445`; rules terminal `:487-495`; action mapping `server/index.mjs:2823-2828` | assignment updates and UI state action `app.js:9256,9719`; rework explicitly requires/creates closure `repository.mjs:10191-10260`; publishable source permits `accepted|closed` `:9893-9903`; article/editorial replacement closes active assignment (earlier audit: `server/index.mjs:10620-10652`) | **No**: current live rework, replacement, and publish-source readers depend on it; it has no outgoing transition |

No code patch or task ordering is included in this audit.
