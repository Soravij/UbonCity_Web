# Step 5 Backend Guard Checklist

## Purpose
This checklist exists to prevent step 5 UI from promising write/approve/publish capability to `user` before backend permissions actually match the target product decision.

## Locked product target
- `user` must be able to:
  - write/edit step 5 content
  - approve step 5 content
  - publish/export step 5 output
  - send work back to step 4
- No sub-role exception is allowed in the target model

## Current backend gaps to close before step 5 UI promises full access

### 1. Content write/update endpoints
- Current endpoints:
  - `PUT /api/items/:id` -> `requireRole("admin", "editor")`
  - `PUT /api/items/:id/editor-work` -> `requireRole("admin", "editor")`
- Current file:
  - `collector/server/index.mjs`
- Why this matters:
  - step 5 editorial workspace cannot be truthfully writable for `user` while these endpoints reject `user`
- Required change in a later round:
  - allow `user` for the step 5 write path, or add a new step 5-specific write endpoint that allows `user`

### 2. Review / approval endpoints
- Current endpoints:
  - `POST /api/review/action` -> `requireRole("admin")`
  - `POST /api/review/reopen` -> `requireRole("admin")`
- Current file:
  - `collector/server/index.mjs`
- Why this matters:
  - step 5 cannot claim `user` can approve content while review transitions are admin-only
- Required change in a later round:
  - either widen these endpoints for `user`
  - or create a step 5 approval path that explicitly allows `user`

### 3. Publish / stage / export endpoints
- Current endpoints:
  - `POST /api/run/publish` -> `requireRole("admin", "owner")`
  - `POST /api/run/approve` -> `requireRole("admin", "owner")`
  - `POST /api/run/stage` -> `requireRole("admin", "owner")`
  - `POST /api/run/export` -> `requireRole("owner")`
- Current file:
  - `collector/server/index.mjs`
- Why this matters:
  - step 5 cannot promise `user` publish/export access while publication/export actions are blocked server-side
- Required change in a later round:
  - decide whether `user` should share existing publish/export endpoints
  - or whether step 5 needs a new publication/export action surface for `user`

### 4. Unpublish / publication rollback
- Current endpoint:
  - `POST /api/items/:id/unpublish` -> `requireRole("admin", "owner")`
- Why this matters:
  - if step 5 is treated as a full public-output workspace, publication rollback rules may also need explicit policy
- Required decision:
  - confirm whether `user` also gets unpublish ability
  - if not, keep this as an explicit exception outside the locked write/approve/publish scope

## Guarding rule for implementation
- Until the gaps above are closed, step 5 UI must not expose enabled `user` actions for:
  - write/save via current admin/editor-only endpoints
  - approve via current admin-only review endpoints
  - publish/export via current admin/owner-only endpoints

## Required pre-round-2 audit
- Before step 4/step 5 runtime work begins, reviewers must confirm:
  - every step 5 action shown to `user` has a matching backend path
  - no step 5 primary action for `user` ends in predictable `403`
  - any temporary UI disable is explicitly labeled as backend gap, not product indecision

## Out of scope for this checklist
- step 4 operational permissions
- assignment permissions
- freelance permissions
- schema changes
