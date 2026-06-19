# UbonCity Project State

## Current Branch

- `feature/assignment-return-cta-taxonomy-ui`

## Latest Completed Fix

- Assignment Work Return CTA compact list and locked Curation snapshot render behavior.

## 2026-06-19 CTA / Curation Lock

Completed:
- CTA Work Return compact UI completed.
- CTA rows share the approved upload-row visual rules.
- Curation rows support the current shared row pattern with `condition_note`.
- Reserved placeholder keys `taxonomy.category`, `taxonomy.subtype`, and `taxonomy.tags` are hidden from Work Return.
- Curation stays hidden when the handoff snapshot contains no actual resolved taxonomy checks.
- Clean category source is `item.category -> handoffPackage.niche`.
- Tests cover hidden-row draft and payload preservation for legacy keys and `custom.*`.

Pending:
- Taxonomy catalog / defaults resolver is not implemented yet.
- Category mapping is not implemented yet.
- Taxonomy Agent additive check generation is not implemented yet.
- Future resolver must combine defaults + mapping + AI into a resolved handoff snapshot.
- Existing assignment snapshots must remain stable; changes require explicit repair/reissue behavior.
- Next task is taxonomy catalog + resolver/mapping design, not another Work Return UI redesign.

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
- Taxonomy catalog/resolver and mapping implementation
- Translation policy
- Production deployment policy
- Backup/restore policy
- Automated test coverage policy
