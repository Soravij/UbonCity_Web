# Collection Workflow (Internal)

## Goal
Collect source content/media as raw references only, then normalize and stage through internal pipeline.

## Current Intake Policy
- UI default adapter is `manual` for every role.
- `google_maps` is owner-only in the collector raw intake UI.
- Non-owner roles can use `manual`, `facebook`, and `tiktok` only.
- The owner-only Google Maps restriction is currently a containment measure for test/local phases, not a full ingest dedupe solution.

## Flow
1. Select adapter (`manual` by default for all roles; `google_maps` owner-only)
2. Submit raw payload JSON array
3. Save ingestion batch in `source_ingestions`
4. Save each raw row in `source_raw_items`
5. Save related raw media references in `source_raw_media`
6. Optionally promote raw item into `content_items` inbox for normal cleaner/AI/quality flow

## Important
- No direct publish from source collection
- No auto-publish to public website
- Google Maps adapter visibility in UI is not the security boundary; server-side collect permissions must remain enforced separately.
