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
