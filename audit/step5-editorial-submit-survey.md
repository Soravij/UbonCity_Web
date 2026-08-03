# Step 5 editorial-submit survey

Audit date: 2026-08-03. Read-only inspection only: no application endpoint was called and no SQLite data was changed.

## 1. Editorial submit

The article and event workspace UI both call **`POST /api/items/:id/article-process/submit-review`**, not `POST /api/assignments/:id/submissions`.

* Article workspace: the submit handler saves then calls `submitWorkspaceForReview` at `collector/server/public/article-workspace-page.js:2166-2180`; that function POSTs the endpoint at `:2094-2104`. Its button is enabled only for `drafting`/`revision_requested`, edit permission, and valid workspace input at `:1715-1725`.
* Event workspace: the equivalent POST is at `collector/server/public/event-workspace-page.js:990-1000`; its click handler saves first at `:1214-1220`.
* Server route: `collector/server/index.mjs:9479-9638`.

However, **there is no source-backed, reachable third editor submission path.**

1. The generic route rejects an editor: `POST /api/assignments/:id/submissions`, `collector/server/index.mjs:11388-11403`.
2. The workspace route calls `ensureArticleProcessTransitionAccess` *before* it reaches its internal submission-writing block (`:9491-9496` before `:9511-9618`). For `ready_for_review`, that guard demands the editor already own an editorial assignment in `submitted` or `resubmitted` (`:4176-4182`).
3. The apparent intended third path is the later block in `submit-review`: it finds an owned `assigned`/`in_progress`/`revision_requested` editorial assignment (`:9513-9519`), creates its submission and deliverable (`:9540-9577`), and updates assignment state to `submitted`/`resubmitted` (`:9609-9618`). But an editor with any of those pre-submit states is rejected at step 2 and cannot reach that block.

Conclusion: the UI endpoint is real, but the source contains a guard-order contradiction for the editor. No separate JS request that first submits the editorial assignment was found in `article-workspace-page.js`, `event-workspace-page.js`, or `article-workflow-core.js`; therefore an editor cannot satisfy the guard through the supplied workspace source. This is a source finding, not an API test.

## 2. Drafting and place transitions

`POST /api/items/:id/article-process/transition` can request `{ "status": "drafting" }` (`collector/server/index.mjs:9425-9469`). It can repeat while already drafting: `drafting -> drafting` is listed at `:2834-2837`, and equal statuses are allowed at `:4421-4427`. Role eligibility for drafting is at `:4558-4577`, with access checks at `:9445-9450`.

`field_review -> writing` is **not** legal for a place. `writing` is in the production enum (`collector/db/repository.mjs:436-452`), but the place table allows only `field_review -> generated | field_working | writing_assigned` (`:506-531`, especially `:518`).

The correct forward route is `POST /api/items/:id/article-editorial-assignments`; creation maps a place to `writing_assigned` at `collector/server/index.mjs:10580-10590`. The next legal place edge is `writing_assigned -> writing` (`collector/db/repository.mjs:519`). A direct article-process `drafting` mapping would propose `writing` for a place (`collector/server/index.mjs:4501-4534`), but it cannot lawfully bypass the place transition table from `field_review`.

## 3. Assignment 3

Read-only SQLite evidence from `collector/data/collector.db`:

* `content_assignments.id = 3`: item `9`, `editorial`, assignee user `10`, `assigned`, created `2026-08-02 16:04:43`.
* Item `9` also has field assignment `id = 2`, `accepted`, created `2026-08-02 16:04:14`, updated `2026-08-02 16:14:09`.

Thus #3 was created before field assignment #2 reached accepted. This only describes the checked local SQLite file.

No dedicated **cancel** endpoint was found. A close route exists: `PATCH /api/assignments/:id/state` at `collector/server/index.mjs:11159-11278`; `close_assignment` maps to closed (`:2827-2832`). The route permits owner/admin/user but explicitly prevents a user closing directly (`:11178-11184`), so owner/admin is required for that action.

Reassignment/change of assignee exists via `POST /api/items/:id/article-editorial-assignments` (`collector/server/index.mjs:10504`). With `replace_active: true`, it closes the active editorial assignment (`:10568-10577`) and creates a replacement (`:10592-10632`). It requires item mutation access and editorial-management permission (`:10515-10520`), then validates internal assignee role and management-line/work-assignment rules (`:10532-10548`).

The early return at `collector/server/index.mjs:10551-10566` happens only when an active editorial assignment has the same internal `assignee_user_id`, or (for external assignees) both the same name and contact (`:10553-10560`). It returns the existing assignment. A different assignee needs `replace_active: true`; otherwise the route returns HTTP 409 (`:10568-10571`).

For a corrected sequence, source supports owner/admin closing #3 and then creating a new editorial assignment after the field-to-editorial handoff is valid, or using `replace_active: true` to close and replace it. No mutating request was made by this audit.
