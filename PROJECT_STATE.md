# UbonCity Project State

Last Updated: 2026-06-20

## Current Branch

- `feature/taxonomy-v1-catalog`
- implementation baseline commit: `372bb50`
- CTA documentation baseline inherited from `1d08fb1`

## CTA / Contact Milestone

Status:
- complete on milestone branch `feature/taxonomy-catalog-resolver`

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
- Backend curated taxonomy storage remains pending.
- Homepage Signals / Content Pool taxonomy integration remains pending.

## Confirmed Direction

- CTA/contact milestone is already closed on `feature/taxonomy-catalog-resolver`.
- Taxonomy v1 now continues on the active branch before downstream backend/Homepage integration.
- Real taxonomy categories for the current Taxonomy v1 branch are:
  - `attractions`
  - `activities`
  - `hotels`
  - `cafes`
  - `restaurants`
  - `transport`

## Policy Reference

- Main project policy: [PROJECT_POLICY.md](./PROJECT_POLICY.md)

## Pending / Update Later

- Backend curated taxonomy storage/filtering
- Homepage Signals / Content Pool taxonomy integration
- Full role matrix
- Full publish workflow state machine
- Translation policy
- Production deployment policy
- Backup/restore policy
- Automated test coverage policy
