# FUTURE_COLLECTOR_ISOLATION_CHECKLIST

## Pre-server checklist
- [ ] Confirm collector is designated internal-only in project docs and runbooks.
- [ ] Keep `collector-app/.env.example` private-first values as baseline.
- [ ] Decide collector access path: VPN only or private reverse proxy + IP allowlist.
- [ ] Decide internal hostname (example: `collector.internal.example`) and do not plan public DNS.
- [ ] Decide who can access collector (named people + IP ranges).

## After-VPS-provision checklist
- [ ] Host firewall configured: collector port closed from public internet.
- [ ] Security group/network ACL configured: collector port not open to `0.0.0.0/0`.
- [ ] Collector bind host set to `127.0.0.1` (preferred) or private IP only.
- [ ] Reverse proxy does not expose collector publicly.
- [ ] TLS enabled for any operator-accessible collector route.
- [ ] Access gate enabled (VPN and/or proxy auth + IP allowlist).

## Before-private-deploy checklist
- [ ] External network test confirms collector endpoint is unreachable.
- [ ] Trusted network test confirms collector is reachable for authorized operators only.
- [ ] `CORS_ALLOWED_ORIGINS` set to internal admin origin(s) only.
- [ ] `COLLECTOR_SYNC_BACKEND_API` uses HTTPS for non-local target.
- [ ] Sync token is set and stored in secret manager (not in repo).
- [ ] Admin/owner credentials are strong and not shared in plaintext docs.
- [ ] Evidence captured:
  - [ ] firewall/security group rule screenshots
  - [ ] external connectivity test result
  - [ ] authorized internal access test result
