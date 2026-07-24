-- Manual execution required: no migration runner or ledger is configured.
-- Step C cleanup: remove obsolete release snapshot storage.
DROP TABLE IF EXISTS release_snapshots;
