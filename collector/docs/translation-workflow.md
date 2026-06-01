# Translation Workflow (Final-Stage Only)

## Trigger point
Translations run only in final pre-frontend export:
- `POST /api/run/export`
- implementation in `collector-app/services/workflow.mjs` (`exportStaging` -> `runFinalTranslationStage`)

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
`collector-app/quality/translation-checks.mjs` validates:
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

are included in frontend translation export.

## Export outputs
Final export includes:
- original source output (unchanged)
- `published-articles-translations.json` for passed translations

Failed translations are stored with failure metadata but do not block source output.

## Admin visibility
Read-only status endpoints/UI:
- `GET /api/translations`
- `GET /api/translation-runs`
- table in internal UI: Translation status/check/stale/updated time
