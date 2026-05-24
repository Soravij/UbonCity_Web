# RETEST CHECKLIST

## 1) Create user with weak password -> must fail
- Endpoint: `POST /api/users`
- Request: valid `name` + `email` + weak `password` values:
  - `admin1234`
  - `password`
  - `password123`
  - `123456`
  - `12345678`
  - `qwerty`
  - `letmein`
  - `admin`
  - any password with length `< 12`
- Expected:
  - HTTP `400`
  - Safe error message (`password must be at least 12 characters` or `password is too weak`)
  - User is not created

## 2) Reset password to weak password -> must fail
- Endpoint: `PATCH /api/users/:id/password`
- Request: valid target `id` + weak `newPassword` values from section 1
- Expected:
  - HTTP `400`
  - Safe error message (`password must be at least 12 characters` or `password is too weak`)
  - Password is not changed

## 3) Create/reset with strong password -> must pass
- Endpoint: `POST /api/users`
- Request example password: `N9r!x2Qm#7Lp`
- Expected:
  - HTTP success (`200/201`)
  - User created successfully

- Endpoint: `PATCH /api/users/:id/password`
- Request example password: `V4t@k8Mn!2Zq`
- Expected:
  - HTTP `200`
  - Password changed successfully
  - Login works with new password and fails with old password

## 4) Verify script no longer contains default password
- File: `collector-app/scripts/run-collect.ps1`
- Checks:
  - No hardcoded default password in `param(...)`
  - Script throws if password is missing from both:
    - `-Password`
    - `COLLECTOR_OWNER_PASSWORD` environment variable
- Expected:
  - No weak/default credential value exists in script
  - Script requires explicit secure secret input

## 5) Verify Postman collections use placeholders only
- Files:
  - `collector-app/postman/UbonCity-Collector.postman_collection.json`
  - `collector-app/postman/UbonCity-Collector-MIN.postman_collection.json`
- Checks:
  - Login request uses:
    - `{{OWNER_EMAIL}}`
    - `{{OWNER_PASSWORD}}`
  - Collection description includes security warning about replacing placeholders and avoiding weak/default passwords
  - No `admin1234` or `password123` examples remain
- Expected:
  - Only placeholder credentials are present in operational examples
