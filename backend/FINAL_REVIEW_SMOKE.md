# Final Review Smoke

Script: `backend/scripts/smoke-collector-admin-final-review.mjs`

What it verifies:
- collector import creates pending review rows for place and event
- admin review detail returns the imported snapshot, not stale entity content
- place approve, place reject, event approve, and event reject move rows into the correct review status
- re-import resets approved and rejected rows back to pending and refreshes review detail
- review history records decision and re-import actions
- queue search works by title, source item id, and review id across place and event

Default run:

```bash
npm run smoke:collector-admin-final-review
```

Node test wrapper:

```bash
npm run test:collector-admin-final-review
```

Local spawned backend:

```bash
node scripts/smoke-collector-admin-final-review.mjs --spawn --port=5098
```

Against an already running backend:

```bash
node scripts/smoke-collector-admin-final-review.mjs --external-base-url=http://127.0.0.1:5000/api
```

Write JSON artifact:

```bash
node scripts/smoke-collector-admin-final-review.mjs --report-file=runtime/final-review-smoke.json
```

Required env:
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `JWT_SECRET`
- `JWT_ISSUER`
- `JWT_AUDIENCE_BACKEND`
- `LIFECYCLE_SYNC_TOKEN`
- `BACKEND_FINAL_REVIEW_SMOKE_REPORT_FILE` (optional)

Notes:
- The script creates temporary lifecycle/import review rows and cleans them up at the end.
- The local mode starts a temporary backend process unless `--external-base-url` is provided.
- The node test wrapper reuses the same smoke runner and is suitable for CI-style execution.
- When `--report-file` or `BACKEND_FINAL_REVIEW_SMOKE_REPORT_FILE` is set, the runner writes a JSON artifact for pass/fail reporting.
- Artifact fields include `ok`, `scope`, `base_url`, `used_external_backend`, `started_at`, `finished_at`, `duration_ms`, and either `assertions` or `error`.
