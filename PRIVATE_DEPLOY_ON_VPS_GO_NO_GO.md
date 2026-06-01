# PRIVATE_DEPLOY_ON_VPS_GO_NO_GO

## Hard blockers (must be fixed)
- [ ] Collector app port is publicly reachable.
- [ ] Collector bind host/public ingress allows internet access without private controls.
- [ ] Missing strong secrets in production env (JWT, owner/admin password, sync token).
- [ ] CORS wildcard or undefined production CORS allowlist.
- [ ] Backend DB connectivity unstable or migrations not applied.
- [ ] No backup set exists for backend DB + collector DB/files.

## Soft warnings (acceptable short-term only with plan)
- [ ] Basic monitoring only (no alerting yet), but logs are still collected.
- [ ] Manual backup process temporarily used, with documented schedule.
- [ ] Admin access restricted by strong auth but not yet VPN-gated.

## Final decision checklist
- [ ] Frontend works on HTTPS.
- [ ] Backend API works on HTTPS.
- [ ] Admin access control verified.
- [ ] Collector confirmed internal-only.
- [ ] Auth/permission checks pass.
- [ ] Critical workflows pass (create/edit/publish/import/export).
- [ ] Backup/restore dry-run completed with evidence.
- [ ] Operator runbook and rollback steps documented.

## Decision
- **GO** only if all hard blockers are cleared.
- **NO-GO** if any hard blocker remains.
