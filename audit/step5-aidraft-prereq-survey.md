# AI-draft prerequisite survey (read-only source review)

Reviewed checkout: `D:\UbonRuntime\repos\UbonCity_Web` at `5a0de7b22a9209ca3e2488d2b6bbe1dbfcfc8f7b`. This survey did not send any mutating HTTP request, modify data, run a migration, or change code/schema.

## 1. Reference / local image

### The actual AI-draft gate

`runAiDraftStage` calls `validateImageWorkflowReady` before it evaluates clean context in `collector/services/workflow.mjs:2229-2237`. The repository's image-workflow calculation is in `collector/db/repository.mjs:10924-10942`:

- It counts selected reference media from `listReferenceMediaByItem(id, { selectedOnly: true })`.
- It also counts selected **local** content assets (`content_assets.selected_in_clean=1`, usable role, `assets.storage_disk` of `local` or `nas`, non-HTTP `storage_path`, and image MIME).
- At `repository.mjs:10941-10942`, AI draft is blocked only when **both** counts are zero: `ต้องเลือกภาพอ้างอิงหรือภาพ local อย่างน้อย 1 ภาพสำหรับ Agent`.

This is deliberately less strict than publish readiness. The later publish gate requires selected local media and one local cover (`repository.mjs:10944-10947`; also `server/index.mjs:7239-7240`).

### Ways an image reaches the gate

| Kind | Source / endpoint | Persistence |
| --- | --- | --- |
| Local uploaded image | `POST /api/assets/upload` at `collector/server/index.mjs:14707`; multipart form with `content_item_id`, `role`, and `file` | Writes a real uploaded file under the Collector media directory, an `assets` row (`storage_disk=local`, relative `storage_path`, MIME/checksum), and a linked `content_assets` row. Schema: `assets` at `database/schema.sql:119-142`, `content_assets` at `144-167`. |
| Existing local asset selection | `PATCH /api/items/:id/assets/:assetId/selected` at `server/index.mjs:13569` and role update at `13599` | Changes `content_assets.selected_in_clean` / role / cover fields. |
| Selected reference image | Candidate list: `GET /api/items/:id/reference-media` at `server/index.mjs:13077`; select: `PATCH /api/items/:id/reference-media/:referenceMediaId/selected` at `13095` with `{"selected":true}` | Candidates are derived in memory from `content_items.image_url`, evidence-media URLs, and raw-source media (`repository.mjs:11124-11285`). Selection alone is persisted in `content_reference_media_selections` (`schema.sql:171-185`) through `setReferenceMediaSelected` (`repository.mjs:11308-11334`). |

### Must a file exist on disk?

For the **AI-draft** image gate, no. A selected reference-media candidate is sufficient; it can be an HTTP(S) image URL and the gate does not check its file existence or fetch it. For the local-asset alternative, the read gate checks only the joined DB metadata described above; it does not call `fs.exists`. However, the supported creation path, `POST /api/assets/upload`, validates an uploaded image's file signature and saves a real file before it inserts its DB rows (`server/index.mjs:14734-14760`).

## 2. Place reference

`hasTraceableReference` in `collector/services/clean-context.mjs:52-59` accepts **any one** of these `content_items` fields:

- non-empty `source_url`
- non-empty `map_url`
- non-empty `google_place_id`
- both `latitude` and `longitude`

This is not a separate reference table requirement. `source_records` (`database/schema.sql:47-63`) preserves source provenance, but the AI clean-minimum check reads the fields on `content_items` listed above. `computeCompleteness` adds `place_reference` to `minimum_missing` at `clean-context.mjs:66-81` when none is present.

### Manual place-create form

Yes, after its raw candidate is accepted/imported. The form requires title, category, latitude, and longitude and emits them in the manual payload (`collector/server/public/app.js:1957-1994`). Those coordinates satisfy the `latitude && longitude` branch of `hasTraceableReference`.

Important routing detail: the UI sends that payload to `POST /api/collect` with `adapter:"manual"` and `auto_import:false` (`app.js:10800-10835`). It therefore first creates a raw candidate; the later normal import/accept operation creates the `content_items` row carrying the coordinates. The form alone does not directly create a content item.

For an existing claimed item, `PUT /api/items/:id` (`server/index.mjs:8936`) is the normal endpoint to set a `map_url`, `google_place_id`, or coordinate pair; no direct DB write is needed.

## 3. Approved context

Approved context resides in `approved_context_blocks` (`collector/database/schema.sql:492-525`) and references an existing `evidence_blocks` row for the same content item.

- Read source evidence first: `GET /api/items/:id/evidence-blocks` (`server/index.mjs:12623`).
- Create/upsert the approval: `POST /api/items/:id/approved-context` (`server/index.mjs:12695`) with the payload below. The route declares `admin`/`user`; the shared role middleware lets `owner` through before checking the declared list (`collector/server/auth-integration.mjs:563-580`).
- The repository validates that `evidence_block_id` belongs to the item, validates `context_type`, and inserts/upserts the active row (`repository.mjs:10641-10724`).
- `buildCleanStructuredContext` reads **only** active rows (`clean-context.mjs:112-114`). A usable row must have non-empty `selected_text`, a non-null `selected_numeric`, or a non-empty selected list (`clean-context.mjs:61-69`). `status` defaults to `active`; `active` is required for the minimum gate. There is no separate `approved` boolean.

## Shortest supported synthetic path to pass an AI-draft gate

The following is the shortest normal-API sequence. It creates no data by direct SQL. `$ITEM_ID`, `$REF_ID`, and `$EVIDENCE_ID` are values returned by the preceding read endpoints, not invented IDs. The image URL is syntactically an image URL; the AI gate accepts it as selected reference media without needing a local file.

```powershell
# Header uses a supplied owner value that already begins with "Bearer ".
$H = @{ Authorization = $ownerBearer }

# 1. Create one synthetic item with a coordinate reference and a synthetic image candidate.
POST /api/collect
{
  "adapter": "manual",
  "source_label": "synthetic-ai-gate",
  "auto_import": true,
  "payload": [{
    "type": "place",
    "category": "attractions",
    "lang": "th",
    "title": "Synthetic AI gate place",
    "description": "Synthetic evidence for an AI-draft prerequisite test.",
    "latitude": 15.244,
    "longitude": 104.847,
    "image": "https://synthetic.invalid/ai-gate.jpg",
    "source_name": "synthetic-ai-gate"
  }]
}

# 2. Locate the returned content item by its unique title, then run the normal clean stage.
POST /api/run/clean
{}

# 3. Claim it so the actor has prep-edit access.
POST /api/items/$ITEM_ID/claim
{ "claim_note": "synthetic ai-gate test" }

# 4. GET /api/items/$ITEM_ID/reference-media; take the candidate whose URL is the .jpg above.
#    Select the exact returned reference_media_id.
PATCH /api/items/$ITEM_ID/reference-media/$REF_ID/selected
{ "selected": true }

# 5. GET /api/items/$ITEM_ID/evidence-blocks; choose an evidence block returned for that item.
POST /api/items/$ITEM_ID/approved-context
{
  "evidence_block_id": $EVIDENCE_ID,
  "context_type": "fact",
  "selected_text": "Synthetic approved fact for AI-draft gate verification.",
  "editor_note": "Synthetic test context",
  "status": "active"
}

# 6. Now the AI-draft prerequisites pass (separate AI-provider availability may still fail later).
POST /api/run/ai-draft
{ "content_item_id": $ITEM_ID }
```

No step in this minimum sequence needs a direct database write. If the goal instead is to satisfy the **later publish** media gate, the reference-image selection is insufficient: upload a real image with multipart `POST /api/assets/upload`, `content_item_id=$ITEM_ID`, `role=cover`, and `file=@<real-image-file>`. That supported endpoint both creates the file and writes the `assets`/`content_assets` records.
