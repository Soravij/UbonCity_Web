# Collector Cache Busting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure collector HTML pages pick up new frontend code after deploy without requiring incognito or manual hard refresh.

**Architecture:** Keep the current Express-served static collector architecture. Add HTML revalidation headers at the server layer and append a server-generated version token to collector asset URLs, first for the root page, then for every collector HTML entrypoint.

**Tech Stack:** Node.js, Express, static HTML/JS/CSS in `collector/server/public`

---

## File Structure

**Modify**
- `collector/server/index.mjs`
  - Add a single collector asset version token source.
  - Add HTML response cache policy for collector HTML routes.
  - Serve versioned HTML for `/` and extend the same pattern to other collector HTML entrypoints.
- `collector/server/public/index.html`
  - Replace hardcoded asset URLs with version-token placeholders.
- `collector/server/public/article-intake.html`
- `collector/server/public/article-preview.html`
- `collector/server/public/article-submit.html`
- `collector/server/public/article-workspace.html`
- `collector/server/public/clean-item.html`
- `collector/server/public/editor-home.html`
- `collector/server/public/event-preview.html`
- `collector/server/public/event-submit.html`
- `collector/server/public/event-workspace.html`
- `collector/server/public/events-manager.html`
- `collector/server/public/events.html`
- `collector/server/public/export-item.html`
- `collector/server/public/field-brief.html`
- `collector/server/public/freelance-home.html`
- `collector/server/public/item-editor.html`
- `collector/server/public/other-transport.html`
- `collector/server/public/place.html`
- `collector/server/public/transport-map-review.html`
- `collector/server/public/transport-map-routes.html`
- `collector/server/public/transport-map-workspace.html`
- `collector/server/public/transport-v2-base-maps.html`
- `collector/server/public/transport-v2-path-editor.html`
- `collector/server/public/transport-v2-review.html`
- `collector/server/public/transport-v2-routes-review.html`
- `collector/server/public/transport-v2-routes.html`
- `collector/server/public/transport-v2-workspace.html`
- `collector/server/public/transport.html`
  - Replace static asset references (`theme-bootstrap.js`, `theme-control.js`, `styles.css`, page module scripts) with placeholders that accept a server version token.

**Documentation**
- `docs/COLLECTION_WORKFLOW.md`
  - Add deployment note that collector HTML/asset cache-busting is now server-managed.
- `agent.md`
  - Add runtime validation checklist for post-deploy collector cache-busting verification.

---

### Task 1: Inventory Collector HTML Entry Points

**Files:**
- Modify: `docs/superpowers/plans/2026-05-27-collector-cache-busting-plan.md`
- Read: `collector/server/index.mjs`
- Read: `collector/server/public/*.html`

- [ ] **Step 1: Confirm the collector HTML inventory**

Run:

```powershell
Get-ChildItem collector\server\public\*.html | Select-Object Name
```

Expected: list of collector HTML entry files including `index.html`, `place.html`, `events.html`, transport pages, and workspace pages.

- [ ] **Step 2: Confirm current asset reference patterns**

Run:

```powershell
Get-ChildItem collector\server\public\*.html | Select-String -Pattern '<script','<link rel="stylesheet"','theme-bootstrap','theme-control','styles.css'
```

Expected: every collector HTML page references shared theme/bootstrap assets and one page-specific module script.

- [ ] **Step 3: Confirm current root route behavior**

Run:

```powershell
Select-String -Path collector/server/index.mjs -Pattern 'app.use\(express.static','app.get\("/"','sendFile'
```

Expected: root page is served by Express static + `sendFile`, with no collector-wide HTML cache-busting layer yet.

- [ ] **Step 4: Commit the inventory checkpoint**

```bash
git add docs/superpowers/plans/2026-05-27-collector-cache-busting-plan.md
git commit -m "chore(plan): document collector cache-busting scope"
```

---

### Task 2: Fix-1 Root Page Cache Busting

**Files:**
- Modify: `collector/server/index.mjs`
- Modify: `collector/server/public/index.html`

- [ ] **Step 1: Write the failing runtime expectation**

Document the expectation in the code review notes for this task:

```text
After deploy and collector restart, opening "/" in a normal browser session should load the newest index HTML and newest app.js/theme assets without requiring incognito.
```

- [ ] **Step 2: Add a single collector asset version token source**

Implementation target:

```js
const collectorAssetVersion =
  String(process.env.COLLECTOR_ASSET_VERSION || "").trim()
  || String(process.env.GIT_COMMIT || "").trim()
  || String(Date.now());
```

Rule:
- version source must be centralized in `collector/server/index.mjs`
- do not spread hardcoded `?v=` values across HTML files

- [ ] **Step 3: Add a small HTML rendering helper for version tokens**

Implementation target:

```js
function renderCollectorHtmlTemplate(fileName) {
  const htmlPath = path.join(dirs.rootDir, "server", "public", fileName);
  const html = fsSync.readFileSync(htmlPath, "utf8");
  return html.replaceAll("__COLLECTOR_ASSET_VERSION__", encodeURIComponent(collectorAssetVersion));
}
```

Rule:
- keep replacement simple
- only replace explicit placeholders
- do not add a general-purpose templating system

- [ ] **Step 4: Change `/` to return revalidated HTML**

Implementation target:

```js
app.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.type("html").send(renderCollectorHtmlTemplate("index.html"));
});
```

Rule:
- apply revalidation to HTML response
- do not weaken media/static cache rules globally in this step

- [ ] **Step 5: Replace hardcoded asset URLs in `index.html`**

Implementation target:

```html
<script src="/theme-bootstrap.js?v=__COLLECTOR_ASSET_VERSION__"></script>
<link rel="stylesheet" href="/styles.css?v=__COLLECTOR_ASSET_VERSION__" />
<script defer src="/theme-control.js?v=__COLLECTOR_ASSET_VERSION__"></script>
<script type="module" src="/app.js?v=__COLLECTOR_ASSET_VERSION__"></script>
```

- [ ] **Step 6: Run targeted verification**

Run:

```powershell
node --check collector/server/index.mjs
```

Expected: no syntax errors

Manual verification:
- open `/` in a normal browser session
- confirm `index.html` re-fetches after restart
- confirm `app.js` URL contains a version query
- confirm owner sees `google_maps`
- confirm non-owner does not see `google_maps`

- [ ] **Step 7: Commit**

```bash
git add collector/server/index.mjs collector/server/public/index.html
git commit -m "fix(collector): cache-bust root collector assets"
```

---

### Task 3: Fix-2 Collector-Wide HTML Cache Busting

**Files:**
- Modify: `collector/server/index.mjs`
- Modify: every collector HTML file listed in File Structure except `index.html` already covered in Task 2

- [ ] **Step 1: Group collector HTML pages by asset pattern**

Use this grouping while editing:
- shared shell pages using `theme-bootstrap.js`, `styles.css`, `theme-control.js`, plus one page module
- special cases already carrying manual version strings, such as `field-brief.html`

Expected: one replacement rule can cover nearly all pages.

- [ ] **Step 2: Replace hardcoded asset URLs in all collector HTML files**

Required replacement pattern:

```html
<script src="/theme-bootstrap.js?v=__COLLECTOR_ASSET_VERSION__"></script>
<link rel="stylesheet" href="/styles.css?v=__COLLECTOR_ASSET_VERSION__" />
<script defer src="/theme-control.js?v=__COLLECTOR_ASSET_VERSION__"></script>
<script type="module" src="/<page-module>.js?v=__COLLECTOR_ASSET_VERSION__"></script>
```

Rule:
- remove legacy hardcoded version strings like `?v=20260508-1`
- use the same placeholder everywhere

- [ ] **Step 3: Extend HTML route handling beyond `/`**

Implementation target:

```js
const collectorHtmlRoutes = new Map([
  ["/", "index.html"],
  ["/place.html", "place.html"],
  ["/events.html", "events.html"],
  // continue for every collector HTML entry file
]);
```

And:

```js
for (const [routePath, fileName] of collectorHtmlRoutes.entries()) {
  app.get(routePath, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.type("html").send(renderCollectorHtmlTemplate(fileName));
  });
}
```

Rule:
- explicit map, not implicit wildcard templating
- keep route/file mapping readable and auditable

- [ ] **Step 4: Keep non-HTML static assets on `express.static`**

Do not remove:

```js
app.use(express.static(path.join(dirs.rootDir, "server", "public"), { index: false }));
```

Reason:
- JS, CSS, and other assets still need to be served directly
- only HTML responses need revalidation handling

- [ ] **Step 5: Run targeted verification**

Run:

```powershell
node --check collector/server/index.mjs
```

Expected: no syntax errors

Manual verification pages:
- `/`
- `/place.html`
- `/events.html`
- `/editor-home.html`
- `/freelance-home.html`
- `/field-brief.html`
- one transport page

Expected:
- HTML returns no-cache headers
- every collector JS/CSS URL carries the same version token
- normal browser session gets updated code after collector restart

- [ ] **Step 6: Commit**

```bash
git add collector/server/index.mjs collector/server/public/*.html
git commit -m "fix(collector): apply cache-busting to all collector html pages"
```

---

### Task 4: Docs and Runtime Validation Closeout

**Files:**
- Modify: `docs/COLLECTION_WORKFLOW.md`
- Modify: `agent.md`

- [ ] **Step 1: Update workflow documentation**

Add:

```md
- Collector HTML pages are served with revalidation headers.
- Collector JS/CSS URLs use a shared server-generated version token.
- Browser incognito should no longer be required after a clean deploy + restart.
```

- [ ] **Step 2: Update agent/runtime notes**

Add runtime validation checklist:

```md
1. Pull latest collector change
2. Restart collector stack
3. Open normal browser session, not incognito
4. Verify updated collector behavior on `/`
5. Verify one non-root collector page also loads new assets
```

- [ ] **Step 3: Final verification**

Run:

```powershell
git diff -- collector/server/index.mjs collector/server/public docs/COLLECTION_WORKFLOW.md agent.md
```

Expected:
- only collector cache-busting and documentation changes are present

- [ ] **Step 4: Commit**

```bash
git add docs/COLLECTION_WORKFLOW.md agent.md
git commit -m "docs(collector): document cache-busting deployment behavior"
```

---

## Self-Review

- Spec coverage: root page fix and collector-wide rollout are both covered.
- Placeholder scan: no `TODO`/`TBD` placeholders remain in execution tasks.
- Type consistency: plan consistently uses `collectorAssetVersion`, `renderCollectorHtmlTemplate`, and `collectorHtmlRoutes`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-27-collector-cache-busting-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
