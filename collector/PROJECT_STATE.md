# PROJECT_STATE

Last Updated: 2026-07-14

## Active Branch

`main`

Current mainline status:
- merged at `7c044a1`
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

## 2026-07-14 Taxonomy Resolver Restoration (branch `fix/restore-taxonomy-resolver`)

Status: taxonomy Curation checks now reach the field worker. Before this branch nothing on this line
produced a single taxonomy check: `taxonomy-catalog.mjs` and `taxonomy-resolver.mjs` did not exist,
`REQUESTED_CHECK_GROUP_TEMPLATES` held only `cta_contact`, `agent-generation.mjs` had zero taxonomy
references, and `ai_taxonomy_json` was never populated — so the Work Return Curation section always
rendered empty, exactly like the CTA gap the previous branch fixed.

What was restored, and how it differs from the sibling stack:
- `collector/server/taxonomy-catalog.mjs` — ported as-is from `fix/taxonomy-work-return-catalog-checks`.
  Pure contract data: the 6 §7A categories, their required and agent-triggered keys, answer types,
  allowed values, unit options, Thai labels. No DB table; the catalog is code.
- `collector/server/taxonomy-resolver.mjs` — **rewritten, not ported.** The sibling's resolver also owned
  the CTA template checks and imported `cta-contact-normalizer.mjs`; adopting it would have given CTA two
  owners and torn out the pipeline restored last week. This one resolves taxonomy only and leaves CTA
  alone.

Where resolution happens:
- `buildRequestedChecksHandoffPayload` (repository) resolves the taxonomy group from the catalog against
  the item's category **at handoff-build time**, then freezes it into the snapshot. Stored
  `requested_checks_json` only carries the curator's per-key requested/rejected decision; labels, answer
  types, allowed values and applicability are the catalog's, so a category change or a catalog fix flows
  into the next handoff instead of being frozen into a field pack forever. Issued snapshots stay stable.
- The client-side Item Editor was deliberately **not** touched. Its autosave rebuilds
  `requested_checks_json` from `REQUESTED_CHECK_GROUP_TEMPLATES`, so putting the taxonomy group there
  would have had the editor delete it on every save.
- Because the resolver reads suggestions from `ai_taxonomy_json` directly, taxonomy needs no equivalent
  of the CTA `syncCtaSuggestionsIntoRequestedChecks` step for `suggested_value`/`source` — those two
  fields are recomputed from this run's `aiTaxonomy` every time, so a stale suggestion cannot survive a
  regenerate by construction. The `requested` flag is a separate field with its own rule (see
  `resolveRequestedFlag`): it re-checks against this run's suggestion only when the saved flag was itself
  AI-attributed (`source.kind === "ai"`); a curator's own activation stays sticky either way.

Suggestion lifecycle (same §7A contract as CTA):
- `ai_taxonomy_json` gained `suggested_checks: [{ taxonomy_key, suggested_value, condition_note }]`.
- `normalizeAiTaxonomySuggestions` drops anything the catalog does not permit for that item: unknown
  keys, keys from another category, reserved keys, and values that violate the key's answer contract.
- An AI run replaces the stored suggestions wholesale; a deterministic/failed run keeps them.
- A suggestion prefills a check. It never pre-ticks one.
- Required category defaults are always asked (marked `required`/`requested: true`). Every
  agent-triggered key applicable to the item's category is also sent to the worker regardless of
  activation, so they can select one on-site that nobody suggested in advance — `requested`/`required`/
  `source` are display-priority metadata, not a gate on reaching the worker at all. A curator's past
  rejection no longer excludes a key; it only means the key carries no AI/required signal to prioritize.
- Catalog keys the curator hand-wrote are re-resolved to the catalog's schema. Keys the catalog does not
  know are preserved untouched — §7A forbids deleting legacy stored data, and the "no legacy rows in new
  snapshots" rule is scoped to the `custom` group, not to taxonomy.

Work Return answer model for a yes/no Curation check — **the tick is the answer**:
- One line per question, like a CTA row: `[✓] มีแอร์  [เฉพาะในร้าน____]`. There is no ใช่/ไม่ใช่ dropdown;
  a dropdown next to a checkbox would ask the same thing twice and cost the row its single line.
- Ticked = ใช่/มี. Not ticked = ไม่มี, verified — the worker went and looked. (Accepted tradeoff: a check
  the worker simply skipped is recorded the same way as one they verified absent, exactly as CTA already
  behaves.)
- The input next to the tick is **not** the answer, it is the qualifier on that answer: it says whether
  the "yes" is a whole yes. "มีแอร์ (เฉพาะในร้าน)". An empty one just means a plain ใช่.
- So on a yes/no check `found = checked`, full stop. The old rule went looking for a value the way CTA
  does, which would have read a plain ticked "มีห้องน้ำ" as ไม่พบ. `hasMeaningfulValue` itself is
  untouched — the CTA lane genuinely does mean "empty = verified none".
- `boolean` / `boolean_with_conditions` values are therefore text, not booleans (a real boolean on an
  older row is still accepted and read).
- An AI `suggested_value: true` prefills nothing (there is no value box to fill) but still shows the
  "AI แนะนำ" badge; its `condition_note` is what prefills the qualifier. An AI `false` with no note is
  dropped entirely — an unticked row already says ไม่มี, so it would badge a row that shows nothing.
- Article Workspace prints ไม่มี for `found === false` on a Curation row, and ใช่ for a ticked row with
  no qualifier — not "ไม่พบ".
- `select` / `number_with_unit` / `multi_select` Curation rows are unchanged: there the value IS the
  answer, so they keep their own value input plus a separate optional `condition_note`.

Bugs fixed on the way:
- `mergeAiCtaWithDeterministicCandidates` threw a TypeError when handed an explicit `null` structured
  context (its `= {}` default only covers `undefined`, and `normalizeFieldPack` passes `null`). A place
  item with no structured context has no deterministic candidates, not a crash.
- **The client never sent `answer_type`.** `buildAssignmentRequestedCheckReturnPayloadFromDraft`
  (`app.js`) only ever emitted `checked`/`value`/`condition_note`/`evidence`/`note`. Before the tick-is-
  the-answer redesign this didn't matter for yes/no checks — a real JS `true`/`false` was itself the type
  signal `inferRequestedCheckAnswerTypeFromReturnRow` (`repository.mjs`) relied on when `answer_type` was
  absent. Once a yes/no check's value became a qualifier *string*, that signal was gone: a plain ticked
  check with no qualifier text submitted `{checked: true, value: ""}`, inferred as `answer_type: "text"`,
  normalized to `null`, and computed `found: false` — a human's plain "ใช่" silently reading as
  "not found," the exact bug class the whole redesign existed to eliminate. No automated test caught this
  because every test (old and new) called the repository directly with `answer_type` hand-included in the
  payload; nothing simulated what the real client actually sends. Fixed by forwarding
  `answer_type: row.answer_type` in the payload builder — one line, confirmed by piping the real client
  function into the real server-side normalizer in a new test.
- **That fix's own side effect: CTA URL checks got real validation for the first time.** Forwarding
  `answer_type` for every row, not just boolean ones, meant `line_url`/`facebook_url`/`website_url` now
  arrive as `answer_type: "url"` instead of inferred `"text"` — and `normalizeOptionalUrlValue` /
  `normalizeHttpUrl` throw on anything without a `http(s)://` scheme. A worker typing `facebook.com/mypage`
  (no scheme — very plausible field input) would have that answer silently discarded, `found: false`,
  indistinguishable from "verified: no link." Fixed with `withAssumedUrlScheme()` in `app.js`, applied at
  the point a `url`-type value is read from the form into draft state: prepends `https://` when the typed
  text has no scheme, so the corrected value round-trips into both the draft (visible on next render) and
  the submitted payload. Confirmed with a mocked-DOM test through the real read function into the real
  server normalizer.

Not done — `confirmed_taxonomy_json` was deliberately left alone. It holds only the reserved Clean-owned
keys (`category`/`subtype`/`tags`). Non-reserved Curation answers live in the accepted Work Return
evidence and are already surfaced from there (`article-workspace-page.js`, `acceptedFieldReturnEvidenceByGroup("taxonomy")`).
Extending that column would have been a data-shape change with no consumer asking for it.

Tests:
- new `collector/tests/taxonomy-upstream.behavior.test.mjs` (16 cases: catalog applicability, AI key/schema
  containment, prompt catalog, required vs agent-triggered activation, curator rejection, qualifier
  prefill without pre-tick, AI-"no" is not a suggestion, stale-suggestion clearing, no-AI preservation,
  legacy row preservation, catalog-owns-schema)
- new repository case: a ticked yes/no check reports `found: true` with or without a qualifier, an
  unticked one reports `found: false` (= ไม่มี), and an empty CTA field still reports `found: false`
- 4 existing `field-pack.repository` cases updated: they asserted the *absence* of the taxonomy group
- two new **client-to-server wiring** cases in `requested-check-return-form.behavior.test.mjs`, each
  piping the real client `buildAssignmentRequestedCheckReturnPayloadFromDraft` (one also through
  `readAssignmentRequestedCheckReturnDraftFromForm` against a mocked DOM row) straight into the real
  server-side `normalizeRequestedCheckReturns` — the exact seam the two bugs above slipped through,
  since client and server had only ever been tested in isolation before:
  - a yes/no check ticked with no qualifier reports `found: true`, not `found: false`
  - a CTA url typed without a scheme (`facebook.com/mypage`) reports `found: true` with `https://` added
- full collector suite compared against the branch-point baseline: identical failing set (80), zero new
  failures, zero newly-passing

Needs Runtime verification (per agent.md's Main/Runtime split — none of this was run against a live DB
or a real browser form/HTTP round-trip, only the equivalent function calls):
- a cafes place → handoff → Work Return shows the Curation section with the 8 required cafes defaults,
  each one line: checkbox + qualifier input
- AI suggests `specialty_coffee` → the check is asked, badged "AI แนะนำ", and **unticked**
- remove the supporting context → regenerate → the suggestion disappears from the next handoff
- worker ticks `air_conditioning`, types nothing → accept → Article Workspace shows "ใช่", not "ไม่มี"
  (the plain-tick path — this was the actual bug; the qualifier path below happens to work by accident)
- worker ticks `air_conditioning` and types "เฉพาะในร้าน" → accept → Article Workspace shows
  "มีแอร์ — เฉพาะในร้าน"; worker leaves `parking` unticked → shows "ไม่มี", not "ไม่พบ"
- worker types `facebook.com/mypage` (no `https://`) into a CTA URL check and ticks it → accept →
  confirmed value is `https://facebook.com/mypage`, not dropped
- a non-place item with a legacy hand-written taxonomy row still gets that row in its handoff

## 2026-07-14 CTA Upstream Restoration (branch `fix/restore-cta-upstream`)

Status:
- implemented, focused + full collector suite green locally; runtime verification pending (Codex)

Why: the accepted-source pipeline (below) consumed CTA answers correctly, but nothing ever *produced*
CTA suggestions on this branch — `ai_cta_contact_json` was always `{}`, so field packs shipped with an
empty CTA block even when the approved context plainly held a phone and a Facebook page.

Restored, place-only, suggestion-only:
- `collector/server/cta-contact-normalizer.mjs`: deterministic candidate extraction from **approved
  context only** (never `evidence_blocks`), Thai phone normalization, URL classification into
  `facebook_url` / `line_url` / `website_url`, and rejection of map/CDN/provenance URLs as websites.
- `buildPromptInput()` passes `cta_contact_candidates` to the agent; both the initial and revision
  prompts request `ai_cta_contact_json` and state that CTA values are unconfirmed suggestions.
- Server-side fallback after the AI answers: deterministic candidates override conflicting AI values,
  so a phone the AI drops is still recovered from the approved context.
- `source` provenance on a suggestion always comes from the approved rows that produced it. AI-supplied
  `source` is discarded — the AI does not get to vouch for its own evidence.

CTA suggestion lifecycle (see `PROJECT_POLICY.md` §7A "CTA/Taxonomy Suggestion Lifecycle"):
- Suggestions are a snapshot of one AI run, not an accumulator. A regenerate rebuilds them, so a value
  the approved context no longer supports **disappears**. This matters because the Work Return form
  prefills suggestions into the worker's input: a stale value is one tick away from becoming confirmed.
- A run that produced no AI pack (deterministic mode, or an AI failure with fallback) never clobbers the
  stored suggestions.
- Non-place items never generate CTA suggestions, and their legacy stored data is left untouched.
- `buildAssignmentRequestedCheckReturnDraftFromHandoffPackage` prefills the value but **never pre-ticks**
  the check. The pre-tick was latent dead code while `ai_cta_contact_json` was empty; restoring CTA would
  have activated it into silent AI auto-confirmation.
- The handoff reads suggestions from `requested_checks_json`, **not** from `ai_cta_contact_json`, and the
  AI draft path never rewrote it. `saveAgentFieldPack` now re-points the existing `cta_contact` rows at the
  suggestions each run resolved (value/source only — which checks are requested, their labels and answer
  types stay the curator's). Without this, clearing `ai_cta_contact_json` was invisible to the field worker
  until someone happened to re-save the Item Editor.
- `buildRequestedChecksHandoffPayload` drops a `suggested_value` that contradicts a `previous_confirmed_value`
  and keeps the confirmed answer as read-only reference. Confirmed wins: a suggestion that disagrees with a
  human-verified answer would otherwise be one tick away from overwriting it. For CTA this also covers a
  human explicitly verifying a field as absent (checked, not found) — `buildPreviousConfirmedCheckValues`
  had to stop collapsing "never confirmed" and "confirmed: none" into the same `null`, or the contradiction
  check above could not tell them apart.
- `scripts/real-external-agent.mjs` passes the item into `normalizeFieldPack` — without it the place-only
  gate stripped the agent's CTA suggestions before they ever reached the collector.

Tests:
- `collector/tests/cta-upstream.behavior.test.mjs` (15 cases: extraction/provenance, prompt candidates,
  deterministic override, stale-clearing, no-AI preservation, place-only gate, external-engine parity,
  requested-checks re-sync)
- `assignment-accept-confirmed-metadata.repository`: a suggestion contradicting a confirmed value is dropped
  from the next round's handoff; an unconfirmed check keeps its suggestion
- `requested-check-return-form.behavior` updated: a suggested value prefills but never pre-ticks
- full collector suite compared against a `fix/cta-taxonomy-accepted-source` baseline: identical failing
  set, zero new failures

Not in scope (next round): taxonomy has no catalog/resolver on this branch, so no taxonomy checks are
generated at all and `ai_taxonomy_json` is never populated. Two known traps to fix when it returns:
`hasMeaningfulValue(false)` treats a "ไม่ใช่" answer as *not found*, and acceptance never maps taxonomy
check answers into `confirmed_taxonomy_json`.

## 2026-07-13 §7A Acceptance Boundary Closure (branch `fix/cta-taxonomy-accepted-source`)

Status:
- implemented, local tests green; runtime verification pending (Codex)

Collector changes:
- `updateAssignmentState` is now a `runInTransaction` wrapper over `updateAssignmentStateInternal`; `requestAssignmentRevisionWithReset` calls the internal variant (single transaction owner, no nested BEGIN)
- transition into `accepted` runs `applyAcceptedAssignmentConfirmedMetadata` in the same transaction:
  - resolves the accepted submission from `latest_submission_id` (validated against the assignment)
  - resolves the handoff snapshot in effect at submission time via `created_at <= datetime(submission.created_at, '-7 hours')` (handoff timestamps are UTC, submission timestamps are Asia/Bangkok). There is no fallback to the *latest* handoff, so a later reissue can never shadow the snapshot that was actually in effect. When no snapshot predates the submission at all (snapshot backfilled by the repair tool after the Work Return, or a legacy submission row stored in UTC), the **oldest** snapshot of that assignment is used instead of failing — an assignment must never become permanently unacceptable. A `field` assignment with no snapshot at all, or one belonging to another content item, still throws and rolls back.
  - Editorial/direct assignments are never issued a handoff, so they accept with a null handoff pointer and no confirmed mapping.
  - writes `accepted_submission_id` / `accepted_handoff_snapshot_id` (idempotent ALTERs added; columns already existed as orphans on Runtime)
  - maps `requested_check_returns` `cta_contact.*` into `confirmed_cta_contact_json` with **patch semantics** (place items only): `checked && found` → overwrite, `checked && !found` → clear, **unchecked → keep the previously confirmed value**. Values that fail the confirmed-column schema (a LINE id where a URL is expected, `primary_cta` outside the enum) persist as null instead of failing the acceptance; the raw answer stays readable in `requested_check_returns`.
  - stamps `confirmed_taxonomy_json.category` from `item.category`, sets `confirmed_meta_status='confirmed'` with actor/timestamp/note
  - upserts into the latest draft row, or creates deterministic `accepted-meta-<assignmentId>` when no draft exists; re-accept after revision overwrites the same row
- `PATCH /api/assignments/:id/state` passes `actor_user_id`
- AI draft generation (`workflow.mjs`) carries `confirmed_*` forward from the previous draft on regeneration
- `mergeConfirmedDraftMetadata` now ignores client payload entirely — editor-work can never rewrite `confirmed_*`
- `buildFieldReturnEvidenceByItem` prefers the accepted submission per assignment, tags rows with `submission_source`, and keeps only the newest round per check key so a superseded round cannot shadow the current one
- `runInTransaction` is now depth-tracked per database handle, so transactional repository helpers can call each other instead of throwing on a nested `BEGIN`
- Article Workspace: confirmed CTA/taxonomy/status sections replaced with read-only summaries (`confirmed-cta-summary`, `confirmed-taxonomy-summary`, `confirmed-meta-status-summary`); apply-evidence ("ใช้ค่านี้") path removed. Summaries render the persisted confirmed values (the accumulated truth across rounds) and only when `article_process.confirmed_meta_source === "accepted"` — legacy rows self-set by writers before the acceptance pipeline are never shown as reviewer-confirmed.

Rework round (§7A "Rework Round", locked):
- `repo.returnFieldAssignmentForRework()` closes the accepted round and issues a new field assignment with its own handoff snapshot, in one transaction. Nothing from the finished round is deleted.
- `POST /api/assignments/:id/return-to-field` — requires a note, requires the actor to re-enter their own password (verified through `authenticateViaBackendLogin`, identity must match the session), and is limited to the assignment's `assigned_by_user_id` or a higher role (owner/admin, admin still bounded by management line). Handing the new round to a *different* worker clears the same assignee gates as the normal create route (`canAssignToUserByManagementLine`, `canAssignInternalWork`, role-vs-kind). Failed re-auth is audit-logged.
- one open field round per item is enforced in `createAssignment` — the shared chokepoint every field-assignment path (including `createAssignmentFromReadiness`) routes through. It raises `createConflictError`, and both create routes now map `err.code === "CONFLICT"` to HTTP 409. The rework flow closes the accepted round first, so it is the only way to supersede a round.
- opening a rework round reconciles `content_workflow_models.assignment_state` to the new round (`closed -> assigned` is not a legal assignment transition, so it is an explicit reconcile sync)
- `buildFieldReturnEvidenceByItem` keeps one row per check key with **accepted winning over unaccepted**, so a rework round that is submitted but not yet accepted never shadows the accepted answer that is still authoritative
- UI: "ส่งงานกลับไปทำรอบใหม่" section in the assignment review panel, visible only on an accepted field round for a permitted actor.
- The new round's requested checks carry `previous_confirmed_value` as read-only reference ("ยืนยันไว้รอบก่อน: …"), never pre-checked.

Tests:
- `collector/tests/assignment-accept-confirmed-metadata.repository.test.mjs` (27 cases: atomic rollback, handoff round resolution, repaired/legacy-UTC handoff, editorial without handoff, patch semantics scoped to accepted field rounds only (an accepted editorial round must not count as the baseline), rework round, evidence dedupe) — green
- rewritten: `endpoint-schema-mapping-surface`, `article-workspace-confirmed-metadata-surface`, `article-workspace-confirmed-metadata.behavior`, `article-workspace-field-return-evidence.behavior` — green
- `revision-asset-replacement-ui` route guard now allowlists the one intentional new route instead of pinning a raw count
- full collector suite compared against a `main` worktree baseline: identical failing set, zero new failures

Runtime verification checklist (hand off to Codex):
- field assignment with requested checks → Work Return with CTA answers → accept → `confirmed_meta_status='confirmed'` + accepted pointers set without opening the workspace
- forged `confirmed_*` via `PUT /editor-work` does not change the DB
- revision → resubmit different phone → re-accept updates confirmed values + pointers
- **rework round**: accept → "ส่งงานกลับไปทำรอบใหม่" with a wrong password (must fail 401 + audit row), then the correct password → old round `closed`, new round `assigned` with a new handoff snapshot → worker sees "ยืนยันไว้รอบก่อน" hints → re-verify only the phone → accept → phone overwritten, untouched fields still hold the round-1 values
- AI regenerate keeps confirmed values; sync → Approvals shows CTA block; approve/publish; public API returns accepted phone

## 2026-06-20 CTA Milestone Closure And Taxonomy v1 Documentation Baseline

Status (SUPERSEDED — every "implemented" line below describes a sibling branch, not this one):
- These claims were inherited as documentation from branches that fork from merge-base `048ecd1` and
  were never merged into this line. This is the same trap that hid the CTA gap for a whole cycle: the
  CTA block further down had to be struck through for exactly the same reason. Do not read anything
  below as current capability on this branch.
- ~~CTA/contact milestone branch `feature/taxonomy-catalog-resolver` complete~~
- CTA documentation baseline inherited from `1d08fb1`
- ~~Taxonomy v1 catalog implemented on `feature/taxonomy-v1-catalog`~~ — the catalog did not exist here
  at all until `fix/restore-taxonomy-resolver` ported it (see the 2026-07-14 section below)
- ~~resolver activation semantics implemented on `feature/taxonomy-v1-catalog`~~
- ~~Field Pack Agent catalog-awareness implemented on `feature/taxonomy-v1-catalog`~~
- backend curated taxonomy storage/filtering implemented and automated-test verified — unverified on
  this branch; treat as a sibling-branch claim until someone checks it
- Homepage Signals / Content Pool taxonomy integration implemented and automated-test verified —
  same caveat
- ~~static taxonomy closure matrix implemented as a completed static milestone on
  `feature/taxonomy-phase5a-closure-matrix`~~ — `collector/docs/taxonomy-v1-scope.md` and
  `collector/docs/taxonomy-v1-end-to-end-matrix.md` do not exist on this branch
- runtime acceptance across representative fixtures remains pending

2026-06-22 runtime verification (SUPERSEDED — describes `fix/cta-article-confirmation-gate`, not this branch):
- This block was inherited as documentation from a sibling stack whose CTA code was never merged here.
  The upstream CTA pipeline it describes (candidate extraction, prompt candidates, post-AI fallback)
  did not exist on this branch at all until `fix/restore-cta-upstream` restored it — which is exactly
  why an approved context holding a phone and a Facebook page produced a field pack with empty CTA.
- Do not read the claims below as current capability. Kept only as the record of what the old stack did.
- ~~the live Item Editor CTA path is proven end to end~~
- ~~item `51` `Golden Hour Coffee` preserved `ai_cta_contact_json.phone = 0804415224` through the workflow save path~~
- ~~deterministic source candidates override conflicting AI contact values~~
- ~~stale CTA contact suggestions can be cleared on regeneration~~
- ~~focused tests passed for the workflow CTA propagation path and repository persistence~~

Still true independently of the above:
- issued handoff snapshots remain immutable
- no auto-confirmation was introduced

Locked CTA/contact contract:
- CTA/contact is separate from taxonomy.
- CTA/contact is place-only.
- Standard CTA checks are always requested for place items:
  - `phone`
  - `line_url`
  - `facebook_url`
  - `website_url`
  - `primary_cta`
- `requested=true` means a human must verify the field, including confirming false, absent, or not found.
- AI is suggestion-only:
  - AI may provide suggested CTA values.
  - AI cannot confirm CTA facts.
  - AI cannot replace human verification.
- Work Return and human review remain the confirmation source.
- Existing issued assignment snapshots remain immutable.
- `field_return_payload_json.requested_check_returns` remains the canonical Work Return payload.
- `condition_note` remains unchanged.

Locked taxonomy direction on this branch:
- The taxonomy code present at `372bb50` is implementation scaffolding, not the approved final Taxonomy v1 catalog.
- Real Taxonomy v1 categories are:
  - `attractions`
  - `activities`
  - `hotels`
  - `cafes`
  - `restaurants`
  - `transport`
- The current Taxonomy v1 scaffold is not the final end-to-end Homepage Curation mapping.
- Coordinates, map identity/link fields, Google Maps opening hours, and CTA/contact are excluded from taxonomy.
- Required taxonomy means the field worker must answer; it does not mean the value must be true.
- Approved catalog keys may be either required or Agent-triggered.
- AI may activate approved Agent-triggered catalog keys and may provide suggested values.
- AI must not create canonical unknown keys, override catalog schema, or remove required defaults.
- Unknown/non-catalog ideas go to:
  - handoff guidance
  - `must_ask_question`
  - Work Return additional notes
- Unknown/non-catalog ideas do not become canonical taxonomy keys automatically.
- Backend curated taxonomy storage/filtering is now implemented and automated-test verified.
- Homepage Signals / Content Pool taxonomy integration is now implemented and automated-test verified.
- The static closure matrix is implemented and checked in this phase.
- Do not include any `custom` group or `custom.*` row in newly created handoff snapshots, including legacy stored rows.
- Preserve legacy custom data at rest.
- Already-issued immutable snapshots containing custom checks remain readable and returnable for compatibility.
- Do not delete legacy stored data.
Relevant docs:
- root state: [../PROJECT_STATE.md](../PROJECT_STATE.md)
- root policy: [../PROJECT_POLICY.md](../PROJECT_POLICY.md)

## 2026-06-19 Work Return CTA / Curation Lock

Status:
- completed as the CTA milestone baseline

Completed on this branch:
- CTA Work Return stays on the approved compact list layout.
- Curation rows use the existing requested-check return payload path and keep `condition_note`.
- `handoffPackage.niche` remains the upstream Clean category context for collector-owned handoff construction.
- Work Return no longer renders reserved metadata rows `taxonomy.category`, `taxonomy.subtype`, or `taxonomy.tags`.
- Hidden legacy draft rows remain preserved through draft merge and payload serialization.
- No auto-save, auto-submit, or auto-publish behavior was introduced by this patch.

Completed on the current Taxonomy v1 branch:
- taxonomy catalog/default resolver
- category-scoped actionable taxonomy checks instead of reserved placeholders
- AI activation of approved Agent-triggered taxonomy keys and suggested values in the resolver
- handoff builder changes that emit resolved actionable taxonomy checks instead of placeholders

Pending for later phases:
- runtime acceptance across representative fixtures

Relevant tests:
- `collector/tests/requested-check-return-form.behavior.test.mjs`
- `collector/tests/requested-check-ui.behavior.test.mjs`

Current baseline:
- `1136009` Add reference media policy v2
- `e001837` Wire reference media into draft preview
- `d08184d` Disable legacy imported media materialization

## Recent Completed Work

### 2026-06-14

Branch / PR:
- `fix/reference-media-policy-v2`

Status:
- runtime smoke passed

Summary:
- reference media and publish media are now separate domains
- `/api/items/32/reference-media` returns `rm:<hash>` reference media rows
- Clean page can select reference media for Agent
- image-workflow shows `ai_reference_selected_count`
- `/api/assets` no longer mixes external/reference media
- active materialization path is closed
- `repairImportedReferenceAssetsForItem` is not used by active server/import/Clean/Agent flow

Known remaining:
- P3 UX flicker after toggling reference media selection
- cause: PATCH selected then reload reference-media table/workflow summary
- keep as later polish backlog

### 2026-06-07

Branch / PR:
- merged to `main`

Status:
- manual UAT completed

Summary:
- user/admin UAT passed for visibility scope
- user/admin do not see out-of-scope work
- admin system/user checks show only the team created/managed by that admin account
- item ownership labels are visible for raw pool / claimed / assigned / visible reason
- crawler / Google Maps API permissions remain owner-only

Checks and tests:
- manual visibility-scope UAT passed for `user` and `admin`
- `collector/tests/assignment-ui-scope.test.mjs` still has known legacy failures unrelated to this patch

### 2026-06-06

Branch / PR:
- `fix/assignment-management-line-scope`
- PR `#5`

Status:
- merged

Summary:
- tightened assignment scope
- tightened item context read routes
- tightened item mutation and recompute routes
- tightened workflow and article-process routes
- tightened claim, takeover, and delete
- added static regression coverage for management-line scope guards

Checks and tests:
- `node --check collector/server/index.mjs` passed
- `node --check collector/db/repository.mjs` passed
- `node --check collector/server/public/app.js` passed
- `collector/tests/assignment-ui-scope.test.mjs` still has legacy failures unrelated to this patch
- new management-line scope assertions pass

Follow-up:
- clean up legacy `collector/tests/assignment-ui-scope.test.mjs` failures separately
- run manual UAT with `owner` / `admin` / `user` / `editor` / `freelance` accounts
- verify `admin` cannot see owner or out-of-branch assignments
- verify `admin` cannot direct-hit item context outside subtree
- verify `admin` cannot claim, takeover, delete, recompute, or generate on out-of-branch item
- verify `user` cannot assign upward or across branch
- verify `owner` remains global

---

# System Architecture

## frontend
Public tourism website (Next.js)

## admin
Internal moderation/review/content operations UI (React + Vite)

## backend
Main API/auth/content lifecycle system (Node.js + Express + MySQL)

## collector
Isolated AI-assisted ingestion/runtime/workflow system

Collector is intentionally separated from the public deployment surface.

---

# Current Infrastructure

## Main Machine
Purpose:
- coding
- AI orchestration
- refactor
- audits
- Git operations
- database source machine

Environment:
- Windows 11
- MySQL80 installed and operational

## Runtime Machine
Purpose:
- runtime execution
- collector workflows
- integration testing
- browser automation
- headless operation
- Cloudflare Tunnel test exposure

Environment:
- Windows 11
- AnyDesk operational
- local MySQL installed
- local integration stack operational
- runtime root migrated to `D:\UbonRuntime`

---

# Current Runtime Services

## backend
http://127.0.0.1:5000

Status:
- operational
- Express boot successful
- connected to local MySQL after DB import

## collector
http://127.0.0.1:5070

Status:
- operational
- SQLite initialized
- health checks passing

## admin (Vite dev)
http://127.0.0.1:5173

Status:
- operational
- can connect to backend
- local auth integration testing active
- Vite host allowlist now required for Cloudflare test domain access

## frontend (Next dev)
http://127.0.0.1:3000

Status:
- operational when started for test domain routing
- public test frontend can route through Cloudflare Tunnel

## Cloudflare test domains

Status:
- active through Cloudflare Tunnel on runtime machine
- backend health verified at `https://api-test.uboncity.com/api/health`
- admin reachable at `https://admin-test.uboncity.com`
- collector reachable at `https://collector-test.uboncity.com`
- public frontend test entry uses `https://test.uboncity.com`

---

# Database Status

## backend database
MySQL 8.0

Database:
`uboncity`

## Migration State
- database dump exported from main machine
- imported successfully into runtime machine
- runtime machine now contains local DB copy

## Current Backend ENV Pattern

```env
PORT=5000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=LOCAL_PASSWORD
DB_NAME=uboncity
```

---

# Repository State

## GitHub
Acts as source of truth.

## Current main baseline
- `19b4d27` Merge AI policy rows for translation repair and SEO agent
- `3f9d2d6` Merge translation repair from recheck issues
- `f8a1d99` Merge translation source fingerprint stale gate
- `20d7967` Ignore draft fallback homepage layout on public home

## Runtime Machine
- runtime repo confirmed on `main`
- runtime repo confirmed at commit `19b4d27`

## Collector source
- collector/main now includes translation stale gate, translation repair, and AI feature policy updates

## Reusable local ops
- `ops/windows/test-stack.ps1` added for Windows test-stack start/stop/status orchestration
- cloudflared preflight guard added:
  - fail-fast when `C:\cloudflared\config.yml` is missing/empty
  - fail-fast when `credentials-file` is missing
  - fail-fast when ingress rules are missing
  - reduces mis-run from direct `cloudflared tunnel run <name>` without config

---

# Major Completed Milestones

## Infrastructure
- runtime machine setup complete
- runtime root moved to M.2-backed `D:\UbonRuntime`
- AnyDesk remote access operational
- local runtime folder structure established
- Cloudflare Tunnel test access established without router port-forward dependency

## Repository Cleanup
- runtime artifacts removed from tracking
- portable collector test paths implemented
- gitignore cleanup completed
- runtime/data separation improved

## Collector
- npm install complete
- SQLite initialized
- collector boot successful
- collector health checks operational
- internal AI execution path moved behind backend proxy for core collector flows
- local provider fallback removed from translation workflow path (backend-only secret boundary for internal path)
- source fingerprint based stale detection for translations completed
- fingerprint excludes `draft_id` and `review_report_id` to avoid false stale on no-op revision cycles
- mismatched `source_fingerprint` now blocks translation technical readiness, recheck readiness, submit-admin-review, and final send
- article submit page now loads live export readiness on init
- generate/regenerate translations now refresh live readiness after completion
- bulk backend sync is fingerprint-aware and excludes stale or mismatched translations
- Translation Recheck evaluates semantic quality only; it does not modify translated fields
- Translation Repair flow added:
  - appears for warning/failed recheck rows with `recheck_issues`
  - repairs a single locale using source + current translation + recheck issues
  - resets recheck status to `not_checked` after repair
  - keeps Final Send blocked until recheck passes again
  - rejects stale fingerprint mismatch and non-eligible rows
- manual repair flow validated:
  - `warning/failed -> Repair translation -> not_checked -> Recheck enabled -> Final Send blocked -> Recheck passed -> Final Send enabled`

## Backend
- backend install successful
- backend boot successful
- MySQL local integration operational
- backend now hosts internal AI execution endpoint for collector internal path
- approved place/event media now served from backend uploads
- public place response rewrites self-hosted media URLs correctly
- `/uploads` static route now allows frontend cross-origin image embedding

## Admin
- Vite dev environment operational
- backend connectivity operational
- review-to-public preview flow validated against local backend/frontend alignment
- Cloudflare test-domain access stabilized via explicit Vite host configuration
- AI Feature Policy page now shows Translation Repair and SEO Agent rows

## Frontend
- light theme scenic shell layering fixed for review/detail rendering
- place/event public detail and list surfaces verified to consume normalized backend media fields
- test domain routing established via Cloudflare Tunnel
- public homepage ignores `draft_fallback` homepage layout unless there is a published curation layout
- frontweb test passed after the homepage draft-fallback fix

---

# AI Feature Policy Status

Current feature rows:
- Field Pack
- Translation
- Translation Recheck
- Translation Repair
- Visual Context
- Article Generator
- SEO Agent

Current defaults and routing:
- Translation remains Gemini 2.5 Flash-Lite (economy) by default
- Translation Recheck can be configured separately
- Translation Repair is active and defaults to Gemini 2.5 Flash
- SEO Agent is reserved for future Article Workspace work and defaults to Gemini 2.5 Flash-Lite
- Repair workflow reads `aiConfig.features.translationRepair` first, then falls back only if that feature config is absent

---

# Article Workspace Test Policy

Before production deploy, Article Workspace should be tested through the full pipeline up to test frontweb.

Current pre-deploy test policy:
- external research data and external/placeholder photo manifests may be used as test fixtures
- this is a temporary test-mode override, not a production policy change
- test fixture content may sync to test frontweb
- test fixture content must be labelled clearly as:
  - `source_mode = "test_external_research"`
  - `publish_policy = "test_only"`
  - `production_publish_allowed = false`
- production publish and final production export must remain blocked for external research fixtures unless replaced by field-verified data and owned assets
- before real deploy, test data must be purged:
  - test content items
  - draft articles
  - generated articles
  - translation rows
  - repair/recheck rows
  - external/placeholder media manifests
  - generated frontend test outputs if applicable
- do not treat Google/Search data as field verified
- do not claim field verification unless `field_return.source_mode` is `field_verified`
- Article AI must surface `missing_info` and `uncertain_fields` instead of inventing facts

---

# Current Runtime Folder Layout

```txt
D:\UbonRuntime\
|-- repos\
|   `-- UbonCity_Web
|
|-- runtime\
|   |-- logs
|   |-- tmp
|   |-- browser-profiles
|   `-- test-stack
|
|-- data\
|   `-- collector
|
|-- config\
|
`-- scripts\
```

---

# Important Rules

## Never commit
- node_modules
- .env
- collector/data
- collector/staging
- runtime artifacts
- browser profiles
- generated exports/media
- temporary logs
- Cloudflare tunnel credentials
- machine-local Cloudflare config

## Avoid
- hardcoded Windows absolute paths
- giant rewrites
- mixing collector runtime into public deployment
- treating Cloudflare test exposure as production hardening

---

# Next Priority

1. Implement the approved Taxonomy v1 catalog on `feature/taxonomy-v1-catalog`.
2. Keep the CTA documentation baseline from `1d08fb1` inherited on this branch.
3. Keep the current taxonomy scaffold from `372bb50` treated as non-final.
4. Complete backend curated taxonomy storage/filtering in a later phase.
5. Bridge confirmed taxonomy facts into internal Homepage Signals / Content Pool filtering in a later phase.
6. Keep public homepage behavior unchanged and keep human selection manual.

---

Main project policy has moved to `/PROJECT_POLICY.md`.
Current project state has moved to `/PROJECT_STATE.md`.
Collector-specific implementation notes may remain here only when they are not duplicated in root policy.

---

# Documentation State

## UAT documents
- role-based markdown checklists are primary artifacts
- previous interactive UAT artifacts were removed from active workflow
- print usage should use markdown-based role files (or generated local print pack outside git tracking)

---

# Deployment Direction

Current phase:
LOCAL INTEGRATED TESTING

Not production-ready yet.

Pending:
- production auth hardening
- reverse proxy
- HTTPS
- VPS isolation
- backup automation
- process management
- monitoring
- production DB strategy
- security review
- Cloudflare/domain staging auto-start hardening

---

# Notes

Current architecture direction:

Main Machine
-> development/orchestration/database source

GitHub
-> canonical source of truth

Runtime Machine
-> isolated execution/integration/runtime testing node

Cloudflare Tunnel
-> public test entry for team access without direct router exposure

This separation should be preserved moving forward.

Collector remains higher-risk than the public site even when exposed through test-domain login flow.
