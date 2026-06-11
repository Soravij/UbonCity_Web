# UbonCity Project State

## Current Branch

- `fix/clean-media-blocker-placement`

## Latest Completed Fix

- Media blocker placement / Clean media workflow fix.

## Confirmed Working

- Clean media select works.
- Clean set cover works.
- Clean AI Draft / Agent workflow works.
- Publish/Admin Review readiness safety remains expected through local media readiness checks.

## Key Commits

- `8127f98` Relax clean media gate while preserving publish media checks
- `7b9ec8b` Demote clean image readiness to AI draft warning
- Restore clean media selection while keeping publish readiness

## Current Media Decision

- Clean stage media selection/cover is workflow context.
- Publish readiness still requires local usable media.
- Local-only media blocker belongs to late publish/admin-review gates, not early Clean selection.

## Policy Reference

- Main project policy: [PROJECT_POLICY.md](./PROJECT_POLICY.md)

## Pending / Update Later

- Full role matrix
- Full publish workflow state machine
- Taxonomy/revision assignment return flow
- Translation policy
- Production deployment policy
- Backup/restore policy
- Automated test coverage policy
