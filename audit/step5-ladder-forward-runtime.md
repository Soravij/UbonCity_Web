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
