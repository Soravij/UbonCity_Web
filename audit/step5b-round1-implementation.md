# Step 5B round 1 — canonical workflow-status readers

Branch: `codex/step5b-round1-canonical-readers` (from `main` at `51796ec`).

Scope respected: this round does not migrate or drop `content_items.workflow_status`, and does not alter or stop its existing writes. The column definition and all INSERT/UPDATE/reconcile writes remain.

## Decision: one legacy-to-canonical decider

**Chosen decider:** `mapWorkflowStatusToModelStates()` in `collector/db/repository.mjs:662`.

It was already the repository's workflow-head creation/default rule and recognizes the values emitted by the canonical-to-legacy mirror, notably `in_review`, `ready_for_content`, and `brief_generated`. The removed server-local `mapLegacyStatusToCanonicalStates()` did not recognize some of those emitted values; for example, `in_review` fell through to `collected/draft`.

To retain the API's accepted historical aliases while making one rule authoritative, the chosen repository function now also maps:

| Legacy input | Canonical state |
| --- | --- |
| `reviewed` / `in_review` | `in_review` / `draft` |
| `cleaned` / `analyzed` | `analyzed` / `draft` |

`collector/server/index.mjs:6881` imports and calls that repository function. The server-local mapper has been deleted. Control query after the change:

```text
rg -n "mapWorkflowStatusToModelStates|mapLegacyStatusToCanonicalStates" collector/db/repository.mjs collector/server/index.mjs
repository.mjs:662  export function mapWorkflowStatusToModelStates
repository.mjs:5957 mapWorkflowStatusToModelStates(...)
index.mjs:36         import
index.mjs:6881       call
```

There is no remaining `mapLegacyStatusToCanonicalStates` definition or call.

## Claim-pool migration and dev-DB evidence

`getItem()` and `listItems()` now `LEFT JOIN content_workflow_models` and return its canonical `production_state` and `publication_state` before the list/claim route calls `attachItemScopeMetadata`. `buildItemWorkScopeState()` and the no-metadata fallback in `isClaimableRawPoolItem()` no longer read `workflow_status`.

The following read-only command was run against the active development DB, `collector/data/collector.db`; it begins with `PRAGMA query_only=ON`.

```sql
SELECT i.id, i.workflow_status, i.claimed_by_user_id,
       w.production_state, w.publication_state,
       CASE WHEN lower(trim(coalesce(i.workflow_status, ''))) IN ('published','completed')
              THEN 'published_or_completed'
            WHEN coalesce(i.claimed_by_user_id,0) > 0 THEN 'claimed'
            ELSE 'raw_pool' END AS legacy_scope,
       CASE WHEN lower(trim(coalesce(w.publication_state, ''))) IN ('published','completed')
              OR lower(trim(coalesce(w.production_state, ''))) IN ('completed','ready_for_publish')
              THEN 'published_or_completed'
            WHEN coalesce(i.claimed_by_user_id,0) > 0 THEN 'claimed'
            ELSE 'raw_pool' END AS canonical_scope
FROM content_items i
LEFT JOIN content_workflow_models w ON w.content_item_id=i.id
ORDER BY i.id;
```

Result: 30 items, no differing scope rows. Exact before/after sets are:

| Scope | Before (legacy reader) | After (canonical reader) |
| --- | --- | --- |
| `raw_pool` | IDs `1`–`28` | IDs `1`–`28` |
| `claimed` | ID `29` | ID `29` |
| `claimed_and_assigned` | ID `30` | ID `30` |
| `published_or_completed` | none | none |

Item 30 is `workflow_status=approved`, canonical `submitted_for_admin_review/approved`, and has accepted field plus submitted editorial assignments; the assignment branch therefore fixes its scope at `claimed_and_assigned` in both cases. Claimable raw-pool IDs are consequently unchanged: `[1..28]` before and after.

## Hard-delete gate proof

The legacy-only blocker was removed. The canonical `production_state=collected` and `publication_state=draft` blockers remain and are the canonical equivalent.

Read-only proof query:

```sql
SELECT i.id, i.item_uid, i.workflow_status, w.production_state, w.publication_state
FROM content_items i
JOIN content_workflow_models w ON w.content_item_id=i.id
WHERE lower(trim(coalesce(i.workflow_status, ''))) <> 'raw'
  AND lower(trim(coalesce(w.production_state, ''))) = 'collected'
  AND lower(trim(coalesce(w.publication_state, ''))) = 'draft'
ORDER BY i.id;
```

Result: `[]`. Thus the legacy gate catches no item that the canonical gates leave eligible in this DB. A new test deliberately makes that stale state (`workflow_status='approved'` with canonical `collected/draft`) and proves the canonical-only gate allows it.

## Tests and verification

New/changed assertions:

| Test | What it proves | Why reverting fails it |
| --- | --- | --- |
| `in-flight-items.test.mjs` — `getItem and listItems carry canonical workflow state for claim-pool scope` | Both repository read paths expose `ready_for_publish/approved` from the workflow head. | Reverting either query to `content_items` alone returns missing canonical states. |
| `raw-delete.test.mjs` — `raw hard-delete eligibility relies on canonical state when the legacy mirror is stale` | A stale non-raw mirror does not block canonical `collected/draft`. | Restoring `workflow_status_not_raw` makes it ineligible. |
| `workflow-readers-loud.test.mjs` — `one shared legacy-to-canonical mapping...` | Historical aliases remain supported and the server calls the shared mapper, with no local mapper. | Restoring the split mapper or removing alias handling fails it. |
| `assignment-ui-scope.test.mjs` lossy-groups test | The new test preserves canonical workflow state across six legacy-lossy state groups. | Reverting the production readers makes the canonical fields `undefined` and fails this test. The original raw-pool fixture relabel remains unchanged and is not this coverage proof. |

Focused verification:

```text
node --test --test-concurrency=1 collector/tests/in-flight-items.test.mjs collector/tests/raw-delete.test.mjs collector/tests/workflow-readers-loud.test.mjs
35 pass, 0 fail
```

`collector/tests/assignment-ui-scope.test.mjs` retains its pre-existing 33 failure names; the separate lossy-groups coverage is the reader-regression proof. The original scope-metadata fixture relabel remains unchanged.

Baseline, once from repository root, was redirected to `audit/step5b-round1-baseline-test.log`:

```text
npm run test:all
failure-name set: 60
```

The sorted set is in `audit/step5b-round1-failing-test-names.txt`; it matches the stated 60-failure baseline by failure name (not merely count). No variant sweeps were run.

## Mechanical sweep and control check

Method (run before and after the patch):

```text
rg -n --glob '!node_modules/**' "\b(workflow_status|legacy_workflow_status)\b" collector
```

Control: before the patch, the same sweep found the known claim consumer at `collector/server/index.mjs:4042` and its work-scope fallback at `:4132`; `rg -n "isClaimableRawPoolItem" collector/server/index.mjs` found definition `:4029` and caller `:4077`. After the patch, the function remains at `:4030` with caller `:4075`, but contains no mirror read. This demonstrates the method finds the known consumer rather than only schema/display text.

Remaining matches are classified below. `workflow_status` without a `content_items` qualifier in `transport-v2-router.mjs` is the separate `transport_routes_v2.workflow_status` column.

| File:line(s) | Classification |
| --- | --- |
| `database/schema.sql:37` | Intentionally kept: `content_items` column definition. No migration in this round. |
| `db/repository.mjs:2790,2821,3995-4000,4025,5372,5417-5419,5835,5841-5848,6027-6032` | Intentionally kept writes/creation compatibility: input normalization, persistence, preserve-on-omission, canonical-to-legacy reconcile and its equality check. |
| `db/repository.mjs:5575,5666,5698,5764` | Intentionally kept display/audit snapshot of the mirror; no eligibility branch reads it. |
| `db/repository.mjs:6048` | Intentionally kept creation compatibility: new-head seed uses the single chosen mapper. Still-to-move only in the later column-removal round. |
| `db/repository.mjs:6252,6263` | Intentionally kept diagnostic drift output. |
| `server/index.mjs:1822,1838,1868,1896,1941,1993,10344` | Intentionally kept display-only cleanup/purge/drift API fields. |
| `server/index.mjs:6881` | Intentionally kept legacy create-input compatibility, delegated to the one mapper. |
| `server/index.mjs:8794-8795,9235,9341,14200-14201` | Intentionally kept transport boundary: rejects client attempts to write the mirror directly. |
| `server/public/app.js:3142` | Intentionally kept display-only cleanup-table label. |
| `server/transport-v2-router.mjs:1009,1053,1781-1791,1822-1833`; `database/schema.sql:348,375` | Intentionally kept: independent `transport_routes_v2.workflow_status`. |
| `services/workflow.mjs:2330`; `services/agent-generation.mjs:734,767` | Intentionally kept trace/diagnostic metadata; no workflow branching. |
| `scripts/audit-workflow-head-missing.mjs:24`; `scripts/cleanup-smoke-items.mjs:30` | Intentionally kept diagnostic/display scripts. |
| `scripts/find-smoke-item.mjs:14,21,32,49`; `scripts/lib/smoke-helpers.mjs:35,97`; `scripts/smoke-ai-draft.mjs:21,73,78,111-112,133` | Still-to-move: smoke eligibility/assertion readers. Out of the production reader scope of this round. |
| `scripts/smoke-article-flow-e2e-browser.mjs:776,782,826`; `scripts/smoke-article-workspace-browser.mjs:236,241,831`; `scripts/smoke-external-agent.mjs:140,169`; `scripts/trigger-field-pack.js:81` | Still-to-move: smoke assertions/selection readers. |
| `scripts/smoke-ai-input-cleanup-post-assignment.mjs:29`; `scripts/smoke-data-cleanup-ui-browser.mjs:168`; `scripts/smoke-data-cleanup.mjs:44`; `scripts/smoke-field-pack-return-to-clean.mjs:36`; `scripts/smoke-reference-cleanup.mjs:30`; `scripts/smoke-publish-sync-compensation.mjs:49` | Still-to-move: smoke SQL projections. |
| `scripts/seed-mock-work-stage-jobs.mjs:390`; `scripts/smoke-assignment-user-review-local-browser.mjs:111`; `scripts/smoke-transport-workflow-live.mjs:272` | Intentionally kept test/smoke fixtures; transport value is separate-table scope. |
| `tests/agent-generation-external.test.mjs:19`; `tests/backend-ai-proxy.test.mjs:13`; `tests/schema-foundation.repository.test.mjs:130,171,204`; `tests/manual-import-merge-backfill.behavior.test.mjs:148`; `tests/raw-delete.test.mjs:149,199`; `tests/assignment-ui-scope.test.mjs:682,684,693-743,777,850-897,2559,3283`; `tests/admin-review-status-semantics.test.mjs:16`; `tests/item-editor-packaging-requirements.test.mjs:108` | Intentionally kept tests/fixtures or source-text assertions for the mirror contract. The original claim-pool fixture relabel remains; real reader coverage in this file comes from the separate lossy-groups test. |
| `docs/structured-context-agent-v1.md:13,95,224,409`; `server/public/app.js:2891` | Documentation/comment only, not a runtime reader. |

## Non-goals retained for later rounds

- No schema migration, column drop, or write-path change.
- No removal of display/diagnostic response fields.
- No migration of smoke-script mirror readers.
- No UI/CSS change.

