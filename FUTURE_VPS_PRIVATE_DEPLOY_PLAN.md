# FUTURE_VPS_PRIVATE_DEPLOY_PLAN

## 1) Code readiness vs infra readiness

### Code-level readiness (from repository)
- Backend: Node/Express + MySQL (`backend/`)
- Frontend: Next.js (`frontend/`)
- Admin: Vite React (`admin/`)
- Collector: Node/Express + SQLite + media/export files (`collector-app/`)

### Infra-level readiness (must be done after VPS exists)
- Network isolation (especially collector)
- TLS certificates and DNS
- Firewall/security group policy
- Secret injection and rotation
- Backup scheduling and restore validation

## 2) Recommended service separation (minimum practical)
1. Public-facing
- `frontend` (public)
- `backend` API (public or private-to-admin/frontend depending product needs)

2. Restricted
- `admin` (private testers only; IP allowlist and/or auth gateway)

3. Internal-only
- `collector-app` (must not be publicly reachable)

## 3) Which services may be public
- May be public: frontend, required backend endpoints.
- Should be restricted: admin.
- Must remain private/internal: collector-app.

## 4) Reverse proxy expectations
- Use reverse proxy for HTTPS and routing.
- Explicit upstream routing only; no catch-all forwarding to collector.
- Collector upstream should be internal-only route or private host.

## 5) TLS/HTTPS expectations
- TLS required for all operator/browser access.
- No plaintext HTTP for internet-accessible routes.
- Internal collector traffic may be private network only, but HTTPS still recommended if cross-host.

## 6) Firewall/security group expectations
- Expose only required ports (`443`, `22` restricted).
- Keep collector service port closed from public internet.
- Restrict admin panel access to approved tester IPs or VPN.

## 7) Env/secret handling expectations
- Use secret store/systemd env file outside repo.
- Never commit real `.env` values.
- Required secure secrets include:
  - backend `JWT_SECRET`, DB credentials, `LIFECYCLE_SYNC_TOKEN`
  - collector owner/admin password and `LIFECYCLE_SYNC_TOKEN`

## 8) Minimum monitoring/logging expectations
- Process uptime monitoring for backend/frontend/admin/collector.
- Error log capture with timestamps.
- Basic alerts for process down, repeated 5xx, repeated auth failures.

## 9) Backup expectations
- Backend MySQL backups + retention policy.
- Backend uploads directory backup.
- Collector SQLite DB backup.
- Collector media/raw/staging/export directory backup.
- Regular restore dry-run in staging copy.

## 10) Post-provision exact checks
1. Confirm external scan cannot reach collector port.
2. Confirm collector reachable only from trusted network path.
3. Confirm CORS values are explicit (no wildcard).
4. Confirm all production secrets loaded from secure env source.
5. Confirm first backup job runs and restore dry-run passes.
