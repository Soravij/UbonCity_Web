# UbonCity Project Policy

## 1. Product / Scope Policy

- UbonCity is a tourism/content platform for Ubon Ratchathani.
- Components:
  - frontend: public Next.js website
  - backend: Express/API and public media serving
  - admin: back-office/admin panel
  - collector: internal ingest/workflow/AI preparation tool
- Collector is an internal workflow tool, not a public asset server.
- Backend/public storage is the source for published public media.

## 2. Role / Permission Policy

- Owner has global visibility/management.
- Admin/user visibility may be scoped by assignment, claim, or workflow.
- Claimed work should not accidentally appear to unrelated users/admins unless policy explicitly allows it.
- Raw pool first-claim behavior is allowed for eligible unclaimed raw items.

Placeholders:

- Detailed owner/admin/user capability matrix: TBD / update later.
- Reviewer/operator policy: TBD / update later.

## 3. Raw Intake / Claim / Delete Policy

- Raw-only hard delete is allowed only for safe raw-only items.
- Hard delete must be blocked once submission deliverables or protected workflow artifacts exist.
- Raw pool first claim is allowed only for eligible unclaimed raw pool items.

Placeholders:

- Raw intake validation policy: TBD / update later.
- Duplicate/raw merge policy: TBD / update later.

## 4. Clean / Agent Draft Policy

- Clean stage can select reference media for AI / Field Pack context.
- Clean stage must not set cover or promote media into publish roles.
- Clean / Agent Draft must not hard-block only because selected reference media is not local publish-ready.
- Need at least 1 approved context remains a valid hard blocker for Agent draft.
- Missing local publish media can be warning/soft readiness at Clean stage, not an early hard blocker.
- Clean media selection is workflow context only and does not automatically mean publish-safe.

## 5. Media Policy

### Media Classes

#### Reference / Evidence Media

- Reference media and publish media are separate domains.
- Allowed in Raw Data, Clean Prep, AI analysis, Field Pack drafting, and internal planning.
- May include external URLs/images, Google/search/social references, and other research references.
- Must remain reference-only.
- Must not be materialized into `assets` / `content_assets`.
- Must not become cover/gallery/inline publish media automatically.
- Must not be treated as rights-verified.
- Must not be synced to public frontend as publish media.

#### Usable / Publish Media

- Used for Article Workspace cover/gallery/inline images, Admin Review, final handoff, publish/export, public frontend.
- Must come from selected local/backend-controlled `assets` + `content_assets` only.
- Eligible publish media must be collector/backend-controlled local/nas assets:
  - storage_disk in local or nas
  - non-http(s) storage_path
  - image mime type when available
- External/reference media cannot be used as publish media unless manually rights-verified, imported into controlled local/backend storage, and selected as a local usable asset.
- `image_context` must contain only local/backend-controlled selected assets.
- `reference_media_context` may contain selected external/reference media and is reference-only, not rights-verified, not publish media, and not approved cover/gallery/inline media.

### Stage-specific Media Blocker Policy

- Raw Data / Clean Prep / Field Pack Draft:
  - Reference media OK.
  - No hard block only because local publish media is missing.
- Clean / Agent Draft:
  - Select reference media only.
  - No local publish-ready hard block.
  - Approved context remains required.
- Article Workspace:
  - May show missing-cover / needs-local-asset state.
  - Must not auto-promote external/reference media into publish media.
- Submit Admin Review / Final Handoff / Publish Export:
  - Must hard-block unless selected local usable cover/assets exist.
  - External/reference media cannot satisfy publish readiness.

### Error Placement

- The error "usable article media must be selected from uploaded local assets" or equivalent local-only publish media error is correct for:
  - Submit Admin Review
  - Final Handoff
  - Publish / Export
- It is too early / incorrect for:
  - Raw Data
  - Clean Prep
  - Field Pack Draft
  - Clean / Agent Draft media selection workflow

### Current Implemented Media Behavior

- Clean reference-media select works.
- Clean no longer sets cover in reference-media flow.
- Clean AI Draft works using reference media and approved context.
- Publish/Admin Review local media readiness remains enforced through local_selected_count/local_cover_count/buildExportReadiness.
- Early PATCH selected/role routes must not block Clean workflow only because asset is not local publish-ready.
- Late publish/admin-review readiness must still block non-local publish media.
- `repairImportedReferenceAssetsForItem()` is legacy/deprecated and must not be used by active server/import/Clean/Agent flow.
- `POST /api/items/:id/assets/repair-imported-media` is deprecated and returns 410 `REFERENCE_MEDIA_POLICY_V2`.

### Reference Media Policy v2 Contract

- Clean reference media endpoint is `GET /api/items/:id/reference-media`.
- Reference media selection is stored in `content_reference_media_selections`.
- `reference_media_id` is a stable synthetic id in format `rm:<url_hash>` from normalized URL.
- Clean selection/toggle must use `reference_media_id`, not `asset_id`, `content_asset_id`, or `selected_in_clean`.
- Import/collect flow must not bridge external media into `assets` / `content_assets`.
- Under policy v2, `bridged_image_count` remains `0` and `reference_media_count` may be returned for imported reference candidates.

## 6. Article / SEO Agent Policy

- Article Agent and SEO Agent are suggestion-only/manual.
- No auto-save, no auto-submit, no auto-publish.
- Human editor must review and save.
- Existing content replacement should require confirmation where implemented.
- SEO Agent fills metadata suggestions locally before save.

Placeholders:

- Detailed prompt/profile policy: TBD / update later.
- Translation policy: TBD / update later.

## 7. Admin Review / Publish Policy

- Submit Admin Review and Publish are late-stage gates.
- Publish must require local usable media readiness.
- Publish must require body/meta/readiness requirements.
- External/reference media must not pass publish readiness.

## 7A. Taxonomy and Curation Policy

- Clean owns the canonical main category.
- Current canonical category path is `item.category -> buildFieldPackHandoffPackage(...) -> handoffPackage.niche`.
- CTA/contact is separate from taxonomy.
- CTA/contact is place-only.
- Standard CTA checks for place are `phone`, `line_url`, `facebook_url`, `website_url`, and `primary_cta`.
- Standard CTA checks for place are always requested for human verification.
- `requested=true` means a human must verify the field, including false, absent, or not found.
- AI may suggest CTA/taxonomy values but cannot confirm facts.
- Work Return and human review remain the confirmation source.
- Work Return recipients must not change category in the assignment return UI.
- Taxonomy catalog entries must use stable real check keys, not generic placeholder rows.
- `taxonomy.category`, `taxonomy.subtype`, and `taxonomy.tags` are reserved metadata keys, not editable Curation questions.
- Real taxonomy categories are `attractions`, `activities`, `hotels`, `cafes`, `restaurants`, and `transport`.
- Coordinates, map identity/link, Google Maps opening hours, and CTA/contact are excluded from taxonomy.
- Category defaults are the baseline for Curation.
- Mapping may add category-relevant checks.
- AI may activate approved Agent-triggered catalog keys and may provide suggested values.
- AI must not create canonical unknown keys, override catalog schema, or remove required defaults.
- AI must not silently remove required category defaults.
- Resolver must deduplicate by stable `taxonomy_key`.
- Resolver writes an immutable resolved checklist into the assignment handoff snapshot.
- Work Return renders only the resolved snapshot.
- Work Return must not query the live taxonomy catalog, infer category defaults, or call AI.
- One taxonomy check maps to one Work Return row.
- Each visible Curation row supports a main value plus optional `condition_note`.
- Hidden legacy rows remain preserved through draft merge and payload handling for backward compatibility.
- `requested_check_returns` remains the canonical Work Return payload.
- Issued assignments must stay stable when the live taxonomy catalog changes.
- Any change to an issued handoff requires explicit repair or reissue behavior.
- If a handoff snapshot contains no actual resolved taxonomy checks, the Work Return Curation section stays hidden.
- Required taxonomy means the field worker must answer, not that the value must be true.
- Unknown/non-catalog observations must go to handoff guidance, `must_ask_question`, or Work Return additional notes for writer consideration.
- Unknown observations do not become catalog keys automatically.
- Do not create new `custom` groups or new `custom.*` keys in the active taxonomy/requested-check flow.
- Do not include any `custom` group or `custom.*` row in newly created handoff snapshots, including legacy stored rows.
- Do not project `custom.*` into canonical taxonomy facts or Homepage Signals filtering.
- Preserve legacy custom data at rest.
- Already-issued immutable snapshots containing custom checks remain readable and returnable for compatibility.
- Do not delete legacy stored data.


## 7B. Operational Rules

- No merge, commit, or push without explicit approval.
- Runtime DB/test data exists only on the Runtime machine.
- Dev code audit must not assume Runtime records are locally available.
- Media Library deduplication must not be mixed with CTA / Curation changes.

Responsibility split:
- `default`: category taxonomy defaults owned by the future taxonomy resolver/catalog
- `mapping`: category/subtype mapping-selected checks owned by the future resolver
- `AI`: additive checks and suggestions only
- `resolved handoff snapshot`: immutable checklist copied into assignment handoff
- `Work Return response`: field-worker answers stored in `requested_check_returns`

Placeholders:

- Exact approval workflow state machine: TBD / update later.
- Rejection/revision policy: TBD / update later.
- Taxonomy/revision assignment policy: TBD / update later.

## 8. Public Frontend Policy

- Public frontend must use published/backend-controlled data.
- Public frontend must not fetch arbitrary external images as publish media.
- Public indexing is controlled by NEXT_PUBLIC_INDEXING.

Placeholders:

- SEO schema policy: TBD / update later.
- Public media URL policy: TBD / update later.
- Multilingual public content policy: TBD / update later.

## 9. Runtime / Deployment Policy

- Main dev path: D:\UbonCity_Web or D:\uboncity_web depending on machine.
- Runtime/test path: D:\UbonRuntime\repos\UbonCity_Web.
- Preferred flow:
  - push from dev
  - pull on runtime
  - restart stack
  - smoke test

Placeholders:

- Production deployment policy: TBD / update later.
- Backup/restore policy: TBD / update later.
- Rollback policy: TBD / update later.

## 10. Testing / Smoke Policy

- Run node --check for touched JS files.
- Use git diff --check before commit.
- Runtime smoke required for workflow changes.
- For media changes, test:
  - Clean select
  - Clean reference-media select
  - Clean AI Draft
  - Submit Admin Review publish readiness

Placeholders:

- Automated test coverage policy: TBD / update later.
- Browser smoke checklist: TBD / update later.

## 11. Documentation Policy

- PROJECT_POLICY.md is the root single source of truth for main project policies.
- PROJECT_STATE.md is the root current state / changelog / active branch summary.
- Component-local docs may reference root docs but should not duplicate main policy.
- If policy changes, update PROJECT_POLICY.md in the same branch or a documentation-only follow-up commit.
