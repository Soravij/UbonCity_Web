# OWNER_ROLE_DEPLOY_IMPACT

Date: 2026-03-11

## Summary
Introducing `owner` changes authorization behavior in production and will affect who can run high-risk actions.

## Deployment Impact

### Access behavior changes (expected)
- Admins can no longer perform owner-only actions.
- Owner is now required for:
  - user role changes,
  - deleting users,
  - destructive deletes on protected resources,
  - collector system config access,
  - collector high-risk publish/export/sync workflow controls,
  - collector destructive item/asset deletes.

### Potential operational impact
- Existing workflows run by `admin` accounts may fail with `403 Forbidden` until an `owner` account is used.
- Automation scripts/integrations that call owner-only endpoints using admin tokens will break.
- Teams with no owner account provisioned will be blocked from owner-only actions.

## Required pre-deploy checks
1. Ensure at least one owner exists in backend user store.
2. Ensure collector has owner credentials configured:
- `OWNER_EMAIL`
- `OWNER_PASSWORD`
- `OWNER_NAME` (optional)
3. Verify owner login works in admin and collector interfaces.
4. Verify admin can still do non-owner admin/content operations.
5. Verify admin receives `403` on owner-only routes (expected).

## API Compatibility Notes
- These endpoints now effectively require owner context (directly or by policy checks):
  - Backend: role update/delete user and protected destructive deletes.
  - Collector: `/api/config`, `/api/users/:id/role`, `/api/items/:id` delete, `/api/assets/:id` delete, and publish/export/sync run routes.

## Rollout recommendation
- Deploy with a staged smoke test:
1. Login as owner, run owner-only actions.
2. Login as admin, confirm owner-only actions are blocked.
3. Login as editor, confirm no privilege escalation paths.
- Keep one emergency owner account managed outside normal admin flows.

## Known non-blocking caveats
- This assessment is code-level and does not confirm live infrastructure policy behavior.
- Runtime data anomalies in existing user roles were not validated in this file.
