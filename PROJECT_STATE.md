# UbonCity Project State

Last Updated: 2026-07-13

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

### Media Behavior Implementation Notes

Moved from `PROJECT_POLICY.md` §5 ("Current Implemented Media Behavior") — this is implementation
status, not durable policy; the durable rule (no hard block before late-stage gates) lives in
`PROJECT_POLICY.md` §5 Stage-specific Media Blocker Policy.

- Clean reference-media select works.
- Clean no longer sets cover in reference-media flow.
- Clean AI Draft works using reference media and approved context.
- Publish/Admin Review local media readiness remains enforced through `local_selected_count`/`local_cover_count`/`buildExportReadiness`.
- Confirmed in code: early PATCH selected/role routes do not block Clean workflow only because an asset is not local publish-ready (matches the §5 stage-specific rule).
- Confirmed in code: late publish/admin-review readiness still blocks non-local publish media (matches the §5 stage-specific rule).

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
- CTA/contact baseline is present on main.

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

## 2026-07-13 §7A Acceptance Boundary Closure (branch `fix/cta-taxonomy-accepted-source`)

Status:
- implemented on `fix/cta-taxonomy-accepted-source`, not yet merged; runtime verification pending (Codex)

Closed root causes:
- assignment `accepted` transition now maps the accepted submission's `requested_check_returns` into `content_drafts.confirmed_*` (CTA place-only, category from Clean-owned `item.category`) inside a single repository transaction with the state transition — no partial accept state is possible
- accepted provenance is recorded on `content_assignments.accepted_submission_id` / `accepted_handoff_snapshot_id`; the handoff pointer resolves the snapshot in effect at submission time (time-bounded), not a later reissue
- Article Workspace confirmed CTA/taxonomy/status is now read-only summary UI; `PUT /api/items/:id/editor-work` ignores client-supplied `confirmed_*` entirely (server chokepoint in `mergeConfirmedDraftMetadata`)
- workspace evidence hydrates from the accepted submission when an accepted pointer exists (latest submission is only a pre-acceptance preview)
- AI draft regeneration carries accepted `confirmed_*` forward instead of wiping it
- Admin Approvals shows a read-only "CTA / ข้อมูลติดต่อ — ยืนยันจาก collector" block for place rows; the Admin re-ingest payload still omits CTA keys so backend omit-preserve semantics keep stored values
- collector sync sends all five CTA keys (explicit `null` included, which clears stored values) only when the draft is `confirmed_meta_status='confirmed'`; an unconfirmed draft omits them so the backend preserves what it already has

- a rework round is the only way "back" after acceptance: the accepted round is closed as evidence and a new field assignment is issued with its own handoff snapshot (`POST /api/assignments/:id/return-to-field`, password re-auth, limited to the assignment's `assigned_by_user_id` or a higher role within the same management tree — owner is the tree root, admin only within their own subtree, a higher role grants no cross-branch authority). Acceptance patches confirmed values — an unchecked answer keeps what a *previous accepted round* confirmed, never an unverified draft value, so re-verifying one field no longer wipes the rest and nothing self-set by a writer gets laundered into "reviewer-confirmed". Rule written into `PROJECT_POLICY.md` §7A "Rework Round".
- confirmed values are only displayed as reviewer-confirmed when acceptance actually wrote them (`article_process.confirmed_meta_source`), which also makes the stamped taxonomy `category` visible in the workspace

Verified statically end-to-end: accept → `confirmed_cta_contact_json` → review ingest (`buildReviewIngestContentPayload`) → backend `review_contents` storage/preserve → Approvals display.

Deferred (unchanged from plan): backend taxonomy schema for subtype/tags, editorial override flow with provenance, handoff-snapshot immutability guard.

Known open gaps (not fixed in this change set):
- assignments accepted before this change have `accepted_submission_id` NULL on Runtime, so their confirmed summaries render as "not confirmed" and re-accept is a no-op. Needs a backfill decision (data migration) — or they can simply be sent through a rework round.
- accepting an assignment that has no submission at all still succeeds and persists nothing (no route guard requires a submission).
- `collector/scripts/repair-assignment-handoff-snapshot.mjs` remains a dev-only data-repair tool; it is not a workflow "way back" and has no UI.

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
