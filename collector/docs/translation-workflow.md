# Translation Workflow

## Trigger point
Translations are generated per content item, on demand — not as part of a batch export:
- `POST /api/items/:id/generate-translations` — (re)generates translations for an item
  (implementation: `rerunProblemTranslations` in `collector/services/workflow.mjs`)
- `POST /api/items/:id/translations/:lang/recheck` — reruns the automatic check for one language
  (`rerunTranslationRecheck` in `collector/services/workflow.mjs`)
- `POST /api/items/:id/translations/:lang/repair` — repairs and rechecks a translation from recheck issues
  (`repairAndRecheckTranslationFromIssues` in `collector/services/workflow.mjs`)

The old batch routes (`POST /api/run/export`, `/api/run/publish`, `/api/run/approve`, `/api/run/stage`,
`/api/run/sync-backend`) are disabled and return `410` via `respondBatchReleaseDisabled`
(`collector/server/index.mjs:14494-14596`). They do **not** run translation.

Translations are **not** generated in:
- draft stage
- review stage

## Source binding
Each translation row stores source linkage:
- `source_content_item_id`
- `source_published_article_id`
- `source_draft_id`
- `source_review_report_id`
- `source_fingerprint` (`content_item_id:draft_id:review_report_id`)

If source fingerprint changes, previous translations are marked stale.

## Automatic checks
`collector/quality/translation-checks.mjs` validates:
- required translated fields
- mojibake/broken chars
- unresolved placeholders
- language-shape sanity by target lang
- source-language leakage threshold
- title/meta/body length sanity
- source fingerprint tie to latest source

Only translations with:
- `translation_status = ready`
- `automatic_check_status = passed`
- `stale_flag = 0`

are eligible to be included when an item is submitted for admin review.

## Submission gate
`POST /api/items/:id/submit-admin-review` blocks submission if any required target language has not
passed translation recheck (`getRequiredTranslationRecheckBlockers`, `collector/server/index.mjs:13373-13382`).
On success, translations that pass the recheck gate are bundled into the review handoff payload and sent
to the backend via `POST ${backendApiBase}/review-content/ingest` (`collector/server/index.mjs:13334`
onward). There is no standalone batch export file — translations travel with the item's admin-review
submission, not through a separate export step.

Failed translations are stored with failure metadata but do not block submission of the source content
itself (only the translation for that language is withheld).

## Admin visibility
Read-only status endpoints/UI:
- `GET /api/translations`
- `GET /api/translation-runs`
- table in internal UI: Translation status/check/stale/updated time
