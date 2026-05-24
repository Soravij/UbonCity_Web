# VPS_PROVISIONING_CHECKLIST

## Before renting VPS
- [ ] Confirm target architecture: frontend + backend + admin + collector.
- [ ] Decide public domains for frontend/backend/admin.
- [ ] Decide private-only access method for collector (VPN or IP-restricted proxy).
- [ ] Decide where secrets will be stored (not in repo).
- [ ] Decide backup destination and retention period.

## Immediately after VPS setup
- [ ] Patch OS and enable automatic security updates.
- [ ] Create non-root deploy user.
- [ ] Disable password SSH login; use SSH keys.
- [ ] Configure host firewall with deny-by-default inbound.
- [ ] Open only required ports (22 restricted, 443 as required).
- [ ] Ensure collector app port is not publicly open.
- [ ] Install runtime dependencies (Node, DB client tools, reverse proxy).

## Before app deployment
- [ ] Create separate env files for backend/admin/frontend/collector.
- [ ] Add strong secrets (`JWT_SECRET`, owner/admin passwords, sync token).
- [ ] Set collector bind host to loopback/private only.
- [ ] Set explicit CORS origins (no wildcard).
- [ ] Configure reverse proxy TLS for public services.
- [ ] Configure collector route as internal-only (or no public route).
- [ ] Configure process manager restart policy.
- [ ] Configure log locations and rotation.

## Before private user testing
- [ ] Verify public URLs load only intended services.
- [ ] Verify collector is unreachable from public internet.
- [ ] Verify collector is reachable from authorized private path only.
- [ ] Run auth/permission smoke tests.
- [ ] Run backup snapshot and small restore test.
- [ ] Record go/no-go evidence.
