# Backend Project Policy

- Backend owns review, public, and published media storage.
- Review ingest must not persist collector-hosted render URLs.
- `body_html` inline images must be mirrored and rewritten to backend/public URLs before review render.
- Approval promotes reviewed backend assets.
- Backend is the source of truth for renderable media URLs used by review and public surfaces.
