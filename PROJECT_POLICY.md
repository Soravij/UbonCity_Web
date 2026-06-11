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

- Clean stage can select media.
- Clean stage can set cover.
- Clean stage can send AI Draft / Agent workflow.
- Clean / Agent Draft must not hard-block only because selected media or cover is not local publish-ready.
- Need at least 1 approved context remains a valid hard blocker for Agent draft.
- Missing image/cover can be warning/soft readiness, not an early hard blocker.
- Clean media selection/cover is workflow context only and does not automatically mean publish-safe.

## 5. Media Policy

### Media Classes

#### Reference / Evidence Media

- Allowed in Raw Data, Clean Prep, AI analysis, Field Pack drafting, internal planning.
- May include external URLs/images, Google/search/social references, and other research references.
- Must remain reference-only.
- Must not become cover/gallery/inline publish media automatically.
- Must not be treated as rights-verified.
- Must not be synced to public frontend as publish media.

#### Usable / Publish Media

- Used for Article Workspace cover/gallery/inline images, Admin Review, final handoff, publish/export, public frontend.
- Must come from selected local collector content_assets or another approved local/backend-controlled source.
- Eligible publish media must be collector/backend-controlled local/nas assets:
  - storage_disk in local or nas
  - non-http(s) storage_path
  - image mime type when available
- External/reference media cannot be used as publish media unless manually rights-verified, imported into controlled local/backend storage, and selected as a local usable asset.

### Stage-specific Media Blocker Policy

- Raw Data / Clean Prep / Field Pack Draft:
  - Reference media OK.
  - No hard block only because local publish media is missing.
- Clean / Agent Draft:
  - Select/set cover allowed for workflow continuity.
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

- Clean select works.
- Clean set cover works.
- Clean AI Draft works.
- Publish/Admin Review local media readiness remains enforced through local_selected_count/local_cover_count/buildExportReadiness.
- Early PATCH selected/role routes must not block Clean workflow only because asset is not local publish-ready.
- Late publish/admin-review readiness must still block non-local publish media.

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
  - Clean set cover
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
