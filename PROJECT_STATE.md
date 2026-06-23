# UbonCity Project State

Last Updated: 2026-06-22

## Current Branch

- `feature/taxonomy-phase5a-closure-matrix`
- Draft PR `#25` `Complete CTA and taxonomy pipeline`
- implementation baseline commit: `372bb50`
- CTA documentation baseline inherited from `1d08fb1`

Draft gate:
- PR `#25` must remain Draft
- do not merge until the final taxonomy pipeline is complete and runtime acceptance is proven

## CTA / Contact Milestone

Status:
- complete on milestone branch `feature/taxonomy-catalog-resolver`

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

## Taxonomy Status On This Branch

- CTA milestone branch `feature/taxonomy-catalog-resolver` is complete.
- Current branch inherits the CTA documentation baseline.
- Taxonomy v1 catalog is now implemented on `feature/taxonomy-v1-catalog`.
- Resolver activation semantics are implemented on `feature/taxonomy-v1-catalog`.
- Field Pack Agent catalog-awareness is implemented on `feature/taxonomy-v1-catalog`.
- Backend curated taxonomy storage/filtering is implemented and automated-test verified.
- Homepage Signals / Content Pool taxonomy integration is implemented and automated-test verified.
- The static taxonomy closure matrix is implemented on `feature/taxonomy-phase5a-closure-matrix`.
- Runtime acceptance across representative fixtures remains pending.
- The current taxonomy scaffold is now backed by a static end-to-end closure document.

## Confirmed Direction

- CTA/contact milestone is already closed on `feature/taxonomy-catalog-resolver`.
- Taxonomy v1 now continues on the active branch with runtime acceptance still pending.
- Real taxonomy categories for the current Taxonomy v1 branch are:
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

- Runtime acceptance across representative fixtures
- Full role matrix
- Full publish workflow state machine
- Translation policy
- Production deployment policy
- Backup/restore policy
- Automated test coverage policy
