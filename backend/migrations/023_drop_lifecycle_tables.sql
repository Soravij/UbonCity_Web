-- Manual execution required: no migration runner or ledger is configured.
-- Step C cleanup: remove obsolete lifecycle release-import storage.
DROP TABLE IF EXISTS lifecycle_release_imports;
DROP TABLE IF EXISTS lifecycle_content_map;
