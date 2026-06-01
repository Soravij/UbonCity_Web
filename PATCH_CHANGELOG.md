# PATCH_CHANGELOG

## What was fixed
- Fixed mojibake/broken text in content generation template labels in `collector-app/ai/generate-content.mjs`.
- Repaired content lifecycle migration file `collector-app/database/migrations/002_content_lifecycle.sql` to remove invalid foreign keys and keep only valid lifecycle table relations.
- Added publish traceability columns migration in `collector-app/database/migrations/003_publish_traceability_columns.sql` (`draft_id`, `review_report_id` on `published_articles`).
- Patched repository lifecycle persistence in `collector-app/db/repository.mjs`:
  - added safe runtime column ensure for legacy DBs (`ensureLifecycleColumns`).
  - added `latestApprovedReviewByItem(...)` query/helper.
  - fixed `savePublishedArticle(...)` to persist `draft_id` and `review_report_id`.
- Added hard publish gate in `collector-app/services/workflow.mjs`:
  - block publish when latest draft is missing.
  - block publish when latest quality/review report is missing.
  - block publish when no approved review exists.
  - block publish when approved review is stale vs latest review.
  - block publish when approved review draft_id is not the latest draft.
  - log all skip reasons into audit logs.
- Strengthened internal-link guardrails in `collector-app/services/workflow.mjs`:
  - no self-link by slug.
  - no duplicate target slug in the same article suggestions.
  - max links per article (5).
  - anchor variation with de-duplication.
  - suggestion-first behavior preserved.
- Improved review traceability:
  - publication now records exact `draft_id` + `review_report_id` used at publish time.
  - review queue already includes reviewed draft metadata and remains compatible.

## Why it was fixed
- Prevented accidental publishing from stale/partially reviewed drafts.
- Increased auditability for lifecycle decisions (review -> publish linkage).
- Reduced internal-link spam/duplication risk while keeping suggestions useful.
- Eliminated broken display text caused by encoding/mojibake artifacts.

## Compatibility notes
- Changes are backward-compatible for existing DBs by runtime column checks and migration 003.
- Existing deterministic/AI draft generation flow remains unchanged.
- Existing review and publish APIs keep behavior shape; publish now enforces stricter gates.

## Remaining limitations
- Legacy `schema.sql` still contains unrelated historical inconsistencies outside this scoped patch and should be cleaned in a dedicated schema-hardening pass.
- Internal-link balancing across *all* articles globally is still heuristic and local to per-article suggestion generation.
- `checks.mjs` still detects `????` as a low-quality signal by regex; this is intentional for quality scoring.
