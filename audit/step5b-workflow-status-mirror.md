# Step 5B survey — `content_items.workflow_status` legacy mirror (READ-ONLY)

Base: `main` @ `51796ec` (step 5A merged). Method: static read of collector code only, no DB access.
Layer 1 (mechanical sweep): audit-scanner subagent, with a control check. Layer 2 (semantics):
audit-deep-reasoner subagent. Three of the deep-reasoner's highest-stakes claims were independently
re-verified by direct file read before inclusion in this doc (marked ✅ below).

## Verdict: NOT a pure column drop — two prerequisite fixes needed first

Removing `content_items.workflow_status` is safe **only after**:
1. `getItem()` / `listItems()` are made to carry canonical `production_state`/`publication_state` to the
   claim endpoint and the `/api/items` list response (they currently don't — see §4, risk #1), and
2. the `workflow_status_not_raw` purge blocker is deliberately dropped or replaced (see §4, risk #2).

Absent those, dropping the column silently widens claim-pool eligibility (item 4, §4) and purge/delete
eligibility (item 4, §4) — both are live, tested contracts today, not vestigial code. Neither the
existing unit tests nor the design doc's step list currently name this prerequisite.

Good news: the specific danger the design doc (lines 130-131) called out —
`repairWorkflowHeadFromLegacy` writing corrupted legacy data back into the canonical head — is **already
gone**. It was deleted in commit `c668b04` ("remove legacy workflow head repair"), before this branch
point, along with `backfillWorkflowHeads` and the `migrate:workflow-head` script. Design-doc step 1
("ปิดของที่ทำลายข้อมูลได้") is already done; nobody needs to do it as part of 5B.

---

## 1. Every WRITE and READ of `workflow_status`

### Writes

| Site | What |
|---|---|
| `collector/database/schema.sql:37` | `workflow_status TEXT NOT NULL DEFAULT 'raw'` — column definition |
| `collector/db/repository.mjs:2766-2789` `toItemBaseParams()` | includes `workflow_status` in INSERT/UPDATE param object |
| `collector/db/repository.mjs:3988-4026` `insertItemStmt`/`updateItemStmt` | the actual SQL write statements |
| `collector/db/repository.mjs:5357` `normalizeInput()` | `workflow_status: String(input.workflow_status \|\| "raw").trim()` |
| `collector/db/repository.mjs:5398-5407` `saveItem()` | **preserves existing value** if caller omits it (comment there calls this "Temporary compatibility") |
| `collector/db/repository.mjs:5818-5823` `setWorkflowStatus(ids, status)` | direct UPDATE, only caller is the reconcile function below |
| `collector/db/repository.mjs:5825-5836` `withCanonicalWorkflowStatusSeed()` | seeds `payload.workflow_status` from a canonical workflow patch **at item-creation time** (called from `createItemWithWorkflowHead` line 5421 and `saveItemWithFieldPack` line 11268) |
| `collector/db/repository.mjs:6008-6025` `reconcileLegacyWorkflowStatusMirror(itemId, nextModel, actor, metadata)` | called unconditionally from `upsertWorkflowModel()` (repository.mjs:6170) on **every** workflow-head update; derives a legacy string from the just-written canonical model via `deriveWorkflowStatusFromModel()` and writes it — this is the canonical→legacy sync path |
| `collector/db/repository.mjs:6034` `buildWorkflowHeadDefaults()` | calls `mapWorkflowStatusToModelStates(item.workflow_status \|\| "raw")` to seed a **new** workflow model — only reachable via `createWorkflowHead()`, which is guarded (`if (existing) return normalizeWorkflowModelRow(existing)`, repository.mjs:6030-6031) so it never overwrites an existing head |
| `collector/server/index.mjs:8830-8831, 9271, 9377, 14236-14237` | `delete payload.workflow_status` before create/update/batch-create/transport-edit — blocks clients from writing the column directly over the API |

**Direction of truth today: canonical → legacy, one-way**, for every post-creation write. The only
place legacy data flows *into* canonical state is `buildWorkflowHeadDefaults()` at brand-new-item
creation, and even then the legacy value being read was itself usually just derived from the same
canonical patch moments earlier via `withCanonicalWorkflowStatusSeed()` — not stale external data
driving canonical state.

### Reads

| Site | Kind | What |
|---|---|---|
| `repository.mjs:5574` `getRawOnlyHardDeleteEligibility()` | **gate** | `workflow_status !== 'raw'` blocks permanent purge, independently of the canonical checks at lines 5580-5581 |
| `repository.mjs:6013` | internal | reads current value inside the reconcile function itself |
| `repository.mjs:6238-6249` `getWorkflowStateDriftByItem()` | diagnostic only | compares legacy value vs. canonical-derived value, returns a mismatch flag — never branches control flow |
| `index.mjs:4029-4054` `isClaimableRawPoolItem()` | **gate** | via `buildItemWorkScopeState()`'s fallback (next row) |
| `index.mjs:4132` `buildItemWorkScopeState()` | **gate/fallback** | `effectivePublicationState = publicationState \|\| String(item?.workflow_status \|\| "").trim().toLowerCase()` |
| `index.mjs:1821,1867,1940,1992` | display/API field | `legacy_workflow_status: row.workflow_status \|\| null` in audit-snapshot / deleted-item cleanup / purge-plan / purge-confirmation responses |
| `index.mjs:1837,1895` | SQL SELECT | backing query for the row above |
| `index.mjs:10379-10381` | diagnostic API field | drift endpoint: `legacy_workflow_status_mismatch`, `legacy_workflow_status`, `workflow_head_derived_status` |
| `collector/scripts/audit-workflow-head-missing.mjs:24` | diagnostic script | includes legacy value in its output |
| `collector/server/public/app.js:3142,3148` | UI display | soft-delete cleanup table cell, `legacy:${value}`, string interpolation only — no branching |
| `collector/tests/assignment-ui-scope.test.mjs:681-682,850,882,887,892,897` | test fixture | passes `workflow_status: "raw"` into `buildItemWorkScopeState`/`buildViewerScopeReason`/`isItemVisibleToActor` fixtures. Only `buildItemWorkScopeState` actually reads it — the other two functions gate on `claimed_by_user_id`/assignment fields, not `workflow_status`, despite it appearing in their fixtures too |
| `collector/tests/raw-delete.test.mjs:149,220` | test fixture | `UPDATE content_items SET workflow_status='raw'` alongside separately resetting canonical fields — proves the purge gate is currently a two-condition contract |

**Control check** (proving the scan method works): searched for a known-present consumer,
`isClaimableRawPoolItem`, via `grep -n "isClaimableRawPoolItem" collector/server/index.mjs` — found its
definition (line 4029), its direct read of `workflow_status` (line 4042), and its caller
`canClaimItemByManagementLine` (line 4077). Confirms the sweep surfaces real gating logic, not just
display fields.

---

## 2. Is the value derivable from canonical state for every content type? Where does the mapping lose information?

**No — the canonical→legacy direction is structurally lossy, and the two legacy→canonical mapping
functions disagree with each other.** This is the concrete mechanism behind the design doc's "wrong in
65% of real DB rows" claim (line 130) — it is not that the column is buggy, it's that the mapping is
many-to-one over a large fraction of the real state space.

**`mapWorkflowStatusToModelStates`** (`repository.mjs:660-673`, legacy→canonical, used only at
brand-new-item creation):
```
published            -> completed / published
approved              -> ready_for_publish / approved
rejected               -> rejected / draft
needs_revision          -> needs_revision / draft
in_review                -> in_review / draft
generated                 -> generated / draft
content_in_progress         -> content_in_progress / draft
ready_for_content             -> ready_for_content / draft
brief_generated                 -> brief_generated / draft
analyzed                          -> analyzed / draft
default (raw, "reviewed", "cleaned", anything unrecognized) -> collected / draft
```

**`mapLegacyStatusToCanonicalStates`** (`index.mjs:6883-6910`, legacy→canonical, used only in the
create-item API path via `resolveCreateWorkflowPatch` at `index.mjs:6917`) — **disagrees with the
function above**:
```
published        -> completed / published
approved           -> ready_for_publish / approved
reviewed              -> in_review / draft        <- repository.mjs has NO "reviewed" branch
generated               -> generated / draft
cleaned OR analyzed        -> analyzed / draft     <- repository.mjs only recognizes "analyzed"
needs_revision                -> needs_revision / draft
rejected                        -> rejected / draft
content_in_progress                -> content_in_progress / draft
default -> collected / draft                        <- no in_review/ready_for_content/brief_generated branch at all
```
Two concrete disagreements: the literal string `"reviewed"` produces `in_review/draft` via the
create-item path but collapses to `collected/draft` (effectively "raw") via the internal default-seed
path. `"cleaned"` maps to `analyzed/draft` in one function and falls to the default in the other. And
`"in_review"` — a value the inverse function below actually *produces* — has no branch in
`mapLegacyStatusToCanonicalStates`, so round-tripping it through the create-item path silently downgrades
it to raw.

**`deriveWorkflowStatusFromModel`** (`repository.mjs:675-694`, canonical→legacy, the inverse used by the
reconcile write path):
```
publication_state == published                                           -> "published"
production_state == rejected                                             -> "rejected"
production_state == needs_revision                                       -> "needs_revision"
publication_state in {approved, unpublished} OR production_state in
  {ready_for_publish, submitted_for_admin_review}                        -> "approved"
production_state == in_review                                            -> "in_review"
production_state == generated                                            -> "generated"
production_state == content_in_progress                                  -> "content_in_progress"
production_state == ready_for_content                                    -> "ready_for_content"
production_state == brief_generated                                      -> "brief_generated"
production_state == analyzed                                             -> "analyzed"
default                                                                   -> "raw"
```

`PRODUCTION_STATES` (`repository.mjs:436-453`) has 16 values; `PUBLICATION_STATES` has 6. Comparing
against the inverse function above: **`field_working`, `field_review`, `writing_assigned`, `writing`,
and `completed` (when not also `publication_state=published`) among production states, and
`archived`/`deleted` among publication states — have no branch at all** and collapse to the generic
`"raw"` string. That's 4 of 16 production states (the newer field-work ladder states from §5.4 of the
design doc) and 2 of 6 publication states silently indistinguishable from a genuinely untouched raw item
once mirrored. Round-tripping any of these through legacy and back does not reproduce the original
canonical state — this holds for every content type that can reach those states, not a subset.

---

## 3. Does `workflow_status` have a well-defined meaning today?

**No — same category of problem 5A hit with `assignment_state`, and it was known and deliberately
deferred at that time**, not missed: `audit/step5a-assignment-mirror-implementation.md:7` states 5A's
scope explicitly excluded `content_items.workflow_status`.

Two effects compound:
- **Lossy mapping** (§2) means even a freshly-reconciled value can't represent 6 of 22 possible canonical
  combinations.
- **Freshness is write-order-dependent.** `reconcileLegacyWorkflowStatusMirror` only fires as a side
  effect of `upsertWorkflowModel()` (repository.mjs:6170). Any item whose workflow head was never
  created, or was created before this reconcile logic existed, keeps whatever `saveItem()` last preserved
  (repository.mjs:5402-5405, "preserve if caller omits it"). There is currently no sweep that guarantees
  reconciliation — `backfillWorkflowHeads` (the function that would have done this) was deleted in the
  same commit that removed `repairWorkflowHeadFromLegacy` (`c668b04`), with no replacement. So the value
  a given row holds right now is "whatever `deriveWorkflowStatusFromModel` last computed at the most
  recent workflow-model update for that item, if one has ever happened, subject to lossy collapse" — not
  a value with one fixed authoritative meaning.

**If a meaning must be chosen** for consumers to use post-removal, it has to be: canonical
`(production_state, publication_state)` read directly, computed fresh at read time — not a value derived
through either of the two disagreeing mapping functions above. That choice affects exactly the two gate
consumers in §4.

---

## 4. Ordering requirement — what reads workflow_status for gating, fallback, or filtering (not just display)

Three real consumers, in required fix order:

**1. `getItem()` / `listItems()` never join canonical state — `workflow_status` is currently the *only*
working signal for claim-pool eligibility and list-response scope metadata, not a rare fallback.**
✅ independently verified by direct read, not just trusting the subagent.

- `POST /api/items/:id/claim` (`index.mjs:9113-9130`): `current = repo.getItem(id)` →
  `getStmt = db.prepare("SELECT * FROM content_items WHERE id=? AND is_deleted=0")` (`repository.mjs:4031`,
  confirmed no join) → `attachItemScopeMetadata(req.authUser, attachSingleItemClaimUser(current))`
  (`index.mjs:9125`) → `buildItemWorkScopeState(item, primaryAssignment)` (`index.mjs:4283`). At this
  point `item.production_state` and `item.publication_state` are `undefined`, so line 4132's fallback to
  `item.workflow_status` is the value actually used. `isClaimableRawPoolItem` then short-circuits on the
  resulting `item_work_scope_state` (`index.mjs:4034-4037`).
- `GET /api/items` (`index.mjs:8501-8539`): confirmed
  `attachItemMatchFields(decorateVisibleItems(repo.listItems()), ...)` — `decorateVisibleItems`
  (`index.mjs:8509-8517`), which computes `item_work_scope_state` via `attachItemScopeMetadata`, runs on
  the **inside**; `attachItemMatchFields` (which attaches canonical `production_state`/`publication_state`
  from a join) wraps it on the **outside**, i.e. runs after. `listItems()` itself
  (`repository.mjs:5454-5456`) is also a plain `SELECT * FROM content_items`, no join. So every
  `item_work_scope_state` in the list response is also computed via the `workflow_status` fallback.
- Confirmed as an intentional, currently-tested contract, not an accident:
  `collector/tests/assignment-ui-scope.test.mjs:681` asserts
  `buildItemWorkScopeState({ workflow_status: "raw", claimed_by_user_id: null }, null) === "raw_pool"`
  with *only* `workflow_status` in the fixture — matching the real runtime shape at both call sites above.

**What breaks on removal with no replacement:** `effectivePublicationState` becomes permanently `""` at
these two call sites. The `allowedPublication`/`allowedProduction`/`allowedWorkflow` sets in
`isClaimableRawPoolItem` (`index.mjs:4047-4052`) all accept `""` — so **every non-deleted, non-claimed
item would pass the raw-pool claimability check regardless of true production/publication state**, a
silent widening of what "raw pool" claim eligibility means. The existing unit test would keep passing
(it supplies `workflow_status` explicitly in its fixture) while testing behavior the column drop has
already made unreachable in production — a stale-but-green test masking the regression.

**Required fix before column removal:** attach canonical `production_state`/`publication_state` to the
item object *before* `buildItemWorkScopeState`/`attachItemScopeMetadata` runs, at both the claim endpoint
and the list endpoint (either join it into `getItem()`/`listItems()`, or reorder `attachItemMatchFields`
to run first).

**2. `getRawOnlyHardDeleteEligibility()` (`repository.mjs:5553-5659`) — an independent, redundant purge
gate.** ✅ independently verified.

Line 5574 adds a `workflow_status_not_raw` blocker requiring the legacy column equal `"raw"`, checked
*in addition to* (not instead of) `production_state !== "collected"` (line 5580) and
`publication_state !== "draft"` (line 5581) — all three must clear for hard-delete eligibility.
`collector/tests/raw-delete.test.mjs:220-221` sets both the legacy column and the canonical fields
separately to make a test item eligible again, confirming this is a live two-condition contract, not
dead code.

**What breaks on removal:** nothing incorrectly — dropping this blocker can only make eligibility
*more permissive*, never falsely block something that should be deletable. But because the mirror is
known to drift from canonical state (§2, §3), some items that are **currently** blocked from hard-delete
purely because the mirror hasn't caught up will become deletable once this check is gone. That's a real,
observable behavior change requiring explicit sign-off — not a bug fix, since the canonical checks
already independently cover the "actually raw" condition the design doc treats as authoritative.

**3. `getWorkflowStateDriftByItem()` (`repository.mjs:6230-6260`) — diagnostic only.** Feeds the drift
API endpoint and audit-log metadata; never branches control flow. Safe to drop with the column, no
ordering requirement.

**Required order:** (1) fix `getItem()`/`listItems()` (or reorder the attach calls) so canonical state is
always present before scope/claim computation runs — closes risk 1; (2) explicitly decide on and drop (or
replace) the `workflow_status_not_raw` purge blocker — closes risk 2; (3) only then is dropping the
column itself safe.

---

## 5. `transport_routes_v2.workflow_status`

**Confirmed separate table and column — out of scope.** `collector/database/schema.sql:348` defines
`workflow_status TEXT NOT NULL DEFAULT 'draft'` inside the independent `transport_routes_v2` table, with
its own composite index (`schema.sql:374-375`,
`idx_transport_routes_v2_...(workflow_status, routing_status, poster_status, updated_at DESC)`) and its
own value set (`draft`/`archived`/etc.). No FK relationship to `content_items`, `content_workflow_models`,
or any of the mapping/reconcile functions surveyed here. `transport-v2-router.mjs:1009,1053,1781-1791,
1822-1833` operate exclusively on this table.

---

## 6. UI consumers of `legacy_workflow_status`

**Confirmed: exactly one real consumer, and it is display-only.**
`collector/server/public/app.js:3142` (`const legacyWorkflowStatus = String(row?.legacy_workflow_status
|| "").trim();`) and `:3148` (renders `legacy:${legacyWorkflowStatus}` or `"-"`) inside the soft-delete
cleanup admin table row renderer. Interpolated into a `<td>` string only — no filter, no comparison, no
branch depends on it.

`admin/` and `frontend/` directories have **zero** references to `workflow_status` or
`legacy_workflow_status` (confirmed by grep across both trees).

**The task brief's assumption of a "raw-data table's `workflow_status='raw'` filter" does not match
current code — verified directly, not just via the subagent.** The "raw" tab filter
(`activeIntakeFilter === "raw"` at `app.js:5713`, backed by `isRawPreparationItem()` at `app.js:775-778`
and `resolveQueueBucket()` at `app.js:735-773`) reads exclusively from `item.production_state`,
`item.publication_state`, `item.has_accepted_assignment`, `item.place_review_flag`, and field-pack
pointer fields — no reference to `workflow_status`/`legacy_workflow_status` anywhere in those three
functions. This UI surface was already migrated to canonical state; nothing there blocks column removal.

---

## 7. Migration shape

`content_items` full definition (`schema.sql:15-45`):
```
CREATE TABLE IF NOT EXISTS content_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_uid TEXT NOT NULL UNIQUE,
  ... (type, category, lang, title, normalized_title, slug, description_raw,
       description_clean, summary, meta_title, meta_description,
       event_period_text, location_text, latitude, longitude, map_url,
       google_place_id, image_url, tags) ...
  workflow_status TEXT NOT NULL DEFAULT 'raw',
  claimed_by_user_id INTEGER,
  claimed_at TEXT,
  claim_note TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(claimed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

**Forward rebuild** (SQLite legacy 12-step ALTER, required for column drop) must preserve: `item_uid`'s
`UNIQUE` constraint, `FOREIGN KEY(claimed_by_user_id) REFERENCES users(id) ON DELETE SET NULL`, and —
because dozens of other tables reference `content_items(id)` via
`FOREIGN KEY(content_item_id) REFERENCES content_items(id) ...` (e.g. `content_drafts`,
`content_workflow_models`, `content_assignments`, `review_reports`, `published_articles`, and others) —
the rebuild needs `PRAGMA foreign_keys=OFF` during the table swap followed by `PRAGMA foreign_key_check`
verification afterward, matching the pattern `collector/scripts/migrate-remove-assignment-state.mjs` used
for 5A. No index is defined directly on `workflow_status`, so nothing else needs recreating for that
column specifically. **This survey did not enumerate every dependent table's exact FK clause** — that
needs to be pulled directly from `schema.sql` at implementation time, not guessed.

**Reverse migration (adding the column back): cannot be exact — must be reported, not guessed**, per §2.
`deriveWorkflowStatusFromModel` cannot distinguish `field_working`, `field_review`, `writing_assigned`,
`writing`, non-published `completed`, or `archived`/`deleted` publication states from a genuinely
untouched raw item — all six collapse to `"raw"`. A reverse migration using this function as the backfill
source would silently mislabel every item in one of those six combinations as `"raw"`. That is not a
restoration of history (the actual pre-removal legacy value, per §3, may already have been stale/wrong
for that item) — it is only "what today's canonical state derives to." This must be stated to whoever
signs off on 5B, not treated as an equivalent rollback.

---

## 8. Risk list and proposed implementation order

**Risks, priority order:**

1. **(Highest — silent, currently masked by a stale-but-green test) Claim-pool eligibility widens** if the
   column is dropped before `getItem()`/`listItems()` carry canonical state to the claim/list call sites.
   See §4 item 1.
2. **(High) Purge/hard-delete eligibility widens** if the `workflow_status_not_raw` blocker is dropped
   without explicit sign-off that canonical-only checks are sufficient. See §4 item 2.
3. **(Medium) Reverse migration cannot exactly restore history** — acceptable only if the team accepts
   "derive from canonical" as the new intentional definition, not a true rollback. See §7.
4. **(Medium) `createWorkflowHead`'s new-item seed default disappears.** `saveItemWithFieldPack`
   (`repository.mjs:11267,11292`) can create items without an explicit `production_state`, relying on
   `buildWorkflowHeadDefaults()` reading `item.workflow_status` (repository.mjs:6034). Removal needs an
   explicit hardcoded default (e.g. `collected`/`draft`) at that call site, or `normalizeStateValue` will
   throw on `undefined` (repository.mjs:6039/6101) and break field-pack item creation.
5. **(Low) Diagnostic/response fields disappear** — `legacy_workflow_status` in audit-snapshot, purge-plan,
   purge-confirmation, and drift-endpoint responses (§1 reads table), plus
   `audit-workflow-head-missing.mjs:24`. Cosmetic, no behavior change, but response shapes need updating.
6. **(Low) UI display string removal** — `app.js:3142,3148`, trivial, no gating impact.

**Proposed implementation step order** (mirrors the design doc's own "bottom layer first" logic from §7):

1. Attach canonical `production_state`/`publication_state` before scope/claim computation at the claim
   endpoint (`index.mjs:9119-9130`) and the list endpoint (`index.mjs:8509-8517`) — closes risk 1. Add a
   test that exercises `buildItemWorkScopeState`/`isClaimableRawPoolItem` with `workflow_status` absent
   and only canonical fields present, so removal in step 4 doesn't go unnoticed like the current fixture
   would.
2. Decide and implement the purge-gate change — either drop `workflow_status_not_raw` from
   `getRawOnlyHardDeleteEligibility` outright, or get explicit sign-off that the canonical-only checks
   (`production_state`/`publication_state`) are the intended sole gate — closes risk 2.
3. Update the ~9 display/diagnostic response sites (§1 reads table) to drop `legacy_workflow_status` and
   related drift fields, and the one UI display line in `app.js`.
4. Add the hardcoded canonical default for the `saveItemWithFieldPack` no-explicit-state path, replacing
   the `buildWorkflowHeadDefaults()` read of `item.workflow_status`.
5. Only after 1-4: forward-rebuild `content_items` dropping the column (12-step ALTER, FK-checked), with
   the reverse migration explicitly documented as approximate (§7), not exact.
6. Remove now-dead code: `setWorkflowStatus`, `withCanonicalWorkflowStatusSeed`,
   `reconcileLegacyWorkflowStatusMirror`, `mapWorkflowStatusToModelStates`, `deriveWorkflowStatusFromModel`,
   `mapLegacyStatusToCanonicalStates`, `normalizeLegacyWorkflowStatus`, and the four `delete
   payload.workflow_status` sanitizer lines (no longer needed once the column doesn't exist to protect).

Everything above was answerable from static code. Nothing in this survey required guessing — where a
question couldn't be answered exactly (the full FK-dependent-table enumeration in §7), it's flagged as
needing to be pulled from `schema.sql` at implementation time rather than estimated here.
