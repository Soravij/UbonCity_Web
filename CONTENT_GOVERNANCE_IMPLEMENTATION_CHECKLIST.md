# Content Governance Implementation Checklist

## Scope
- Normal flow + Emergency flow separation with `is_emer` flag
- Conflict guard between Normal publish and existing Emergency content
- Owner-only purge flow with password confirmation
- Deleted audit visibility in Approvals History

## Backend
- [x] Add governance infrastructure bootstrap (`places.is_emer`, `events.is_emer`, `content_purge_audit`)
- [x] Add emergency conflict guard service
- [x] Add purge service for `place` and `event` with relation/media cleanup
- [x] Replace shallow delete in place/event controller with password-protected purge
- [x] Wire conflict guard in normal place/event create+update+approve
- [x] Wire conflict guard in review approve pipeline (`reviewDecisionService`)
- [x] Return `409 emer_conflict` payload for UI handling
- [x] Expose deleted audit endpoint for approvals history
- [x] Initialize governance infrastructure at backend startup

## Admin Frontend
- [x] Add `Deleted` filter in Approvals History tab
- [x] Fetch deleted items from `/collector-import-reviews-deleted`
- [x] Show emer conflict hint when approval is blocked
- [ ] Add dedicated owner Purge action UI (password modal) in normal content edit/list pages
- [ ] Split owner navigation explicitly into `Normal` and `Emer` sections

## Validation
- [ ] Run backend syntax checks
- [ ] Run admin build check
- [ ] Run end-to-end smoke: normal publish blocked by emer, purge clears, publish succeeds
