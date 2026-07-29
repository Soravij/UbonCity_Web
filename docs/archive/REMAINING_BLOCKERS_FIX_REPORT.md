# REMAINING_BLOCKERS_FIX_REPORT

## Scope
Credential-related deployment blockers only (collector auth/user management, collector operational script, collector Postman collections, targeted weak-string scan).

## Files changed
- `D:\UbonCity_Web\collector-app\server\index.mjs`
- `D:\UbonCity_Web\collector-app\scripts\run-collect.ps1`
- `D:\UbonCity_Web\collector-app\postman\UbonCity-Collector.postman_collection.json`
- `D:\UbonCity_Web\collector-app\postman\UbonCity-Collector-MIN.postman_collection.json`

## Exact credential-policy changes

### 1) Strong password policy enforced for collector user-management flows
Implemented shared password policy in `collector-app/server/index.mjs` and applied to:
- `POST /api/users`
- `PATCH /api/users/:id/password`

Policy now enforced:
- Minimum length: **12**
- Reject exact weak/default passwords (case-insensitive after trim):
  - `admin1234`
  - `password`
  - `password123`
  - `123456`
  - `12345678`
  - `qwerty`
  - `letmein`
  - `admin`

Response behavior:
- Returns safe/clear `400` errors:
  - `password must be at least 12 characters`
  - `password is too weak`

## Exact defaults/examples removed

### 2) Operational script default password removed
File: `collector-app/scripts/run-collect.ps1`
- Removed default weak password parameter (`admin1234`).
- `-Password` now has no default.
- Script now requires password explicitly via:
  - `-Password` argument, or
  - `COLLECTOR_OWNER_PASSWORD` environment variable.
- If neither provided, script exits with clear error:
  - `Collector password is required. Provide -Password or set COLLECTOR_OWNER_PASSWORD.`

### 3) Postman weak credentials replaced with secure placeholders
Files:
- `collector-app/postman/UbonCity-Collector.postman_collection.json`
- `collector-app/postman/UbonCity-Collector-MIN.postman_collection.json`

Changes:
- Login request body now uses:
  - `{{OWNER_EMAIL}}`
  - `{{OWNER_PASSWORD}}`
- Removed old weak sample variables (`email`, `password` with weak values).
- Added collection variables:
  - `OWNER_EMAIL`
  - `OWNER_PASSWORD`
- Added warning in collection description:
  - placeholder credentials must be replaced securely and weak defaults must not be used.

## Targeted weak-string search result (operational impact)
Searched for:
- `admin1234`
- `password123`
- `uboncity_secret`

Result:
- No remaining operational script/Postman weak defaults for active use.
- Remaining matches are in audit/report markdown files (historical notes) and in password deny-lists (intentional security enforcement).

## Remaining manual steps
1. Set secure secret values before use:
- `OWNER_EMAIL`
- `OWNER_PASSWORD`
- `COLLECTOR_OWNER_PASSWORD` (if using `run-collect.ps1` without `-Password`)
2. Re-run manual credential tests from `RETEST_CHECKLIST.md`.
3. Ensure CI/deploy secret stores do not contain weak values.
