# UbonCity Project State

Last Updated: 2026-06-20

## Current Branch

- `feature/taxonomy-catalog-resolver`
- implementation baseline commit: `372bb50`

## CTA / Contact Milestone

Status:
- complete on the current branch

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

- Taxonomy code currently present on `feature/taxonomy-catalog-resolver` is implementation scaffolding.
- The current scaffold is not the approved final Taxonomy v1 catalog or defaults.
- Final Taxonomy v1 catalog work belongs to the next branch: `feature/taxonomy-v1-catalog`.
- Backend curated taxonomy storage remains pending.
- Homepage Signals / Content Pool taxonomy integration remains pending.

## Confirmed Direction

- CTA/contact milestone closes on this branch through documentation only.
- Taxonomy v1 expands next in a new branch before downstream backend/Homepage integration.
- Real taxonomy categories for the next branch are:
  - `attractions`
  - `activities`
  - `hotels`
  - `cafes`
  - `restaurants`
  - `transport`

## Policy Reference

- Main project policy: [PROJECT_POLICY.md](./PROJECT_POLICY.md)

## Pending / Update Later

- Taxonomy v1 catalog implementation on `feature/taxonomy-v1-catalog`
- Backend curated taxonomy storage/filtering
- Homepage Signals / Content Pool taxonomy integration
- Full role matrix
- Full publish workflow state machine
- Translation policy
- Production deployment policy
- Backup/restore policy
- Automated test coverage policy
