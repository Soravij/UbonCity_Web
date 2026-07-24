# Final Review Smoke

Script: `backend/scripts/smoke-collector-admin-final-review.mjs`

What it verifies:

- Collector `POST /api/items/:id/submit-admin-review` creates review-content submissions for place and event fixtures.
- Admin queue list exposes synthetic review-content rows; detail and decisions use `/review-content/:id`.
- Approve/reject transitions, V2 re-ingest history, backend-owned multipart media, and pre/post-approval public visibility.

Before running, start a backend instance yourself. The smoke does not spawn one.

```bash
npm run start
```

Then run the smoke from `backend/`:

```bash
npm run smoke:collector-admin-final-review
```

The script uses `BACKEND_FINAL_REVIEW_SMOKE_BASE_URL` when set, otherwise `BACKEND_PUBLIC_URL`, otherwise `http://127.0.0.1:5000`. It fails before creating fixtures if `${base}/api/health` is unavailable.

Node test wrapper:

```bash
npm run test:collector-admin-final-review
```

Required environment:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `JWT_SECRET`
- `BACKEND_JWT_SECRET` — fallback ของ `JWT_SECRET`; ใช้เมื่อ `JWT_SECRET` ว่าง
- `BACKEND_FINAL_REVIEW_SMOKE_COLLECTOR_PORT` — default `5698`
- `COLLECTOR_PUBLIC_BASE_URL` — default `http://127.0.0.1:${BACKEND_FINAL_REVIEW_SMOKE_COLLECTOR_PORT}`; ต้องเป็นค่าคงที่ตลอด run ห้าม random ต่อรอบ เพราะเป็น input ของ submission hash; ถ้าเปลี่ยน retry จะกลายเป็น revision
- `JWT_ISSUER` — default `uboncity-backend`
- `JWT_AUDIENCE_BACKEND` — default `uboncity-backend`
- backend `COLLECTOR_REVIEW_SYNC_TOKEN` must be configured for Collector-to-backend multipart ingest

The smoke creates a temporary Collector database and Collector process, then cleans its backend fixtures after the run. It does not accept CLI flags, does not spawn a backend, and does not write a report artifact.
