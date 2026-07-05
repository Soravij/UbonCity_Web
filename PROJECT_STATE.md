# UbonCity Project State

Last Updated: 2026-07-05

## Current Branch

- `main`
- CTA/contact baseline is present on main
- CTA documentation baseline inherited from `1d08fb1`

## Completed Media Workflow

- assignment revision media retention is allowed when the matching reset flag is false
- retained media is accepted by capture and submission readiness
- submitted review videos resolve through source asset `storage_path`
- full deliverable rows are used for review media rendering
- stale `deliverables-bundle` responses are ignored
- runtime smoke passed with retained images, successful assignment submission, review images, review video playback, and reviewer acceptance
- media flow is complete for current pipeline testing
- Media Library duplicate entries remain a separate non-blocking follow-up for CTA / Curation work

## Current Priority

- `CTA & Curation`
- CTA required fields and validation
- taxonomy and curation required fields
- user-return input fields for assigned workers
- AI-filled versus needs-verification state
- readiness gates before review and acceptance
- consistent propagation from assignment return -> field pack -> review -> publishable data

## CTA / Contact Milestone

Status:
- complete and merged into main at `7c044a1`

Verified CTA path:
- Item Editor Generate/Regenerate -> `POST /api/run/ai-draft` -> `runAiDraftStage()` -> `normalizeFieldPack()` -> `buildFieldPackPayloadFromAgent()` -> `saveAgentFieldPack()` -> repository create/update -> `getCurrentFieldPackByItem()` -> CTA Review UI

Runtime verification:
- item `51` `Golden Hour Coffee` showed `ai_cta_contact_json.phone = 0804415224`
- current AI-generated CTA fields persist through the real workflow save path
- deterministic source candidates override conflicting AI contact values
- AI regeneration can clear stale CTA contact suggestions
- deterministic/null path does not erase existing CTA data
- existing issued assignment snapshots remain immutable
- CTA remains place-only
- AI suggestions never auto-confirm CTA/contact

Locked CTA rules:
- CTA/contact is separate from taxonomy.
- Standard CTA checks are place-only and always requested for place items:
  - `phone`
  - `line_url`
  - `facebook_url`
  - `website_url`
  - `primary_cta`
- `requested=true` means a human must verify the item field, including confirming false, absent, or not found.
- AI may suggest values, but AI cannot confirm CTA facts.
- Work Return and human review remain the confirmation source.
- Existing issued assignment snapshots remain immutable.

## Taxonomy / Curation Status

- Assignment-return Curation flow and `requested_check_returns` handling are present on main.
- Taxonomy v1 catalog/resolver, backend curated taxonomy storage/filtering, and Homepage Signals / Content Pool filtering are implemented on feature branches (`feature/taxonomy-v1-catalog`, `feature/taxonomy-phase5a-closure-matrix`, `feature/taxonomy-phase3-backend-storage`, `feature/taxonomy-phase3b-backend-filtering`, `feature/taxonomy-phase4a-content-pool-filtering`, `feature/taxonomy-phase4b-admin-content-pool-filters`).
- The static taxonomy closure matrix is complete as a feature-branch milestone.
- Runtime acceptance across representative fixtures remains pending.
- This documentation does not claim the feature-branch taxonomy work is merged to main.

## Confirmed Direction

- CTA/contact baseline is present on main.
- Taxonomy v1 remains documented as feature-branch work and runtime acceptance is still pending.
- Real taxonomy categories for the current Taxonomy v1 feature-branch category set are:
  - `attractions`
  - `activities`
  - `hotels`
  - `cafes`
  - `restaurants`
  - `transport`
- Taxonomy end-to-end merge remains blocked until runtime acceptance is proven on representative fixtures.

## Policy Reference

- Main project policy: [PROJECT_POLICY.md](./PROJECT_POLICY.md)

## Pending / Update Later

- CTA / Curation follow-up work
- Media Library deduplication
- Runtime acceptance across representative fixtures
- Full role matrix
- Full publish workflow state machine
- Translation policy
- Production deployment policy
- Backup/restore policy
- Automated test coverage policy