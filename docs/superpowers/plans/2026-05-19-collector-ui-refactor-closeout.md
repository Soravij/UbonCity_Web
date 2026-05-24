# Collector UI Refactor Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Collector UI refactor by turning the current override-heavy CSS into a stable, auditable styling system without changing workflow logic or page routing.

**Architecture:** Keep `collector/server/public/styles.css` as the single stylesheet for this phase, but re-establish a clear source-of-truth order: tokens -> shared primitives -> page-scoped components -> final page-specific exceptions. Remove duplicated selector chains and broad catch-all overrides only after the canonical rule is identified and verified in both light and dark mode.

**Tech Stack:** Static HTML, vanilla JS, one shared CSS bundle, theme toggle via existing collector theme scripts.

---

### Task 1: Freeze Scope And Build The Closeout Inventory

**Files:**
- Modify: `D:\UbonCity_Web\collector\server\public\styles.css`
- Review only: `D:\UbonCity_Web\collector\server\public\index.html`
- Review only: `D:\UbonCity_Web\collector\server\public\clean-item.html`
- Review only: `D:\UbonCity_Web\collector\server\public\item-editor.html`
- Review only: `D:\UbonCity_Web\collector\server\public\article-workspace.html`
- Review only: `D:\UbonCity_Web\collector\server\public\article-submit.html`
- Review only: `D:\UbonCity_Web\collector\server\public\event-workspace.html`
- Review only: `D:\UbonCity_Web\collector\server\public\event-submit.html`
- Review only: `D:\UbonCity_Web\collector\server\public\events-manager.html`
- Review only: `D:\UbonCity_Web\collector\server\public\events.html`
- Review only: `D:\UbonCity_Web\collector\server\public\field-brief.html`
- Review only: `D:\UbonCity_Web\collector\server\public\export-item.html`
- Review only: `D:\UbonCity_Web\collector\server\public\transport-map-workspace.html`
- Review only: `D:\UbonCity_Web\collector\server\public\transport-map-review.html`
- Review only: `D:\UbonCity_Web\collector\server\public\transport-v2-review.html`
- Review only: `D:\UbonCity_Web\collector\server\public\article-intake.html`

- [ ] **Step 1: Lock the allowed execution scope**

Allowed changes for the closeout:
- `styles.css` cleanup and consolidation
- HTML class additions/removals only where already introduced for styling consolidation such as `btn-home`
- No backend
- No routing logic
- No workflow logic

- [ ] **Step 2: Mark the current blockers from the audit as the closeout entrance criteria**

Closeout blockers:
- `styles.css` still contains override-driven late blocks with high `!important` density
- assignments table selectors are repeated across many ranges
- `.article-page-shell button:not(...)` is too broad and unsafe as a long-term primitive
- `:has(#panel-assignments.active)` is repeated and should not remain scattered

- [ ] **Step 3: Define the success gate**

The refactor can be called closed only when:
- canonical primitives exist and are not routinely overridden later by broader selectors
- duplicated selector chains are reduced materially
- page-specific exceptions are localized and documented by placement
- light and dark mode both work on all touched collector pages

### Task 2: Rebuild CSS Layer Order Inside `styles.css`

**Files:**
- Modify: `D:\UbonCity_Web\collector\server\public\styles.css`

- [ ] **Step 1: Separate the stylesheet mentally into four layers and preserve that order while editing**

Layer order to enforce:
1. token definitions
2. shared primitives
3. shared component families
4. page-specific overrides

- [ ] **Step 2: Promote canonical shared primitives**

Canonical shared primitives that should win:
- `button`
- `input, select, textarea`
- `table, th, td`
- `.btn-home`
- badge/pill families already tokenized

These should stay near the shared primitive section, not be redefined again later unless strictly page-scoped.

- [ ] **Step 3: Demote catch-all late overrides**

Selectors to reduce or eliminate as generic sources of truth:
- `.article-page-shell button:not(.primary):not(.ok):not(.warn):not(.fail):not(.utility-action):not(.nav-next)`
- repeated `#panel-assignments.as-scope .as-table th/td` blocks that only restate layout and density
- repeated `:root[data-theme="dark"] .container:has(#panel-assignments.active)` blocks

- [ ] **Step 4: Keep only true exceptions at the end of the file**

Allowed end-of-file exception buckets:
- assignments-only dense table polish
- clean-item evidence table polish
- raw panel late cleanup where legacy markup forces a scoped override

### Task 3: Consolidate Assignments Table Rules To One Canonical Cluster

**Files:**
- Modify: `D:\UbonCity_Web\collector\server\public\styles.css`
- Review only: `D:\UbonCity_Web\collector\server\public\index.html`

- [ ] **Step 1: Treat the assignments table family as one component**

Component scope:
- `#panel-assignments.as-scope .as-table`
- `#panel-assignments.as-scope table[id^="table-assignments"]`

- [ ] **Step 2: Keep one canonical light cluster**

That cluster should own:
- table layout
- header density
- cell density
- action column alignment
- row selected state
- action stack sizing

- [ ] **Step 3: Keep one canonical dark cluster**

That cluster should own:
- dark table backgrounds
- dark action button surfaces
- dark selected-row treatment
- dark hover treatment

- [ ] **Step 4: Remove duplicated intermediate declarations only if a later canonical declaration fully covers them**

Safe removal rule:
- remove only when same selector family is restated later with equal or higher specificity and no needed unique property would be lost

- [ ] **Step 5: Preserve these behaviors exactly**

Must remain true after cleanup:
- header/body alignment stays correct
- last action column remains right aligned
- mobile min-width behavior stays intact
- dark selected row remains visible

### Task 4: Replace Broad Article-Shell Button Override With Explicit Families

**Files:**
- Modify: `D:\UbonCity_Web\collector\server\public\styles.css`
- Review only: `D:\UbonCity_Web\collector\server\public\clean-item.html`
- Review only: `D:\UbonCity_Web\collector\server\public\item-editor.html`
- Review only: `D:\UbonCity_Web\collector\server\public\article-workspace.html`
- Review only: `D:\UbonCity_Web\collector\server\public\article-submit.html`

- [ ] **Step 1: Audit which buttons the broad selector is currently styling**

Current risky selector:
- `.article-page-shell button:not(.primary):not(.ok):not(.warn):not(.fail):not(.utility-action):not(.nav-next)`

- [ ] **Step 2: Replace it with explicit button groups**

Safer explicit families:
- `button[id^="btn-insert"]`
- evidence/action-stack buttons
- workspace secondary action buttons that truly need the neutral-blue style

- [ ] **Step 3: Do not rely on negative selector lists for future behavior**

Closeout rule:
- every visually distinct button family should have a positive selector, not a negative catch-all selector

### Task 5: Normalize Theme Hooks And Remove Repeated Theme Containers

**Files:**
- Modify: `D:\UbonCity_Web\collector\server\public\styles.css`

- [ ] **Step 1: Collapse repeated `:has(#panel-assignments.active)` blocks**

Current target area:
- `.container:has(#panel-assignments.active)`
- `:root[data-theme="dark"] .container:has(#panel-assignments.active)`

Goal:
- one light declaration
- one dark declaration
- no duplicate spread across multiple sections

- [ ] **Step 2: Keep theme state driven by tokens first**

Rule:
- prefer token swaps in `:root` and `:root[data-theme="dark"]`
- use page-scoped dark blocks only when markup forces it

- [ ] **Step 3: Preserve clean-item/theme toggle behavior**

No changes may regress:
- `clean-item.html` light/dark switching
- auth header input styling in both modes

### Task 6: Final Dead-Code Cleanup Pass

**Files:**
- Modify: `D:\UbonCity_Web\collector\server\public\styles.css`

- [ ] **Step 1: Remove selectors already replaced by canonical equivalents**

Expected dead-code candidates:
- duplicate assignment action-stack declarations
- duplicate `table-substatus` declarations already covered by broader canonical scope
- duplicate `last-child` alignment declarations already covered by later canonical block

- [ ] **Step 2: Keep fallback selectors only where HTML migration is still transitional**

Example:
- `btn-home` consolidation may keep legacy compatibility only if any remaining page still depends on the old path during this phase

- [ ] **Step 3: Do not remove a selector just because it looks redundant**

Removal rule:
- confirm later surviving selector covers the same pages, same mode, and same state

### Task 7: Regression Sweep By Page And Mode

**Files:**
- Verify: `D:\UbonCity_Web\collector\server\public\index.html`
- Verify: `D:\UbonCity_Web\collector\server\public\clean-item.html`
- Verify: `D:\UbonCity_Web\collector\server\public\item-editor.html`
- Verify: `D:\UbonCity_Web\collector\server\public\article-workspace.html`
- Verify: `D:\UbonCity_Web\collector\server\public\article-submit.html`
- Verify: `D:\UbonCity_Web\collector\server\public\event-workspace.html`
- Verify: `D:\UbonCity_Web\collector\server\public\event-submit.html`
- Verify: `D:\UbonCity_Web\collector\server\public\events-manager.html`
- Verify: `D:\UbonCity_Web\collector\server\public\events.html`
- Verify: `D:\UbonCity_Web\collector\server\public\field-brief.html`
- Verify: `D:\UbonCity_Web\collector\server\public\export-item.html`
- Verify: `D:\UbonCity_Web\collector\server\public\transport-map-workspace.html`
- Verify: `D:\UbonCity_Web\collector\server\public\transport-map-review.html`
- Verify: `D:\UbonCity_Web\collector\server\public\transport-v2-review.html`
- Verify: `D:\UbonCity_Web\collector\server\public\article-intake.html`

- [ ] **Step 1: Verify light mode**

Required checks:
- buttons render with correct family styles
- form controls stay readable
- table headers and cells align
- no old warm theme pockets remain in touched pages unless intentionally preserved

- [ ] **Step 2: Verify dark mode**

Required checks:
- no washed-out panels
- no hidden text on dark surfaces
- action buttons remain distinguishable
- assignments table remains aligned and readable

- [ ] **Step 3: Verify navigation-critical pages**

Must specifically recheck:
- `index.html?tab=raw`
- assignments handoff/work/review flows
- `clean-item.html?id=<sample>`
- article/event/transport workspace back-home bars

- [ ] **Step 4: Record any remaining exceptions as post-closeout backlog, not silent leftovers**

Acceptable backlog items:
- deliberate future font unification beyond collector
- non-collector frontend theme work
- deeper component extraction beyond current HTML/CSS architecture

### Task 8: Final Acceptance Gate

**Files:**
- Review only: `D:\UbonCity_Web\collector\server\public\styles.css`

- [ ] **Step 1: Run the closeout checklist**

Closeout checklist:
- `styles.css` no longer depends on broad late catch-all selectors for article-shell buttons
- assignments table family has one canonical light cluster and one canonical dark cluster
- duplicate selector chains materially reduced
- no new HTML/JS behavior regressions introduced
- touched collector pages still theme-switch correctly

- [ ] **Step 2: Refuse to call it done if only the visuals look fine**

Refactor is not complete unless:
- the cascade is understandable
- dead duplicate selectors are removed
- remaining exceptions are clearly intentional

---

Plan complete and saved to `docs/superpowers/plans/2026-05-19-collector-ui-refactor-closeout.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
