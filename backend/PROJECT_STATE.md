# Backend Project State

Last Updated: 2026-06-19

## Active Branch Context

- Root branch in progress: `feature/assignment-return-cta-taxonomy-ui`

## Current State

- No backend code changes were made in the current CTA/Curation Work Return patch.
- Backend remains downstream of collector handoff snapshots for assignment question flow.
- Backend should continue treating resolved taxonomy data as stable keyed data, not a live checklist generator.

## Database Bootstrap Precondition

- On a blank MySQL database, apply `backend/migrations/000_baseline_schema.sql` before running `npm start`. Runtime bootstraps create or extend supporting tables, but assume the baseline `users`, `categories`, and `places` tables already exist.

## Pending

- Future publication mapping must preserve stable taxonomy keys.
- Backend must not become a second source of truth for issued assignment checklist resolution.
