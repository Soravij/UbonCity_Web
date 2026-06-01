# BACKUP_RESTORE_CHECKLIST

## Backup scope

### Backend (MySQL)
- [ ] Full DB backup scheduled (daily minimum).
- [ ] Incremental/binlog strategy defined (if required by RPO).
- [ ] Backup includes schema + data + migration state.
- [ ] Backup encryption at rest enabled.
- [ ] Offsite copy retention configured.

### Collector (SQLite)
- [ ] `collector-app/data/*.db` backup scheduled (at least daily, plus before major jobs).
- [ ] Consistent backup method used (hot backup or app pause snapshot).
- [ ] Backup includes associated workflow artifacts when needed.
- [ ] Backup encryption and retention policy configured.

### Media and exports
- [ ] Backup of media storage (`uploads` / `media` paths) configured.
- [ ] Backup of staging/export outputs configured if operationally required.
- [ ] Restore ordering documented (DB first, then media consistency checks).

## Restore readiness

### Prerequisites
- [ ] Restore environment documented (OS/runtime versions, env vars, secrets).
- [ ] Access credentials for backup storage are available and tested.
- [ ] Clear rollback point identified before restore attempts.

### MySQL restore test
- [ ] Restore latest full backup to staging.
- [ ] Apply incremental/binlog replay (if used).
- [ ] Validate critical tables and row counts.
- [ ] Validate auth and key workflows post-restore.

### SQLite restore test (collector)
- [ ] Restore latest collector DB to isolated staging.
- [ ] Start collector with restored DB.
- [ ] Validate login, item listing, and workflow continuity.
- [ ] Validate publish/export metadata integrity.

### Media consistency test
- [ ] Verify DB references match actual media files.
- [ ] Spot-check random assets and recent uploads.
- [ ] Validate no broken paths after restore.

## RTO/RPO governance
- [ ] Target RPO documented (max acceptable data loss window).
- [ ] Target RTO documented (max acceptable downtime).
- [ ] Backup frequency aligns with RPO.
- [ ] Recovery drill frequency defined (monthly/quarterly).

## Security and compliance
- [ ] Backup access is least-privilege and audited.
- [ ] Backup files are encrypted in transit and at rest.
- [ ] Secret material is not stored unencrypted in backup scripts.
- [ ] Retention/deletion policy is enforced and reviewed.

## Incident execution checklist
- [ ] Declare incident and freeze writes if needed.
- [ ] Capture current state for forensics before restore.
- [ ] Perform staged restore (DB, then app, then media verification).
- [ ] Run smoke tests for backend/frontend/admin/collector.
- [ ] Re-enable traffic gradually and monitor error/latency/auth anomalies.
- [ ] Document post-incident findings and update runbooks.
