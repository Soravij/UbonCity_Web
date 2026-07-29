# Dark Mode Phase 7 Test Report

Date: 2026-03-20
Scope: `collector-app`, `frontend`, `admin`

## 1) Static / Syntax Checks

- `node --check collector-app/server/public/app.js` -> PASS
- `node --check collector-app/server/public/item-editor.js` -> PASS
- `node --check collector-app/server/public/export-item.js` -> PASS
- `node --check collector-app/server/public/theme-control.js` -> PASS

## 2) Build Checks

- `npm --prefix frontend run build` -> PASS
- `npm --prefix admin run build` -> PASS

## 3) Runtime Smoke

### collector-app (port 5090)

Checked endpoints:

- `/` -> 200 + contains `theme-control.js`
- `/clean-item.html` -> 200 + contains `theme-control.js`
- `/item-editor.html?id=1` -> 200 + contains `theme-control.js`
- `/export-item.html?id=1` -> 200 + contains `theme-control.js`
- `/theme-control.js` -> 200 + contains `theme-mode-control`

### frontend (port 3101)

- `/` -> 200
- HTML contains `ubon_theme_preference` (bootstrap present)
- HTML contains `theme-mode-select` / `theme-mode-control` (control rendered)

### admin

- `vite preview` startup in this environment is unstable (spawn/EPERM behavior observed)
- Fallback verification from built artifact:
  - `admin/dist/index.html` contains `ubon_theme_preference` and `data-theme-preference`

## 4) Lint (Changed Files)

- `frontend`: `app/layout.js`, `components/Navbar.jsx`, `components/LanguageSwitch.jsx`, `components/ThemeModeControl.jsx` -> PASS
- `admin`: `src/App.jsx` -> PASS

## 5) Known Limitation

- Manual visual checks for contrast/focus/hover/mobile still recommended in real browser session (human QA).
