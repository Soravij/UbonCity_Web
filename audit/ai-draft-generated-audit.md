# Audit: AI-mode ai-draft draft creation + analyzed → generated transition

- Branch: `fix/ai-draft-writes-generated` (5de10b8) vs `main` (962da87)
- Scope: `collector/services/workflow.mjs` (`runAiDraftStage`), new test `collector/tests/ai-draft-generated-transition.test.mjs`
- Mode: READ-ONLY discovery/verification audit, two-layer (audit-scanner → audit-deep-reasoner)
- Gate: not re-run per instruction (baseline 973/913/59 already reported as matching)

## Headline finding — CONTRACT VIOLATION, high confidence

**The "draft" this branch saves in AI mode contains no AI-authored content at all — it's the item's pre-existing raw description, and the code now falsely marks the item `production_state=generated`, skipping the documented human-authoring pipeline.**

- `collector/services/workflow.mjs:2311` — in AI mode, `generationInput = normalized` (bypasses `generateContentDrafts()` entirely, which is the *only* place `.body`/`.draft_title`/`.excerpt` get computed).
- `collector/services/workflow.mjs:155-177` (`mapFromDb`) — never sets `.body`/`.draft_title`/`.excerpt`, only `.description = description_clean || description_raw`.
- `collector/services/workflow.mjs:2439-2446` — `finalFieldPack` (the actual agent output: `ai_summary`, `story_angle`, `social_hook`, checklists — confirmed against the schema `assertAgentFieldPackContract` enforces at :2117) is saved to the field-pack tables but is **never merged into `finalItem`**; line 2446 only adds `visual_context`.
- `collector/services/workflow.mjs:2359` — `body: finalItem.body || finalItem.description` → `finalItem.body` is always `undefined` in AI mode, so this silently falls back to the raw, pre-AI item description.
- `collector/services/workflow.mjs:2338-2339` — same fallback also rewrites `description_raw`/`description_clean` with that stale text.

Cross-checked against `collector/docs/structured-context-agent-v1.md` (untouched by this branch, last modified 2026-05-22, well before): it documents the agent path's contract explicitly — output is "a handoff field pack, not an article draft" (line ~102), workflow model is meant to end at `production_state=analyzed` (line ~96), and "Agent generation must not overwrite `description_clean`" (line ~98). This branch violates all three: it writes `description_clean`, forces `production_state: "generated"`, and calls the result a draft. `PRODUCTION_STATES` in `collector/db/repository.mjs:440-457` also documents a full human-authoring pipeline (`field_working → field_review → writing_assigned → writing → content_in_progress`) sitting between `analyzed` and `generated` — this branch's AI path jumps straight over all of it.

This is worse than the pre-existing bug (AI branch never created a draft): previously the item honestly stayed at `analyzed` with only a field pack attached; now it's marked `generated` — signaling "AI draft complete, ready for the next stage" — while zero real authored content exists, and the handoff-tab surface for `field_working` (which depends on the item staying pre-`generated`) is short-circuited.

The new test (`ai-draft-generated-transition.test.mjs:155`) only asserts `draft.body` is non-empty, which trivially passes because the raw seeded description is non-empty — it doesn't and can't catch this, since it never checks the body contains anything from the field pack.

## Q1 — draft body source

**Neither real article prose nor field-pack JSON.** It's the original, unmodified `description_clean || description_raw` that existed before the AI stage ran (`workflow.mjs:2359`, `2338-2339`, traced through `mapFromDb` at `:155-177`). See headline finding above.

## Q2 — does `saveDraftAndTransitionToGenerated` change the deterministic branch's behavior?

No — confirmed pure extraction for the pre-existing (non-agent) branch. Diff shows the helper body (`workflow.mjs:2328-2393`) is a verbatim lift of what previously ran inline in the `else` branch on `main`; same order (`saveItem → saveDraft → upsertWorkflowModel → addVersion`), same arguments. Deterministic-mode call site (`:2506`) is unchanged in shape.

What *did* change is the AI-mode branch, which on `main` only called `repo.upsertWorkflowModel(..., production_state: "analyzed", reason_code: "agent_field_pack_generated")` and stopped there — no `saveItem`/`saveDraft`/`addVersion`. This branch replaces that single call with the full helper (`:2488`), which is the intended fix in scope but is undermined by the Q1 finding.

## Q3 — saveItem → saveDraft → upsert sequencing / transaction safety

**Confirmed gap, partially pre-existing, now with wider and more silent blast radius.**

- No transaction wraps the 4-step sequence anywhere — no `db.transaction()` call in `workflow.mjs` or the route handler (`collector/server/index.mjs:14014`) around this path.
- `saveDraftAndTransitionToGenerated` hardcodes `source_type: "manual"` unconditionally (`workflow.mjs:2351`), written straight through by `repo.saveItem`. If `repo.saveDraft` throws right after (as the new test at `:162-191` explicitly exercises by monkey-patching `repo.saveDraft` to throw), `repo.saveItem` has already committed — including flipping `source_type` to `"manual"` even for e.g. a `google_places`-sourced item — while `production_state` stays `analyzed`. That's a real, silent, observable side effect (an item's source badge could change) with no corresponding draft or state transition.
- This exact un-transactioned 4-step sequence already existed on `main` for the deterministic branch, so the transaction gap itself is not new. What's new is that it's now also reachable from the AI/agent branch — and there (see Q3/Candidate C below) it's wrapped in a catch that swallows the failure instead of propagating it, so on `main` a mid-sequence failure in the deterministic path would crash/surface loudly; in this branch's AI path it fails silently into an audit-log row only.

## Q4 — transition mechanics

**PASS.** `upsertWorkflowModel` (`repository.mjs:4944`) runs the normal path — `assertValidTransition` (`:4970-4972`) fires whenever `production_state` changes, no `skip_production_transition_validation`/`skip_publication_transition_validation` flag is set anywhere in this diff's calls (metadata objects only carry `actor_role`, `reason_code`, `bump_state_version`, `bump_content_version`). `analyzed → generated` is a legitimate edge already present in `buildContentTypeTransitionRules()` (`repository.mjs:487`), unchanged by this diff. No direct SQL bypass.

## Q5 — field pack still created / `current_field_pack_id` still set

**PASS.** `saveAgentFieldPack` is still called unconditionally before the draft/transition step (`workflow.mjs:2478`, unchanged from `main`). `current_field_pack_id` is still set inside the transition call (`workflow.mjs:2374`, `Number(savedFieldPack?.id || 0) || null` — same expression as before, just relocated into the shared helper).

## Q6 — cost impact

**PASS, no change.** Diff touches only `workflow.mjs` and the new test file. `agentEngine.generateFieldPack()` / `generateVisualContext()` call sites and counts are unchanged (still one of each per item). No references to `ai_usage_log` or `COLLECTOR_FIELD_PACK_LEAN` appear in the diff — both live in `collector/services/agent-generation.mjs`, which this branch does not touch.

## Q7 — new tests

- **Enum import:** No — the test imports only `openDatabase`, `createRepository`, `runAiDraftStage`; it hand-types the string literals `"analyzed"` / `"generated"` rather than importing `PRODUCTION_STATES` from `collector/db/repository.mjs:440`. Minor convention gap, not a functional bug (other tests, e.g. `content-type-transition-rules.test.mjs`, do import the enum).
- **Path resolution:** Uses `path.resolve(process.cwd(), "collector", "database", "schema.sql")` rather than `import.meta.url`. This is **not a deviation** — it matches the established convention already used by several other existing tests in this repo (`audit-delete-tier-consistency.test.mjs`, `deleted-item-purge-gate.test.mjs`, `deleted-item-reference-classification.test.mjs`, `in-flight-items.test.mjs`, `item-blocker-summary.test.mjs`, `raw-delete.test.mjs` all use the identical `process.cwd()` pattern). No action needed.
- **`options.agentEngine` bypass risk:** Test-only. `collector/server/index.mjs:14014` (the only production call site) invokes `runAiDraftStage(repo, actorEmail(req), { mode, allowFallback, aiConfig, contentItemId })` — no `agentEngine` key, so there is no production path that can inject a substitute engine. Confirmed no bypass risk.

## Out-of-scope check

Confirmed the diff does **not** touch `resolveQueueBucket`, any tab-filter logic, field-pack-status guards, or `canTransition`/`assertValidTransition` itself — grep of the diff for these identifiers returns nothing.

## Adjacent finding (not one of the 7, flagged for the record)

Asymmetric error handling now has a materially larger blast radius than before: on `main`, the AI branch's try/catch (`workflow.mjs:2487-2495` region) wrapped a single `upsertWorkflowModel` call; now it wraps the full 4-step write sequence, so a failure partway through is caught, logged to `workflow.sync.skipped`, and the loop silently continues to the next item — `errorCount` is not incremented for this path, only for field-pack generation failures (`:2462`). The deterministic branch's call to the same helper (`:2506`) still has no try/catch, so a failure there still crashes the batch loudly. This asymmetry existed in shape on `main` but now shields much more.

## Verdict

**Do not merge as-is.** The transition mechanics, field-pack persistence, cost profile, and out-of-scope boundaries are all clean (Q2, Q4, Q5, Q6 pass; Q7 is a non-issue). But the core goal of the branch — "make AI mode produce a real draft" — is not actually achieved: the saved draft body is disconnected from the AI output, and the branch now falsely advances `production_state` to `generated` over content that was never AI-authored, contradicting `collector/docs/structured-context-agent-v1.md`'s documented contract and skipping the human-authoring states in between. Q3's transaction gap additionally means a mid-sequence failure in AI mode can silently mutate `content_items` (including `source_type`) with no matching draft or state transition, and no visible error to the operator.
