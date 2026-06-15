# UbonCity Project Policy

## Product Scope

- UbonCity has four components: `frontend`, `backend`, `admin`, and `collector`.
- `collector` is internal workflow and preparation only.
- `collector` must not be treated as a public asset server.
- `backend` and its public storage are the source of truth for renderable media.
- Review render is the final candidate before approval.
- `admin` is review-only.
- `frontend` is render-only.

## Media And Review Boundaries

- Review, admin, and public pages must not depend on `collector-test` or collector uploads.
- Inline body images, cover, gallery, and thumbnails must be backend-hosted before review rendering.
- Approve/publish promotes reviewed backend assets, not collector-hosted assets.
- Public and review surfaces must consume backend/public URLs for renderable media.

## Workflow Boundaries

- `collector` handles ingest, prep, evidence gathering, and curator-owned workflow data.
- `admin` handles review decisions only.
- `frontend` renders published/backend-controlled data only.
- Do not widen a component's scope to solve another component's bug.
