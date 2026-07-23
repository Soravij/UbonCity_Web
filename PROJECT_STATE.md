# UbonCity Project State

Last Updated: 2026-07-15

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
- The current branch contains the accepted-source CTA pipeline.
- CTA candidate generation and post-AI fallback were missing before this restoration.
- CTA generation is considered proven end to end only after the focused CTA tests for this restoration pass.

Restored CTA upstream path:
- Item Editor Generate/Regenerate -> `POST /api/run/ai-draft` -> `runAiDraftStage()` -> `normalizeFieldPack()` -> `buildFieldPackPayloadFromAgent()` -> `saveAgentFieldPack()` -> repository create/update -> `getCurrentFieldPackByItem()` -> CTA Review UI
- CTA remains place-only and AI values remain unconfirmed suggestions; human verification is still required.

Locked CTA rules:
- CTA/contact is separate from taxonomy.
- Standard CTA checks are place-only and always requested for place items:
  - `phone`
  - `line_url`
  - `facebook_url`
  - `website_url`
- There is no "primary" CTA (retired 2026-07-15, see "CTA Public Rendering Redesign" below); `primary_cta` is a legacy column, no longer part of the requested-check template.
- `requested=true` means a human must verify the item field, including confirming false, absent, or not found.
- AI may suggest values, but AI cannot confirm CTA facts.
- Work Return and human review remain the confirmation source.
- Existing issued assignment snapshots remain immutable.

## 2026-07-15 CTA Public Rendering Redesign (implemented on `feature/cta-public-rendering-redesign`, Runtime verification pending)

Decided direction (from the item-47 Runtime finding that a confirmed `facebook_url` had no public
rendering path — see audit findings on `frontend/components/PlaceDetailContent.jsx:194`):

- The public CTA block moves to be the last content block on the place detail page (after the
  contact-details block, immediately before the "nearby places" navigation link — that link is
  navigation, not content, so it stays after the CTA block).
- The block always shows every populated contact channel for the place — not a single curated
  "primary" one. Fixed display order, decided once, not configurable per place:
  1. Map (`map_url`)
  2. Phone (`phone`)
  3. LINE (`line_url`)
  4. Facebook (`facebook_url`)
  5. Website (`website_url`)
  Rationale: directions first (highest immediate intent), then the two most common direct-contact
  channels for a Thai consumer audience, then lower-intent social/reference links last.
- `primary_cta` is retired as a concept — nothing in the redesigned block singles one channel out,
  so there is nothing left for it to select. This is a change to the "Locked CTA rules" list above
  (§7A "Standard CTA checks for place") and to `PROJECT_POLICY.md` §7A, which must be edited in the
  same change (EN+TH together, per §11) once this ships, not before.

Implemented:
- Frontend (`frontend/components/PlaceDetailContent.jsx`): `ctaRows` now includes all 5 channels in
  the order above (block position was already last-before-nearby-link, no move needed); the click
  payload no longer sends `metadata_json.primary_cta`.
- Backend: `backend/migrations/016_cta_analytics_facebook_website_click.sql` adds `FACEBOOK_CLICK` /
  `WEBSITE_CLICK` to `analytics_events.event_type`; `analyticsController.js` (`ALLOWED_EVENT_TYPES` and
  every hardcoded `event_type IN (...)` list, plus `by_type`/top-entities breakdowns) accepts and
  surfaces both new types. `places.primary_cta` / `review_contents.primary_cta` left as inert legacy
  columns (not backfilled, not dropped).
- Collector: `primary_cta` removed from `REQUESTED_CHECK_GROUP_TEMPLATES` (`item-editor.js`) and from
  `cta-contact-normalizer.mjs` (`CTA_KEYS`, `getValidCtaSuggestedValue`) — no longer asked or
  AI-suggested. Existing `confirmed_cta_contact_json.primary_cta` values from past accepted rounds are
  untouched (separate storage, not the requested-check template). Updated the collector behavior tests
  that asserted the old 5-key template/labels (`requested-check-ui.behavior.test.mjs`); full collector
  suite re-run after the change matches the pre-change baseline exactly (same single pre-existing
  unrelated failure, zero new failures).
- Policy: `PROJECT_POLICY.md` §7A "Standard CTA checks for place" updated to drop `primary_cta`,
  bilingual, plus a new line stating there is no "primary" CTA.

Pending:
- Migration 016 has not been run anywhere (no DB connection on the dev machine) — needs to be applied
  on Runtime, then a real place with all 5 fields populated needs a manual click-through smoke test per
  root `PROJECT_POLICY.md` §10.

## 2026-07-13 §7A Acceptance Boundary Closure (branch `fix/cta-taxonomy-accepted-source`)

Status:
- merged to `main` (confirmed present in `main` history as of `e38c572`); Runtime DB verification for the checklist below is still pending (Codex) — merged-to-main and runtime-verified are separate facts, do not conflate them

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

Verified statically end-to-end: accept → `confirmed_cta_contact_json` → review ingest (`buildReviewIngestContentPayload`) → backend `review_contents` storage/preserve → Approvals display. Correction (2026-07-23): the review-content re-ingest SELECT omitted the CTA columns, so that omit-preserve step was dead code from 2026-06-11 until the Phase 5 B0 identity fix; do not treat the earlier static verification as proof that preservation worked in production.

Deferred (unchanged from plan): backend taxonomy schema for subtype/tags, editorial override flow with provenance, handoff-snapshot immutability guard.

Known open gaps (not fixed in this change set):
- assignments accepted before this change have `accepted_submission_id` NULL on Runtime, so their confirmed summaries render as "not confirmed" and re-accept is a no-op. Needs a backfill decision (data migration) — or they can simply be sent through a rework round.
- accepting an assignment that has no submission at all still succeeds and persists nothing (no route guard requires a submission).
- `collector/scripts/repair-assignment-handoff-snapshot.mjs` remains a dev-only data-repair tool; it is not a workflow "way back" and has no UI.

## Taxonomy / Curation Status

- Assignment-return Curation flow and `requested_check_returns` handling are present on main.
- The taxonomy catalog/resolver (`collector/server/taxonomy-catalog.mjs`, `collector/server/taxonomy-resolver.mjs`) is merged to `main` (commit `6bcb1cd` "Restore taxonomy resolver workflow", ported from `fix/taxonomy-work-return-catalog-checks`) — a cafes/attractions/etc. Work Return now gets real resolved taxonomy checks instead of an empty Curation section. See `collector/PROJECT_STATE.md` 2026-07-14 "Taxonomy Resolver Restoration" for the detailed restore notes.
- Backend curated taxonomy storage/filtering, and Homepage Signals / Content Pool filtering, remain feature-branch-only work (`feature/taxonomy-phase5a-closure-matrix`, `feature/taxonomy-phase3-backend-storage`, `feature/taxonomy-phase3b-backend-filtering`, `feature/taxonomy-phase4a-content-pool-filtering`, `feature/taxonomy-phase4b-admin-content-pool-filters`) — do not assume these are on `main`.
- 2026-07-16: `feature/curation-taxonomy-true-filters` adds internal Homepage Curation Content Pool filtering over canonical `review_contents.review_payload_json.confirmed_taxonomy_checks` only. It exposes boolean-compatible catalog entries, accepts `taxonomy_true` with AND semantics, and keeps manual block selection/layout publishing unchanged. It does not add taxonomy storage to `places` or support false/unknown filtering.
- 2026-07-16: the taxonomy catalog definitions now live in the neutral shared module `shared/taxonomy/taxonomy-catalog.mjs`. Both `collector` and `backend` import from it, so backend never imports from the collector tree; `collector/server/taxonomy-catalog.mjs` remains as a re-export shim and every existing collector import path/API is unchanged. Backend requires this shared directory to be present at runtime, and filter-key validation reads the same shared catalog.
- The static taxonomy closure matrix is complete as a feature-branch milestone (separate from the catalog/resolver restoration above).
- Runtime acceptance across representative fixtures remains pending for both the merged catalog/resolver and the still-unmerged backend/Homepage-Signals filtering work.

## Confirmed Direction

- CTA/contact baseline is present on main.
- Taxonomy v1's catalog/resolver (worker-facing Curation checks) is merged to main; backend curated storage/filtering and Homepage Signals / Content Pool integration remain feature-branch work with runtime acceptance still pending.
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

- 2026-07-23: Step A extracted `/collector-import-reviews*` routes into `backend/routes/importReviewRoutes.js` and handlers into `backend/controllers/importReviewController.js`; paths remain unchanged. Lifecycle import remains active and final-review smoke continues to exercise `/lifecycle/import-published` until Step B removes that endpoint.
- 2026-07-23: Extracted lifecycle readiness state into the leaf `backend/controllers/lifecycleInfra.js`. Queue/detail/reject then received separate collector-import-review readiness in leaf `backend/controllers/importReviewInfra.js`: only successful `ensureCollectorImportReviewTables()` marks that infrastructure ready, so those handlers return 503 until its own tables are ready rather than inheriting lifecycle readiness.
- 2026-07-23: MySQL migrations are not a fresh/rerunnable schema source: 001 uses `ADD COLUMN IF NOT EXISTS`, unsupported by Runtime MySQL 8.0.46; 006/007/011/015/016 are not rerunnable; and no migration runner/ledger exists. Runtime bootstrap remains the schema source of truth pending a separate post-Phase-5 migration-system repair. `lifecycle_content_map` also has a `purgeContentService.js` consumer and must be handled before its physical drop in Step C.
- 2026-07-23: Runtime tooling debt — `npm run test:phase56` passes `--test-isolation=none`, unsupported by Runtime Node v22.22.2; use `node --test tests/place.phase56.backend.test.mjs` without that option. Runtime `BACKEND_PUBLIC_URL` (`https://api-test.uboncity.com`) also differs from the fixture expectation (`https://api.test.local`), so the self-hosted-media absolute-URL subtest fails. Both reproduce on main and are tooling/environment debt, not application-code regressions.
- 2026-07-23: Browser revision-loop smoke (`collector/tmp-runtime-article-revision-loop-smoke`) times out at 180s before `submit-admin-review`: after timeout `content_assignment_submissions=0` and `review_submission_snapshots=0`. The identical timeout reproduces on main, so this is not a regression from `636b0c6`. The smoke leaves no screenshot, trace, or step log for debugging; repair it separately.
- 2026-07-23: Timed-out smoke can leave a backend Node process holding `collector.db` and headless Edge holding its browser profile. Harnesses need reliable process/browser cleanup; this was observed during the revision-loop smoke investigation.
- 2026-07-23: CTA data-repair debt — review-content re-ingest could NULL CTA/contact fields from 2026-06-11 through 2026-07-23 because its existing-row SELECT omitted the fields required by omit-preserve semantics. Repair requires comparing affected public rows with the latest confirmed CTA values from Collector; do not infer values from unconfirmed drafts.

- CTA public rendering redesign (all 5 channels, fixed order, drop `primary_cta`) — see 2026-07-15 section above
- CTA / Curation follow-up work
- Media Library deduplication
- Runtime acceptance across representative fixtures
- Full role matrix
- Full publish workflow state machine
- Translation policy
- Production deployment policy
- Backup/restore policy
- Automated test coverage policy
