ALTER TABLE content_assets ADD COLUMN selected_in_clean INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_assets ADD COLUMN is_cover INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_assets ADD COLUMN placement_type TEXT NOT NULL DEFAULT 'unused';

UPDATE content_assets
SET selected_in_clean = CASE WHEN role IN ('cover','gallery','inline') THEN 1 ELSE 0 END
WHERE selected_in_clean IS NULL OR selected_in_clean NOT IN (0,1);

UPDATE content_assets
SET is_cover = CASE WHEN role='cover' THEN 1 ELSE 0 END
WHERE is_cover IS NULL OR is_cover NOT IN (0,1);

UPDATE content_assets
SET placement_type = CASE
  WHEN role='inline' THEN 'inline'
  WHEN role='gallery' THEN 'gallery'
  WHEN role='cover' THEN 'gallery'
  ELSE 'unused'
END
WHERE placement_type IS NULL OR placement_type='';
