# TRANSLATION_WORKFLOW_PLAN

1. Add DB support for translation lifecycle metadata.
- Create migration with translation tables (`content_translations`, `translation_runs`).
- Append same table definitions to `database/schema.sql` for fresh DB bootstrap.

2. Extend repository safely.
- Ensure translation tables exist at runtime (idempotent create).
- Add CRUD/status methods for translations and translation runs.
- Add stale-marking helpers tied to source fingerprint.

3. Add translation execution + automatic checks.
- Add translation service module with OpenAI reuse when configured; deterministic fallback otherwise.
- Add automatic translation check module for empties/mojibake/placeholders/lang-shape/leakage/length/fingerprint tie.

4. Integrate only at final pre-frontend export.
- Keep draft/review behavior unchanged.
- In `exportStaging`, run translation stage from published source records.
- Save translation rows with source trace (`content/draft/review/published/fingerprint`).
- Export only translations that pass checks and are not stale.

5. Add lightweight admin visibility.
- Add API endpoints for translation status and runs.
- Add translation status table in internal UI.

6. Validate and document.
- Run syntax checks for touched modules.
- Write changelog and short workflow docs.
