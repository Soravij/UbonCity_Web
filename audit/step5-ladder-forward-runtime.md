# Step 5 pipeline-forward runtime report

Run date: 2026-08-02 (Asia/Bangkok)  
Runtime checkout used: `D:\UbonRuntime\repos\UbonCity_Web` only. The stale `C:\UbonRuntime\repos\UbonCity_Web` checkout was not accessed.

## Runtime confirmation

| Check | Result |
| --- | --- |
| Runtime HEAD | `5a0de7b22a9209ca3e2488d2b6bbe1dbfcfc8f7b` |
| Runtime worktree | Clean before this pipeline run |
| `GET http://127.0.0.1:5000/api/health` | `200`, `ok: true` |
| `GET http://127.0.0.1:5070/api/health` | `200`, `ok: true` |
| Migration/schema/code action | None. No migration was run; no schema or code was changed. |
| Authentication | Owner token from the supplied Runtime token file was used unchanged as its Authorization header. Its value is not recorded here. |

## Test data

`POST /api/collect` with the manual adapter and owner authorization created five disposable place items. The API returned `raw_count: 5`, `imported_count: 5`, and SQLite confirmed content-item IDs **3–7**. Existing raw place IDs 1 and 2 were not accessed, changed, or deleted.

All state triples in this report are read from SQLite, not inferred from HTTP success responses. The order is `production_state / publication_state / workflow_status`.

## Pipeline table

| Step | API | 3 states before -> after | Pass/fail |
| --- | --- | --- | --- |
| Create five disposable items (IDs 3–7) | Owner: `POST /api/collect` | n/a -> `collected / draft / raw` for each item | Pass |
| Clean all test items | Owner: direct `POST /api/run/clean` (no UI caller) | `collected / draft / raw` -> `analyzed / draft / analyzed` for IDs 3–7 | Pass — HTTP 200, then SQLite verified all five rows. |
| Claim for owner processing | Owner: `POST /api/items/:id/claim` | `analyzed / draft / analyzed` -> unchanged for IDs 3–7 | Pass — claims recorded; this does not alter the three workflow values. |
| AI draft, item 3 | Owner: `POST /api/run/ai-draft` with `content_item_id=3` | `analyzed / draft / analyzed` -> unchanged | **Blocked** — HTTP 400. Clean minimum was met after normal item/context preparation, but the persisted audit record states: an Agent requires at least one reference or local image. No image was fabricated or uploaded to bypass this prerequisite. |
| AI draft, items 4–7 | Owner: `POST /api/run/ai-draft` with each item ID | `analyzed / draft / analyzed` -> unchanged | **Blocked** — HTTP 400 for every item. The clean preview for each reports missing `place_reference` and `approved_context`. No fake reference/context was inserted to bypass the prerequisite. |
| Generated -> quality | Not called | n/a | Not run — no item reached `generated`. |
| Quality -> in_review | Not called | n/a | Not run — no item reached quality. |
| Review decision -> ready_for_publish/approved | Not called (`POST /api/review/action` would be the API-only reject path) | n/a | Not run — no item reached review. |
| Submit admin review -> submitted_for_admin_review | Not called | n/a | Not run — no item reached ready-for-publish. |
| Backend Admin Approvals -> published | Not called | n/a | Not run — no item was submitted for admin review. |

## Per-item final database state

| Item | `production_state / publication_state / workflow_status` | Result |
| ---: | --- | --- |
| 3 | `analyzed / draft / analyzed` | Stopped at AI draft: missing reference/local image. |
| 4 | `analyzed / draft / analyzed` | Stopped at AI draft: missing place reference and approved context. |
| 5 | `analyzed / draft / analyzed` | Stopped at AI draft: missing place reference and approved context. |
| 6 | `analyzed / draft / analyzed` | Stopped at AI draft: missing place reference and approved context. |
| 7 | `analyzed / draft / analyzed` | Stopped at AI draft: missing place reference and approved context. |

## Conclusion

The collect and clean sections of the ladder pass on Runtime. The forward path cannot reach `generated` with the supplied minimal manual records: every test item was rejected by the intended AI-draft prerequisites while its canonical database state remained unchanged. This report deliberately does not add synthetic media, references, approved context, or code changes merely to force later states.

---

## Round 2 — synthetic local-cover pipeline attempt

Scope: owner-only pipeline flow. Existing items 3–7 were left unchanged as the earlier gate evidence. A real, valid 12,340-byte PNG was copied outside the repository to `D:\UbonRuntime\tmp\step5-synthetic-cover.png`; it was then uploaded only through the supported multipart endpoint. No direct database write was used.

| Step | API | 3 states before -> after | Pass/fail |
| --- | --- | --- | --- |
| Create synthetic items 8–9 | Owner: `POST /api/collect` with `adapter=manual`, `auto_import=true`, title/description and latitude/longitude | n/a -> `collected / draft / raw` for both | Pass — API returned `raw_count: 2`, `imported_count: 2`; SQLite confirmed IDs 8 and 9. |
| Clean | Owner: direct `POST /api/run/clean` | `collected / draft / raw` -> `analyzed / draft / analyzed` | Pass — SQLite confirmed both items. |
| Claim | Owner: `POST /api/items/:id/claim` | `analyzed / draft / analyzed` -> unchanged | Pass — claims provide prep-edit access without changing workflow state. |
| Local-cover upload and selection | Owner: multipart `POST /api/assets/upload` with `content_item_id`, `role=cover`, and the external PNG; then `PATCH /api/items/:id/assets/:assetId/selected` with `{"selected":true}` | `analyzed / draft / analyzed` -> unchanged | Pass — SQLite confirmed one `assets`/`content_assets` relation per item with `storage_disk=local`, `mime_type=image/png`, `selected_in_clean=1`, and `is_cover=1`. |
| Approved context | Owner: `GET /api/items/:id/evidence-blocks`, then `POST /api/items/:id/approved-context` with an item-owned active fact block, non-empty `selected_text`, and `status=active` | `analyzed / draft / analyzed` -> unchanged | Pass — SQLite confirmed one active approved-context row per item. |
| AI-draft preflight | Owner: `GET /api/items/:id/draft-input-preview` | n/a | Pass — for both 8 and 9: `has_minimum_required=true`, no `minimum_missing`, `selected_image_count=1`, `cover_count=1`, `approved_context_count=1`. |
| AI draft, item 8 | Owner: `POST /api/run/ai-draft` with `content_item_id=8` | `analyzed / draft / analyzed` -> unchanged | **Blocked** — HTTP 400. Persisted audit error: `Agent field pack must include at least one must_capture checklist item`. |
| AI draft, item 9 | Not called after item 8 blocker | `analyzed / draft / analyzed` -> unchanged | Not run — stopped at the same pipeline step as instructed. |
| generated -> quality -> in_review -> review decision -> ready_for_publish/approved -> submit-admin-review -> Admin Approvals -> published | Not called | n/a | Not run — item 8 did not reach `generated`. |

### Blocker classification

This is **not** an AI-provider-unavailable failure. The persisted AI runtime snapshot records configured feature policies and `backend_proxy_ready=true`; the returned error is specifically a field-pack output validation rule requiring at least one `must_capture` checklist entry. No provider connection/authentication/quota error was recorded. No code, configuration, schema, or direct database change was made to bypass it.

Final state after stop: item 8 = `analyzed / draft / analyzed`; item 9 = `analyzed / draft / analyzed`.

---

## Round 3 — continue after successful AI field-pack generation

Scope: owner-only runtime pipeline continuation. No migration, schema change, source edit, or direct SQLite write was performed. Every state triple below was read from `content_workflow_models` plus `content_items.workflow_status` after the HTTP action. The order is `production_state / publication_state / workflow_status`.

| Step | API | 3 states before -> after | Pass/fail |
| --- | --- | --- | --- |
| Item 9 AI-draft result confirmation | Read-only SQLite verification of the earlier one-request run | `analyzed / draft / analyzed` -> `analyzed / draft / analyzed` | Pass for field-pack generation: run `12c57f58-dc26-4eed-b54a-31c02c9a8b8c` completed `success=1`; field pack 1 contains 5 `must_capture` rows (all `photo` or `video`), 3 verify rows, and 4 ask rows. It did **not** create a content draft or transition to `generated`. |
| Generated -> quality, item 9 | Owner: `POST /api/run/quality` | `analyzed / draft / analyzed` -> `analyzed / draft / analyzed` | **Blocked** — HTTP 200 with `reviewed: 0`, `needs_revision: 0`; SQLite quality run records `Reviewed: 0, Needs revision: 0`. No `generated` candidate existed. |
| Item 8 AI-draft retry 1 of maximum 2 | Owner: `POST /api/run/ai-draft` with `content_item_id: 8` | `analyzed / draft / analyzed` -> `analyzed / draft / analyzed` | Pass for field-pack generation. HTTP 200: `count: 1`, `aiSuccessCount: 1`, `errorCount: 0`; pipeline run completed `success=1`. SQLite field pack 2 contains 4 valid `must_capture` rows (3 `photo`, 1 `video`), 1 verify row, and 3 ask rows. Retry 2 was not used because retry 1 succeeded. |
| Generated -> quality, item 8 | Not sent again | `analyzed / draft / analyzed` -> unchanged | Not applicable — the shared quality request above already established that `analyzed` items are not quality candidates; item 8 has the same state after its successful field-pack generation. |
| Quality -> in_review | Not called | n/a | **Blocked** — no content draft exists and neither item reached `generated`; review cannot start. |
| Review decision -> ready_for_publish/approved | Not called | n/a | Not run — prerequisite `in_review` was not reached. |
| Submit admin review -> submitted_for_admin_review | Not called | n/a | Not run — prerequisite ready-for-publish/approved was not reached. |
| Backend Admin Approvals -> published | Not called | n/a | Not run — no submission was created. |

### Round 3 blocker: successful AI mode creates only a field pack

This is distinct from the earlier `must_capture` validation failure. In the successful AI branch, `runAiDraftStage` saves the agent field pack and explicitly upserts `production_state: "analyzed"` at `collector/services/workflow.mjs:2400-2433`; it does not call `saveDraft`. The `saveDraft` and transition to `production_state: "generated"` code is in the `else` deterministic branch at `collector/services/workflow.mjs:2434-2507`.

`runQualityStage` selects only workflow heads whose production state is `generated`, `in_review`, or `needs_revision` (`collector/services/workflow.mjs:2544-2550`). Consequently the owner quality call found zero candidates. The canonical final states are:

| Item | Field pack | Content draft | `production_state / publication_state / workflow_status` | Result |
| ---: | ---: | ---: | --- | --- |
| 8 | 2, current, `draft`; valid capture rows | none | `analyzed / draft / analyzed` | Field-pack generation passed; later ladder blocked at generated → quality boundary. |
| 9 | 1, current, `draft`; valid capture rows | none | `analyzed / draft / analyzed` | Field-pack generation passed; later ladder blocked at generated → quality boundary. |

No state was forced and no unsupported API or direct database edit was used to move past this boundary.

---

## Round 4 — remaining place-ladder runtime attempt (item 9 only)

Scope: item 9 only. Item 8 was left at `analyzed / draft / analyzed` and was not read or changed by these requests. No migration, schema change, source edit, or direct database write was performed. All state triples below were read from SQLite (`content_workflow_models` joined to `content_items`) before and after each HTTP request, in the order `production_state / publication_state / workflow_status`.

The requested `PUT /api/items/9/workflow` route does not exist in runtime source. The actual state-model endpoint is `PUT /api/items/:id/workflow-model` at `collector/server/index.mjs:9708`. It was used exactly once as the explicitly authorized manual bridge; it is not a business-path transition and no other state was manually forced.

| Step | API / acting role | 3 states before -> after | Pass/fail |
| --- | --- | --- | --- |
| 1. Manual bridge to generated | Owner: `PUT /api/items/9/workflow-model` with `production_state=generated`, audit-only reason/note | `analyzed / draft / analyzed` -> `generated / draft / generated` | **Pass (manual only, not business path).** This is the single allowed bridge because finding `4e7c32a` established there is no public analyzed-to-generated business route. |
| 2. Place ready for content | Owner: `POST /api/items/9/place-ready-for-content` | `generated / draft / generated` -> unchanged | **Blocked — HTTP 409.** Current field pack is not `ready_for_field`: `item is not ready_for_assignment; complete step "พร้อมส่งเข้า handoff" (stored field pack status must be "ready_for_field")`. No public endpoint was used to force that field-pack status. |
| 3. Create field assignment for freelance | Owner: `POST /api/items/9/assignments`, `assignee_user_id=61`, `assignment_kind=field` | `generated / draft / generated` -> unchanged | **Blocked — HTTP 400.** The supplied freelance token identifies id 61, but the new collector DB contains only local owner id 1; its local lookup yields no assignee role, so validation returns `assignment_kind=field requires assignee role in [freelance, user, admin, owner]`. No assignment row was created. |
| 4. Field assignment in progress | Freelance would be assignee; actual PATCH not possible without an assignment id | `generated / draft / generated` -> unchanged | **Blocked by step 3.** There is no field assignment to call `PATCH /api/assignments/:id/state` on. Separately, the route accepts only owner/admin/user (`collector/server/index.mjs:11159`), not freelance, so the stated assignee token cannot perform this PATCH. |
| 5. Field submission and accept | Freelance submission, then manager acceptance | `generated / draft / generated` -> unchanged | **Blocked by step 3.** No assignment exists. Thus no legitimate `POST /api/assignments/:id/submissions` or accept action can be issued. |
| 6. Create editorial assignment for editorA | Owner: `POST /api/items/9/article-editorial-assignments`, `assignee_user_id=62` | `generated / draft / generated` -> unchanged | **Blocked — HTTP 400.** EditorA token identifies id 62, also absent from collector's local `users` table. Local role lookup is empty and returns `editorial assignment requires assignee role in [editor, user, admin, owner]`. No editorial assignment row was created. |
| 7. Editor drafting -> writing -> submit review | EditorA: `POST /api/items/9/article-process/transition` with `status=drafting` | `generated / draft / generated` -> unchanged | **Blocked — HTTP 403.** `editor ต้องมี editorial assignment ที่ยัง active จึงจะแก้บทความได้`. Since step 6 could not create an assignment, no draft body could legitimately be saved and no submit-review request was sent. |
| 8a. Review decision | Owner: `POST /api/review/action` with `content_item_id=9`, `action=approve` | `generated / draft / generated` -> unchanged | **Blocked — HTTP 409.** `review prerequisite missing: latest review report is required`. |
| 8b. Submit admin review | Owner: `POST /api/items/9/submit-admin-review` | `generated / draft / generated` -> unchanged | **Blocked — HTTP 409.** Readiness says missing latest draft, review report/approved review, meta title/description, assignment and publishable assignment source; it also requires `ready_for_publish` plus `approved`. |
| 8c. Backend Admin Approvals -> published | Not called | `generated / draft / generated` -> unchanged | **Not reachable.** No collector admin-review submission was created, so there is no backend approval record to approve/publish. |

### Round 4 conclusion

Only the explicitly authorized manual bridge passed. The remaining genuine endpoints expose three independent holes:

1. A valid AI-generated field pack remains `draft`, while `place-ready-for-content` requires `ready_for_field`; no public business endpoint in this run moves it there.
2. Runtime authentication tokens for freelance id 61 and editor id 62 are not represented in the fresh collector-local `users` table (which has only owner id 1), so both field and editorial assignment creation reject them before an assignee can work.
3. Without the assignments and a saved draft/review report, the review, admin-review, and backend-publish stages are correctly gated and cannot be exercised without an additional manual bypass. None was used.

Final canonical state: item 9 = `generated / draft / generated`; item 8 remains `analyzed / draft / analyzed`.

---

## Round 5 — corrected local-assignee continuation (item 9)

Scope: item 9 only. No code/schema/migration/direct-SQL write and no additional manual workflow-state bridge were used. Before starting, a full SQLite count found 14 collector users (3 owner, 3 admin, 3 user, 2 editor, 3 freelance); collector-local ids used were freelance **14** and editor **10**. Every triple is read from SQLite before/after the endpoint in the order `production_state / publication_state / workflow_status`.

| Step | API / actor | 3 states before -> after | Result |
| --- | --- | --- | --- |
| 1. Mark current field pack ready | Owner: `PUT /api/field-packs/1` with `{"status":"ready_for_field"}` | `generated / draft / generated` -> unchanged | **Pass.** Field pack 1 became `ready_for_field`; this is a field-pack sidecar change, not a production-state transition. |
| 2. P1 ready for content | Owner: `POST /api/items/9/place-ready-for-content` | `generated / draft / generated` -> `ready_for_content / draft / ready_for_content` | **Pass.** |
| 3. Create field assignment | Owner: `POST /api/items/9/assignments`, `assignment_kind=field`, `assignee_user_id=14` | `ready_for_content / draft / ready_for_content` -> unchanged | **Pass.** Created field assignment 2 for local freelance id 14. Assignment creation itself does not move the workflow head. |
| 4. Start field work | Owner: `PATCH /api/assignments/2/state` with `state=in_progress` | `ready_for_content / draft / ready_for_content` -> `field_working / draft / raw` | **Pass with finding.** Canonical `production_state` advanced to `field_working`, but SQLite legacy `content_items.workflow_status` became `raw`, not a corresponding field-working value. |
| 5. Freelance field submission | Freelance: `POST /api/assignments/2/submissions` with `action=submit` | `field_working / draft / raw` -> unchanged | **Blocked — HTTP 409.** The legitimate assignee was accepted, but the endpoint requires at least one assignment-round image/video deliverable: `ต้องแนบผลงานอย่างน้อย 1 รายการก่อนส่ง`. No extra upload was fabricated outside the requested submission step. Therefore no submission/accept action was possible and `field_review` was not reached. |
| 6. Create editorial assignment | Owner: `POST /api/items/9/article-editorial-assignments`, `assignee_user_id=10` | `field_working / draft / raw` -> unchanged | **Unexpected pass / finding.** Editorial assignment 3 was created for local editor id 10 even while field assignment 2 remains `in_progress`; the head did **not** become the expected `writing_assigned`. |
| 7a. Begin article process | Editor: `POST /api/items/9/article-process/transition`, `status=drafting` | `field_working / draft / raw` -> unchanged | **Partial pass / finding.** HTTP 200 and article-process status `drafting`, but canonical production state did not advance to `writing`. |
| 7b. Save real draft body | Editor: `PUT /api/items/9/editor-work` with synthetic HTML body, title, excerpt, meta title and meta description | `field_working / draft / raw` -> unchanged | **Pass.** SQLite `content_drafts` has draft 1 with non-empty 135-character body. |
| 7c. Submit article review | Editor: `POST /api/items/9/article-process/submit-review` | `field_working / draft / raw` -> unchanged | **Blocked — HTTP 403.** `editor ต้อง submit หรือ resubmit assignment ของตัวเองก่อนส่งบทความเข้าตรวจ`; editorial assignment 3 remains `assigned` and has no submission. No alternate assignment-state mutation was used. |
| 8a. Review decision | Owner: `POST /api/review/action`, `action=approve` | `field_working / draft / raw` -> unchanged | **Blocked — HTTP 409.** Latest review report is required. |
| 8b. Submit admin review | Owner: `POST /api/items/9/submit-admin-review` | `field_working / draft / raw` -> unchanged | **Blocked — HTTP 409.** Readiness reports no approved review, wrong production/publication states, field assignment not accepted, no latest submission, and no article-draft deliverable. |
| 8c. Backend Admin Approvals -> published | Not called | `field_working / draft / raw` -> unchanged | **Not reachable.** No collector admin-review submission exists. |

### Round 5 findings

1. The corrected collector-local ids make both assignment-creation endpoints work; the previous “missing users” explanation was wrong and has been corrected in `step5-fieldpack-status-and-users.md`.
2. The field path is correctly blocked at submission until an assignment-round deliverable exists. This run did not invent/upload one after the explicit submission request failed.
3. The editorial endpoint permits assignment creation before the field assignment is submitted/accepted, but does not transition the canonical head from `field_working` to `writing_assigned`; article-process drafting likewise returns 200 without changing it to `writing`.
4. After the genuine field-work transition, canonical and legacy status diverge: final item 9 is `field_working / draft / raw`. This is database evidence, not an interpretation of the HTTP response.

---

## Round 6 — assignment-round evidence upload and continuation check (item 9)

Scope: item 9 only. No code/schema/migration/direct-SQL write or manual workflow-state update was used. All triples below were read from SQLite before/after the HTTP call in the order `production_state / publication_state / workflow_status`.

| Step | API / actor | 3 states before -> after | Result |
| --- | --- | --- | --- |
| 1. Upload field evidence into assignment round | Freelance local id 14: multipart `POST /api/assignments/2/assets/upload` with the existing valid `D:\\UbonRuntime\\tmp\\step5-synthetic-cover.png`, field `file`, and `sync_batch_id=audit-r6-field-1` | `field_working / draft / raw` -> unchanged | **Pass.** Source route is `collector/server/index.mjs:15206-15316`. SQLite confirms one local PNG asset linked to assignment 2, round 1, `assignment_surface=assignment_work`, `assignment_media_type=image`; it is not a cover/clean asset. |
| 2. Field submission | Freelance: `POST /api/assignments/2/submissions` with complete verify/question/additional-text answers | `field_working / draft / raw` -> unchanged | **Blocked — HTTP 400.** The valid image meets the “at least one deliverable” gate, but the same submission validation additionally requires every structured `must_capture` item. Field pack 1 has 5: two photo and three video. The one PNG filename does not carry a required capture-slot key and cannot satisfy the three video slots. The endpoint listed all five capture prompts as missing. No fake video MIME, payload-only slot claim, or state bypass was used. |
| 3. Accept field submission | Not called | `field_working / draft / raw` -> unchanged | **Not reachable.** Assignment 2 remains `in_progress`, has no submission id, so an accept would not be acceptance of a real submission. The earlier source conclusion remains: if accepted at `field_review`, a place head intentionally remains there (`collector/server/index.mjs:11229-11235`). |
| 4a. Recheck existing editorial assignment | Owner: repeat `POST /api/items/9/article-editorial-assignments` with local editor id 10 | `field_working / draft / raw` -> unchanged | **HTTP 200 silent no-op.** It returned existing assignment 3 and created no duplicate. The route explicitly returns early when the active editorial assignment has the same assignee (`collector/server/index.mjs:10548-10555`). |
| 4b. Drafting / submit-review / review / publish | Not called again | `field_working / draft / raw` -> unchanged | **Not reachable from this round's blocked field submission.** Existing draft 1 remains non-empty, but assignment 3 is still `assigned` and its earlier submit-review result was 403 for missing own assignment submission. |

### Editorial assignment 3 and silent no-op cause

Assignment 3 is not duplicated: the repeat request was idempotent and retained the one active editorial row. It is, however, **out of order**: it was created while the field assignment is still `in_progress`.

That out-of-order record causes the observed misleading 200 responses. The initial editorial-assignment request attempted `writing_assigned`; the drafting request attempted `writing`. For a place whose actual head is `field_working`, `resolvePlaceLadderWorkflowPatch` checks the legal edge and, when invalid, strips only `production_state` from the patch rather than returning an error (`collector/server/index.mjs:4258-4276`). The surrounding caller still upserts the remaining patch and returns 200 (`:4211-4255`). Thus:

- first creation: assignment 3 was persisted but the canonical head stayed `field_working`;
- drafting: returned 200/process status `drafting`, but `production_state=writing` was stripped;
- repeat creation in this round: 200 is the explicit same-assignee early return, not a new transition.

Final canonical state is still item 9 = `field_working / draft / raw`; assignment 2 = `in_progress` with one image work asset and no submission; assignment 3 = `assigned`. The remaining physical evidence required for a genuine field submission is five correctly slotted captures, including three real videos; it cannot be supplied from the one PNG without falsifying the workflow.

---

## Round 7 — curated field-pack field submission and editorial continuation (item 9)

Scope: item 9, field assignment 2 (freelance collector-local id 14), and the already-existing editorial assignment 3 (editor collector-local id 10). No source, schema, migration, or direct SQLite write was made; no workflow state was manually forced. Every triple was read from SQLite before/after the action in the order `production_state / publication_state / workflow_status`.

| Step | API / actor | 3 states before -> after | Result |
| --- | --- | --- | --- |
| 1. Curate field pack 1 | Owner: `PUT /api/field-packs/1`, replacing its checklist with exactly one `must_capture` (`capture_type=photo`), one `must_verify_fact`, and one `must_ask_question`; `status=ready_for_field` | `field_working / draft / raw` -> unchanged | **Pass.** HTTP 200; SQLite confirmed pack 1 remains `ready_for_field` and has exactly the three required current checklist rows. This is a field-pack change, not a head transition. |
| 1a. Effect on pre-existing assignment 2 | Read-only source + SQLite | n/a | **Confirmed material effect.** `repo.updateFieldPack` replaces the pack's checklist set when it receives `field_pack_checklists` (`collector/services/repository.mjs:10071-10197`). Assignment 2's stored `brief_json` still records the old five captures, but submission validation resolves the current field pack dynamically through `resolveAssignmentSubmissionPromptContext` (`collector/server/index.mjs:3293`), so the live required-capture set became the one new photo slot. |
| 2. Upload correctly slotted real photo | Freelance: multipart `POST /api/assignments/2/assets/upload`, existing real PNG, `sync_batch_id=audit-r7-field-slot-exact`, original filename `shot-1-synthetic-photo-evidence-for-assignment-r.png` | `field_working / draft / raw` -> unchanged | **Pass.** This is the exact computed slot key: `buildAssignmentCaptureSlotKey` lowercases/non-alphanumeric-normalizes `shot-${item_order + 1}-${item_text}` and truncates to 48 (`collector/server/index.mjs:3160-3174`). SQLite confirms current round asset 5 is a local `image/png` whose stored filename starts with that slot. No video or altered MIME was used. |
| 2a. Field submission | Freelance: `POST /api/assignments/2/submissions` with answers for the one verify and one question prompt plus field notes | `field_working / draft / raw` -> `field_review / draft / raw` | **Pass.** HTTP 201 created submission 1 and changed assignment 2 to `submitted`; SQLite confirmed `latest_submission_id=1`. The formerly missing capture gate is satisfied by the correctly slotted actual PNG. |
| 3. Accept field submission | Owner: `PATCH /api/assignments/2/state` with `state=accepted` | `field_review / draft / raw` -> `field_review / draft / raw` | **Pass; deliberately no head move, not a silent no-op.** SQLite confirmed assignment 2 `accepted`, `accepted_submission_id=1`. The place-specific accept code intentionally retains head `field_review` (`collector/server/index.mjs:11229-11235`). |
| 4. Repeat editorial-assignment creation after field review | Owner: `POST /api/items/9/article-editorial-assignments`, `assignee_user_id=10` | `field_review / draft / raw` -> `field_review / draft / raw` | **HTTP 200 silent no-op.** It returned the existing assignment 3 (`assigned`) and did not transition to `writing_assigned`. Same-assignee active-assignment early return is explicit at `collector/server/index.mjs:10548-10555`. Therefore the early, out-of-order creation still prevents the requested route from performing its normal creation/transition now. No duplicate was created. |
| 4a. Editor drafting attempt | Editor local id 10: `POST /api/items/9/article-process/transition`, `status=drafting` | `field_review / draft / raw` -> `field_review / draft / raw` | **No confirmed HTTP result; no retry.** The HTTP client received no response object, so the request was not resent. SQLite immediately afterwards found no head or assignment change. This is not an AI/pipeline operation, so there is no item-specific AI run to recover. Source predicts the route would try to map drafting to place `writing` (`collector/server/index.mjs:4501-4534`), but the place-ladder validator strips an invalid head edge while the caller can still return 200 (`:4258-4276`, `:4211-4255`); `field_review -> writing` is not established by this run. |
| 4b. Editor generic assignment submission | Editor local id 10: `POST /api/assignments/3/submissions` | `field_review / draft / raw` -> unchanged | **Blocked — HTTP 403.** This route expressly rejects the editor with `editor should submit via article/event workspace flow only` (`collector/server/index.mjs:11402-11403`). Assignment 3 stayed `assigned`, with no submission. |
| 4c. Editor article submit-review | Editor local id 10: `POST /api/items/9/article-process/submit-review` | `field_review / draft / raw` -> unchanged | **Blocked — HTTP 403.** The same article workspace requires an editorial assignment already `submitted` or `resubmitted` before the editor may send the article to review (`collector/server/index.mjs:4176-4182`). Thus the stated correct-identity path is circular: the generic submission endpoint rejects editors, and the workspace endpoint requires their prior submission. Draft 1 remains non-empty, so missing body is not the blocker. |
| 5. Review decision -> ready-for-publish -> admin review -> backend approval -> published | Not called | `field_review / draft / raw` -> unchanged | **Not reachable.** No legitimate route in this run advanced the editorial assignment or head to `in_review`; calling later actions would only bypass the unresolved editorial-submission gate. |

### Round 7 conclusion

Curating the live field pack and supplying a correctly slotted genuine photo makes the field path pass: item 9 genuinely reached `field_review`, and owner acceptance correctly leaves that place head there. The subsequent blocker is not media validation or the AI provider. It is the pre-existing, out-of-order editorial assignment: re-creating it is an explicit 200 early-return silent no-op, while the editor cannot create the required assignment submission through the generic endpoint and is refused by article submit-review until that submission already exists. Final canonical state: **item 9 = `field_review / draft / raw`; assignment 2 = `accepted` with submission 1; assignment 3 = `assigned`, no submission.**
