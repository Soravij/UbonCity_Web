# Step 5A audit — Layer 2 findings

Branch: `codex/impl-step5a-remove-assignment-mirror` @ 48057c1, base `main` @ e05eb90.
Layer 1 scan: `audit/step5a-audit-scan.md`. Method: static read/diff of both branches, no DB access.

## Verdict: **CONDITIONAL**

The mechanical part of the removal (history preservation, schema rebuild, boot guard, flag cleanup) is
done correctly. But the implementation silently resolved an ambiguity the pre-implementation survey had
explicitly flagged as unconfirmed — "what should 'accepted' mean once derived from real assignment rows"
— and picked a semantic that changes real Article Intake queue behavior for reworked items relative to
`main`, without surfacing that as a decision needing sign-off. That divergence, and a related internal
inconsistency it creates between two screens, should be resolved or explicitly accepted before merge.

## Confirmed bugs (behavioral divergence from `main`)

### 1. Article Intake treats a reworked item as permanently "accepted" — `main` reset it to non-accepted

**What changed:** On `main`, `content_workflow_models.assignment_state` was a single mirror value per
item. `returnFieldAssignmentForRework` (`main:collector/db/repository.mjs:10429-10442`) explicitly
force-wrote that mirror from `closed` back to the new round's state (`assigned`) in the same transaction
— the old code comment says this exists specifically so downstream consumers stop seeing the prior
acceptance ("closed -> assigned is not a legal assignment transition, hence the explicit reconcile").
Article Intake (`main:collector/server/public/article-intake.js:410-411,417-418,426-427,467-469`) checked
`assignmentState === "accepted"` by strict string equality against that mirror.

On this branch, that reconcile write is gone (correctly — the mirror it wrote to no longer exists) but
nothing replaced its semantic effect. `hasAcceptedOrClosedAssignment()`
(`collector/services/assignment-state.mjs:6-9`) is `.some()` over **every** assignment row the item has
ever had, of any kind, any age. Once a field round has ever reached `accepted`/`closed`, this predicate
is permanently `true` for that item — including through a rework that reopens a fresh, not-yet-accepted
round.

**Concrete scenario:** field assignment accepted → reworked via `returnFieldAssignmentForRework` (closes
old round, opens new round at `assigned`) → item's `derivedArticleWorkflowStatus` is not in
`ARTICLE_FLOW_STATUSES` (e.g. `collected`):
- `main`: head mirror = `assigned` (forced by reconcile) → `isArticleQueueCandidate` = `false` →
  **item does not appear in the Article Intake queue.**
- This branch: `has_accepted_assignment = true` (old closed round still satisfies `.some()`) →
  `isArticleQueueCandidate` = `true`, `queueGroupKey` = `"needs_attention"`, `queueStageMeta` label =
  "ผ่านจากกระบวนการส่งงานไปทำแล้ว" (already passed assignment acceptance) — **item appears in the queue,
  mislabeled as already-accepted, while the actually-active round has not been re-accepted.**

This is exactly the "assignment ล่าสุดเป็น rework" case this audit was asked to check, and exactly the
ambiguity flagged unresolved in the survey (`f6ddc35:audit/step5a-assignment-mirror.md`, section E,
article-intake row: "**ไม่แน่ใจ**... latest assignment, active editorial assignment, latest field
assignment, หรือ `EXISTS(...)`"). The implementation report does not mention this tradeoff or that a
decision was made about rework-reset behavior specifically — it verifies only one real-DB item (item 30,
which was already in-queue via `workflow_status=approved` regardless of the assignment signal, so it
doesn't exercise this path) and a unit test that asserts the "any row ever" behavior as a given rather
than as a decision to be confirmed (`collector/tests/assignment-state-reader.test.mjs:54-64`, test titled
"reader derives completion from every already-loaded assignment, not the newest row").

**Before merge:** confirm with whoever owns Article Intake's product behavior whether "sticky forever
once accepted" or "resets on rework until re-accepted" is correct. This is not knowable from the code —
it's a product decision. If "resets on rework" is correct, the reader needs to select the
current/active round (e.g. exclude `closed` rounds superseded by a later round on the same item, or
otherwise identify "the current round") rather than `.some()` over full history.

### 2. Two independently-implemented "accepted" predicates over the same rows can disagree for the same item at the same time

`hasAcceptedOrClosedAssignment` (`collector/services/assignment-state.mjs:6-9`, feeds Article Intake and
dashboard queue bucketing) and `buildPublishableSourceByItem`'s own accepted/closed derivation
(`collector/db/repository.mjs:9958-10051`, feeds the publish-readiness API response field
`assignment_accepted` at `collector/server/index.mjs:7663` and the Article Workspace display at
`collector/server/public/article-workspace-page.js:708`) both read the same
`listAssignmentsByItem(itemId)` rows but compute "accepted" differently:
- `hasAcceptedOrClosedAssignment`: true if *any* row is accepted/closed, ever.
- `buildPublishableSourceByItem`: derives `checks.assignment_accepted` from only the single best-ranked
  candidate row (sort key includes deliverable-content presence before assignment recency,
  `:10036-10051`), so once the new (not-yet-accepted) round accumulates any draft content, it can outrank
  the old closed round and `assignment_accepted` correctly flips to `false` — while
  `hasAcceptedOrClosedAssignment` on the exact same item stays `true`.

Net effect: during the window after a rework where the new round has started producing content but has
not yet been re-accepted, Article Intake can show the item as "already accepted" while the Article
Workspace / publish-readiness panel simultaneously shows it as "not yet accepted" — for the same item, at
the same moment. This duplication (two independently-maintained definitions of the same concept) did not
exist as two *derivations* before Step 5A in the same way; `main` had one mirror value feeding one family
of consumers and `buildPublishableSourceByItem`'s own real-row logic feeding the other, and while they
could already disagree in principle (per the pre-Step-5A `docs/place-workflow-policy.md:241` "mirror...
แตกจริง 3 item" note), Step 5A had the opportunity to unify "what does accepted mean" into one shared
helper and instead introduced a second, differently-scoped one. Recommend either reusing one predicate
for both call sites, or explicitly documenting why they're intentionally different scopes ("has ever
been accepted" vs. "current best candidate is accepted") if that distinction is deliberate.

Confidence: medium — the divergence mechanism (candidate ranking preferring deliverable-content presence
over recency) is verified by reading the actual sort/branch logic; whether it's hit in practice depends on
real deliverable timing that would need runtime/DB data to confirm frequency, not just possibility.

## Not bugs (verified false positives / correctly implemented)

- **Transition-history ordering** (item 1 of the check list): confirmed correct in both remaining
  writers (`createAssignment`, `updateAssignmentStateInternal`) — the assignment row write always
  precedes the transition-history read, both inside the same transaction. The survey's warned failure
  mode ("ถ้าสลับลำดับ history จะหยุดถูกบันทึก") does not occur. See scan §2 for exact citations.
- **Multiple assignments of different kinds** (narrowly, kind-mixing itself): not a new regression —
  `main`'s mirror-sync logic was already kind-agnostic (any assignment's state change could overwrite the
  single head value regardless of kind). The real divergence in this area is Issue 2 above, which is
  caused by round history + readiness ranking, not by kind-mixing specifically.
- **No assignment at all**: `hasAcceptedOrClosedAssignment([])` returns `false` safely; both the
  `/api/items` list path and single-item path degrade to `false`/absent with no throw and no extra query.
- **Reverse migration NULL**: confirmed to be a deliberate, disclosed, unconditional `NULL` backfill for
  every row on rollback (`collector/scripts/migrate-remove-assignment-state.mjs:31,64`), not a fabricated
  guess at the old (already-undefined) semantic. Matches what the implementation report states.
- **Bootstrap path**: `ensureWorkflowHeadBootstrapColumns` (`collector/db/client.mjs:224-254`) never adds
  or drops `assignment_state` itself; `assertAssignmentStateMigrationApplied`
  (`collector/db/workflow-head-schema.mjs:24-32`) only throws if the column still exists, forcing an
  explicit migration run. No repeat of the prior round's silent-schema-mutation pattern.

## Needs more information (not code bugs, but unresolved before this can be called correct)

- Product decision on rework-reset semantics (Issue 1) — cannot be resolved from the code or docs alone.
- Whether Issue 2's divergence window is actually reachable with real production data (would need a
  runtime check against `collector/data/collector.db` or the Runtime machine, out of scope for this
  static pass per audit boundaries).

## Documentation (low severity, not blocking)

- `docs/place-workflow-target-design.md:128,177` and `docs/place-workflow-policy.md:241,276-277` still
  list the `assignment_state` mirror and `skip_assignment_transition_validation` removal as pending
  to-do items in their roadmap tables. Both are done now; these dated planning docs were not updated.
  Not a locked policy contract, low priority, but worth a follow-up edit so the roadmap doesn't claim
  outstanding work that's already shipped.
- `collector/scripts/seed-mock-work-stage-jobs.mjs:752` labels a printed summary field `assignment_state`
  (reads a real assignment row, not the removed column) — confusingly named post-removal, cosmetic only.

## Test run (direct, not `test:all`)

`node --test collector/tests/assignment-state-migration.test.mjs collector/tests/assignment-state-reader.test.mjs`
run from repo root: **4 tests / 4 pass / 0 fail / 0 skip / 0 todo** (1 + 3 across the two files). This
fully accounts for the reported `test:all` delta (base 813/746/66 → branch 817/756/60, +4 total, matching
exactly). The separate `total ≠ pass+fail` gap (817 vs 756+60=816) predates this branch — the same
one-short gap exists on the reported baseline (813 vs 746+66=812) — and is a Node test-runner summary
counting quirk unrelated to this diff; `scripts/testAll.mjs` itself is unchanged here. See scan document
for detail. Not a Step 5A issue.

## Summary — what must be resolved before merge

1. **Blocking:** Get a product decision on Article Intake rework-reset semantics (Issue 1), and change
   `hasAcceptedOrClosedAssignment`'s scope (or its callers) to match the decided semantic if "sticky
   forever" is not intended.
2. **Should fix or explicitly justify:** Reconcile or document the intentional difference between
   `hasAcceptedOrClosedAssignment` and `buildPublishableSourceByItem`'s candidate-based accepted check
   (Issue 2), since they can now show contradictory "accepted" status for the same item on two screens.
3. **Non-blocking follow-up:** Update the two stale roadmap docs under `docs/`.
