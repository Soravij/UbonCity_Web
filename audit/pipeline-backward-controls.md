# Pipeline backward controls audit — place ladder

Scope: `D:\UbonCity_Web` (dev, `main` @ `962da87`). Source-only static audit; no DB opened, no code changed.
Question: for every backward ("ถอย") edge on the `place` production-state ladder, is there an actual clickable
UI control on the page where the item is sitting when that edge becomes legal — not just a server endpoint.

## 1. The backward endpoint

`GET /api/items/:id/workflow/backward-transitions` — `collector/server/index.mjs:9099-9114`.
Roles: `owner, admin, editor, user` (read-only; returns `can_transition` + legal `targets` for the item's
current `production_state`, place-only — `buildPlaceBackwardTransitionsPayload`, `index.mjs:4136-4152`).

`POST /api/items/:id/workflow/backward-transitions` — `collector/server/index.mjs:9116-9185`.
- Roles: `owner, admin, user` only (**not** `editor`) — `index.mjs:9116`.
- 409 if `item.type !== "place"` — `index.mjs:9127-9130`.
- Requires `ensureItemMutationAccess` (claim/management-line check) — `index.mjs:9131-9133`.
- Requires non-empty `reason` string in the body, 400 otherwise — `index.mjs:9134-9138`.
- Target must be one of `repo.listLegalBackwardProductionTransitions("place", currentState, id)` — `index.mjs:9141-9149`.
- On success: `repo.upsertWorkflowModel` writes `production_state`/`publication_state`, audit-logs
  `workflow.backward_transition`, returns `resume_path` computed from the edge's `surface` tag
  (`placeBackwardTransitionResumePath`, `index.mjs:4124-4134`).

Separately, `can_transition` in the GET/POST response is gated by `canTransitionPlaceBackwardByRole`
(`index.mjs:4118-4122`): `true` for `owner` unconditionally, or `admin`/`user` with
`canMutateItemByManagementLine`. **`editor` always gets `can_transition:false`**, on every page, for every
edge — this is a single global gate, not a per-edge UI gap.

The endpoint still exists and behaves as above; the July 2026 audits' prior finding that it's place-only,
reason-required, and role-gated this way is unchanged.

## 2. All backward edges — `PLACE_BACKWARD_PRODUCTION_TRANSITIONS`

`collector/db/repository.mjs:541-571` (comment at `:538-540` confirms this is the intentional single
allowlist the route reads). Forward ladder for comparison: `collector/db/repository.mjs:516-534`
(`collected→analyzed→generated→ready_for_content→field_working→field_review→writing_assigned→writing→
in_review→ready_for_publish→submitted_for_admin_review→completed`).

11 edges, each tagged `direction`, `label_th`, `surface` (the page you land on *after* transitioning, not
necessarily the page the button is on), and usually `return_to_clean`:

| # | from → to | direction | label_th | surface | line |
|---|---|---|---|---|---|
| 1 | generated → analyzed | in_process | คัดข้อมูลส่งเข้า AI | item_editor | `repository.mjs:543` |
| 2 | field_working → ready_for_content | in_process | ส่งงานไปทำ | handoff | `repository.mjs:546` |
| 3 | field_review → field_working | in_process | ลงงาน | assignment_work | `repository.mjs:549` |
| 4 | field_review → generated | cross_process | สร้างร่างด้วย AI และตรวจแก้เนื้อหา | item_editor | `repository.mjs:550` |
| 5 | ready_for_content → generated | cross_process | สร้างร่างด้วย AI และตรวจแก้เนื้อหา | item_editor | `repository.mjs:553` |
| 6 | writing_assigned → field_review | cross_process | ตรวจงาน | assignment_review | `repository.mjs:556` |
| 7 | writing → writing_assigned | in_process | รับงาน | article_intake | `repository.mjs:559` |
| 8 | in_review → writing | in_process | เขียนบทความ | article_workspace | `repository.mjs:562` |
| 9 | in_review → field_review | cross_process | ตรวจงาน | assignment_review | `repository.mjs:563` |
| 10 | ready_for_publish → in_review | in_process | ตรวจและอนุมัติ | article_submit | `repository.mjs:566` |
| 11 | submitted_for_admin_review → in_review | cross_process | ตรวจและอนุมัติ | article_submit | `repository.mjs:569` |

**No entry exists for `analyzed`** — an item at `analyzed` has zero legal backward targets (confirms the
July 2026 finding that there is still no `*→collected` edge). `collected` and `completed` have no entries
either, but that's by ladder design (start/terminal).

The button UI is one shared, payload-driven widget, not per-edge markup:
`collector/server/public/workflow-backward-transitions.js` — `loadWorkflowBackwardTransitions` (`:14-18`,
GETs the endpoint) and `renderWorkflowBackwardTransitionControls` (`:20-69`, renders whatever `targets` the
server returns into a `<section id="workflow-backward-controls">` container, POSTs on click with the
required `reason`). **Important**: the `surface` tag only controls the post-transition redirect — it does
*not* restrict which page can show the button. Any page that (a) loads/refreshes this widget for the item
and (b) is where the item actually sits when in the `from` state, shows the button.

## 3. Master table — from→to, hosting page, button, endpoint

"Hosting page" = the page a user actually sees the item on while it is in the `from` state (not the
`surface` tag). "Button" cites container markup + JS load/render binding, or states "ไม่มี" with the files
checked.

| from → to | hosting page (file) | button: markup file:line + binding file:line | endpoint hit |
|---|---|---|---|
| 1. generated → analyzed | `clean-item.html` (via shared `item-editor.js`, `isCleanMode` flag `item-editor.js:34`) | markup `clean-item.html:42` / `item-editor.html:70`; binding `item-editor.js:5313-5338` (render), `:5340-5348` (load) | POST above |
| 2. field_working → ready_for_content | `index.html?tab=handoff\|work` (shared assignment page) | markup `index.html:531` (inside `#assignment-detail-panel`); binding `app.js:3638-3659` (render), `:3661-3668` (load), triggered by `selectAssignmentContextItem` (`app.js:3623`) → `loadAssignmentContextFieldPackStatus` (`:3671-3699`) | POST above |
| 3. field_review → field_working | `index.html?tab=review` (item under review) + also `item-editor.html` (unconditional load) | same container/binding as row 2; also `item-editor.js:5313-5348` | POST above |
| 4. field_review → generated | `item-editor.html` (direct nav; unconditional) + `index.html?tab=review` | markup `item-editor.html:70`; binding `item-editor.js:5313-5348` (unconditional — runs before the raw/clean redirect check, `item-editor.js:6106-6114`) | POST above |
| 5. ready_for_content → generated | `item-editor.html` (`canEditItem` explicitly permits this state) + `index.html?tab=handoff` (pre-assignment context item) | markup `item-editor.html:70` / `index.html:531`; binding `item-editor.js:5313-5348`; `app.js:3638-3668`, visibility `app.js:9673` (`setAssignmentDetailVisible(pageMode==="handoff")` when item has no assignment rows yet) | POST above |
| 6. writing_assigned → field_review | **no natural page** — see §4 | **ไม่มี** on `article-intake.html`/`.js` (zero container, zero import — confirmed by direct grep of both files). Only reachable via manual URL to `item-editor.html?id=…` (`item-editor.js:5313-5348`, owner/admin/user only) or the atypical case where the editorial assignee is itself owner/admin/user, via `index.html?tab=work` (`app.js:9243`→`3671`→`3661`→`9262`) | POST above (role-reachable subset only) |
| 7. writing → writing_assigned | `article-workspace.html` (the writer's active workspace — this is where "writing"-stage items are actually edited) | markup `article-workspace.html:33`; binding `article-workspace-page.js:1884-1918` (render), `:1911-1918` (load); called unconditionally in `init()` at `article-workspace-page.js:2400-2409` (before the `canEditArticle()` redirect gate at `:2405`) | POST above |
| 8. in_review → writing | `article-workspace.html` | markup `article-workspace.html:33`; binding `article-workspace-page.js:1884-1918` | POST above |
| 9. in_review → field_review | `article-workspace.html` + `index.html?tab=review` | same as rows 7/8 and row 2/3 | POST above |
| 10. ready_for_publish → in_review | `article-submit.html` | markup `article-submit.html:33`; binding `article-submit-page.js:981-1011`; gated to owner/admin by `canApproveArticle()` (`article-submit-page.js:1485`, tighter than the server's owner/admin/user) | POST above |
| 11. submitted_for_admin_review → in_review | `article-submit.html` | same as row 10 | POST above |

Note: `item-editor.html`'s widget load (`item-editor.js:5340-5348`) is unconditional — it never gates on
`production_state` — so it is a de-facto universal fallback for owner/admin/user for *any* edge if they
know to navigate there directly by item ID. Rows above still separately report each edge's **natural**
hosting page, since that's what determines whether a person following the normal workflow ever sees the
button without knowing to type a URL manually.

## 4. Deep dive — the two points requested

### Handoff tab (P2 ขั้น 1 "ส่งงานไปทำ") → backward to `generated`

This is edge 5 (`ready_for_content → generated`). **Confirmed wired.** When an item is selected as handoff
context and has no assignment rows created yet, `setAssignmentDetailVisible(getAssignmentPageMode() ===
"handoff")` (`collector/server/public/app.js:9673`) makes `#assignment-detail-panel` — which contains
`<section id="workflow-backward-controls">` (`collector/server/public/index.html:531`) — visible.
Selecting the item (`selectAssignmentContextItem`, `app.js:3623-3636`) calls
`loadAssignmentContextFieldPackStatus` (`app.js:3671-3699`), which unconditionally calls
`refreshAssignmentBackwardTransitions(targetItemId)` (`app.js:3661-3668` defines it, called at `:3696`),
which loads and renders the widget (`renderAssignmentBackwardTransitionControls`, `app.js:3638-3659`).
The resulting button posts to the same endpoint and, per `surface: item_editor`, redirects to
`/item-editor.html?id=…` after firing (`placeBackwardTransitionResumePath`, `index.mjs:4124-4134`).

### Article stage (P3) — `article_intake`, `article-workspace`, `article-submit`

**Edge `writing → writing_assigned`** (article_intake surface): **wired, but not on article-intake.html.**
`article-intake.html` and `article-intake.js` contain **zero** `#workflow-backward-controls` markup and
zero import of `loadWorkflowBackwardTransitions`/`renderWorkflowBackwardTransitionControls` (checked the
full files — no match). However this edge's `from` state, `writing`, is the state an item is in while it is
actively being written, and that page is `article-workspace.html`, not `article-intake.html`
(`article-intake.js:375-405` `derivedArticleWorkflowStatus` maps production `writing` to article-status
`content_in_progress`-adjacent "drafting" territory — the item has already moved on from the intake queue's
own list by then). `article-workspace.html:33` has the container, and `article-workspace-page.js:2400-2409`
(`init()`) unconditionally calls `refreshBackwardTransitions()` (`:1911-1918`) before the `canEditArticle()`
gate (`:2405`, allows owner/admin/editor/user — not freelance), and `renderAll()` (called after the gate)
includes `renderBackwardTransitionControls()` (`:1884`) with no state-based condition. So: **the button is
present and functioning on the writer's actual page**, for owner/admin/user (editor sees the page and the
(empty-of-buttons) container, since `can_transition` is server-gated false for editor — §1).

**Edge `writing_assigned → field_review`** (assignment_review surface): **confirmed no button on any
natural page.** `writing_assigned` is the state before the writer has accepted/started — the natural page
would be `article-intake.html`, which (as above) has zero backward-transitions wiring at all. The
`index.html?tab=review` tab does not help either: that tab's queue only surfaces assignments in
`content_assignments.state` `submitted`/`resubmitted` (`index.mjs` `scope=review` handling, verified by the
deep-reasoner pass), and an editorial assignment only reaches `submitted` together with the production-state
move to `in_review` (bundled in `POST /article-process/submit-review`, `index.mjs:9258-9330`) — by which
point the item is already past `writing_assigned`/`writing`. The `?tab=work` tab *can* select the row (no
kind filter on `GET /api/assignments/mine?scope=actionable`), but the button only renders there for the
assignee — and for the standard flow the assignee is `editor`, who is excluded from `can_transition`
everywhere (§1). It only actually renders for an atypical case where the editorial assignee happens to be
owner/admin/user themselves. **Net effect: a normal editor sent an editorial assignment has no discoverable
button to send it back from `writing_assigned`; only a manual URL to `item-editor.html?id=…` by an
owner/admin/user works.**

## 5. Summary

- **1 edge** has the endpoint but no button on any page a normal user reaches through the standard workflow:
  `writing_assigned → field_review` (row 6 above). It is only reachable by an owner/admin/user manually
  navigating to `item-editor.html?id=<id>`, or in the non-standard case where the editorial assignee is
  itself owner/admin/user rather than `editor`.
- **1 state has no backward edge at all**: `analyzed` — it has no key in `PLACE_BACKWARD_PRODUCTION_TRANSITIONS`
  (`repository.mjs:541-571`), so an item there cannot step back to `collected` or anywhere else through this
  endpoint. (`collected` and `completed` are intentionally terminal/start states, not counted as gaps.)
- All other 9 edges have both the endpoint and a working button on the page where the item naturally sits.
- Cross-cutting: `editor` role can view every one of these pages but can never fire a backward transition
  anywhere (`canTransitionPlaceBackwardByRole`, `index.mjs:4118-4122`) — this is a single role-level gate
  reported once here rather than repeated per row.
