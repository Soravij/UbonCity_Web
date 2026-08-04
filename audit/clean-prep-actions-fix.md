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
- Extend `raw-intake-clean-prep.behavior.test.mjs` to assert required attributes for every Raw
  Intake and Clean Prep action and assert Clean Prep receives the same delegated handler as Raw
  Intake.
- The test fails when `collector/server/public/app.js` is reverted to its pre-fix version because
  the Clean Prep body no longer receives that handler.

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
