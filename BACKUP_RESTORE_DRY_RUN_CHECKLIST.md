# BACKUP_RESTORE_DRY_RUN_CHECKLIST

## Pre-dry-run
- [ ] Identify backup source timestamp to test.
- [ ] Prepare isolated staging target (not production).
- [ ] Confirm staging secrets/env files are ready.
- [ ] Confirm enough disk space for restore.
- [ ] Assign operator and observer.

## Data selection checklist
- [ ] Backend MySQL dump selected.
- [ ] Backend `uploads/` backup selected.
- [ ] Backend `transport/` backup selected (if used).
- [ ] Collector SQLite backup selected.
- [ ] Collector `media/` backup selected.
- [ ] Collector `raw/` + `staging/content/` backup selected.

## Dry-run restore steps
- [ ] Restore backend DB into staging DB.
- [ ] Restore backend file archives into staging app path.
- [ ] Restore collector SQLite DB into staging collector path.
- [ ] Restore collector file archives into staging collector path.
- [ ] Start backend staging service.
- [ ] Start collector staging service.
- [ ] Start admin/frontend against staging backend.

## Validation checks
- [ ] Backend `/api/health` is OK.
- [ ] Collector `/api/health` is OK.
- [ ] Admin login succeeds.
- [ ] Collector login succeeds.
- [ ] 3 sample place records present.
- [ ] 3 sample event records present.
- [ ] 3 sample media assets present and render.
- [ ] Collector staged/export files present.
- [ ] Collector workflow pages load without server errors.

## Go/No-Go
- [ ] GO if all validation checks pass.
- [ ] NO-GO if any critical data/service check fails.

## Evidence to capture
- [ ] Start/end timestamps.
- [ ] Restore command outputs (or logs).
- [ ] Backup file sizes + checksums.
- [ ] Record count comparison snapshot.
- [ ] Sample image/content verification screenshots.
- [ ] Final pass/fail decision with operator name.
