# DOM split migration plan — `#panel-assignments` → 3 physically separate containers

Audited HEAD: `af413aa41c3be91268ce196f9f81b89abf55398e`
Branch: `fix/pipeline-round-15aug`

This plan supersedes-in-**direction** (not in inventory-content — the fact-finding in both prior
documents is reused and cited throughout) the Option-B recommendation in
`audit/pagemode-refactor-plan.md`. The owner has locked the decision: split `#panel-assignments`
into 3 physically separate DOM containers (Option A from that document). This document plans the
migration to that structure. It does not re-argue the choice, and it does not design
`#workflow-backward-controls`'s show/hide logic (§F states only where the node lives after the
split).

Primary sources, both fresh at this HEAD, re-verified against live files during this pass (every
citation below not marked "per inventory" was re-read from `index.html`/`app.js`/`styles.css`/
`workflow-backward-transitions.js` directly in this session):

- `audit/pagemode-refactor-plan.md` — blast-radius table (§A), architecture options (§B), phased
  rollout for the double-decision bug (§C).
- `C:\Users\WIN11\AppData\Local\Temp\claude\D--UbonRuntime-repos-UbonCity-Web\2e199822-be3f-4677-9fd1-6dd253a5fb17\scratchpad\dom-split-inventory.md`
  — full id classification (§1), necessity-vs-accident analysis (§2), CSS ancestor-dependency
  audit (§3), JS call-site table (§4), dead-reference findings (§5).

This is a **plan-only** document. No code file was edited, no commit was made.

---

## A. New DOM structure

Three new per-mode containers, nested inside the existing `#panel-assignments` wrapper (kept —
see rationale in §C's CSS subsection):

- `#assignment-panel-handoff`
- `#assignment-panel-work`
- `#assignment-panel-review`

`#panel-assignments` itself survives as a thin outer shell holding: the Home button, the subnav,
`#workflow-backward-controls` (see §F), and the 3 containers below it — plus the `.as-scope` class
(`app.js:4576`) and the outer `.app-shell.assignment-process-mode #panel-assignments` display
switch (`styles.css:9518-9520`), both of which target this literal id and are cheapest to leave
alone rather than rewire to a new outer element.

### A.0 Markup sketch

```
<section id="panel-assignments" class="panel hidden">          <!-- unchanged id, kept as shell -->
  <div class="card page-actions-strip raw-process-actions">
    <button id="btn-assignments-home">Home</button>            <!-- unchanged, shared-by-necessity -->
  </div>
  <div class="toolbar compact-toolbar" id="assignment-subnav"> <!-- unchanged, shared-by-necessity -->
    <button id="assignment-mode-handoff" data-assignment-tab="handoff">...</button>
    <button id="assignment-mode-work" data-assignment-tab="work">...</button>
    <button id="assignment-mode-review" data-assignment-tab="review">...</button>
  </div>
  <section id="workflow-backward-controls" class="assignment-brief-card hidden"></section>
                                                                 <!-- unchanged id, repositioned only -->

  <div id="assignment-panel-handoff" class="assignment-panel-mode hidden">
    <h2 id="assignment-panel-title-handoff" class="section-title"></h2>
    <p id="assignment-panel-note-handoff" class="muted"></p>
    <div id="assignment-page-summary" class="readiness-alert ready hidden"></div>       <!-- unchanged id -->
    <div id="assignment-manual-create-panel" class="secondary-panel hidden"> ... </div> <!-- unchanged id + children -->
    <div id="assignment-list-panel-handoff" class="secondary-panel hidden">
      <h3 id="assignment-list-title-handoff"></h3>
      <p id="assignment-list-note-handoff"></p>
      <table id="table-assignments-handoff"> ... </table>       <!-- handoff queue view -->
    </div>
    <div id="assignment-detail-panel-handoff" class="secondary-panel hidden">
      <p id="assignment-selected-summary"></p>                  <!-- unchanged id -->
      <div class="assignment-guide"> id="assignment-next-action" / id="assignment-process-steps" </div>
      <div class="assignment-brief-card"> id="assignment-context-brief" </div>
      <div class="assignment-brief-card"> id="assignment-next-step-content" </div>
    </div>
    <div id="assignment-state-workspace" class="assignment-workspace-section hidden"> ... </div> <!-- unchanged id + children -->
    <details id="assignment-debug-box"> ... </details>          <!-- unchanged id + children -->
  </div>

  <div id="assignment-panel-work" class="assignment-panel-mode hidden">
    <h2 id="assignment-panel-title-work" class="section-title"></h2>
    <p id="assignment-panel-note-work" class="muted"></p>
    <div id="assignment-list-panel-work" class="secondary-panel hidden">
      <h3 id="assignment-list-title-work"></h3>
      <p id="assignment-list-note-work"></p>
      <div id="assignment-managed-list-wrap"> ... </div>        <!-- unchanged id + children -->
      <div class="grid">
        <div id="assignment-assignee-wrap"> ... </div>          <!-- unchanged id; dead, parked here -->
        <div id="assignment-limit-wrap-work">
          <input id="assignment-limit-work" type="number" .../>
        </div>
      </div>
      <h4 id="assignment-actionable-list-title"></h4>           <!-- unchanged id -->
      <table id="table-assignments-work"> ... </table>
      <div id="assignment-submitted-list-wrap"> ... </div>      <!-- unchanged id + children -->
    </div>
    <div id="assignment-submission-workspace" class="assignment-workspace-section hidden">
      <div id="assignment-work-monitor"> ... </div>             <!-- unchanged id + children -->
      <div id="assignment-submission-form"> ... </div>          <!-- unchanged id + full field subtree -->
      <div class="assignment-deliverables-card">
        <p id="assignment-deliverables-meta"></p>
        <div id="assignment-deliverables-summary"></div>        <!-- unchanged id; reclassified work-only, see §B -->
      </div>
    </div>
  </div>

  <div id="assignment-panel-review" class="assignment-panel-mode hidden">
    <h2 id="assignment-panel-title-review" class="section-title"></h2>
    <p id="assignment-panel-note-review" class="muted"></p>
    <div id="assignment-list-panel-review" class="secondary-panel hidden">
      <h3 id="assignment-list-title-review"></h3>
      <p id="assignment-list-note-review"></p>
      <div class="grid">
        <div id="assignment-limit-wrap-review">
          <input id="assignment-limit-review" type="number" .../>
        </div>
        <div id="assignment-review-tracking-wrap"> ... </div>   <!-- unchanged id + children -->
      </div>
      <table id="table-assignments-review"> ... </table>
    </div>
    <div id="assignment-review-workspace" class="assignment-workspace-section hidden"> ... </div> <!-- unchanged id + children -->
    <div id="assignment-return-to-field" class="assignment-workspace-section hidden"> ... </div>  <!-- unchanged id + children -->
    <div id="assignment-review-hover-preview" class="asset-hover-preview hidden"> ... </div>       <!-- unchanged id -->
  </div>
</section>
```

### A.1 Full id mapping table

Bucket columns cite the inventory row that established the classification. "unchanged" = id and
all descendant ids move as a block with no rename needed (single-use markup, no cross-mode
duplication).

| old id / cluster | inventory citation | new home | new id(s) |
|---|---|---|---|
| **handoff-only (4 clusters, inventory §1)** | | | |
| `assignment-page-summary` | inventory §1 handoff row 1; app.js:4483-4493 | `#assignment-panel-handoff` | unchanged |
| `assignment-manual-create-panel` (+13 children) | inventory §1 handoff row 3; app.js:3590-3592, 4495-4500 | `#assignment-panel-handoff` | unchanged |
| `assignment-state-workspace` (+9 children) | inventory §1 handoff row 4; app.js:4507-4508, 4627 (`stateMode:"hidden"` forced outside work), spot-checked app.js:4610-4662 | `#assignment-panel-work` | **CORRECTED**: original §A.1 classified this as handoff-only based on per-node toggle behavior (app.js:4485-4487 gating `pageMode !== "handoff"`). That toggle was itself a bug — the state workspace contains reopen_in_progress controls that belong in work mode. Moved to work container; per-node toggle updated to `pageMode !== "work"`. |
| **work-only (4 clusters, inventory §1)** | | | |
| `assignment-managed-list-wrap` (+3 children) | inventory §1 work row 1; app.js:8951-8958 | `#assignment-panel-work` (inside its list-panel) | unchanged |
| `assignment-submitted-list-wrap` (+3 children) | inventory §1 work row 2; app.js:9018-9025, 9090 | `#assignment-panel-work` (inside its list-panel) | unchanged |
| `assignment-submission-workspace` (+full form subtree, ~25 field ids) | inventory §1 work row 3; app.js:4514-4516, 4610-4631 | `#assignment-panel-work` | unchanged |
| `assignment-work-monitor` (+4 children) | inventory §1 work row 4; app.js:4529-4531, 3944-3988 | nested in `assignment-submission-workspace`, moves with it | unchanged |
| **review-only (5 clusters, inventory §1)** | | | |
| `assignment-review-workspace` (+13 children) | inventory §1 review row 1; app.js:4517-4518 | `#assignment-panel-review` | unchanged |
| `assignment-review-summary-card` (+content) | inventory §1 review row 2; app.js:4520-4522, 4257-4273 | `#assignment-panel-review` (inside review-workspace) | unchanged |
| `assignment-review-submission-card` (+4 children) | inventory §1 review row 3; app.js:4523-4525, 4127-4146 | `#assignment-panel-review` (inside review-workspace) | unchanged |
| `assignment-return-to-field` (+4 children) | inventory §1 review row 4; app.js:9500-9512, gate at 9491 | `#assignment-panel-review` | unchanged |
| `assignment-review-tracking-wrap` (+checkbox) | inventory §1 review row 5; app.js:3587-3588 | `#assignment-panel-review` (inside its list-panel grid) | unchanged |
| **genuinely-shared, 12 nodes (inventory §1 "genuinely shared" table + §2)** | | | |
| `btn-assignments-home` | shared-by-necessity, inventory §2 row 1 | top-level shell, outside all 3 containers | unchanged |
| `assignment-panel-title` | shared-by-accident, inventory §2 row 3; app.js:4465-4471 | one per container | `assignment-panel-title-handoff` / `-work` / `-review` |
| `assignment-panel-note` | shared-by-accident, same row; app.js:4472-4482 | one per container | `assignment-panel-note-handoff` / `-work` / `-review` |
| `assignment-subnav` (+3 mode buttons) | shared-by-necessity, inventory §2 row 2 | top-level shell | unchanged |
| `assignment-list-panel` (outer) | shared-by-accident, inventory §2 row 4; app.js:9097 handoff branch vs 9186+ work/review branch | split 3 ways, content differs per mode (see §A.2) | `assignment-list-panel-handoff` / `-work` / `-review` |
| `table-assignments` | same row; renderAssignmentsTable app.js:9083-9258, re-read this pass | one per container (3 distinct render paths already exist at runtime — see §A.2) | `table-assignments-handoff` / `-work` / `-review` |
| `assignment-list-title` / `assignment-list-note` | app.js:9086-9087, 9102-9106, 9187-9203 | one per container | `assignment-list-title-handoff/-work/-review`, `assignment-list-note-handoff/-work/-review` |
| `assignment-assignee-wrap` (+select) | **dead** at this HEAD — condition always true, inventory §1 finding; app.js:3581-3583 re-verified this pass | parked in `#assignment-panel-work`'s list-panel (arbitrary — dead regardless of container) | unchanged |
| `assignment-limit-wrap` (+input) | live in work+review only (2 of 3 modes), inventory §1; app.js:3584-3585 | duplicated into both surviving containers | `assignment-limit-wrap-work`/`assignment-limit-work`, `assignment-limit-wrap-review`/`assignment-limit-review` |
| `assignment-detail-panel` (outer, +4 content children) | shared-by-accident with caveat, inventory §2 row 5; **re-verified this pass**: its only content (`assignment-selected-summary`, `.assignment-guide`, both `.assignment-brief-card`s) is hidden outside handoff by app.js:4541-4555 — the node has no functional content in work/review | real content moves to handoff only; no duplicate empty shell in work/review (see §A.2) | `assignment-detail-panel-handoff` |
| `assignment-context-brief` | shared-by-accident, inventory §2 row 6 | folds into `assignment-detail-panel-handoff`, no separate disposition | unchanged, inside handoff detail panel |
| `assignment-deliverables-summary` (+card, +`-meta`) | inventory §2 calls this "shared-by-necessity"; **re-verified this pass, contradicts that**: physically nested inside `#assignment-submission-workspace` (index.html:632-642, work-only block per §1), so it is *already* only ever reachable in work mode today regardless of the conceptual necessity argument — see §B | `#assignment-panel-work`, inside submission-workspace | unchanged |
| `assignment-debug-box` (+4 json children) | "effectively handoff-only in practice", inventory §1; app.js:4556-4558 | `#assignment-panel-handoff` | unchanged |
| `assignment-review-hover-preview` (+image) | "review-only in practice" (hover-driven), inventory §1 | `#assignment-panel-review` | unchanged |
| `workflow-backward-controls` | bucketed handoff-only in inventory §1 (reflects *current buggy* Writer-A-wins behavior) | **top-level shell**, not inside any container — see §F for why this deviates from the §1 bucketing | unchanged |

**Id tally**: 3 new container root ids, 6 title/note ids (3+3), 3 list-panel ids, 3 table-assignments
ids, 6 list-title/list-note ids (3+3), 1 detail-panel id (`-handoff`, replacing the old shared id),
4 limit-wrap/-input ids (2 wrap + 2 input for work/review copies) = **26 ids newly introduced or
renamed**. Every other id under the old `#panel-assignments` (~115+ remaining ids per inventory's
"~140 ids exist under `#panel-assignments`" estimate) moves unchanged, just reparented.

### A.2 Two findings that change the id count from a naive "triple everything"

1. **`#assignment-detail-panel`'s real content is handoff-only, not shared.** Its only children —
   `assignment-selected-summary`, the `.assignment-guide` block, and both `.assignment-brief-card`s
   (`assignment-context-brief`, `assignment-next-step-content`) — are unconditionally hidden
   outside handoff by `app.js:4541-4555`. In work/review, today's `#assignment-detail-panel` is an
   empty shell with a static header, whose only remaining purpose is a `.scrollIntoView(...)`
   target after row-selection (`app.js:11451`, `11463`). Duplicating an empty shell into 3
   containers is wasted markup; this plan instead makes handoff the sole owner of
   `assignment-detail-panel-handoff` and retargets the two `scrollIntoView` calls in work/review
   contexts to that mode's primary workspace section (`#assignment-submission-workspace` for work,
   `#assignment-review-workspace` for review) — see §D Step 3/4 and §E's `af413aa` row.
2. **`#assignment-deliverables-summary` is already work-only in the live DOM**, despite inventory
   §2 arguing it's conceptually shared. It sits physically inside `#assignment-submission-workspace`
   (index.html:632-642), which is itself hidden outside work mode (`app.js:4514-4516`) — so the
   "shared-by-necessity" claim was never exercised at runtime; the element cannot currently be seen
   in handoff or review no matter what its own hidden-toggle condition says. This plan preserves
   current behavior (work-only) rather than inventing new cross-mode visibility, which would be a
   product/content decision out of scope for a DOM-split migration.

---

## B. What stays shared

Only 2 clusters mount once, outside all 3 containers, with no per-mode duplication:

| element | why not split |
|---|---|
| `#btn-assignments-home` | Identical role in every mode (global nav), no per-mode content difference. No pageMode branch found anywhere referencing it (inventory §1, re-confirmed). |
| `#assignment-subnav` + 3 mode buttons | *Is* the mode switcher — it must exist above/outside whichever container is active by definition. Splitting it 3 ways would mean duplicating the tab strip and synchronizing `.active` state across copies, strictly worse (inventory §2 reasoning, unchanged). |

`#workflow-backward-controls` is also mounted at the top level (see §F) but for a different,
placement-only reason — it is not "necessity" in the same sense; it's a deliberate non-decision to
avoid prejudging deferred show/hide work.

Everything else in the old "genuinely shared" bucket (title/note, list-panel, detail-panel,
context-brief, deliverables-summary, table-assignments) turns out to be shared **by accident**
(inventory §2) or **by current physical nesting** (§A.2 finding 2) — both get split per §A.1, not
kept shared.

---

## C. Functions: dead vs rewritten vs moved

| function | file:line | classification | reasoning |
|---|---|---|---|
| `syncAssignmentPageMode` | `app.js:4419-4571` (re-read in full this pass) | **dies**, replaced by 3 smaller per-mode render functions (or the equivalent logic folded into whichever function already owns each container's content, e.g. `renderAssignmentsTable`, `renderAssignmentContextBrief`) | Its entire job today is "given one shared DOM tree, decide per-node which of ~20 things should be hidden based on `pageMode`." Once each mode has its own container, "hidden or not" collapses to "which container is active" — a single classList toggle on 3 nodes, not 20+ per-node toggles. The non-visibility work it also does (writing title/note text, calling `renderAssignmentContextBrief`/`renderAssignmentWorkMonitor`/`renderAssignmentReviewSummary`/`renderAssignmentReviewSubmissionContent`, calling `applyFreelanceWorkerView`/`syncAssignmentSubnav`/the 3 table renderers/`applyAssignmentModernClasses`) survives, relocated into whichever container-specific function replaces it. |
| `syncAssignmentWorkflowLayout` | `app.js:4610-4702` (re-read in full this pass) | **gets rewritten** | Its `effectiveLayout` computation (4616-4631, work-mode-specific state/submission/review-section mode overrides) still has a real job — computing labels/section modes for the work container — but it currently exists to feed 3 sections that live in one shared tree; post-split, `stateSection`/`reviewSection` lookups (4633, 4635) become meaningless inside the work container (state-workspace lives in handoff now, review-workspace in review) — the function's scope shrinks to just the work container's submission section, or splits into 3 tiny mode-specific layout functions. Its unconditional trailing call to `syncAssignmentPageMode(assignment)` (`4702`) must not survive as-is once that function is deleted. |
| `applySectionState` | `app.js:4641-4658` (local arrow function defined **inside** `syncAssignmentWorkflowLayout`, not a top-level function — corrects the other plan's citation of `4641-4662` as if it were standalone; the `4660-4662` lines are its 3 call sites, not part of its body) | **moves/renames with logic mostly intact** | The is-active/is-secondary/is-collapsed toggling logic (4644-4658) is sound and container-agnostic — it just needs to keep being called once per container's own section instead of 3 times against 3 siblings under one shared parent. |
| `setAssignmentDetailVisible` | `app.js:3779-3781`; 8 call sites: `4858`, `9279`, `9329`, `9598`, `9639`, `9724`, `10510`, `10529` (re-confirmed this pass at 3779-3781, 2505-2510 for one reorder call site) | **gets rewritten** | Post-split it only ever needs to toggle `assignment-detail-panel-handoff` (per §A.2 finding 1) — but every one of its 8 call sites currently fires unconditionally regardless of pageMode (e.g. from `applyLogoutUI`, `selectAssignment`'s two branches, `refreshAssignments`/`loadAssignmentsByItem`). Each site needs to become a no-op (or redirect to a work/review scroll-anchor per §A.2) when the active container isn't handoff. This is the highest-call-site-count single function in the migration — see §E's `c6821e7` row for the 2 sites that must not regress. |
| `applyAssignmentModernClasses` | `app.js:4573-4608` (re-read in full this pass) | **gets rewritten** | Keeps adding `.as-scope` to `qs("panel-assignments")` unchanged (4576) since the wrapper id survives (see CSS subsection below). Its 13 `addClassById(...)` calls (4579-4591, 4596-4597) targeting now-split ids (`assignment-list-panel`, `assignment-detail-panel`, `assignment-state-workspace`, `assignment-submission-workspace`, `assignment-review-workspace`, `assignment-review-summary-card`, `assignment-review-submission-card`, `assignment-managed-list-wrap`) each need updating to the new id (some become single unchanged-id calls since those clusters don't rename, others need to target the 3 new list-panel ids and the 1 new detail-panel id). |
| `ensureAssignmentHandoffLayoutOrder` | `app.js:2505-2519` (re-read this pass, header at 2505-2511) | **dies** | Its entire job is reordering `assignment-page-summary`/`assignment-list-panel`/`assignment-manual-create-panel`/`assignment-detail-panel` as DOM siblings under the old shared `#panel-assignments` root so the handoff layout reads top-to-bottom correctly at runtime. Once handoff's content lives in its own container in a single fixed markup order (§A.0), there is nothing left to reorder — the function's precondition (multiple pageModes sharing one flat sibling list) no longer holds. |
| `setAssignmentRoleVisibility` | `app.js:3554-3626` (re-read this pass) | **gets rewritten** | Still legitimately does role-gating (assignee-wrap/limit-wrap/review-tracking-wrap/tab visibility, 3581-3623) but every id it touches needs updating per §A.1 (e.g. `assigneeWrap`/`limitWrap` become the work-container copies; `createPanel` toggling folds into the handoff container's local render path). Its trailing calls (3624-3625) into `updateAssignmentActionControls`/`syncAssignmentPageMode` need to target whichever function replaces the latter. |
| `applyFreelanceWorkerView` | `app.js:447-...` (header + id lookups re-read this pass, 447-465) | **gets rewritten** | Already receives `pageMode` as a parameter (447), but grabs a single shared `assignment-panel-title`/`-note`/etc. id once (449-464) and overwrites it regardless of which mode is "current." Post-split, each of those ids is 3 nodes; the function needs to resolve the mode-specific node (e.g. `assignment-panel-title-${pageMode}`) instead of a bare id lookup. |
| `renderAssignmentsTable` | `app.js:9083-9258` (re-read in full this pass) | **gets rewritten** | Already contains 2 fully separate rendering paths behind one `if (pageMode === "handoff") { ... return; }` branch (9097-9184) vs. the shared work/review path (9186-9258) — i.e. it is *already* two functions wearing one name and one target id. Splitting `table-assignments` into 3 ids turns this cleanly into 3 render functions (or keeps 2 bodies — handoff-specific and work/review-shared — each writing to its own container's table id and wiring its own click delegation, since the click-delegation setup itself currently lives outside this function at `app.js:11425-11453` and must also become per-container, see §E's `af413aa` row). |
| `renderManagedAssignmentsTable`, `renderSubmittedAssignmentsTable` | `app.js:8951-8981`, `9018-9082` (per inventory §1/§4, not re-read line-by-line this pass beyond the citations already spot-checked) | **moves with logic intact** | Both are already single-writer, work-only functions (inventory §1 work rows 1-2) — no pageMode branching inside them to rewrite, just reparent their target ids' lookups if any id changes (they don't, per §A.1). |
| `renderAssignmentContextBrief`, `renderAssignmentWorkMonitor`, `renderAssignmentReviewSummary`, `renderAssignmentReviewSubmissionContent` | `app.js:6566-6621`, `3944-3988`, `~4132-4146`, `~4257-4273` (per inventory §1, not re-read line-by-line this pass) | **moves with logic mostly intact** | Single-writer content functions; `renderAssignmentContextBrief`'s own `pageMode !== "work"` branch (inventory §1, `app.js:6589`) becomes unreachable in practice once its parent card is handoff-only-mounted (§A.2 finding 1) — flag as dead-relevant code to clean up opportunistically, not required for the split to function. |

### CSS remediation (`.as-scope` / bare-`#panel-assignments` problem)

Because `#panel-assignments` is **kept** as the outer wrapper (not removed), and `.as-scope` stays
applied to that same wrapper (`app.js:4576`, unchanged), the vast majority of the ~999 `.as-scope`-
rooted selectors (styles.css ~6258-10397, per inventory §3) **continue to match unmodified** —
they're written as `.as-scope <descendant-class-selector>` (e.g. `.as-scope .secondary-panel`
`styles.css:6604`, `.as-scope .assignment-workspace-section` `6668`, `.as-scope .assignment-brief-card`
`6528`), and the 3 new containers remain genuine DOM descendants of the `.as-scope`-carrying wrapper
regardless of how markup is reorganized underneath it.

Only the **id-specific** compound selectors need surgery, because those specific ids are the ones
being split per §A.1:

- `styles.css:6520-6521` — `.as-scope #assignment-list-panel, .as-scope #assignment-detail-panel`
  → becomes `.as-scope #assignment-list-panel-handoff, .as-scope #assignment-list-panel-work,
  .as-scope #assignment-list-panel-review, .as-scope #assignment-detail-panel-handoff` (4 selectors
  replacing 2; detail-panel only needs 1 since it's handoff-only now per §A.2).
- `styles.css:7047, 7051, 7056, 7063, 7073, 7078, 7082` — `#panel-assignments
  #assignment-review-submission-content ...` (re-read this pass, confirmed 7 rules, all descending
  through the bare `#panel-assignments` id, not `.as-scope`) → `assignment-review-submission-content`
  itself doesn't rename (it's inside `assignment-review-workspace`, a review-only cluster that moves
  unchanged per §A.1), so these 7 rules keep working as-is once `#panel-assignments` still wraps the
  review container — **no change needed**, listed here only to confirm they were checked, not
  overlooked.
- `styles.css:9518-9536` (re-read this pass) — the outer `.app-shell.assignment-process-mode
  #panel-assignments` / `.app-shell.users-management-mode #panel-assignments` display switches — no
  change needed, since `#panel-assignments` survives as the literal target of these rules.
- Sibling-combinator rules (`styles.css:7636-7637`, `8315-8316`, `8364-8365`, `8894-8895`, targeting
  `.assignment-workspace-section + .assignment-workspace-section`) — **re-verified this pass against
  live `index.html`**: today `assignment-state-workspace` (543), `assignment-submission-workspace`
  (573), `assignment-review-workspace` (645), `assignment-return-to-field` (690) are 4 consecutive
  DOM siblings, all carrying `.assignment-workspace-section`. After the split: state-workspace is
  alone in the handoff container (rule never matches there — harmless no-op, not a visual break);
  submission-workspace is alone in the work container (same); **review-workspace and
  return-to-field remain adjacent siblings inside the review container** (index.html:645 and 690 are
  still consecutive today, and nothing in this plan reorders them) — the sibling-margin rule is
  **still load-bearing for the review container** and must not be deleted, only re-scoped if its
  selector prefix (`#panel-assignments.as-scope`) needs updating — it doesn't, since the compound
  targets the class pair, not an id, and `#panel-assignments.as-scope` still wraps the review
  container per this plan's design.

Net CSS effort: ~9 concrete rule edits (2 id lookups at 6520-6521 becoming 4), everything else
(≈990 of the 999 `.as-scope` rules) is unaffected because the ancestor identity (`#panel-assignments.as-scope`)
is deliberately preserved by this migration's design choice to keep the wrapper.

---

## D. Migration sequence

Each step leaves the app fully working end-to-end for every pageMode — no step ships with old and
new structure both partially serving the same mode.

### Step 1 — Scaffolding only, zero behavior change

Add the 3 empty container `<div>`s (`#assignment-panel-handoff/-work/-review`) and reposition
`#workflow-backward-controls` to sit directly above them (still inside `#panel-assignments`,
still targeting the same id — trivial DOM move, no id/class/JS change). Do not move any existing
content into the new containers yet.

- **Files touched**: `index.html` only.
- **Runtime verification**: load `index.html`, navigate to the assignments tab in each of the 3
  pageModes (handoff/work/review URL states). Confirm every existing element still renders and
  behaves identically to pre-change (the 3 new divs are present but empty/hidden and inert).
  Confirm `#workflow-backward-controls` still renders correctly in handoff (same visual position).

### Step 2 — Migrate handoff-only content into `#assignment-panel-handoff`

Move `assignment-page-summary`, `assignment-manual-create-panel` (+children), `assignment-state-workspace`
(+children), and rename/relocate `assignment-detail-panel` → `assignment-detail-panel-handoff`
(§A.2 finding 1) into the new handoff container. Split `assignment-panel-title`/`-note` into
`-handoff` copies inside this container; the old shared ids keep serving work/review for now (not
yet split). Delete `ensureAssignmentHandoffLayoutOrder` (its job is now "fixed markup order,"
nothing to reorder). Update `syncAssignmentPageMode`'s handoff-branch writes, `setAssignmentDetailVisible`
and its 8 call sites (only the handoff-relevant ones now do anything; the rest become no-ops for
non-handoff calls — see §E for the 2 call sites `c6821e7` touched).

- **Files touched**: `index.html`, `app.js` (functions listed in §C touching handoff-only ids:
  `syncAssignmentPageMode`, `setAssignmentDetailVisible`, `ensureAssignmentHandoffLayoutOrder` (deleted),
  `applyAssignmentModernClasses`'s handoff-relevant `addClassById` calls).
- **Runtime verification**: open the assignments tab in **handoff** mode. Confirm: page summary
  banner renders, manual-create-panel shows/hides correctly by role, the handoff queue table lists
  items and "1.1 เลือกงาน"/"เปิดงานที่เลือก" buttons work, selecting an item populates the new
  `assignment-detail-panel-handoff` (context brief, next step, process steps). Then switch to
  **work** and **review** modes and confirm those are unaffected (still rendering from the old
  shared elements, since they weren't touched this step).

### Step 3 — Migrate work-only content into `#assignment-panel-work`

Move `assignment-managed-list-wrap`, `assignment-submitted-list-wrap`, `assignment-submission-workspace`
(+work-monitor+full form+deliverables card), and the work slice of the old list-panel (grid with
`assignment-assignee-wrap`(dead)/new `assignment-limit-wrap-work`, actionable-list header, and a new
`table-assignments-work`) into the work container. Split `assignment-panel-title`/`-note` into
`-work` copies. Re-wire the `table-assignments` tbody click delegation (`app.js:11425-11453`) onto
`#table-assignments-work`, and retarget its `scrollIntoView` (`11451`) to
`#assignment-submission-workspace` per §A.2 finding 1 — **this is the exact flow `af413aa` shipped,
see §E**. Update the 4 path-builder functions (`buildAssignmentsActionablePath`/`ManagedPath`/
`SubmittedPath`/`MinePath`, `app.js:6324-6341`) to read `assignment-limit-work`.

- **Files touched**: `index.html`, `app.js` (`renderManagedAssignmentsTable`,
  `renderSubmittedAssignmentsTable`, `renderAssignmentsTable`'s work-path slice, `syncAssignmentWorkflowLayout`,
  the `applySectionState` calls, the 4 path builders, the click-delegation block at `~11383-11467`).
- **Runtime verification**: switch to **work** mode. Confirm: managed-list table loads, actionable
  list loads via "1.1 โหลดงานในกระบวนการนี้", clicking "เปิดงาน" on an `assigned` row PATCHes
  `reopen_in_progress` (watch network tab or confirm the row's state visibly flips), the page then
  scrolls to the submission workspace, submission form fields populate, deliverables summary
  renders, "ส่งงานกลับ" flow still works. Confirm handoff/review remain unaffected.

### Step 4 — Migrate review-only content into `#assignment-panel-review`; retire old shared ids

Move `assignment-review-workspace` (+summary-card+submission-card), `assignment-return-to-field`,
`assignment-review-tracking-wrap`, `assignment-review-hover-preview`, and the review slice of the
old list-panel (grid with new `assignment-limit-wrap-review` + review-tracking-wrap, and a new
`table-assignments-review`) into the review container. Split title/note into `-review` copies.
Re-wire a second copy of the `table-assignments` click delegation onto `#table-assignments-review`
(same PATCH-on-click reopen logic, `scrollIntoView` retargeted to `#assignment-review-workspace`).
At this point the OLD shared `assignment-list-panel`, `assignment-detail-panel`, `assignment-panel-title`,
`assignment-panel-note`, and `table-assignments` ids have zero remaining consumers — delete them
from `index.html` and delete the now-dead old code paths (the pre-split branches inside
`renderAssignmentsTable`, `syncAssignmentPageMode`'s old per-node toggles).

- **Files touched**: `index.html`, `app.js` (`renderAssignmentsTable`'s remaining shared branch,
  `syncAssignmentReturnToFieldUI`, the second click-delegation copy, cleanup deletions).
- **Runtime verification**: switch to **review** mode. Confirm: the review table lists submitted
  work, opening a row shows the review-summary/submission cards with photos/videos, "ขอแก้เพิ่ม"/
  "รับงานผ่าน" both work, "ส่งกลับไปทำรอบใหม่" (return-to-field) works and re-prompts for password.
  Then re-verify handoff and work modes one more time end-to-end (full regression pass across all 3
  modes, since this step deletes the last of the old shared markup).

### Step 5 — Delete dead visibility plumbing; rewrite the layout functions

Delete `syncAssignmentPageMode`'s remaining per-node `classList.toggle("hidden", ...)` blocks that
are now meaningless (container-level hidden toggle replaces them — see §C). Rewrite
`syncAssignmentWorkflowLayout` to operate only within the work container's submission section
(state/review sections no longer live there). Confirm `applySectionState`'s 3 call sites collapse
correctly.

- **Files touched**: `app.js` only.
- **Runtime verification**: full regression pass — all 3 modes, all role tiers if testable
  (owner/admin/user/freelance/editor per `canSeeAssignment*Surface` gates,
  `app.js:4422-4425`), confirming visibility now tracks "which container is active" with no
  leftover per-node toggles firing.

### Step 6 — CSS remediation

Apply the ~9 concrete rule edits from §C's CSS subsection (`styles.css:6520-6521` id rewrite, plus
confirming the other flagged lines need no change). Do this last, after markup has stabilized, so
the CSS edit is against final ids, not ids that will move again.

- **Files touched**: `styles.css` only.
- **Runtime verification**: visually compare each of the 3 modes against pre-migration screenshots
  (or against Step 1's baseline) for `.as-scope`-driven styling — card borders/radius/background on
  the list-panel and detail-panel equivalents, spacing between `.assignment-workspace-section`
  elements (specifically confirm the review container's review-workspace → return-to-field spacing
  still has its margin-top, since that sibling rule is still load-bearing per §C).

---

## E. Must-not-break table

| commit | what it touched | migration step(s) touching same code/elements | regression risk if handled carelessly |
|---|---|---|---|
| `db1cccc` (moved `#workflow-backward-controls` to top-level `index.html:358`) | `index.html` only | Step 1 (repositions the same node again, from "above manual-create-panel" to "above the 3 containers") | Purely a position change, same id, same "always a direct child of `#panel-assignments`" invariant `db1cccc` established. Risk is low but concrete: if Step 1 accidentally nests it *inside* one of the new containers instead of keeping it at the shell level, it re-creates exactly the "hidden when no assignment is selected" bug `db1cccc` fixed, this time scoped to whichever container it landed in. Verify after Step 1 that it's a sibling of the 3 containers, not a child of any one. |
| `12b02f7` (`app.js:4510-4513`, force-hide backward-controls outside handoff) | `app.js` only | Step 5 (deletes `syncAssignmentPageMode`'s remaining per-node toggle blocks, which is where this line lives) | This plan's Step 5 naturally removes the same 4 lines the other plan's Phase 1 targets — if Phase 1 ships first on its own, Step 5 here just confirms the block is already gone (no double-deletion conflict, it's idempotent). Because this plan mounts `workflow-backward-controls` at the shared top level with no container to gate it against (§F), there is no equivalent per-node toggle to re-add in the new structure — do not introduce a "hide unless active container is handoff" check as a stand-in, that would silently resurrect `12b02f7`'s mechanism under a new name. |
| `c6821e7` (stopped auto-selecting; rewrote `refreshAssignments`/`loadAssignmentsByItem` else-branches, `app.js:9607-9682`, `9700-9770`) | `app.js` region containing 2 of `setAssignmentDetailVisible`'s 8 call sites: `9639` (passes `false`), `9724` (passes `getAssignmentPageMode() === "handoff"`) | Step 2 (rewrites `setAssignmentDetailVisible` and all 8 call sites) | **Step 2 must not flip the boolean at either site.** `9639`'s `false` must stay `false` — it exists specifically so a background refresh doesn't pop the detail panel open on an unselected assignment. `9724`'s `pageMode === "handoff"` condition should become "is the handoff container the active one" (equivalent post-split, since `getAssignmentPageMode()` still returns the same string), not loosened to always-true. Getting either wrong resurrects the exact auto-selection-appears-open bug `c6821e7` fixed. |
| `af413aa` (PATCH-on-click for "เปิดงาน", `wireAssignments()` click delegation `app.js:11425-11453`, specifically the `reopen_in_progress` PATCH at `11437-11443`) | `app.js` region around `table-assignments`'s tbody click handler | Step 3 (re-wires this delegation onto `#table-assignments-work`) and Step 4 (adds a second copy onto `#table-assignments-review`, since `renderAssignmentsTable`'s shared work/review branch, `app.js:9186-9258`, emits the same `data-action="open-assignment"` button in both modes — confirmed this pass by reading `app.js:9239-9257`, the row-rendering loop that runs for both work and review) | **Both Step 3 and Step 4 must independently preserve the full PATCH-then-refresh-then-select-then-scroll sequence** (`11437-11451`): PATCH `/api/assignments/:id/state` with `reopen_in_progress` only when `row.state === "assigned"`, then `refreshAssignments({ showStatus: false, preserveSelection: true })`, then `selectAssignment(id)`, then scroll. Losing this on either the work or review copy (e.g. only re-wiring one table and forgetting the other exists because it looks like "the same id, already done") would silently break the reopen flow in whichever mode's copy was missed. |

**`c6821e7`-specific callout**: Step 2 is the step that must not resurrect auto-selection. **`af413aa`-specific callout**: Steps 3 and 4 together are what must keep the "เปิดงาน" PATCH-on-click flow working — in both of its live locations (work table and review table), not just one.

---

## F. `#workflow-backward-controls` placement

Physically mounted at the **top-level shell**, as a direct child of `#panel-assignments`, sibling
to `#assignment-subnav` and above the 3 new mode containers (§A.0) — **not** inside any single
container, and not duplicated into all 3.

Why a single shared mount rather than living inside the handoff container (which is where its
current DOM position, `index.html:358`, and its §1 classification as "handoff-only" would suggest):

- Its actual content writer, `renderWorkflowBackwardTransitionControls`
  (`workflow-backward-transitions.js:20-33`, re-read this pass), is **pageMode-agnostic by
  construction** — it gates purely on `payload.can_transition`/`payload.targets` from
  `GET /api/items/:id/workflow/backward-transitions`, with no reference to `getAssignmentPageMode()`
  anywhere in the file.
- The inventory's §1 "handoff-only" bucketing for this node reflects the *current, contested*
  behavior — `app.js:4510-4513`'s force-hide (Writer A) always overriding Writer B — not a settled
  design intent. `audit/pagemode-refactor-plan.md`'s Phase 1 (a separate, deferred piece of work)
  documents an owner-verified bug report where item 29 expects this control to function on the
  **work** page, i.e. the "handoff-only" behavior is itself the bug being tracked for a future fix.
- Physically nesting the node inside the handoff container now would force whoever does that
  deferred show/hide work to *also* move the markup a second time (out of the handoff container,
  into a shared position) before they could make it visible from work. Mounting it at the shared
  level today settles the DOM-position question independently of the still-open visibility-logic
  question, so the deferred work only ever has to touch JS, never markup again.

No visibility logic is authored by this plan for this node — it keeps whatever hidden/shown state
its two existing writers currently produce; only its *position in the tree* changes, per §D Step 1.

---

## G. Total size + riskiest step

**Size**: Large. Files touched across the whole migration: `index.html` (full rewrite of the
`#panel-assignments` subtree, ~400 lines), `app.js` (13+ functions per §C:
`syncAssignmentPageMode` deleted, `syncAssignmentWorkflowLayout` + its local `applySectionState`
rewritten, `setAssignmentDetailVisible` + 8 call sites rewritten, `applyAssignmentModernClasses`
rewritten, `ensureAssignmentHandoffLayoutOrder` deleted, `setAssignmentRoleVisibility` rewritten,
`applyFreelanceWorkerView` rewritten, `renderAssignmentsTable` split into per-container paths, the
click-delegation block duplicated, 4 path-builder functions updated), `styles.css` (~9 concrete
rule edits, out of 999 `.as-scope` rules — the rest are preserved unmodified by design, per §C).
`workflow-backward-transitions.js` needs **no changes** (already pageMode-agnostic). This matches
the "Large" sizing the other plan gave Option A in the abstract; this document makes it concrete
across 6 ordered steps.

**Riskiest step: Steps 3+4 (the work/review split of `assignment-list-panel`/`table-assignments`)**,
for three compounding reasons:

1. `renderAssignmentsTable` (`app.js:9083-9258`) is the single most call-site-dense function
   touched by this migration (inventory §4: called from `syncAssignmentPageMode` at `4568`, from
   `setAssignmentRoleVisibility`'s trailing chain, driven by both `state.assignments.rows` updates
   and direct pageMode reads at `9092`) — splitting its target from 1 id to 3 has the largest blast
   radius of any single edit in this plan.
2. It's the exact code path `af413aa` most recently changed (the click delegation at
   `app.js:11425-11453`) — per §E, this step has to get duplicated correctly into **two** new
   locations (`#table-assignments-work` and `#table-assignments-review`), and a partial job (only
   one of the two re-wired) would produce a regression that's easy to miss in manual testing if the
   tester only checks one mode.
3. It's also where the §A.2 finding about `#assignment-detail-panel` being handoff-only in practice
   gets operationalized for the first time (retargeting `scrollIntoView` in 2 places) — a step that
   both restructures markup *and* changes a small piece of behavior (the scroll target), rather than
   a pure reparent, which is inherently harder to verify as "no behavior change" than the other
   steps.

Second-riskiest: **Step 6 (CSS remediation)**, not because the edit count is large (~9 rules) but
because a mistake there produces *silent visual* regressions (broken card borders, missing spacing)
that don't throw errors and are easy to ship unnoticed without a deliberate side-by-side comparison
against Step 1's baseline across all 3 modes and both light/dark themes (the inventory notes several
`.as-scope` rules have `:root[data-theme="dark"]` duplicates, e.g. `styles.css:6876`, `6992-7002`,
which would need the same 6520-6521-style id updates and are easy to forget since they're not
adjacent in the file to their light-theme counterparts).
