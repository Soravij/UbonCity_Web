# BACKUP_RESTORE_RUNBOOK

## Purpose
Practical backup and restore plan for future private VPS deployment.

## Data stores in this project
1. Backend MySQL database
- Used by `backend/` via `backend/config/db.js` (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`).

2. Backend file storage
- Uploaded files in `backend/uploads/`
- Transport static assets in `backend/transport/`

3. Collector SQLite database
- Default: `collector-app/data/collector.db`
- Can be overridden by `DB_PATH` in collector env.

4. Collector file storage
- Default media root: `collector-app/media/` (includes `media/uploads/...`)
- Collector content artifacts:
  - `collector-app/raw/`
  - `collector-app/staging/content/`
  - export files (default same as staging unless `EXPORT_DIR` overrides)

## Backup scope (must include)
- MySQL dump for backend DB
- `backend/uploads/`
- `backend/transport/` (if used as managed content)
- collector SQLite DB file
- collector media directory
- collector raw/staging/export directories
- env/config snapshot (redacted secrets) + backup manifest

## Backup procedure (operator placeholders)

### A) Backend MySQL backup (operator-provided command)
- Example placeholder command (replace with your real VPS values):
```bash
mysqldump -h <DB_HOST> -u <DB_USER> -p'<DB_PASSWORD>' <DB_NAME> > <BACKUP_DIR>/backend-db-YYYYMMDD-HHMM.sql
```
- Record output file size and checksum.

### B) Backend files backup
```bash
tar -czf <BACKUP_DIR>/backend-files-YYYYMMDD-HHMM.tar.gz backend/uploads backend/transport
```

### C) Collector SQLite backup
- Stop collector service first or use SQLite safe backup mode.
```bash
# Option 1: service stopped
cp collector-app/data/collector.db <BACKUP_DIR>/collector-db-YYYYMMDD-HHMM.db

# Option 2: online sqlite backup (operator-provided)
sqlite3 collector-app/data/collector.db ".backup <BACKUP_DIR>/collector-db-YYYYMMDD-HHMM.db"
```

### D) Collector files backup
```bash
tar -czf <BACKUP_DIR>/collector-files-YYYYMMDD-HHMM.tar.gz collector-app/media collector-app/raw collector-app/staging/content
```

### E) Backup manifest (required)
Create a text file with:
- timestamp
- operator name
- backup file names
- file sizes
- checksums (sha256)
- app versions/commit hash

## Restore procedure to staging/test copy

### 1) Prepare isolated restore target
- Use separate staging folder, DB/schema, and ports.
- Do not restore directly into live production first.

### 2) Restore backend DB
```bash
mysql -h <STAGING_DB_HOST> -u <STAGING_DB_USER> -p'<STAGING_DB_PASSWORD>' <STAGING_DB_NAME> < <BACKUP_DIR>/backend-db-YYYYMMDD-HHMM.sql
```

### 3) Restore backend files
```bash
tar -xzf <BACKUP_DIR>/backend-files-YYYYMMDD-HHMM.tar.gz -C <STAGING_APP_ROOT>
```

### 4) Restore collector DB and files
```bash
cp <BACKUP_DIR>/collector-db-YYYYMMDD-HHMM.db <STAGING_APP_ROOT>/collector-app/data/collector.db
tar -xzf <BACKUP_DIR>/collector-files-YYYYMMDD-HHMM.tar.gz -C <STAGING_APP_ROOT>
```

### 5) Start staging services
- Start backend with staging env.
- Start collector with staging env and restored DB path.
- Start admin/frontend against staging backend.

## Restore validation steps
1. Backend health endpoint returns OK.
2. Collector health endpoint returns OK.
3. Login works for test admin/owner account.
4. Sample places/events/media records count matches expected baseline.
5. Sample uploaded images load correctly.
6. Collector content lists, staging items, and exports are present.
7. Collector -> backend sync path works with staging token.

## Go/No-Go criteria
- Go:
  - All core services start.
  - Data counts within acceptable delta.
  - Sample media accessible.
  - No schema/runtime errors.
- No-Go:
  - Missing/invalid DB restore.
  - Missing media files.
  - Auth failure on known restored accounts.
  - Collector workflow data missing/corrupt.

## Evidence to record
- Backup timestamps
- File sizes/checksums
- Restore start/end timestamps
- Record counts (before vs after)
- Screenshot or curl outputs of health checks
- 3 sample content records and 3 sample images verified
- Operator sign-off and date

## Notes
- Exact service manager/infra commands are operator-provided and depend on final VPS setup.
