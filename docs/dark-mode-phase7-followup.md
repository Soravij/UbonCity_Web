# Dark Mode Phase 7 Follow-up (Manual QA Round 2)

Date: 2026-03-20

## Scope in this round

- Reduce remaining eye-strain points from hardcoded colors in active UI paths.
- Keep changes narrow and additive (no business-flow changes).

## Changes applied

### frontend

- Replaced AQI inline hardcoded colors with class-based tones in `app/[lang]/page.js`.
- Added AQI tone classes for light/dark in `app/globals.css`:
  - `.aqi-unknown`, `.aqi-good`, `.aqi-moderate`, `.aqi-sensitive`, `.aqi-unhealthy`, `.aqi-very-unhealthy`, `.aqi-hazardous`

### admin

- Converted remaining bright panel styles in `src/App.css` to theme vars for:
  - inline-image manager blocks
  - transport side panel and transport map wrap
  - fullscreen transport background
  - menu badge palette source
- Converted approval log preview inline style in `src/pages/Approvals.jsx` to CSS vars (`--theme-border`, `--theme-surface`).

## Verification

- `frontend` lint (changed files): PASS (only existing `no-img-element` warning)
- `admin` eslint (`src/App.jsx` and `src/pages/Approvals.jsx`): PASS
- `frontend` production build: PASS
- `admin` production build: PASS
- Runtime smoke:
  - `frontend /th`: 200 + theme bootstrap/control present
  - `collector-app /`: 200 + theme control script present

## Remaining note

- `admin` preview server is still environment-sensitive (sporadic spawn/EPERM), so runtime presence is validated via successful build + artifact checks.
