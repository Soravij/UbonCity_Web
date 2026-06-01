# Dark Mode Foundation Audit (Steps 1-3)

Date: 2026-03-20
Scope: `collector-app`, `frontend`, `admin`

## 1) Source Inventory (Hardcoded Color Usage)

Counts are from source files only (excluded `node_modules`, build output).

| App | Primary files scanned | Approx. color literals |
| --- | --- | --- |
| collector-app | `server/public/*.css,*.js,*.html` | `styles.css: 148`, `item-editor.js: 12`, `app.js: 2` |
| frontend (public web) | `app/**`, `components/**`, `lib/**` | `TransportRoutesMap.jsx: 15`, `app/globals.css: 11`, `Navbar.jsx: 9`, `LanguageSwitch.jsx: 5` |
| admin frontend | `src/**` | `App.css: 55`, `index.css: 9`, `pages/TransportAdmin.jsx: 6`, `pages/Approvals.jsx: 2` |

### Theme Hook Points

- collector-app: HTML entry pages in `server/public` + shared global stylesheet `server/public/styles.css`
- frontend: root layout `frontend/app/layout.js` + global stylesheet `frontend/app/globals.css`
- admin: Vite entry HTML `admin/index.html` + global stylesheet `admin/src/index.css`

## 2) Shared Semantic Token Contract

Base semantic tokens aligned across all 3 apps:

- `--theme-bg*` (background layers/gradients)
- `--theme-surface`, `--theme-surface-soft`
- `--theme-border`
- `--theme-text`, `--theme-text-muted`
- `--theme-primary`, `--theme-primary-strong`
- `--theme-success`, `--theme-warning`, `--theme-danger`
- `--theme-focus-ring`
- `--theme-overlay`
- `--theme-selection`

Legacy app variables are preserved and mapped to semantic tokens where applicable (additive, no breaking rename).

## 3) Theme Switching Contract

Implemented as pre-render bootstrap script in entry HTML/layout for all 3 apps.

### Storage and Modes

- Local storage key: `ubon_theme_preference`
- Allowed modes: `light`, `dark`, `system`
- `system` resolves from `prefers-color-scheme: dark`

### Runtime behavior

- Sets `data-theme` (`light`/`dark`) on `<html>`
- Sets `data-theme-preference` (`light`/`dark`/`system`) on `<html>`
- Watches system color-scheme change and auto-syncs only when preference is `system`
- Exposes `window.__UBON_THEME__` with:
  - `key`
  - `getPreference()`
  - `setPreference(preference)`
  - `syncSystem()`

## Out of Scope in this batch

- No component-by-component color refactor yet
- No UI toggle controls added yet
- No route/business logic changes
