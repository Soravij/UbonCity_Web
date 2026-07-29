# Collector pipeline audit: collector → backend review ingest

Audit date: 2026-07-29.  Scope ends at Collector's `POST ${backendApiBase}/review-content/ingest`; backend code and the database contents were not read.  `audit/role-matrix-survey.md` was read from `codex/role-matrix-survey`; this report does not repeat its role/state matrix.

`ready_for_sync` is an **article-process derived status**, not a stored `content_workflow_models.production_state`: approved publication state or `ready_for_publish` derives to it (`collector/server/index.mjs:4593-4610`).

## A. Raw data ingress

`POST /api/collect` normalizes request input, starts a `source_ingestions` batch, calls the selected adapter, then inserts each returned record and its media before any optional item import (`collector/server/index.mjs:14161-14199`). The raw tables are:

| Table | Columns written by this flow | What remains raw |
|---|---|---|
| `source_ingestions` | `batch_uid`, `adapter`, `source_label`, `status`, `item_count`, `message`, timestamps (`collector/database/schema.sql:214-223`; `collector/db/repository.mjs:4044-4052`) | One batch row, initially `collecting`, later `collected` or `failed` (`collector/server/index.mjs:14178,14256,14271-14276`). |
| `source_raw_items` | `batch_uid`, `source_ref`, `source_url`, `source_type`, `title_raw`, `description_raw`, `payload_json`, `normalized_json`, `status` (`schema.sql:226-238`; insert mapping `repository.mjs:4054-4058,10553-10569`) | Adapter payload and normalized result are stored as separate JSON columns. This flow does not update either row after insertion. |
| `source_raw_media` | `raw_item_id`, `media_url`, `checksum`, `mime_type`, `width`, `height`, `status`, `metadata_json` (`schema.sql:243-255`; `repository.mjs:4060-4063,10472-10484`) | One-or-more raw-media rows are linked only by `raw_item_id`; no `content_item_id` column exists. |

With `auto_import` (default true), the same collected normalized values are copied to a newly created `content_items` row: type/category/lang/title, `description_raw`, empty `description_clean`, image/location/source fields, `payload_json` and tags; its workflow head is `collected/draft` (`collector/server/index.mjs:14201-14237`). This is a copy, not a move: raw rows remain. Manual raw import has the same new-item path (`collector/server/index.mjs:6867-6887`).

Raw media are URLs and metadata, not local `assets`. Local files use `assets(storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)` and item links use `content_assets(content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order, caption)` (`collector/database/schema.sql:119-157`). The raw-import code shown above does not create that link. A source record is linked to an item by `source_records.content_item_id`; its `payload_json` is copied from the raw item (`collector/server/index.mjs:6793-6833`). A merge can update that source-record row by `source_url` and only backfill location/map fields; it does not replace the raw row (`collector/server/index.mjs:6840-6856`).

### Persistence versus replacement observed in the common path

- `content_items` is mutable. `saveItem` updates its row and **deletes every `source_records` row for that item** before reinserting the supplied source (`collector/db/repository.mjs:5286-5311`). Clean and deterministic draft both call it (`collector/services/workflow.mjs:1779-1800,2428-2453`), so those item columns and the current source-record set are overwritten.
- Raw source tables are append-only in the covered collection/import path. No raw-row update/delete was found in that path.
- Draft-input snapshots are new rows (`schema.sql:512-526`; `repository.mjs:11826-11850`). Draft rows are upserted by `(content_item_id, generation_run_uid)` (`schema.sql:542-566`; `repository.mjs:10545-10568`); a normal generation has a new run UID, so it preserves prior run rows, while retry with the same UID overwrites that run's draft.
- Quality checks are deliberately replaced: all checks for the item are deleted then the current checks inserted (`repository.mjs:5699-5704`). Review reports/actions append rows (`schema.sql:571-587,725-735`; `repository.mjs:10586-10600,11238-11244`).
- Agent field-pack generation updates the current field-pack in place when it exists; otherwise creates one (`collector/services/workflow.mjs:2154-2192`). Thus ordinary regenerate overwrites that pack's editable values/children; it does not add a version. The exceptional return-to-clean operation deletes the current pack and its checklists/references/media-hints/assignments (`repository.mjs:10972-11010`).

## B. Actual ordered pipeline

### 1. collect → clean (`collected` → `analyzed`)

- Reads: workflow-head items whose `production_state` is `collected` (`collector/services/workflow.mjs:1772-1776`).
- Writes: `content_items` fields supplied to `saveItem` (including `description_raw` and `description_clean`, both set from the cleaned `item.description`), replaces source records, then workflow head `production_state=analyzed` (`workflow.mjs:1778-1817`; replacement behavior `repository.mjs:5286-5311`).
- Original: the item row's prior raw/clean fields and source-record set are overwritten. `source_raw_*` rows are not touched.
- Gate: selection is only `collected`; route has no per-item validation (`workflow.mjs:1772-1776`; `collector/server/index.mjs:14282-14285`).
- Failure: a workflow-head write failure is caught and only audit-logged; cleaning has already occurred and the loop continues (`workflow.mjs:1801-1817`). Other errors escape the route's `safeAsync` handler.

### 2. analyze → AI draft

- Reads: item workflow state in `analyzed|generated|needs_revision|content_in_progress`, approved clean context, image readiness and clean minimum (`collector/services/workflow.mjs:2194-2255`).
- Writes: always starts pipeline/generation-run records. It creates a draft-input snapshot before generation (`workflow.mjs:2250-2255`; schema `512-540`). With the configured AI engine it saves/updates the current field pack and keeps production state `analyzed` (`workflow.mjs:2384-2417`). The deterministic branch overwrites item fields, saves a draft, adds a `content_versions` row and sets `generated`, pointing `current_draft_id` and `current_field_pack_id` at the latest rows (`workflow.mjs:2418-2491`).
- Original: AI field-pack mode overwrites the current field pack (no version); deterministic mode overwrites item fields but creates a new normal-run draft/version. Snapshot rows are retained.
- Gate: route requires `content_item_id`, item/edit access, then `validateCleanMinimum`; service also rejects a non-candidate state and skips image/context-blocked candidates (`collector/server/index.mjs:14287-14325`; `workflow.mjs:2205-2245`).
- Failure: route retries retryable failures twice, otherwise logs `ai_draft.run.error` and replies 400; no error state is written (`collector/server/index.mjs:14337-14392`). A field-pack workflow sync failure is swallowed after saving the pack (`workflow.mjs:2411-2417`).

### 3. quality (`generated|in_review|needs_revision` → `in_review|needs_revision`)

- Reads: candidate workflow heads and latest draft body/excerpt/suggestions (`collector/services/workflow.mjs:2527-2544`).
- Writes on pass: replaces `quality_checks`, appends review report/action, points `current_review_report_id` to it, sets `in_review`, and replaces internal-link suggestions (`workflow.mjs:2546-2573`). On fail it replaces checks, appends report/action, points at it, and sets `needs_revision` (`workflow.mjs:2575-2599`).
- Original: quality-check and internal-link-suggestion sets are overwritten. Drafts and prior review reports/actions survive.
- Gate: candidate state only; the pass/fail gate is `runQualityChecks` (`workflow.mjs:2527-2544`).
- Failure: no local per-item catch exists here; an exception leaves the pipeline run without the final `done` call. A quality failure is not an exception: it writes `needs_revision` and returns normally.

### 4. Collector review (`in_review` → `ready_for_publish/approved`, or reverse outcome)

- Reads: request `content_item_id/action/notes`, latest review report and workflow head (`collector/services/workflow.mjs:2605-2634`).
- Writes: updates the **same** latest review report status, appends one `review_actions` row, and updates workflow. `approve` writes `ready_for_publish/approved`; `reject` writes `rejected/draft`; `request_changes` writes `needs_revision/draft` (`workflow.mjs:2635-2692`).
- Original: report status is overwritten; old report body, previous action rows and workflow-transition history survive.
- Gate: action must be one of three, latest report must exist; reject/changes cannot repeat their matching state (`workflow.mjs:2610-2626`).
- Failure: throws; route returns 409 for governance/prerequisite errors or 400 otherwise; no state error is written (`collector/server/index.mjs:14401-14409`).

### 5. article process `ready_for_sync` (derived)

- Reads: item, workflow head, publishable assignment source, latest draft and review (`collector/server/index.mjs:4475-4562`).
- Writes: if publishable field-return source is ready, directly sets `ready_for_publish/approved` (`index.mjs:4478-4510`). Otherwise it runs quality and, when needed, calls `applyReviewAction(... action:"approve")`, which writes the quality/review outputs described above (`index.mjs:4513-4562`). No `ready_for_sync` database field is written.
- Original: direct path only overwrites workflow head. Automatic quality may replace quality checks; automatic approval overwrites latest report status and workflow head.
- Gate: article-process transition must be legal; non-direct path requires latest draft, review report for that draft, and no `needs_revision` result (`index.mjs:9468-9519,4513-4559`).
- Failure: throws and route returns 409 for listed transition/quality prerequisites or 400 otherwise (`index.mjs:9515-9518`).

### 6. submit admin review (`ready_for_sync` → `submitted_for_admin_review/approved`)

- Reads: item, export readiness, translation recheck, workflow/process status, canonical handoff source, selected local assets, translations and active/new submission snapshot (`collector/server/index.mjs:13369-13440,5509-5597`).
- Writes before HTTP: `review_submission_snapshots`; same manifest returns the active snapshot as `retry`, a changed manifest supersedes it and inserts a new row (`collector/db/repository.mjs:12014-12039`). On successful backend response it writes an audit row and workflow `submitted_for_admin_review/approved` (`collector/server/index.mjs:13497-13517`).
- Original: snapshot manifests are retained; one active snapshot per item is enforced (`collector/database/schema.sql:1138-1158`). Workflow head is overwritten; payload source data is not.
- Gate: configured backend/public URL/token; item and mutation access; source readiness; editorial or field-flow readiness; translation recheck; derived status exactly `ready_for_sync`; complete title/excerpt/body/meta and selected local cover (`collector/server/index.mjs:13354-13425,5509-5555`).
- Failure: before/at backend ingest, returns without workflow transition (`collector/server/index.mjs:13490-13495,13530-13534`). A snapshot can already exist/supersede before an HTTP failure.

## C. Export boundary: `/review-content/ingest`

The HTTP body is multipart: `payload` JSON, plus one file field per selected local asset and an optional `media_index` describing client UID, field, original name, asset id, role, position and source URL (`collector/server/index.mjs:13455-13482`).

`payload` contains `source_system`, item/submission IDs, manifest hash, source base URL, canonical `content`, qualifying `translations`, and cover/gallery/inline `media_manifest` plus selected count (`collector/server/index.mjs:5614-5635`). `content` is constructed from latest draft first, then item fallbacks: type/lang/category/slug/title/excerpt/body/meta; events add period/location; both add coordinates/map/place id; other-transport values; confirmed CTA/taxonomy only when the latest draft is confirmed; and translation language IDs (`collector/server/review-ingest-mapping.mjs:47-91`). The body has collector media URLs rewritten for the configured public base URL (`collector/server/index.mjs:5521-5526`).

Not sent as top-level payload fields: raw batch/raw-media rows, source records/payload JSON, evidence/approved context, field-pack data, quality-check rows, review report/action history, item `workflow_status`, audit logs, all unselected assets, and non-qualifying translations. This is based on the explicit payload construction above; backend acceptance is out of scope. Recomputed at send time: fallback content values, rewritten inline-media URLs, media manifest, translation eligibility/canonicalization, manifest hash, and multipart `media_index` (`collector/server/index.mjs:5478-5480,5531-5572,5614-5646`).

## D. Backward walk

“Can go back” below means a demonstrated Collector code path, not merely that the transition-rule table permits it (`collector/db/repository.mjs:464-478`).

| State | Path back | Data loss / retained data | Can progress again? |
|---|---|---|---|
| `collected` | ไม่มี | N/A | Yes: clean selects it. |
| `analyzed` | From `rejected` via reopen (`workflow.mjs:2712-2755`); from a current field pack via return-to-clean (`repository.mjs:10972-11047`). | Reopen changes only head. Return-to-clean permanently deletes that current field pack and cascading children; drafts/raw rows remain. | Yes: AI accepts `analyzed` (`workflow.mjs:2200-2213`). Return is blocked by active assignment or publish-ready/published (`repository.mjs:10989-10998`). |
| `generated` | No direct `generated → analyzed` path found. `needs_revision → generated` is permitted and AI can regenerate, but is not a rollback to generated. | N/A | Yes: quality selects it; AI also accepts it. |
| `in_review` | No direct path to prior `generated/analyzed` found. Review changes can set `needs_revision` or `rejected` (`workflow.mjs:2649-2676`). | Quality checks may already have replaced older checks; reports/actions retained. | Yes: quality selects it again; review can decide it. |
| `needs_revision` | No dedicated rollback. AI accepts it and writes a new/updated output; process transition can move to drafting/review path (`workflow.mjs:2200-2213`; `index.mjs:2839-2844`). | No automatic deletion in this transition. A later quality run replaces checks. | Yes, unless its particular clean/image gates block AI. |
| `ready_for_publish` / derived `ready_for_sync` | `request_changes` or backend feedback writes `needs_revision/draft` (`workflow.mjs:2664-2676`; `index.mjs:14467-14497`). | Workflow/report status overwrites only; latest draft/report rows remain. | Yes: run quality/re-approve or transition ready_for_sync again, subject to gates. |
| `submitted_for_admin_review` | Backend feedback endpoint can write `needs_revision` (`index.mjs:14426-14497`). No Collector UI/API path was found to revert it directly otherwise. | Submission snapshot and backend-ingest audit remain; workflow head changes. | Yes: AI accepts `needs_revision`, then normal quality/ready/submit. Active snapshot may be reused for an unchanged manifest or superseded for changed one (`repository.mjs:12024-12034`). |
| `rejected` | `POST /api/review/reopen` writes `analyzed/draft` only from rejected (`workflow.mjs:2712-2755`; route `index.mjs:14411-14419`). | No rows deleted by reopen; current review report remains rejected. | Yes: AI accepts analyzed. |
| `completed` | `completed → needs_revision` is permitted by workflow rules, but no concrete Collector caller in the scoped flow was found. | ไม่แน่ใจ: no demonstrated handler means no demonstrated data mutation. | Not established from a concrete scoped path. |

## E. Forward transitions caused as side effects

- An article-process transition request to `ready_for_sync` automatically runs quality if the latest draft lacks a matching approved report, then automatically invokes review approve with hardcoded `action: "approve"` when needed (`collector/server/index.mjs:9507-9512,4530-4559`). The triggering action is `/article-process/transition`, not `/api/run/quality` or `/api/review/action`.
- The same `ready_for_sync` request directly changes the workflow to `ready_for_publish/approved` when `buildPublishableSourceByItem` reports `ready_for_publish_source` (`collector/server/index.mjs:4475-4510`).
- `POST /api/collect` with default `auto_import=true` creates a `content_items` workflow head at `collected/draft` as a side effect of collection (`collector/server/index.mjs:14161-14165,14201-14237`).
- `POST /api/items/:id/submit-admin-review` writes `submitted_for_admin_review/approved` only after the backend ingest returns success (`collector/server/index.mjs:13476-13517`).

## F. UI reachability (markup/event evidence)

| Action | UI reachability |
|---|---|
| collect | Yes: main app calls `/api/collect` (`collector/server/public/app.js:10740-10742`). |
| clean | API-only in checked-in public source: no caller for `/api/run/clean` found; route is `collector/server/index.mjs:14282-14285`. |
| AI draft | Yes: Item Editor calls `/api/run/ai-draft` (`collector/server/public/item-editor.js:1984-2011`). |
| quality | API-only: no caller for `/api/run/quality` found; route `collector/server/index.mjs:14396-14399`. |
| Collector review approve/reject/request changes | API-only: no caller for `/api/review/action` found; route `collector/server/index.mjs:14401-14409`. |
| reopen rejected review | API-only: no caller for `/api/review/reopen` found; route `collector/server/index.mjs:14411-14419`. |
| return field pack to clean | Yes: markup button `btn-return-to-clean` (`collector/server/public/item-editor.html:353-356`) and click binding/API call (`item-editor.js:4359-4366,5665-5687`). |
| article-process transition, including ready_for_sync | Yes: Article Submit binds `transitionArticle` to the actual transition API (`collector/server/public/article-submit-page.js:988-1002`); this is the caller that can trigger the automatic quality/approve sequence. |
| submit admin review | Yes: Article Submit calls `/submit-admin-review` (`collector/server/public/article-submit-page.js:1283-1298`) and Event Submit also calls it (`collector/server/public/event-submit-page.js:729-733`). |
| backend feedback to `needs_revision` | API-only from Collector's perspective: token endpoint route (`collector/server/index.mjs:14426-14497`); no Collector public-script caller found. |
