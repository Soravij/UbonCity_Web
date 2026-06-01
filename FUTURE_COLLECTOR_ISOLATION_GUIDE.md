# FUTURE_COLLECTOR_ISOLATION_GUIDE

## Purpose
Keep `collector-app` internal-only when you deploy later on a VPS.

## Recommended bind host
- Default: `COLLECTOR_BIND_HOST=127.0.0.1`
- Use `0.0.0.0` only if collector must be reached across a private subnet, and only with strict firewall/private network controls.

## Recommended port exposure policy
- Collector app port (`5060`/`5070`) must not be internet-exposed.
- Public internet should only reach:
  - frontend HTTPS (`443`)
  - admin HTTPS (`443`) if intentionally enabled
  - backend API HTTPS (`443`) only as needed
- Collector port should be reachable only from:
  - localhost (preferred), or
  - private subnet/VPN + allowlisted admin IPs.

## Reverse proxy guidance
- Do not map collector on a public route without access controls.
- If proxied, enforce all of the following:
  - IP allowlist and/or VPN requirement
  - HTTP auth or SSO gate in front of collector
  - TLS termination
  - no open wildcard routing to collector
- Keep collector behind internal hostname only (example: `collector.internal.example`).

## Firewall/security group guidance
- Inbound defaults:
  - allow `22` only from your admin IP(s)
  - allow `443` from intended private testers (or internet only for public frontend/backend)
  - deny collector app port from `0.0.0.0/0`
- Explicit rule: collector app port allowed only from localhost/private network range.

## VPN/private-network guidance
- Preferred: operator connects through VPN before accessing collector.
- Alternative: bastion + SSH tunnel to collector loopback port.
- Keep collector DNS private; do not publish public DNS record for collector.

## What must never be exposed publicly
1. Collector direct app port (`5060`/`5070`)
2. Collector auth endpoints (`/api/auth/*`) on public internet
3. Collector workflow endpoints (`/api/run/*`, `/api/collect`, `/api/import`) publicly
4. Collector media internal paths if they contain private draft assets
5. Sync token values and owner/admin credentials

## How to verify isolation later (when VPS exists)
1. From outside trusted network, request collector URL and collector port directly.
- Expected: timeout/blocked/403 (not reachable publicly).
2. Run port scan from external test host.
- Expected: collector port closed/filtered.
3. From VPN or trusted host, access collector.
- Expected: reachable only from trusted path.
4. Confirm runtime bind host.
- Check process/env shows `COLLECTOR_BIND_HOST=127.0.0.1` (or private IP with firewall restrictions).
5. Confirm firewall/security group rule set screenshot/export.
6. Confirm reverse proxy rules do not expose collector publicly.

## Minimum required env posture for collector
- `NODE_ENV=production`
- `COLLECTOR_BIND_HOST=127.0.0.1`
- `CORS_ALLOWED_ORIGINS=<internal admin origin(s) only>`
- `COLLECTOR_SYNC_BACKEND_API=<https internal/backend endpoint>`
- `LIFECYCLE_SYNC_TOKEN=<long random secret>`
