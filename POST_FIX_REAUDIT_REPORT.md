# POST_FIX_REAUDIT_REPORT

## Scope
Credential-related blockers only, re-audited after latest fixes:
1. `POST /api/users` strong password enforcement
2. `PATCH /api/users/:id/password` strong password enforcement
3. No weak default password in `collector-app/scripts/run-collect.ps1`
4. No weak credential examples in `collector-app/postman/*.postman_collection.json`
5. Search results for `admin1234`, `password123`, `uboncity_secret` contain no operationally unsafe leftovers

## Verification Results

### 1) Collector `POST /api/users` enforces strong password policy
- Status: **PASS**
- Evidence:
  - `collector-app/server/index.mjs` defines:
    - `MIN_PASSWORD_LENGTH = 12`
    - `WEAK_PASSWORDS` deny-list including `admin1234`, `password`, `password123`, `123456`, `12345678`, `qwerty`, `letmein`, `admin`
  - `POST /api/users` calls `validateStrongPassword(password)` and returns `400` with safe message when invalid.

### 2) Collector `PATCH /api/users/:id/password` enforces strong password policy
- Status: **PASS**
- Evidence:
  - `collector-app/server/index.mjs` password reset route calls `validateStrongPassword(newPassword)`.
  - Invalid password returns `400` with safe message.

### 3) No weak default password in `collector-app/scripts/run-collect.ps1`
- Status: **PASS**
- Evidence:
  - `Password` parameter has no default value.
  - Script requires explicit secret input from `-Password` or `COLLECTOR_OWNER_PASSWORD`.
  - Missing both causes explicit failure: `Collector password is required. Provide -Password or set COLLECTOR_OWNER_PASSWORD.`

### 4) No weak credential example in Postman collections
- Status: **PASS**
- Evidence:
  - `collector-app/postman/UbonCity-Collector.postman_collection.json` and `collector-app/postman/UbonCity-Collector-MIN.postman_collection.json` login body uses:
    - `{{OWNER_EMAIL}}`
    - `{{OWNER_PASSWORD}}`
  - Both include security warning text requiring secure replacement and no weak/default passwords.
  - No `admin1234`/`password123` examples found in these collection files.

### 5) Repo search for weak strings has no operationally unsafe leftovers
- Status: **PASS (with classification)**
- Search terms:
  - `admin1234`
  - `password123`
  - `uboncity_secret`
- Result classification:
  - Remaining matches are in historical audit/report markdown files (documentation of past issues), and in intentional weak-password deny-lists:
    - `collector-app/db/client.mjs`
    - `collector-app/server/index.mjs`
  - No active default credential values remain in operational scripts, Postman operational examples, or runtime credential fallbacks verified in this re-audit scope.

## Regressions or Unsafe Side Effects
- None found within credential-only scope.

## Final Credential Re-audit Conclusion
- Credential-related blockers requested in this re-audit are **resolved**.
- Manual runtime verification is still recommended using `RETEST_CHECKLIST.md` before final private deployment sign-off.
