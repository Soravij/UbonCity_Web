-- 030_reset_curation_drafts.sql
-- Reset all homepage curation drafts to empty JSON arrays so the system
-- regenerates default blocks from createDefaultBlocks on next load.

UPDATE homepage_curation_layouts
SET draft_blocks_json = '[]', published_blocks_json = '[]';
