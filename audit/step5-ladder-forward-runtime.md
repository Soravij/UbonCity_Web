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
