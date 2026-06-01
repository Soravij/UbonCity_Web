# Content Lifecycle Changelog

## Added
- `collector-app/database/migrations/002_content_lifecycle.sql`
- New lifecycle tables in schema: generation runs, drafts, review reports/actions, internal link suggestions, publish runs, published articles.

## Updated
- `collector-app/db/repository.mjs`: lifecycle repositories for generation/review/publish/internal links.
- `collector-app/ai/generate-content.mjs`: structured draft generation.
- `collector-app/quality/checks.mjs`: scoring-based review checks + backward-compatible output.
- `collector-app/services/workflow.mjs`: full lifecycle orchestration and publish/internal-link handling.
- `collector-app/server/index.mjs`: new REST endpoints for drafts/review/internal-links/publish.
- `collector-app/server/public/index.html` + `app.js`: review queue, internal-link review, publish controls, published list.

## Compatibility
- Existing pipeline script still runs (`npm run build-export`).
- Existing raw import and asset features remain available.
- No automatic publication to public website endpoints.
