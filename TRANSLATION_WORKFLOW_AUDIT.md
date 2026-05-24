# TRANSLATION_WORKFLOW_AUDIT

## Scope inspected
- collector-app lifecycle and publish path:
  - `collector-app/services/workflow.mjs`
  - `collector-app/db/repository.mjs`
  - `collector-app/server/index.mjs`
  - `collector-app/server/public/app.js`
  - `collector-app/server/public/index.html`
- DB and migration layer:
  - `collector-app/database/schema.sql`
  - `collector-app/database/migrations/001_source_ingestion.sql`
  - `collector-app/database/migrations/002_content_lifecycle.sql`
  - `collector-app/database/migrations/003_publish_traceability_columns.sql`
- Reusable AI/translation pieces:
  - `collector-app/config/ai.mjs`
  - `collector-app/ai/provider-openai.mjs`

## Findings
- Publish gate was already strict at source-content level (`publishApproved`) and should remain unchanged.
- Translation flow did not exist in lifecycle path.
- Final export path (`exportStaging`) is the correct pre-frontend stage to trigger translation.
- Repository had publish traceability (`draft_id`, `review_report_id`) and can be reused for translation source binding.
- UI already had lifecycle tabs, so translation status visibility can be added without new review subsystem.

## Risks found before patch
- `schema.sql` has legacy inconsistencies unrelated to this task; avoid broad schema redesign.
- Existing UI expected some endpoints that were not present in `server/index.mjs`.
- Translation must not run in draft/review stages and must not block original publish when translation fails checks.

## Decision
- Extend existing lifecycle minimally:
  - add translation storage + checks
  - run translation only at final export step
  - keep source publish gate unchanged
  - include only auto-check-passed translations in export output
