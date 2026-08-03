# Survey: crawl เพิ่มเข้า item เดิม (read-only)

Scope: source-only audit on `main`. No application code, DB data, commit, or push was changed.

## 1. Crawl starts how, which sources, and which tables it writes

### Fact

The only supplied crawl UI is the Raw/home source panel, not Clean: source selector plus **“ดึงข้อมูลดิบ”** (`btn-source-collect`) in [index.html](../collector/server/public/index.html#L193-L203) and [index.html](../collector/server/public/index.html#L205-L281). The click handler selects an adapter, builds its input payload, and sends `POST /api/collect` with `auto_import: false` ([app.js](../collector/server/public/app.js#L10807-L10844)). It then fetches the batch through `GET /api/source-raw-items?batch_uid=...` and opens the review modal ([app.js](../collector/server/public/app.js#L10860-L10877)).

`POST /api/collect` is owner/admin-only, creates a `source_ingestions` batch, invokes `collectRawFromAdapter`, writes one `source_raw_items` row per result and optional `source_raw_media` rows, then marks the ingestion collected ([index.mjs](../collector/server/index.mjs#L14032-L14155)). The raw insert columns are `batch_uid`, `source_ref`, `source_url`, `source_type`, `title_raw`, `description_raw`, `payload_json`, `normalized_json`, `status`; media has `raw_item_id`, URL/checksum/MIME/dimensions/status/metadata ([repository.mjs](../collector/db/repository.mjs#L3042-L3051), [repository.mjs](../collector/db/repository.mjs#L9353-L9384)).

Source adapters registered at server level are `manual`, `facebook`, `tiktok`, `google_maps`, and `google_search` ([sources/index.mjs](../collector/collector/sources/index.mjs#L1-L26)). Actual Raw UI exposes Google Maps (owner only), manual URL, manual-place input, Facebook URL, and TikTok URL ([index.html](../collector/server/public/index.html#L196-L203), [app.js](../collector/server/public/app.js#L1563-L1599)).

- **Google Maps**: text query; optional location `{lat,lng}`, radius, result limit; calls Google Maps and deduplicates by source reference/URL/title ([app.js](../collector/server/public/app.js#L6188-L6227), [google-maps.mjs](../collector/collector/sources/adapters/google-maps.mjs#L503-L556)). A Google Maps URL entered in the UI is intentionally treated as `manual`, not query search ([app.js](../collector/server/public/app.js#L10811-L10818)).
- **Website / Google Maps URL / Facebook / TikTok URL**: UI converts one URL per line to manual payload rows; the manual adapter enriches each URL with timeout/fallback ([app.js](../collector/server/public/app.js#L1605-L1642), [manual.mjs](../collector/collector/sources/adapters/manual.mjs#L1835-L1860)). Facebook/TikTok selection also maps to `manual` in this UI ([app.js](../collector/server/public/app.js#L10816-L10833)); their registered direct adapters only normalize caller-supplied rows, they do not crawl ([facebook.mjs](../collector/collector/sources/adapters/facebook.mjs#L1-L6), [tiktok.mjs](../collector/collector/sources/adapters/tiktok.mjs#L1-L6)).
- **Google Search**: server adapter exists and requires Custom Search key/engine plus `query`/`queries[]` ([google-search.mjs](../collector/collector/sources/adapters/google-search.mjs#L118-L157)), but it is not a selectable Raw UI option and `normalizeCollectPayload` does not build a Google Search payload ([app.js](../collector/server/public/app.js#L6188-L6227)).
- **manual_place** is data entry, not crawl; it is converted to the manual pipeline ([app.js](../collector/server/public/app.js#L10811-L10828)).

Conclusion: Clean has no crawl entry. Crawl first creates a batch of raw-source records; it does not write into an existing content item at this stage.

## 2. Is “merge into existing item” already in the UI?

### Fact

Yes—on the Raw/home **source-intake modal**, after crawl completes or from a completed ingestion’s **“เปิด review”** button ([app.js](../collector/server/public/app.js#L4888-L4920)). The modal itself is defined in [index.html](../collector/server/public/index.html#L931-L950).

The modal provides a batch-wide destination select with:

- `รับเป็นรายการใหม่ (place เดียว)`;
- `รวมเข้ารายการเดิม (id เดียวทั้งชุด)`;
- an existing-item select shown only in merge mode.

This is rendered directly in [app.js](../collector/server/public/app.js#L5996-L6029). The item options include detected match candidates first, then up to 50 items already in the loaded `state.items` list ([app.js](../collector/server/public/app.js#L5948-L5973)). The default becomes merge only if candidate matching recommends it; the target is preselected only when every suggestion agrees on one item ([app.js](../collector/server/public/app.js#L5976-L5994), [app.js](../collector/server/public/app.js#L6116-L6138)).

On confirmation, UI sends every accepted raw row as `decision: "merge"` and supplies the same `existing_item_id`; it blocks confirmation when merge mode has no target ([app.js](../collector/server/public/app.js#L10901-L10937)). Thus the user does select the target. It is not “new item only.” However, no equivalent UI exists at `clean-item.html`; users must leave/open the Raw source intake surface and select the item there.

## 3. What `POST /api/source-raw-items/import` merge does

### Fact

The endpoint is `POST /api/source-raw-items/import`, `requireRole("admin")`, rate-limited. It requires a batch and decisions, verifies every `raw_item_id` belongs to that batch, and for `merge` requires an existing `existing_item_id` ([index.mjs](../collector/server/index.mjs#L13953-L14029), [index.mjs](../collector/server/index.mjs#L6511-L6559)). It checks neither the target’s workflow state nor claim nor mutation ownership. Therefore: **admin required; no target claim requirement in this endpoint.**

For each merge, it runs inside `BEGIN IMMEDIATE`/commit transaction ([index.mjs](../collector/server/index.mjs#L6710-L6768)) and:

1. writes `source_records`: insert a new record, or update the globally matching `source_url` record to point at the target (`content_item_id`) and replace its type/name/entity/payload ([index.mjs](../collector/server/index.mjs#L6605-L6645));
2. may update `content_items` only to fill a wholly missing latitude/longitude pair and/or missing recognized Google Maps `map_url`; it deliberately does not overwrite populated values ([index.mjs](../collector/server/index.mjs#L1574-L1630));
3. inserts deduplicated `evidence_blocks` from the newly imported normalized source through `seedEvidenceBlocksForItem` ([index.mjs](../collector/server/index.mjs#L6648-L6676));
4. reads reference media count only. This path reports `bridged_image_count: 0`; it does not insert `source_raw_media` again or create content assets ([index.mjs](../collector/server/index.mjs#L6670-L6676)).

It does **not** call `upsertWorkflowModel`, create/update `content_workflow_models`, or alter workflow transitions. Workflow head is untouched in merge mode. It also does not update the source raw row’s status in the import transaction; the code only counts/results it ([index.mjs](../collector/server/index.mjs#L6721-L6764)).

Duplicate behavior has two layers:

- `source_records`: duplicate is keyed by `source_url` globally, so an existing same-URL record is reassigned to the target and its payload fields are overwritten ([index.mjs](../collector/server/index.mjs#L6627-L6639)); this can move provenance from a different item.
- `evidence_blocks`: candidates are deduplicated against existing blocks by a signature before insertion ([index.mjs](../collector/server/index.mjs#L7099-L7147)).

## 4. How Clean sees data after merge

### Fact

Merge immediately calls `seedEvidenceBlocksForItem` using the just-merged raw item’s normalized payload and the target’s current `source_records` ([index.mjs](../collector/server/index.mjs#L6659-L6667)). Separately, every `GET /api/items/:id/evidence-blocks` calls that seeder again and re-reads evidence if it added any rows ([index.mjs](../collector/server/index.mjs#L12622-L12645)). This provides re-seeding from the target’s `source_records`, with candidate derivation that chooses a usable normalized payload from source records or falls back to the item ([index.mjs](../collector/server/index.mjs#L7099-L7147)).

Clean’s loader requests evidence, approved context, and preview together and renders the result ([item-editor.js](../collector/server/public/item-editor.js#L1903-L1922)). It has no push/notification link from the Raw import modal. After an external merge, the user must reload Clean or press **“รีเฟรชตัวอย่าง”**, which executes the same loader ([item-editor.js](../collector/server/public/item-editor.js#L5973-L5983)).

The new evidence is not automatically put into `approved_context`; the user still must select/approve it before it is the primary agent input. Thus the answer is: re-seed is present, but visibility is pull-based and selection is manual.

## 5. What a Clean “crawl เพิ่มเข้า item นี้” button must connect, and blockers

### Required existing flow, in order

1. From `clean-item.html?id=:id`, open/reuse the Raw source-input UI (adapter, query/URLs, label/location). Clean currently has none.
2. Build the same payload and call `POST /api/collect` with `auto_import:false` ([app.js](../collector/server/public/app.js#L10807-L10844)).
3. Use returned `batch_uid` to call `GET /api/source-raw-items?batch_uid=...` ([app.js](../collector/server/public/app.js#L10867-L10876)).
4. Show the source-intake review and force/offer destination `merge` with `existing_item_id` equal to the current Clean item id.
5. Call `POST /api/source-raw-items/import` with `{batch_uid, adapter, decisions:[{raw_item_id, decision:"merge", existing_item_id:id}]}` ([app.js](../collector/server/public/app.js#L10901-L10930)).
6. Run Clean’s `loadEvidenceContextAndPreview()` so new evidence is visible, then let the user approve selected rows ([item-editor.js](../collector/server/public/item-editor.js#L1903-L1922)).

### Constraints / blockers

- Both crawl and import are admin/owner controlled: `/api/collect` allows owner/admin; import allows admin only ([index.mjs](../collector/server/index.mjs#L14032-L14044), [index.mjs](../collector/server/index.mjs#L13953-L13957)). A Clean user role may edit manual evidence but cannot run this crawl/merge path.
- It is deliberately a two-stage batch flow. `POST /api/collect` must finish and produce `batch_uid`; import validates raw IDs against that batch. There is no single endpoint “crawl into item id” ([index.mjs](../collector/server/index.mjs#L13959-L14013)).
- The current design requires Raw review and explicit per-row accept/skip before import; that is where destination merge is selected. Skipping it would be a new policy/API behavior, not a wiring change.
- In the existing UI, the existing-target dropdown is built from loaded dashboard items (max 50 fallback) plus match candidates; a direct Clean implementation should insert the current item explicitly rather than rely on that list ([app.js](../collector/server/public/app.js#L5948-L5973)).
- The target does not need claim for the current import endpoint, but Clean’s normal editing/approval controls do require the current user’s claim. This produces a split permission model.

## Non-implementation options (least work to most)

1. Add a Clean link/button that navigates to the existing Raw source panel with item id communicated as context; user runs crawl, chooses merge, then returns and refreshes. Lowest implementation risk; still preserves the existing review gate. Downside: context handoff and one extra navigation.

2. Add a Clean-only launcher that reuses `/api/collect` and the existing source-intake modal, preselects and locks the current item as merge target, then refreshes Clean. Better user flow and still uses current endpoints/review policy. Downside: shared UI extraction/context handling and admin-only behavior must be explicit.

3. Add a purpose-built server endpoint that crawls, records a batch/audit trail, accepts reviewed decisions (or a separately approved auto-merge policy), merges to the supplied item, and returns refreshed evidence. Most coherent API for Clean, but largest change and highest risk because it must preserve batch review, permissions, duplicate provenance, and partial-failure handling.
