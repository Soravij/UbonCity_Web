# Clean Prep action-handler hotfix

## Cause

`renderRawTable()` creates `#table-clean-prep` after the Raw Intake / Clean Prep split, but it
assigned the delegated row-action handler only to `#table-raw-intake tbody` and
`#table-raw-review tbody`.  The new Clean Prep `<tbody>` was outside that binding.  Its buttons
already had the required `data-action` and `data-id` attributes, and `handleRowAction` already
implements their actions; therefore all three Clean Prep actions silently did nothing.

Raw Intake remains bound to the handler and retains its existing action attributes.

## Fix and coverage

- Bind the existing `handleRowAction` to `#table-clean-prep tbody`.
- Extend `raw-intake-clean-prep.behavior.test.mjs` to assert attributes for: Raw Intake's
  open-state-entry, claim-item, release-item, takeover-item, delete, and row-select checkbox; and
  Clean Prep's open-state-entry, release-item, and delete. (Correction, audit round 2: the original
  version of this line claimed "every" Raw Intake and Clean Prep action was asserted — it actually
  omitted the checkbox and rendered-but-unasserted takeover-item. Both are now covered.)
- Assert Clean Prep receives the same delegated handler as Raw Intake.
- The test fails when `collector/server/public/app.js` is reverted to its pre-fix version because
  the Clean Prep body no longer receives that handler.
- Added a further test (audit round 2) that derives the table list from `renderRawTable`'s own
  `renderRawQueueTable(...)` calls rather than a hardcoded selector map, and asserts every table
  that can render an actionable button is bound to the same delegated handler — so a future table
  added without its handler bound fails automatically instead of needing a human to remember to
  test it. See `audit/clean-prep-actions-audit.md` Section C for the coverage gap this closes, and
  its Section D for `table-raw-workflow-unknown`, a separate pre-existing unbound table this fix
  does not touch (named as an explicit exemption in that new test instead).

## Actual diff size

Command run before adding this audit record:

```text
git diff --numstat -- collector/server/public/app.js collector/tests/raw-intake-clean-prep.behavior.test.mjs
```

Output:

```text
2       0       collector/server/public/app.js
60      7       collector/tests/raw-intake-clean-prep.behavior.test.mjs
```

No state-machine, transition, route, `resolveQueueBucket`, `isRawPreparationItem`,
`normalizeDashboardWorkflowStage`, or `workflowBadge` code was changed.
