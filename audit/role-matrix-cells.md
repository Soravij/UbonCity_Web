# Role-matrix cells — script-actionable extraction

Read-only pass, Runtime `D:\UbonRuntime\repos\UbonCity_Web`.
Branch `feat/role-matrix-full-smoke` @ `0c274c0` (working tree: trivial uncommitted edit at
`collector/server/index.mjs:14301`, unrelated to the matrix).
Method: `audit-scanner` ×1 + direct source re-read. No code changed, no HTTP, no smoke run.

> **`git pull` not run.** `CLAUDE.md` marks `git pull` in the Runtime repo as owner-managed —
> agents must not run it. This extraction is against the tree as checked out now. If a newer
> `main`/branch tip exists, Sor must pull and the line anchors below re-verified.

Source of the grid: `audit/role-matrix-verify.md` §D (D1–D4, 154 distinct cells) + its ADDENDUM.
Every cell re-checked against **current** source; where current code contradicts the verify.md
value it is marked **[DOC-WRONG]** and corrected here (§3).

Legend for roles (same as verify.md §D):
**O** owner · **A** admin · **U** user · **Ea** editor *with* an active editorial assignment on
the item · **Eu** editor *without* · **F** freelance.
`A✓` / `U✓` = admin/user whose management line covers the item's claimant/assignee.
`A✗` = admin/user with no such scope.

Group tags per cell:
- **① now** — the status is decided by a role/auth layer that runs *before* any item-state gate
  (`requireRole`, the global `/api` freelance middleware `:7355`, an in-handler role check, or the
  role branch of `ensureItemMutationAccess`). Fireable with only a role token + the minimal fixture
  noted (item / asset / assignment rows) — **no specific `production_state` needed.**
- **② state** — needs the item parked in a specific `production_state` (and usually satellite rows)
  before the cell yields its documented status; state given per route in §2.
- **③ blocked** — cannot be produced by a pure Collector smoke: backend-only process, or the
  positive path needs a live AI/translation backend or the backend ingest endpoint, or a real
  external file. Reason per route in §4 / §D4.

For the *allow* cells (`200`), ① means "returns non-403 immediately" (the smoke asserts
`status !== 403`); a *true* `200` still needs the §2 state. Deny cells (`403`) under ① are
fully deterministic now.

---

## 1. The grid — route (method + path) × role × expected status

Route line numbers are **current** `collector/server/index.mjs` unless noted.

### D1 — run / pipeline routes (role gate is state-independent)

| # | Route | O | A | U | Ea | Eu | F | Group | Deciding layer |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| 1 | `POST /api/collect` `:14037` | 200 | 200 | **403** | **403** | **403** | **403** | ① | in-handler role check `:14040` (`owner`/`admin` only); F also stopped at `:7355` — **[DOC-WRONG]** verify.md/D1/§A3 say `200` for all |
| 2 | `POST /api/run/clean` `:14179` | 200 | 200 | 403 | 403 | 403 | 403 | O/A=② `collected` · rest=① | `requireRole("admin")` + owner override (`auth-integration.mjs:571-573`); F 403 at `:7355` |
| 3 | `POST /api/run/ai-draft` `:14184` | 200 | 200 | 200 | 403 | 403 | 403 | O/A/U=③ AI · Ea/Eu/F=① | `requireRole("admin","user")`; positive path → `getEffectiveAiConfig` / OpenAI draft |
| 4 | `POST /api/run/quality` `:14293` | 200 | 200 | 403 | 403 | 403 | 403 | O/A=③ AI · rest=① | `requireRole("admin")`; positive path → AI quality eval |
| 5 | `POST /api/review/action` `:14298` | 200 | 200 | 403 | 403 | 403 | 403 | O/A=② `in_review`+report · rest=① | `requireRole("admin")`; `applyReviewAction` (no AI) |
| 6 | `POST /api/review/reopen` `:14308` | 200 | 200 | 403 | 403 | 403 | 403 | O/A=② `rejected`/`ready_for_publish` · rest=① | `requireRole("admin")`; `reopenReviewDecision` (no AI) |
| 7 | `POST /api/items/:id/unpublish` `:14540` | 200/409 | 200/409 | 403 | 403 | 403 | 403 | O/A=② `publication_state=published` · rest=① | `requireRole("admin","owner")` then `publication_state==="published"` (`:14555`) |

D1 = 7 × 6 = **42 cells**.

### D2 — item-mutation routes (`requireRole` vs `ensureItemMutationAccess`)

State assumed legal; cells show the **authorization** outcome.

| # | Route | O | A✓ | A✗ | U✓ | Ea | Eu | F | Group | Deciding layer |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| 1 | `PATCH /api/items/:id/assets/:assetId/role` `:13610` | 200 | 200 | 403 | 200 | **200** | 403 | 403 | O/A✓/U✓/Ea=① (item+asset+assignment fixture) · A✗/Eu=① deny · F=① deny (`:7355`) | `ensureItemMutationAccess` call `:13624` now passes `{allowAssignedSelf:true}` — **[DOC-WRONG]** verify.md Ea=`403` |
| 2 | `PATCH /api/items/:id/assets/:assetId/selected` `:13573` | 200 | 200 | 403 | 200 | **200** | 403 | 403 | as row 1 | call `:13587` `{allowAssignedSelf:true}` — **[DOC-WRONG]** Ea |
| 3 | `PATCH /api/items/:id/assets/:assetId/caption` `:13652` | 200 | 200 | 403 | 200 | **200** | 403 | 403 | as row 1 | call `:13664` `{allowAssignedSelf:true}` — **[DOC-WRONG]** Ea |
| 4 | `PATCH /api/items/:id/reference-media/:referenceMediaId/selected` `:13099` | 200 | 200 | 403 | 200 | **200** | 403 | 403 | as row 1 | call `:13112` `{allowAssignedSelf:true}` — **[DOC-WRONG]** Ea |
| 5 | `POST /api/assets/upload` `:14718` · `POST /api/assets/register` `:15373` | 200 | 200 | 403 | 200 | **200** | 403 | 403 | ① (needs multipart file for a true 200; auth check needs none) | `ensureComposerMediaEditAccess` → `ensureItemMutationAccess` call `:4476` `{allowAssignedSelf:true}` — **[DOC-WRONG]** Ea |
| 6 | `PUT /api/items/:id/editor-work` `:8879` | 200 | 200 | 403 | 200 | 200 | 403 | 403 | O/A✓/U✓/Ea=② `content_in_progress`/`writing` + editorial assignment `assigned`/`in_progress` · rest=① deny | `ensureArticleComposerEditAccess` editor branch (`:4217`) |
| 7 | `POST /api/items/:id/article-process/transition` (nextStatus ≠ `ready_for_review`) `:9357` | 200 | 200 | 403 | 200 | 200 | 403 | 403 | O/A✓/U✓/Ea=② article-process state + assignment · rest=① deny | `ensureArticleProcessTransitionAccess` composer branch (`:4248`) |
| 8 | `POST /api/items/:id/article-process/submit-review` `:9411` | 200 | 200 | 403 | 200 | **200 / 403** | 403 | 403 | Ea=① for the 403-check (state-independent), ② for a true 200 · rest=① deny | Gate A `:4241` allows assignment ∈ {assigned,in_progress,revision_requested,submitted,resubmitted}; Gate B `:9450` needs ∈ {assigned,in_progress,revision_requested}. **Intersection non-empty → F2 fixed.** Ea = **not-403** for an assignment in a working state; **403** only for submitted/resubmitted — **[DOC-WRONG]** verify.md Ea=`403` (F2 double-bind) |
| 9 | `POST /api/items/:id/submit-admin-review` `:13245` | 200 | 200 | 403 | 403 | 403 | 403 | 403 | O/A✓=③ (translation gate + backend ingest) · A✗/U/Ea/Eu/F=① deny | `requireRole("admin","owner")` + `ensureItemMutationAccess` `:13266` + readiness gates + translation gate `:13284` + `ready_for_sync` `:13304` |

D2 = 9 × 7 = **63 cells**.

### D3 — assignment routes (editor/freelance functional path)

Columns: **O · A** (=`scope`: 200 iff manages the assignee, else 403) **· U** (assigner, same `scope` rule) **· Ea · F** (assigned) **· Eu / unrelated**.

| # | Route | O | A | U | Ea | F | Eu | Group | Deciding layer |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| 1 | `PUT /api/assignments/:id/draft` `:11033` | **403** | **403** | **403** | 200 | 200 | 403 | Ea/F=① (assignee only via `hasAssignmentDraftAccess` `:11044`) · O/A/U=① deny | `hasAssignmentDraftAccess` `:11044` — **[DOC-WRONG]** prev: O=`200`, A=`scope`, U=`scope`; code only allows assignee |
| 2 | `POST /api/assignments/:id/submissions` `:11348` | 200 | scope | scope | **403** | 200 | 403 | O/A/U/F=② assignment state ∈ {assigned,in_progress,revision_requested} · Ea=① deny (`:11361`) · Eu=① deny | `hasAssignmentSubmissionAccess`; **Ea blocked at `:11361`** ("editor should submit via article/event workspace flow only") — **[DOC-WRONG]** prev: Ea=`200` |
| 3 | `POST /api/assignments/:id/assets/upload` `:15217` | 200 | scope | scope | **403** | 200 | 403 | ① (needs assignment + multipart file) · Ea=① deny (`:15228`) · Eu=① deny | `hasAssignmentAccess`; **Ea blocked at `:15228`** ("editor cannot upload assignment assets from this surface") — **[DOC-WRONG]** prev: Ea=`200` |
| 4 | `GET /api/assignments/:id/deliverables/summary` `:12054` | 200 | scope | scope | **403** | **403** | 403 | ① — O/A/U need assignment fixture · Ea/Eu/F all deny | `requireRole("admin","user","freelance")` — editor not listed; **F 403 at `:7355`** (not in allowlist) — **[DOC-WRONG]** verify.md D3 F(assigned)=`200` |

D3 = 4 × 6 = **24 cells**.

### D4 — backend review routes (separate service)

Columns: backend **O · A · editor · freelance · user**. All roles are *backend* JWT identities.

| # | Route | bO | bA | bEd | bFl | bU | Group | Deciding layer |
|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| 1 | `POST /review-content/:id/approve` `reviewContentRoutes.js:65` | 200 | 200 | 403 | 403 | 403 | ③ | `authorizeEditorOrAdmin` = admin+owner only (`authMiddleware.js:122-129`) |
| 2 | `POST /review-content/:id/needs-revision` `:66` | 200 | 200 | 403 | 403 | 403 | ③ | same |
| 3 | `POST /review-content/:id/reject` `:67` | 200 | 200 | 403 | 403 | 403 | ③ | same |
| 4 | `GET /review-content/:id` `:63` | 200 | 200 | 403 | 403 | 403 | ③ | `protectReviewContentReadAccess` → owner+admin, or a `review_content:read` scoped token |
| 5 | `POST /review-content/ingest` `:60` | 200† | 200† | 403† | 403† | 403† | ③ | `x-review-sync-token` header bypasses role; else `authorizeEditorOrAdmin` (†=no header) |

D4 = 5 × 5 = **25 cells**. **All ③** — backend Express + MySQL, a different process the Collector
smoke never starts; needs a real backend JWT, a running backend, and `review_content` rows.

### Cell totals

| Table | Routes | Grid | Distinct cells (verify.md collapse) |
|---|---|---|---|
| D1 | 7 | 7×6 | 42 |
| D2 | 9 | 9×7 | 63 |
| D3 | 4 | 4×6 | 24 |
| D4 | 5 | 5×5 | 25 |
| **Total** | **25** | | **154** |

---

## 2. Group ② — cells that need an item in a specific `production_state`

`PRODUCTION_STATES` (current) — `collector/db/repository.mjs:440-458`, 17 values:
`collected, analyzed, brief_generated, ready_for_content, field_working, field_review,
ready_for_writer, writing_assigned, writing, content_in_progress, generated, in_review,
needs_revision, ready_for_publish, submitted_for_admin_review, rejected, completed`.
No DB CHECK constraint — any state is reachable by a direct `UPDATE content_workflow_models
SET production_state=?` (the smoke scripts do exactly this).
Article-process transition table: `ARTICLE_PROCESS_TRANSITIONS` `collector/server/index.mjs:2849-2856`;
legality checked by `canTransitionArticleProcess` `:4485-4492`.

| Route (cell subset) | Required `production_state` | Extra rows needed | Source |
|---|---|---|---|
| `POST /api/run/clean` — O, A | `collected` | — | `workflow.mjs` clean stage selects `collected` |
| `POST /api/run/ai-draft` — O, A, U *(also ③: AI)* | `analyzed` | item **claimed**; ≥1 `evidence_blocks` + `approved_context` row (per `smoke-role-matrix-full.mjs:297-311`) | route + `runAiDraftStage` |
| `POST /api/run/quality` — O, A *(also ③: AI)* | `generated` \| `in_review` \| `needs_revision` | latest draft | `workflow.mjs` quality candidates |
| `POST /api/review/action` — O, A | `in_review` | latest `content_review_reports` row (run quality first) | `applyReviewAction` |
| `POST /api/review/reopen` — O, A | `rejected` \| `ready_for_publish` | prior review decision | `reopenReviewDecision` |
| `POST /api/items/:id/unpublish` — O, A | any, with `publication_state = published` | published record | `:14555` |
| `PUT /api/items/:id/editor-work` — O, A✓, U✓, Ea | `content_in_progress` \| `writing` | editorial `content_assignments` row, state `assigned`/`in_progress` | `ensureArticleComposerEditAccess` |
| `POST …/article-process/transition` — O, A✓, U✓, Ea | article-process from-state legal for target (table `:2849-2856`); e.g. `writing_assigned`+`drafting` → `writing` | editorial assignment | `canTransitionArticleProcess` |
| `POST …/article-process/submit-review` — O, A✓, U✓, Ea (true 200) | article-process `drafting` \| `revision_requested` \| `ready_for_review`; production `writing`/`content_in_progress` | editorial assignment ∈ {assigned,in_progress,revision_requested} **and** a `content_drafts` row with non-empty body (`:9458`) | Gate A/B + `:9434` |
| `POST /api/items/:id/submit-admin-review` — O, A✓ *(also ③)* | `ready_for_publish` + article-process `ready_for_sync` | readiness: `source_ready` **and** (`editorial_ready` \| `field_flow_ready`); translations generated + rechecked | `:13270-13304` |
| `POST /api/assignments/:id/submissions` — O, A, U, Ea, F | (item state loose) | `content_assignments` state ∈ {assigned,in_progress,revision_requested} | `hasAssignmentSubmissionAccess` |

Approx **② count: 21 cells** (D1: 8 · D2: 8 · D3: 5).
The end-to-end state ladder (rungs `collected → … → completed`) is already scripted in
`collector/scripts/smoke-role-matrix-full.mjs:289-473` — reuse it to park an item per rung.

---

## 3. Cells known to be DOC-WRONG (current code disagrees with `audit/role-matrix-verify.md`)

| # | verify.md location | Cell(s) | verify.md says | **Current code** | Evidence (current line) |
|---|---|---|---|---|---|
| 1 | §A3 (`:44-51`), D1 (`:398`) | `POST /api/collect` × U, Eu, Ea | `200` ("`requireRole` absent; `requireAuth` only" / "any of the 5 roles can collect") | **`403 {"error":"Forbidden"}`** (dev body adds `requires:"admin|owner"`) | in-handler check `collector/server/index.mjs:14040` — present since `165e66a`, missed by the original audit **and** the ADDENDUM |
| 2 | §A3, D1 (`:398`) | `POST /api/collect` × F | `200` | **`403 {"error":"freelance access is limited to assigned submissions"}`** | global `/api` middleware `:7355-7398` (`/collect` not in allowlist). ADDENDUM §3 caught this one; §A3 body still not corrected in verify.md |
| 3 | D2 (`:413-417`) | rows `assets/:assetId/role` `/selected` `/caption`, `reference-media/:id/selected`, `assets/upload` × **Ea** | `403` (F1: editor branch of `ensureItemMutationAccess` dead) | **not `403`** (200 on legal state) | F1 fix merged: `{ allowAssignedSelf: true }` at `index.mjs:4476, 13112, 13587, 13624, 13664` (grep count = 5) |
| 4 | D2 (`:420`), F2 (`:163-181`) | `article-process/submit-review` × **Ea** | `403` (Gate A ∩ Gate B disjoint — "impossible for the editor role") | **not `403`** for assignment ∈ {assigned, in_progress, revision_requested}; `403` only for {submitted, resubmitted} | Gate A widened: `ensureArticleProcessTransitionAccess` `:4241` now `["assigned","in_progress","revision_requested","submitted","resubmitted"]`; Gate B unchanged `:9450` `["assigned","in_progress","revision_requested"]` → overlap exists |
| 5 | §C row 6 (`:129`), F3 (`:183-202`) | `field-pack/return-to-clean` — "orphans an active editorial assignment / incompleteness" | route succeeds, leaves assignment active → later `409` on re-assign | **`409 {code:"OPEN_ASSIGNMENT_BLOCKS_RETURN_TO_CLEAN"}`** up front when any assignment ∈ `OPEN_FIELD_ROUND_STATES` | guard added: `collector/db/repository.mjs:10034-10040`; `OPEN_FIELD_ROUND_STATES` `:1019-1026` = {assigned,in_progress,submitted,resubmitted,revision_requested,accepted} |
| 6 | D3 (`:430`) | `GET /api/assignments/:id/deliverables/summary` × **F (assigned)** | `200` | **`403`** "freelance access is limited to assigned submissions" | `:7355` — path not in the `:7368-7392` allowlist. ADDENDUM §3 flagged; D3 table not updated |
| 7 | §B (`:73-82`), D1 "Deciding layer" col | freelance rows on D1 routes `run/clean`/`ai-draft`/`quality`/`review/action`/`review/reopen`/`unpublish` | attributes the `403` to `requireRole` | value `403` correct, **attribution wrong** — freelance stops at `:7355` (`"freelance access is limited…"`), never reaches `requireRole` | `:7355-7398` |

**Line-drift (not value-wrong), for the firing script's anchors:**
`ensureItemMutationAccess` → `:4158-4171` · `ensureArticleProcessTransitionAccess` → `:4228-4249` ·
global freelance middleware → `:7355-7403` · `submit-review` → `:9411` (Gate B `:9445-9451`) ·
`article-process/transition` → `:9357` · `deliverables/summary` → `:12054` ·
`submit-admin-review` → `:13245` (translation gate `:13284`) · `field-pack/return-to-clean` → `:13729`.
D1 route lines in verify.md (`:14037/:14179/:14184/:14293/:14298/:14308/:14540`) are **current**.

---

## 4. Routes behind the translation gate or an AI call — SKIP in the firing round

### 4a. Translation gate

| Item | Location | Note |
|---|---|---|
| Gate function | `getRequiredTranslationRecheckBlockers(id, readiness)` — `collector/server/index.mjs:7007` | returns `{ blocking, blocking_langs, … }` |
| Only caller | `POST /api/items/:id/submit-admin-review` `:13245`, checked at `:13284-13294` → `409 "คำแปลยังไม่ผ่าน translation recheck…"` when `blocking` | so the **positive path of `submit-admin-review` is gated** — O/A✓ cells are ③ |
| `POST /api/items/:id/generate-translations` `:13456` | `requireRole("admin","owner")` → `rerunProblemTranslations` → `getEffectiveAiConfig` (AI translation) | ③ positive path; `403` for U/Ea/Eu/F is ① |
| `POST /api/items/:id/translations/:lang/recheck` `:13495` | `requireRole("admin","owner")` → `rerunTranslationRecheck` (AI) | ③ positive path; deny cells ① |

The full smoke (`smoke-role-matrix-full.mjs:417-445`) drives the gate by calling
`generate-translations` then `translations/:lang/recheck` per lang and asserting
`translation_recheck_status ∈ {passed, warning}` — that path **requires the AI backend up**
(`COLLECTOR_SYNC_BACKEND_API`). Do not run it in a role-only firing round.

### 4b. AI / LLM routes (positive path needs `getEffectiveAiConfig` → backend/OpenAI)

| Route | Line | Role gate | AI op |
|---|---|---|---|
| `POST /api/run/ai-draft` | `:14184` | `requireRole("admin","user")` | draft generation (OpenAI) |
| `POST /api/run/quality` | `:14293` | `requireRole("admin")` | quality evaluation |
| `POST /api/items/:id/seo-suggestion` | `:9020` | `requireRole("owner","admin","editor","user")` + `ensureArticleComposerEditAccess` | `executeBackendAiJson` task `seo_metadata_suggestion` |
| `POST /api/items/:id/article-suggestion` | `:9079` | same gate | article agent |
| `POST /api/items/:id/generate-translations` | `:13456` | `requireRole("admin","owner")` | translation model |
| `POST /api/items/:id/translations/:lang/recheck` | `:13495` | `requireRole("admin","owner")` | translation recheck model |
| `POST /api/assignments/:id/deliverables/summary/evaluate` | `:12078` | `requireRole("admin","user","freelance")` | deliverable summary eval (AI) |
| `POST /api/assignments/:id/deliverables/readiness/evaluate` | (verify.md ADDENDUM `:12140`) | `requireRole("admin","user","freelance")` | readiness eval (AI) |

For all of the above: fire only the **deny cells** (role gate) in a role-only round; the
`200`/positive cells belong to a separate AI-enabled smoke.

---

## 5. Scope test — routes that need TWO fixtures (item in own line vs item in another line)

A cell's status differs for **A / U** by whether the actor's management line covers the item's
`claimed_by_user_id` **or** an assignment's `assignee_user_id`.

- Item-mutation gate: `ensureItemMutationAccess` `:4158-4171` → admin/user branch
  `canMutateItemByManagementLine` `:3837-3895` (walks `users.managed_by_user_id`).
- Read gate: `isItemVisibleToActor` `:3897-3915` (owner all; admin/user need claimant/assignee or
  manage them; raw-pool visible to admin/user).
- Assignment gate: `hasAssignmentAccess` `:3089-3106` (assignee self, or manages assignee).
- Owner is never scope-sensitive (`:4160` / `:3900` / short-circuit). Editor/freelance are gated by
  assignment membership, not management line — a single "with assignment" fixture suffices.

**Fire each of these twice — once with an in-line item/assignment, once cross-line — for role A (and U where U✓ applies):**

| Route | Line | Gate | Expected: in-line | Expected: cross-line |
|---|---|---|---|---|
| `PATCH /api/items/:id/assets/:assetId/role` | `:13610` | `ensureItemMutationAccess` | 200 | 403 |
| `PATCH /api/items/:id/assets/:assetId/selected` | `:13573` | " | 200 | 403 |
| `PATCH /api/items/:id/assets/:assetId/caption` | `:13652` | " | 200 | 403 |
| `PATCH /api/items/:id/reference-media/:referenceMediaId/selected` | `:13099` | " | 200 | 403 |
| `POST /api/assets/upload` · `/api/assets/register` | `:14718` · `:15373` | `ensureComposerMediaEditAccess`→`ensureItemMutationAccess` | 200 | 403 |
| `PUT /api/items/:id/editor-work` | `:8879` | `ensureArticleComposerEditAccess` (admin/user → `canMutateItemByManagementLine`) | 200 | 403 |
| `POST /api/items/:id/article-process/transition` | `:9357` | `ensureArticleProcessTransitionAccess` `:4233` | 200 | 403 |
| `POST /api/items/:id/article-process/submit-review` | `:9411` | " | 200 | 403 |
| `POST /api/items/:id/submit-admin-review` | `:13245` | `ensureItemMutationAccess` `:13266` | 200* | 403 |
| `POST /api/items/:id/field-pack/return-to-clean` | `:13729` | `requireRole("owner","admin","user")` + scope | 200* | 403 |
| `GET /api/items/:id` | `:8241` | `isItemVisibleToActor` | 200 | 403 |

**Note:** For `GET /api/items/:id`, freelance (F) is blocked at middleware `:7355` (path not in allowlist) → **F = 403**. Freelance uses `GET /api/items/:id/field-pack/current` (`:7382` briefItemMatch) instead.
| `PUT /api/assignments/:id/draft` | `:11033` | `hasAssignmentAccess` | 200 | 403 |
| `POST /api/assignments/:id/submissions` | `:11348` | `hasAssignmentSubmissionAccess` | 200 | 403 |
| `POST /api/assignments/:id/assets/upload` | `:15217` | `hasAssignmentAccess` | 200 | 403 |
| `GET /api/assignments/:id/deliverables/summary` | `:12054` | `hasAssignmentAccess` (+ role list) | 200 | 403 |
| `POST /api/items/:id/assignments` | `:10661` | assignee must be in assigner's downline | 200 | 403 (cross-chain assignee) |
| `POST /api/items/:id/article-editorial-assignments` | `:10434` | same | 200 | 403 |

\* also subject to §2 state and/or §4 gates for a true 200 — the cross-line 403 still fires first.

**List routes** (`GET /api/review-queue` etc. — verify.md §A4 unguarded; and any `GET` list that
runs `isItemVisibleToActor` as a row filter) differ between lines by **row count, not status**
(200 either way). Not a 2-fixture status cell — assert on payload contents instead if covered.

The existing full smoke already covers the cross-line negative for three of these:
`GET /api/items/:id` (Group C, `smoke-role-matrix-full.mjs:554-561`) and
`POST /api/items/:id/assignments` cross-chain (Group D, `:564-571`).

---

## 6. Summary — counts per group

| Group | What | Cells | Where |
|---|---|--:|---|
| **① now** | decided by a role/auth layer before any state gate — fireable with a role token + minimal fixture (item/asset/assignment rows), no `production_state` | **≈101** | D1 29 · D2 53 · D3 19 |
| **② state** | needs the item parked in a specific `production_state` (+ satellite rows) — ladder in `smoke-role-matrix-full.mjs:289-473` | **≈21** | D1 8 · D2 8 · D3 5 |
| **③ blocked** | backend-only process (D4), or positive path needs live AI / translation / backend ingest / real file | **32** | D1 5 · D2 2 · D4 25 |
| | **Total** | **154** | D1 42 · D2 63 · D3 24 · D4 25 |

(① vs ② for the *allow* cells is a judgment boundary: every allow cell is fireable **now** as a
`status !== 403` check; it needs its §2 state only for a *true* `200`. Counts above assign each
allow cell to its primary group. Deny cells — all ① — are the deterministic core: **D1 27, D2 29,
D3 6 = 62 fully-deterministic deny cells**, plus the 2 `POST /api/collect` allow cells that need
only a valid payload.)

**Doc-wrong cells: 7 groups** (§3) — biggest: `POST /api/collect` is `owner`/`admin` only
(`:14040`), not "any authenticated role"; F1 and F2 are fixed (Ea now passes the asset routes and
submit-review); F3 now returns `409` instead of orphaning.

**Translation-gate / AI routes to skip: 10** (§4) — plus `submit-admin-review`'s positive path.

**Scope 2-fixture routes: 17** (§5).
