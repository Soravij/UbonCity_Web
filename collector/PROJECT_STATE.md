# PROJECT_STATE

Last Updated: 2026-06-20

## Active Branch

`feature/taxonomy-catalog-resolver`

## CTA / Contact Final Contract

- CTA is separate from taxonomy.
- CTA is place-only.
- The five standard CTA checks are required human verification for place items:
  - `phone`
  - `line_url`
  - `facebook_url`
  - `website_url`
  - `primary_cta`
- `requested=true` means the field worker must answer the check, including confirming false, absent, or not found.
- AI is suggestion-only:
  - AI may populate suggested values.
  - AI cannot confirm the fact.
  - AI cannot replace human verification.
- The immutable handoff snapshot remains the source of what was actually assigned.
- Existing issued assignment snapshots remain immutable.
- `field_return_payload_json.requested_check_returns` remains the canonical Work Return payload.
- `condition_note` remains unchanged.

## Locked Taxonomy Direction

- Real categories for Taxonomy v1:
  - `attractions`
  - `activities`
  - `hotels`
  - `cafes`
  - `restaurants`
  - `transport`
- Coordinates are excluded from taxonomy.
- Map identity/link fields are excluded from taxonomy.
- Google Maps opening hours are excluded from taxonomy.
- CTA fields are excluded from taxonomy.
- Required taxonomy means the worker must answer; it does not mean the value must be true.
- Approved catalog keys may be either:
  - required
  - Agent-triggered
- Unknown/non-catalog observations must go to:
  - `must_ask_question`
  - ordinary handoff guidance
  - Work Return additional notes
- Unknown observations are writer consideration only.
- There is no automatic catalog creation.

## custom.* Policy

- No new custom groups.
- No new `custom.*` keys.
- No new UI creation for custom requested checks.
- No new Agent output routed into `custom.*`.
- No inclusion of `custom.*` in newly created handoff snapshots.
- No canonical taxonomy projection from `custom.*`.
- No Homepage filtering from `custom.*`.
- Preserve legacy custom data at rest.
- Existing issued snapshots containing custom checks remain readable and returnable for compatibility.

## Taxonomy Branch Split

- Current branch closes the CTA/contact milestone and documents the Taxonomy v1 decisions.
- Current taxonomy code on commit `372bb50` is implementation scaffolding only.
- Its current defaults are not the approved final Taxonomy v1 catalog.
- Final catalog implementation belongs to `feature/taxonomy-v1-catalog`.

## Relevant Docs

- Root state: [../PROJECT_STATE.md](../PROJECT_STATE.md)
- Root policy: [../PROJECT_POLICY.md](../PROJECT_POLICY.md)
- Taxonomy v1 scope: [./docs/taxonomy-v1-scope.md](./docs/taxonomy-v1-scope.md)
