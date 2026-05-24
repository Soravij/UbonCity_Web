# Collection Workflow (Internal)

## Goal
Collect source content/media as raw references only, then normalize and stage through internal pipeline.

## Flow
1. Select adapter (`manual`, `facebook`, `tiktok`, `google_maps`)
2. Submit raw payload JSON array
3. Save ingestion batch in `source_ingestions`
4. Save each raw row in `source_raw_items`
5. Save related raw media references in `source_raw_media`
6. Optionally promote raw item into `content_items` inbox for normal cleaner/AI/quality flow

## Important
- No direct publish from source collection
- No auto-publish to public website
