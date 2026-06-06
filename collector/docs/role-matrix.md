# Collector Role Matrix

This document is the canonical role and surface access matrix for `collector`.

It exists to stop role drift between:
- backend authority
- frontend navigation and page guards
- business intent

If implementation and this document disagree, treat this document as the intended contract until a newer decision replaces it.

## Role legend

- `owner`
  - Full authority.
- `admin`
  - Internal high-privilege operator and approver.
- `user`
  - Internal operator-manager.
- `editor`
  - External editorial contributor.
- `freelance`
  - External work contributor.

## Role groups

### Internal staff

- `owner`
- `admin`
- `user`

### External contributors

- `editor`
- `freelance`

## External contributor contract

### `editor`

- Canonical surfaces:
  - `editor-home.html`
  - `article-workspace.html`
  - `event-workspace.html`
- Primary responsibilities:
  - Write content
  - Edit assigned content
  - Submit work for review
- Explicitly out of scope:
  - Review
  - Approve
  - Manage contributors
  - Governance
  - System tools
  - Shared internal landing surfaces

### `freelance`

- Canonical surfaces:
  - `freelance-home.html`
  - `/?tab=work`
- Primary responsibilities:
  - View own assignments
  - View own brief and required context
  - Upload files
  - Submit work back
  - Track own work status as needed
- Explicitly out of scope:
  - Review
  - Approve
  - Manage contributors
  - Governance
  - System tools
  - Other users' work

## Internal staff contract

### `owner`

- Full authority across collector.
- May access all internal surfaces.

### `admin`

- High-privilege internal operator.
- May operate most workflows.
- May approve.
- May access contributor management surfaces in collector.
- Must not be treated as owner for owner-only tools.

### `user`

- Internal operator-manager.
- May create and manage work.
- May assign work to `editor` and `freelance`.
- May work directly.
- May manage contributors within allowed scope.
- Must not approve.
- Must not delete content.
- Must not access owner-only tools.

## Surface matrix

This matrix describes which roles should be able to enter each surface.

| Surface | owner | admin | user | editor | freelance |
| --- | --- | --- | --- | --- | --- |
| Shared landing `/?tab=home` | yes | yes | yes | no | no |
| Place | yes | yes | yes | no | no |
| Events | yes | yes | yes | no | no |
| Transport | yes | yes | yes | no | no |
| Transport Base Maps | yes | no | no | no | no |
| Assignments internal manage/review surfaces | yes | yes | yes | no | no |
| Contributor management inside collector | yes | yes | yes | no | no |
| Owner system tools | yes | no | no | no | no |
| Editor portal | no | no | no | yes | no |
| Editor workspaces | no | no | no | yes | no |
| Freelance portal | no | no | no | no | yes |
| Freelance work surface | no | no | no | no | yes |

## Capability matrix

This matrix describes business capabilities, not just page visibility.

| Capability | owner | admin | user | editor | freelance |
| --- | --- | --- | --- | --- | --- |
| View internal landing | yes | yes | yes | no | no |
| Create content items | yes | yes | yes | no | no |
| Assign editorial work | yes | yes | yes | no | no |
| Assign field work | yes | yes | yes | no | no |
| Review work | yes | yes | yes, if flow allows non-final review | no | no |
| Approve work | yes | yes | no | no | no |
| Delete content | yes | yes | no | no | no |
| Manage contributor profile in collector | yes | yes | yes, within allowed scope | no | no |
| Use owner-only system tools | yes | no | no | no | no |
| Write editorial content | yes | yes | yes | yes | no |
| Submit assignment work | yes | yes | yes | yes, via workspace only | yes |

## Contributor management

`Contributor management` and `owner system tools` are separate concepts.

## Visibility and management-line policy

Collector command and visibility follow a pyramid management tree, not flat role rank.

Tree shape:

- `owner`
- `admin`
- `user`
- `editor` / `freelance`

In this model:

- `owner` is the global root.
- `admin` is a branch root.
- `user` is a team root within that branch.
- `editor` and `freelance` are contributor leaf nodes under `user`.

Visibility and target scope must follow subtree boundaries.

- `owner`
  - Global visibility across collector.
- `admin`
  - Visibility is limited to the subtree assigned to that admin.
  - May see `user`, `editor`, and `freelance` accounts only inside that subtree.
  - Must not cross into another admin branch.
- `user`
  - Visibility is limited to contributors assigned under that user.
  - Must not see contributors managed by another `user` or outside the parent admin branch.
- `editor`
  - Self scope only, except for explicitly assigned workflow context.
- `freelance`
  - Self scope only, except for explicitly assigned workflow context.

Canonical rule:

- No cross-line visibility for `admin` or `user`.
- No role may act outside its assigned subtree, except `owner`.
- Role capability defines allowed actions inside the assigned subtree.
- Management line defines which accounts and work items belong to that subtree.

## Management-line assignment and item scope

Management tree:

```text
owner
└── admin
    └── user
        ├── editor
        └── freelance
```

### Assignment target policy

- `owner`
  - Can assign globally.
- `admin`
  - Can assign only to descendants inside that admin branch.
- `user`
  - Can assign only to descendants inside that user branch.
- `editor`
  - Cannot assign.
- `freelance`
  - Cannot assign.

Canonical restrictions:

- `admin` and `user` cannot assign upward.
- `admin` and `user` cannot assign across branch.
- `admin` and `user` should not assign to self by default unless an explicit flow says otherwise.
- When `assignee_user_id` is present, descendant scope to the assignee is the source of truth.

### Assignment visibility policy

- `owner`
  - Sees all assignments.
- `admin`
  - Sees assignments only inside that admin descendant subtree.
- `user`
  - Sees assignments only inside that user descendant subtree.
- `editor`
  - Self scope only or explicit assigned workflow context.
- `freelance`
  - Self scope only or explicit assigned workflow context.

Canonical rules:

- If `assignee_user_id` exists, assignee scope is authoritative.
- `assigned_by_user_id` must not open visibility to an out-of-scope assignee.
- External or unassigned assignment visibility must fail closed unless a route explicitly allows it.

### Item and work context policy

- `owner`
  - Can read and mutate all item context.
- `admin`
  - Can read and mutate only items inside descendant subtree.
- `user`
  - Can read and mutate only items inside descendant subtree.
- `editor`
  - No generic item-context access. Only explicit assigned or self workflow context where allowed.
- `freelance`
  - No generic item-context access. Only explicit assigned or self workflow context where allowed.

Canonical rules:

- Generic item-context read routes must use a subtree-aware read guard.
- Item mutation and recompute routes must use a subtree-aware mutation guard.
- `claim`, `takeover`, `delete`, `recompute`, `generate`, `release`, `review`, and translation routes must not allow direct-hit cross-branch access.
- `claim` and `takeover` must not create scope.

### Equivalent allowed guards

- `ensureItemBriefReadAccess`
  - Canonical guard for item read context.
- `ensureItemMutationAccess`
  - Canonical guard for item mutation and recompute.
- `ensureArticleProcessTransitionAccess`
  - Canonical guard for article process transitions.
- `canClaimItemByManagementLine`
  - Canonical guard for claim.
- `canTakeOverItemByManagementLine`
  - Canonical guard for takeover.
- Self-held release flow
  - Acceptable equivalent guard for releasing a claim already held by actor.
- Owner-only routes
  - Do not require subtree checks.

### Contributor management

Visible to:
- `owner`
- `admin`
- `user`

Examples:
- View contributor records allowed by backend scope
- Manage contributor profiles allowed by backend scope
- Use assignable user selection
- Manage work relationships already represented in collector

### Owner system tools

Visible to:
- `owner` only

Examples:
- Owner-only cleanup or destructive tools
- Agent profile administration if explicitly owner-only
- Other system-level controls not required for normal operations

## Non-goals for collector

These are intentionally outside collector scope.

- Creating contributor accounts is handled in backend admin UI, not collector.
- `article-intake` is not a canonical internal-staff landing entry.
- `transport base-maps` is intentionally owner-only.

## Implementation notes

When auditing or fixing access, separate issues into these categories:

1. Landing visibility
2. Tab normalization
3. Direct page guard
4. Backend deny

Do not assume that a role is aligned just because backend routes exist.
Effective access must reflect:
- visible entry
- direct-hit behavior
- page-level guard behavior
- backend permission behavior

## Current decision summary

- `owner`, `admin`, and `user` are internal staff.
- `editor` and `freelance` are external contributors.
- `admin` should see contributor management in collector, but not owner-only system tools.
- `user` should be able to enter `place`, `events`, and `transport`.
- `editor` and `freelance` must stay inside their canonical external contributor flows.
