# Handoff tracks audit: assignment and article process

Audit date: 2026-07-29. Source-only review; no database was opened and no code was changed. `audit/collector-pipeline-audit.md` (from `codex/prompt-audit-collector-pipeline`) and `audit/role-matrix-survey.md` (from `codex/role-matrix-survey`) were read first. This report intentionally does not repeat the production-state backward walk.

Important: an item has persisted `content_assignments.state` rows and a workflow-head `assignment_state`, but **article-process status has no column/table**. It is derived from production/publication state and publishable-source facts (`collector/server/index.mjs:4593-4610`).

## A. Forward tracks

### Assignment track

The assignment rules are the `TRANSITION_RULES.assignment` table: `assigned → in_progress|submitted|closed`; `in_progress → submitted|revision_requested|closed`; `submitted → revision_requested|accepted|closed`; `revision_requested → resubmitted|in_progress|closed`; `resubmitted → accepted|revision_requested|closed`; `accepted → closed|revision_requested`; `closed →` none (`collector/db/repository.mjs:487-495`). Repository state writes enforce this table (`repository.mjs:6636-6694`).

| Forward action | Actual endpoint/actor path | Writes |
|---|---|---|
| Create / hand off | `/api/items/:id/assignments/from-readiness` is owner-only (`collector/server/index.mjs:10382-10423`); article editorial assignment creation is in `:10620-10714`. | `content_assignments` row starts `assigned`; field flow also creates `content_assignment_handoff_snapshots` (`collector/db/repository.mjs:6361-6437,10141-10172`). |
| Submit / resubmit | Contributor submission endpoint (`collector/server/index.mjs:11484-11636`); article workspace’s submit-review does the same for an eligible editorial assignment (`:9522-9689`). | Appends submission, sets its ID as `latest_submission_id`, then assignment `submitted` or `resubmitted`. |
| Review: revision / accept / reopen / close | Owner/admin/user patch `/api/assignments/:id/state`; action mapping is request revision, accept, reopen to in-progress, close (`collector/server/index.mjs:2819-2835,11245-11374`). User is restricted to `revision_requested|in_progress|accepted` and cannot close (`:11265-11271`). | Updates one assignment row and synchronizes workflow-head `assignment_state` (`repository.mjs:6636-6694`). |
| Rework after accept | owner/admin/issuing user calls `/api/assignments/:id/return-to-field` with note + password (`collector/server/index.mjs:11390-11481`). | Closes old accepted field assignment, creates a new assigned field assignment and handoff snapshot (`repository.mjs:10191-10261`). |

The persisted record relationships are: assignment → item; submission → assignment and item; deliverable → assignment, submission and item (`collector/database/schema.sql:994-1066`). A field handoff snapshot carries assignment/item/readiness IDs and immutable JSON package (`schema.sql:1180-1195`).

### Article-process track

The rule table is `ARTICLE_PROCESS_TRANSITIONS`: `drafting → ready_for_review`; `revision_requested → drafting|ready_for_review`; `ready_for_review → revision_requested|ready_for_sync`; `ready_for_sync → revision_requested|submitted_for_admin_review`; `submitted_for_admin_review → revision_requested`; `synced_to_admin → revision_requested|submitted_for_admin_review` (`collector/server/index.mjs:2837-2845`). The generic transition route verifies this rule (`index.mjs:9468-9519`).

`drafting`, `ready_for_review`, `ready_for_sync`, `submitted_for_admin_review`, and `revision_requested` map respectively to workflow `content_in_progress/draft`, `in_review/draft`, `ready_for_publish/approved`, `submitted_for_admin_review/approved`, and `needs_revision/draft` (`collector/server/index.mjs:4660-4690`). `synced_to_admin` cannot be manually transitioned because it has no patch (`:4660-4663`) and derives only when `publication_state=published` (`:4593-4598`).

Actor gate is owner: all except synced; admin: drafting/revision/review/sync; user: drafting/revision/review; editor: drafting/review (`collector/server/index.mjs:4714-4733`), then item/editorial-assignment access is checked (`:4362-4383`). `POST /article-process/submit-review` is the workspace route to `ready_for_review`; it creates/submits an editorial assignment submission when applicable (`:9522-9689`).

## B. Backward walk and actual UI

### Assignment states

| State | Demonstrated backward path | What is lost/overwritten | Forward again / obstruction | Actual UI |
|---|---|---|---|---|
| `assigned` | ไม่มี | N/A | Can submit directly by rule. Field creation is blocked if another open field round exists (`repository.mjs:6347-6358`). | State picker exists (`collector/server/public/index.html:568`; binding `app.js:9695-9727`), but its available values are runtime-gated. |
| `in_progress` | ไม่มี | N/A | Can submit, request revision, close. | Same state picker; submit button markup `index.html:627-628`, binding `app.js:11260-11269`. |
| `submitted` | `request_revision` → `revision_requested` (`collector/server/index.mjs:11277-11304`). | No submission/de-liverable deletion by plain revision. If reset flags are requested, assignment work assets may be deleted; promoted assets are only detached (`collector/db/repository.mjs:6750-6804,6837-6880`). | Resubmit requires `revision_requested`; duplicate submission is rejected until reviewer action (`repository.mjs:6883-6904`). | Review buttons are real markup `index.html:683-684`, bindings `app.js:11327-11355`. |
| `revision_requested` | `reopen_in_progress` → `in_progress` (`collector/server/index.mjs:2823-2827,11245-11304`); article-process drafting side effect also sets primary editorial assignment to `in_progress` (`index.mjs:4393-4409`). | Plain reopen changes state only. Reset revision may already have deleted unpromoted assignment files. | Can resubmit only as `resubmitted`; resubmission appends a new submission and carries prior payload values when omitted (`repository.mjs:6917-6951`). | Generic state picker is a real UI. No separate dedicated reopen button was found. |
| `resubmitted` | `request_revision` → `revision_requested` (`repository.mjs:491-493`; endpoint above). | No automatic deletion unless reset requested. Prior submission remains; `latest_submission_id` points to new row. | Can accept, request revision, close. | Real review-request button/binding cited above. |
| `accepted` | (1) ordinary `request_revision` is permitted by rules and endpoint; (2) field-only `return-to-field` closes the accepted row and creates a new assigned row (`repository.mjs:10191-10261`). | Ordinary request revision does not delete rows; it may delete unpromoted reset media. Return-to-field retains old assignment/submission/deliverables/handoff but old row becomes `closed`; it creates a new handoff snapshot. Acceptance itself overwrites the latest draft’s confirmed metadata under its generation UID (`repository.mjs:6536-6629`). | Ordinary revision can resubmit same assignment. Rework can progress only as a **new** field assignment; one-open-field-round guard applies (`repository.mjs:6347-6358`). | Return-to-field has markup `index.html:689-703`, visibility gate/API call `app.js:9272-9315`, click binding `:11357-11366`. |
| `closed` | ไม่มี. No `closed → *` rule (`repository.mjs:493-495`). | Closing alone deletes nothing. | Cannot reopen the same row. A field rework is possible only when the prior row was `accepted` before it is closed; direct closed row cannot use it (`repository.mjs:10202-10205`). A new field round requires no open field assignment. | Generic UI may render a state picker, but no actionable closed-reopen control/caller was found. |

### Article-process states

| State | Demonstrated backward path | What is lost/overwritten | Forward again / obstruction | Actual UI |
|---|---|---|---|---|
| `drafting` | ไม่มี | N/A | Can move to ready_for_review. | Workspace has actual Submit Review markup `article-workspace.html:239` and binding/API (`article-workspace-page.js:2036-2065,2355`); event equivalent `event-workspace.html:159`, `event-workspace-page.js:973-1001,1214`. |
| `revision_requested` | ไม่มี earlier process state; it moves forward to drafting or review per rules. | `transitionArticleProcessState` may also set primary editorial assignment to `revision_requested`; no delete in this helper (`collector/server/index.mjs:4393-4427`). | drafting changes that primary editorial assignment back to in_progress if it is revision_requested (`:4403-4409`). | Article/Event Submit actual revision buttons: markup `article-submit.html:86`, `event-submit.html:50`; bindings use editorial revision APIs (`article-submit-page.js:1005-1014,1321-1339`; `event-submit-page.js:637-659,764-783`). |
| `ready_for_review` | → `revision_requested` by generic transition; this also changes primary editorial assignment if present (`index.mjs:4385-4427`). | Workflow head changes; assignment only has state/note overwritten. | Can move to ready_for_sync. `ready_for_sync` may run quality and hardcoded approve, described in prior pipeline audit (`index.mjs:4513-4559`). | Revision button markup/binding above; approve-to-ready_for_sync binding `article-submit-page.js:1336-1339`, event `event-submit-page.js:780-783`. |
| `ready_for_sync` | → `revision_requested` (`index.mjs:2839-2844,4385-4427`). | No rows deleted by that helper; workflow head changes. | Can submit admin review if readiness/translation/etc. pass; an unchanged submission manifest can retry, a changed one supersedes old snapshot (`collector/db/repository.mjs:12014-12039`). | Yes: Submit pages have Send Admin Review markup `article-submit.html:98`, `event-submit.html:62`, event/API bindings `article-submit-page.js:1283-1298`, `event-submit-page.js:729-733`. |
| `submitted_for_admin_review` | → `revision_requested` is permitted by article-process rules. A Collector generic transition route exists, but no direct checked-in UI caller for this exact transition was found. | Workflow head only in Collector route. Review-submission snapshot remains. | Can proceed only by backward transition in the local rules; backend behavior is out of scope. | API-only/not found for this exact local transition. |
| `synced_to_admin` | → `revision_requested` or `submitted_for_admin_review` are listed in rules, but generic patch rejects `synced_to_admin` only as a destination; source transition can map the target. No checked-in UI caller was found. | Not determined beyond workflow mapping; backend state out of scope. | `synced_to_admin` derives from published state; further behavior is not established in scope. | API-only/not found. |

## C. Handoff and field return

Field handoff is created by `createAssignmentFromReadiness`: it requires no open field round, builds a package from a current ready field pack or a readiness snapshot, creates the assignment, then inserts `content_assignment_handoff_snapshots` with its JSON (`collector/db/repository.mjs:10106-10172`). The package preference and gate are explicit: field-pack statuses `ready_for_field|field_in_progress|field_done`, else readiness snapshot/governance; lack of readiness can be forced only with the shown force fields (`repository.mjs:9629-9714,10117-10136`). Assignment records identify the assignee; snapshots bind that assignment to the item (`schema.sql:994-1017,1180-1195`).

Contributor return is a new `content_assignment_submissions` row containing article/media/field-return JSON. The assignment’s `latest_submission_id` is replaced with that row ID; a resubmission merges article/media payload with the previous submission when omitted (`collector/db/repository.mjs:6883-6973`). Submission deliverables are separate rows. Text-like deliverables of the same type/lang **are updated in place**; otherwise a deliverable row is inserted (`repository.mjs:7104-7208`). UI upload submits files first and then calls deliverable creation, but its catch deliberately ignores a deliverable-create failure (`collector/server/public/app.js:9963-9979,9981-10033`).

`buildPublishableSourceByItem` chooses assignment candidates ordered by ready flag, article content/deliverable/usable media, state rank and update time. `ready_for_publish_source=true` requires: current field pack, a candidate assignment in `accepted|closed`, latest submission, article-draft deliverable containing text or URL, and `deliverables_utility.review_usable` (`collector/db/repository.mjs:9848-10030`). Thus an accepted/closed assignment alone does not qualify.

After an accepted field handoff, “send back again” is possible only through return-to-field: it requires field kind, current `accepted`, note, authorized issuer/higher role and password; it closes the accepted round and creates a new assignment/snapshot instead of reopening it (`collector/server/index.mjs:11379-11481`; `repository.mjs:10191-10261`). `accepted` can alternatively receive ordinary revision and resubmit. `closed` cannot reopen; there is no closed outbound transition.

## D. Cross-track locks and side effects

| Lock / coupling | Evidence and release |
|---|---|
| Active assignment blocks field-pack return-to-clean. | `assigned|in_progress|submitted|resubmitted|revision_requested|accepted` causes `cannot return to clean`; close/complete the active assignment first. Publish-ready/published also blocks independently (`collector/db/repository.mjs:10989-10998`). |
| One open field assignment blocks another field handoff. | `assertNoOpenFieldRound` rejects creation; open state must be closed or accepted field rework flow must close it first (`repository.mjs:6347-6358,10117-10120`). |
| Editor’s article-process `ready_for_review` is locked by editorial assignment state. | Editor must have own editorial assignment `submitted|resubmitted` (`collector/server/index.mjs:4362-4383`); submit through workspace to reach it (`:9555-9655`). |
| Article-process revision/drafting changes the primary editorial assignment state. | revision requested sets it to `revision_requested`; drafting sets it from that state to `in_progress` (`collector/server/index.mjs:4393-4409`). |
| Assignment accept can advance production/article work. | A field assignment acceptance moves production to `content_in_progress` only from collected/analyzed/brief_generated/ready_for_content (`collector/server/index.mjs:11314-11336`), therefore article process derives drafting. |
| Field assignment acceptance/closure determines publishable field source. | `ready_for_publish_source` requires `accepted|closed`; pending/revision assignment makes it false (`collector/db/repository.mjs:9893-9903,9950-9979`). |
| Article ready-for-sync can automatically consume quality/review path. | When no direct publishable field source, it runs quality and applies hardcoded approval (`collector/server/index.mjs:4513-4559`). This is an article-process action advancing production state. |
| Replacing active editorial assignment closes the old one. | Creation returns conflict unless `replace_active=true`; replacement writes old assignment `closed` then creates `assigned` (`collector/server/index.mjs:10620-10652`). |

## E. Three-track dead-end combinations observed from source

These are observed blocking combinations, not recommendations.

1. Current field pack + any active field assignment + need to return to clean: assignment track blocks return-to-clean; the return-to-clean code does not close it (`collector/db/repository.mjs:10989-10998`).
2. Assignment `submitted|resubmitted` + need contributor changes: contributor cannot add another submission because duplicate submission is rejected until reviewer action; reviewer must request revision first (`repository.mjs:6883-6904`).
3. Assignment `closed` + need the same assignee/round reopened: no `closed` transition exists. Field rework is unavailable once already closed because it requires `accepted`; a new round must satisfy the one-open-round guard (`repository.mjs:487-495,10191-10205`).
4. Article process `ready_for_review` + editorial assignment not submitted/resubmitted: an editor cannot perform the review transition, while the assignment must be submitted through its workspace flow first (`collector/server/index.mjs:4374-4380,9555-9664`).
5. Article process `ready_for_sync` + field source not accepted/closed or no usable article-draft deliverable: derived field-flow readiness is false, so submit-admin-review gate cannot use that path (`collector/db/repository.mjs:9950-9979`; gate `collector/server/index.mjs:13378-13419`).
6. Article process `submitted_for_admin_review` + desired local rollback: rules allow `revision_requested`, but no checked-in UI caller for that exact transition was found; this is API-only in the scanned source (`collector/server/index.mjs:2837-2845,9468-9519`).
