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
