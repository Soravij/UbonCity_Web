# Frontend Project State

Last Updated: 2026-09-02

## Active Branch Context

- Root branch in progress: `feat/nearby-inline-list`

## Current State

- Nearby places list in place detail page now shows 4 vertical cards instead of inline link button; helpers moved to frontend/lib/nearby.js; description in /nearby page clamped to 3 lines.
- No frontend code changes were made in this CTA/Curation Work Return patch.
- Frontend continues to consume published/backend-approved taxonomy only.
- Frontend does not read assignment requested-check drafts or handoff-return payloads.

## Pending

- Future published taxonomy mapping should continue using stable keys only.
- Frontend should not reinterpret historical assignment questions retroactively.
