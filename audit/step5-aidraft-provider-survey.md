# Step 5 — AI-draft field-pack provider survey

Date: 2026-08-02  
Scope: source and database read-only inspection, plus the one explicitly authorized `POST /api/run/ai-draft` attempt for item 9. No code, schema, migration, direct database write, or additional AI-draft request was made.

## Decision

**Classification: (i) prompt/schema instruction is incomplete relative to the enforced workflow contract; fix the prompt (and preferably add a provider response schema).**

The prompt names `must_capture` and explains its object shape, but it never says that `must_capture`, `must_verify_fact`, and `must_ask_question` are each required to be non-empty (minimum one). The workflow enforces that cardinality after the provider responds. The active Google request asks only for JSON MIME, not a JSON Schema with `minItems: 1`; therefore a syntactically valid JSON response with an empty/missing capture list can reach the workflow and fail.

There is no retained raw response for item 8, so the exact malformed shape from that earlier failure cannot be established honestly. The one authorized item-9 retry completed successfully and persisted five valid `must_capture` rows. It proves the active provider can comply and that the current converter preserves a correct response; it does not reconstruct item 8's raw response.

## 1. Prompt and output contract

| Question | Evidence | Finding |
| --- | --- | --- |
| Prompt builder | `collector/services/agent-generation.mjs:471-510` (`buildFieldPackPrompt`) | The production field-pack prompt is built locally and sent through `generateFieldPack` at `:815-833`. A debug copy (first 2,000 characters only) is written by `debugPrompt` at `:551-564` and called at `:820-821`. |
| Does it name the capture shape? | `agent-generation.mjs:477-478,497-500` | Yes. It names `checklists.must_capture`, says it is an array of objects, and asks for `capture_type (photo/video/both)` plus `item_text`, one concrete shot per item. |
| Does it demand at least one? | Same prompt; compare `collector/services/workflow.mjs:2118-2137` | No explicit “at least one non-empty item” instruction exists for any of the three required checklist groups. `workflow.mjs:2124-2126` does require at least one `must_verify_fact`, `must_capture`, and `must_ask_question`. This is a cardinality-contract gap. |
| Structured output? | `collector/services/backend-ai-client.mjs:46-72`; `backend/routes/internalAiRoutes.js:23-54`; `backend/services/aiExecutionService.js:161-192` | Actual path is collector → backend `/internal/ai/json` → Google `generateContent`. Google receives `generationConfig.responseMimeType: "application/json"` (`:174-176`) but no `responseSchema`; it is JSON-only free generation, parsed afterwards. It is not a tool call and has no provider-enforced checklist schema/minimum cardinality. |
| Contract alignment | Prompt `agent-generation.mjs:477-500`; normalizer `:109-133,136-220`; assertion `workflow.mjs:2114-2137` | Field names and allowed `capture_type` values align. The prompt is weaker than the runtime assertion on required non-empty lists. |

For completeness, the non-active OpenAI branch is also unconstrained JSON text: `backend/services/aiExecutionService.js:128-159` calls Chat Completions without `response_format` or a JSON schema. The runtime evidence shows this test used Google, not OpenAI.

## 2. What is retained, and item 8

The raw provider response is not persisted in collector SQLite:

- `collector/services/backend-ai-client.mjs:57-71` receives `output_text`/`parsed` from the backend and returns them only in memory.
- `collector/services/agent-generation.mjs:829-833` immediately normalizes that in-memory object.
- `pipeline_runs` and `generation_runs` retain only status/count/message (`collector/database/schema.sql:186-197,534-546`); `audit_logs` has `details_json` only (`:199-209`); `draft_input_snapshots` contains request/input snapshots rather than provider output (`:510-532`).
- `debugPrompt` retains a truncated prompt, not a response (`agent-generation.mjs:551-564`).

Read-only inspection of item 8 found its state still `analyzed/draft`, an input snapshot, and no stored field pack. The earlier error text proves that the normalized object had zero countable `must_capture` rows at `workflow.mjs:2125`; it cannot distinguish among: omitted list, an ignored legacy/wrong key, non-object capture entries, or rows missing `item_text`. A response with a present `must_capture` object lacking `capture_type` would instead fail earlier and specifically at `agent-generation.mjs:120-122`, so that is not consistent with the observed `must_capture checklist item` error.

## 3. One allowed item-9 runtime attempt

`POST /api/run/ai-draft` with `content_item_id: 9` was attempted once. The local PowerShell HTTP client reported a `NullReferenceException` while receiving the response, but read-only database verification shows the service processed the request once and completed it:

| Evidence | Observed value |
| --- | --- |
| `pipeline_runs` | `ai-draft` run `12c57f58-dc26-4eed-b54a-31c02c9a8b8c`, `done`, output 1, message `success=1 fallback=0 errors=0` |
| `generation_runs` | run `b573778f-b618-4177-9ed1-aec5cafbaffa`, mode `ai`, model `gemini-2.5-flash-lite`, `done`, output 1, errors 0 |
| Saved field pack | field-pack id 1 for item 9, current, status `draft` |
| Saved checklist result | 5 `must_capture`, 3 `must_verify_fact`, 4 `must_ask_question` |
| Capture values | all five saved capture rows have a non-empty `item_text` and `capture_type` of `photo` or `video` |

This is persisted, normalized evidence rather than a raw provider payload. It shows no generic converter loss: a correctly named, correctly shaped provider result reaches `field_pack_checklists` as `checklist_type = must_capture`.

## 4. Converter analysis

`normalizeFieldPack` accepts either a top-level `field_pack` envelope or the object itself (`collector/services/agent-generation.mjs:136-140`). It reads three input locations for each group:

- verify: top-level `must_verify_fact`/aliases or `checklists.must_verify_fact` (`:188-190`);
- capture: only top-level `must_capture` or `checklists.must_capture` (`:191`);
- ask: top-level `must_ask_question`/aliases or `checklists.must_ask_question` (`:192`).

`normalizeCaptureChecklistGroup` ignores non-objects and blank `item_text` (`:109-117`), throws for missing/invalid `capture_type` (`:120-122`), and writes valid rows as `checklist_type: "must_capture"` (`:124-130`).

There is a compatibility hole: `must_capture_shot` is not an accepted input alias. Such a provider key would be silently absent from the normalized capture list and later produce the item-8-style count error. There is stale fixture evidence of that old term in `collector/scripts/seed-mock-work-stage-jobs.mjs:262-268` and `collector/scripts/smoke-mcp-chatgpt-test.mjs:105`. However, no retained raw response shows item 8 used it, and item 9 proves the current provider did not use it. It is a separate converter hardening candidate, not proof of the item-8 root cause.

## 5. Active configuration and flags

| Setting | Evidence | Value |
| --- | --- | --- |
| Field-pack policy | `ai_feature_policies` queried read-only; no rows; defaults in `collector/config/ai.mjs:1-32,164-215` | Default `gemini-2.5-flash-lite` → provider `google`, model `gemini-2.5-flash-lite`. |
| Runtime confirmation | Item-9 `ai_draft.run.start` audit record | field pack provider `google`, model `gemini-2.5-flash-lite`; backend proxy ready. |
| Engine | `collector/config/ai.mjs:181,213-215` | `internal` unless `COLLECTOR_AGENT_ENGINE=external`; the observed backend-proxy audit state and successful internal proxy execution are consistent with internal. |
| Feature flag | `collector/config/ai.mjs:25-32`; DB has no override rows | `fieldPack` is `active: true`; no feature policy disables it. |

The audit runtime snapshot intentionally exposes only readiness metadata (`has_api_key: false` in collector because the key is held by the backend), not secret values. No key was read or recorded.

## Result and recommended correction scope

The evidence rules out “prompt never asks for `must_capture`” and rules out a universal converter drop. It supports classification **(i)** because the prompt/output mechanism does not enforce the cardinality required by the workflow. The minimum correction should make the prompt state all of the following unambiguously: each of `must_verify_fact`, `must_capture`, and `must_ask_question` must be an array with at least one non-empty entry; each capture entry must be an object with `item_text` and `capture_type` limited to `photo|video|both`. The durable correction is to send the equivalent provider JSON schema with `minItems: 1` for those arrays and an enum for `capture_type`.

No fix was made in this audit.
