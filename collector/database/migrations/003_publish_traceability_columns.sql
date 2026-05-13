-- For existing DBs created before draft/review traceability columns were added.
ALTER TABLE published_articles ADD COLUMN draft_id INTEGER;
ALTER TABLE published_articles ADD COLUMN review_report_id INTEGER;
