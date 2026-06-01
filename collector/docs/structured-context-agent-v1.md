# Structured Context Agent v1

## Scope

This path keeps the existing clean page and `/api/run/ai-draft` route for compatibility, but changes the generation backend to use clean-curated structured context through the agent engine.

The user-visible flow remains:

1. Raw/source data is reviewed on the clean page.
2. The clean page saves curated fields.
3. The Agent action builds structured context from clean data.
4. The internal agent engine generates a handoff field pack.
5. The item remains `workflow_status=cleaned` and becomes ready for `?tab=handoff&item_id=...` through `field_pack.status=ready_for_field`.

## Source Contract

`buildCleanStructuredContext()` is the source of truth for agent input.

Allowed primary fields:

- `item.title`
- `item.type`
- `item.category`
- `item.lang`
- `item.slug`
- `item.description_clean`
- `item.tags`
- `item.source_name`
- `item.source_url`
- `item.latitude`
- `item.longitude`
- `item.map_url`
- `item.google_place_id`
- `approved_context`
- `evidence_blocks`
- `image_context`
- `completeness`
- `evidence_policy`
- `task`

Do not send `description_raw` in structured context. Clean-curated content must come from `description_clean`, `approved_context`, and clean-selected images.

## Minimum Requirements

`validateCleanMinimum()` blocks sending to Agent when required clean data is missing.

Hard blockers:

- Missing item title.
- Missing traceable reference: source URL, map URL, Google place id, or coordinates.
- Missing at least one active approved clean context block.

Soft gaps do not block generation. Current examples include:

- `image_context`
- `editor_note_richness`
- `context_depth`

## Image Handling

Clean-selected images are collected from `image_context`.

The agent engine accepts:

- Absolute `http(s)` image URLs.
- Collector proxy URLs beginning with `/api/`.

Before sending proxy URLs to OpenAI, the engine fetches them from Collector and converts them to `data:image/...;base64,...`. Runtime base URL resolution uses:

1. `COLLECTOR_INTERNAL_BASE_URL`
2. `COLLECTOR_PUBLIC_BASE_URL`
3. `http://127.0.0.1:${PORT || 5062}`

Smoke/test-only variables must not control runtime image fetch behavior.

## Runtime Path

Main route:

```text
POST /api/run/ai-draft
```

The route still exists for compatibility. Internally, `runAiDraftStage()` creates `createAgentGenerationEngine()` for `mode=ai` and calls:

- `generateVisualContext()`
- `generateFieldPack()`

On success, the route now saves the agent output as the current handoff field pack:

- `field_packs`
- `field_pack_checklists`
- `field_pack_references`
- `field_pack_media_hints`
- `workflow_status=cleaned` so the item remains visible in `?tab=handoff&item_id=...`
- workflow model `production_state=analyzed`

Agent generation must not overwrite `description_clean`. Clean text remains human-curated input.

## External Agent Integration

The default runtime remains the internal OpenAI Responses adapter. External agent execution is opt-in and uses the same `generateVisualContext()` / `generateFieldPack()` engine interface. `/api/run/ai-draft` remains as the compatibility route, but the saved output contract is now a handoff field pack, not an article draft.

Environment:

```powershell
COLLECTOR_AGENT_ENGINE=external
COLLECTOR_EXTERNAL_AGENT_URL=https://agent.example/run
COLLECTOR_EXTERNAL_AGENT_TOKEN=optional-bearer-token
COLLECTOR_EXTERNAL_AGENT_TIMEOUT_MS=90000
```

External agent request shape:

- `schema_version`: `collector_agent_request_v1`
- `task`: `generate_visual_context` or `generate_field_pack`
- `content_item_id`
- `model`
- `mcp`: advertises `collector-clean-context` tools (`validate_clean_minimum`, `get_clean_context`)
- `structured_context`: clean structured context v1
- `prompt_input`: normalized generation input used by the internal engine
- `images`: visual-context task only; selected images prepared the same way as the internal path, including `/api/...` proxy images converted to `data:image/...;base64,...`
- `visual_context`: field-pack task only, when visual context was generated

Accepted external agent responses:

```json
{
  "visual_context": {
    "visual_summary": "...",
    "setting_cues": [],
    "atmosphere_cues": [],
    "style_cues": [],
    "standout_visual_elements": [],
    "confidence_note": "..."
  }
}
```

```json
{
  "field_pack": {
    "status": "ready_for_field",
    "ai_summary": "...",
    "ai_highlights": [],
    "ai_unknowns": [],
    "editor_summary": "",
    "verified_facts": [],
    "uncertain_facts": [],
    "story_angle": "...",
    "field_notes": "...",
    "social_hook": "...",
    "social_caption_angle": "...",
    "social_shot_emphasis": [],
    "social_on_camera_points": [],
    "checklists": {
      "must_verify_fact": [],
      "must_capture": [
        {
          "capture_type": "photo",
          "item_text": "..."
        }
      ],
      "must_ask_question": []
    },
    "field_pack_references": [],
    "field_pack_media_hints": []
  }
}
```

The adapter also accepts `output`, `result`, or a direct JSON object with the same fields. It normalizes responses into the field pack contract before workflow save.

## First-Time MCP/Agent Runbook

MCP is not the generator. In this project, MCP is the Collector data/tool endpoint that an agent can call when it needs clean context:

```text
POST /api/mcp
```

For the first external integration step, do not start with a full MCP client. Start with the mock external HTTP agent first:

```text
Collector /api/run/ai-draft
  -> external HTTP agent mock
  -> mock returns existing draft JSON contract
  -> Collector saves output as generated
```

### Step 1: Start Collector in external-agent mode

Open terminal A:

```powershell
cd D:\UbonCity_Web\collector
$env:COLLECTOR_AGENT_ENGINE="external"
$env:COLLECTOR_EXTERNAL_AGENT_URL="http://127.0.0.1:7001/run"
npm start
```

Keep this terminal running.

### Step 2: Run the mock external-agent smoke

Open terminal B:

```powershell
cd D:\UbonCity_Web\collector
npm run smoke:external-agent -- --item 35
```

This smoke starts a temporary mock agent on:

```text
http://127.0.0.1:7001/run
```

Expected result:

- mock receives `generate_visual_context`
- mock receives `generate_field_pack`
- `/api/run/ai-draft` returns `ok`
- item remains `workflow_status=cleaned`
- current field pack is saved with `status=ready_for_field`
- `description_clean` is unchanged

The mock request log is written by default to:

```text
collector/runtime/mock-external-agent-smoke.jsonl
```

Open that file to inspect exactly what Collector sent to the external agent.

### Optional: Run mock server manually

If you want to watch incoming requests live:

```powershell
cd D:\UbonCity_Web\collector
npm run mock:external-agent -- --port 7001 --log-file runtime/mock-external-agent.jsonl
```

Then run the normal draft smoke in another terminal while Collector is already in external mode:

```powershell
npm run smoke:ai-draft -- --item 35
```

### Step 3: Only after mock works, wire a real agent

Replace:

```powershell
$env:COLLECTOR_EXTERNAL_AGENT_URL="http://127.0.0.1:7001/run"
```

with your real agent endpoint. The real endpoint must accept the request shape above and return `visual_context` / `draft` JSON.

For local real-agent testing, Collector includes a small HTTP agent wrapper around OpenAI Responses:

Terminal A:

```powershell
cd D:\UbonCity_Web\collector
$env:OPENAI_API_KEY="..."
npm run agent:external
```

Terminal B:

```powershell
cd D:\UbonCity_Web\collector
$env:COLLECTOR_AGENT_ENGINE="external"
$env:COLLECTOR_EXTERNAL_AGENT_URL="http://127.0.0.1:7001/run"
npm start
```

Terminal C:

```powershell
cd D:\UbonCity_Web\collector
npm run smoke:ai-draft -- --item 35
```

This path is the production-shaped flow:

```text
/api/run/ai-draft -> external agent HTTP server -> OpenAI Responses -> existing draft output saved by Collector
```

### Where MCP comes in later

The mock/external adapter already sends `structured_context`, so the real agent can generate without calling MCP at first.

When ready for full MCP behavior, the external agent can call Collector:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_clean_context",
    "arguments": { "content_item_id": 35 }
  }
}
```

That is an agent-side enhancement. It is not required for the first external-agent smoke.

## ChatGPT MCP Public Test Endpoint

ChatGPT cannot call `http://127.0.0.1:5062/api/mcp` directly. It also cannot reuse the Collector browser login session. For first-time ChatGPT testing, Collector exposes a separate read-only endpoint:

```text
POST /api/mcp-chatgpt-test?token=<COLLECTOR_MCP_PUBLIC_TEST_TOKEN>
```

This endpoint is disabled unless `COLLECTOR_MCP_PUBLIC_TEST_TOKEN` is set.

Recommended local start for ChatGPT MCP testing:

```powershell
cd D:\UbonCity_Web\collector
$env:COLLECTOR_MCP_PUBLIC_TEST_TOKEN="dev-mcp-12345"
$env:COLLECTOR_MCP_PUBLIC_TEST_ITEM_IDS="35"
npm start
```

Local smoke:

```powershell
cd D:\UbonCity_Web\collector
$env:COLLECTOR_MCP_PUBLIC_TEST_TOKEN="dev-mcp-12345"
npm run smoke:mcp-chatgpt-test -- --item 35
```

If using Cloudflare Tunnel:

```powershell
C:\Cloudflared\cloudflared.exe tunnel --url http://127.0.0.1:5062
```

If the tunnel URL is:

```text
https://abc-demo.trycloudflare.com
```

Use this MCP URL in ChatGPT Developer Mode:

```text
https://abc-demo.trycloudflare.com/api/mcp-chatgpt-test?token=dev-mcp-12345
```

Use `No Authentication` in ChatGPT for this temporary test endpoint because the test token is already in the URL. Do not use this pattern for production.

The ChatGPT test endpoint exposes read-only tools:

- `validate_clean_minimum`
- `get_clean_context`
- `get_field_pack_contract_prompt`
- `get_draft_contract_prompt` (deprecated alias)

For field-pack experiments in ChatGPT, prefer `get_field_pack_contract_prompt` over manually typing the contract rules. It returns the structured context plus the required JSON keys and grounding rules.

The field-pack contract prompt guards against common ChatGPT issues:

- article body output
- reader-facing internal process terms such as `clean context`, `approved_context`, or `ข้อมูลที่อนุมัติ`
- stiff Thai phrasing such as `อายุขัยมากกว่า` or `ถูกกระทำโดย`
- causal/preservation explanations that are not explicitly stated in context

Suggested ChatGPT prompt:

```text
Use UbonCity Collector Test only.
Call get_field_pack_contract_prompt for content_item_id 35.
Follow the returned grounding_rules and required_json_keys exactly.
Return JSON only.
```

## Smoke Commands

MCP/structured context readiness:

```powershell
npm run smoke:mcp -- --item 35
```

Agent generation runtime:

```powershell
npm run smoke:ai-draft -- --item 35
```

Use item `35` as the primary proxy-image regression case because it includes clean-selected `/api/google-maps/photo?...` URLs.

Expected generation smoke result:

- `ok=true`
- `generation.mode=ai`
- `generation.aiSuccessCount=1`
- `generation.errorCount=0`
- `generation.visualContextSuccessCount>0` when selected images exist
- `generation.visualContextErrorCount=0`
- `saved_contract.workflow_status=cleaned`
- `field_pack_contract.status=ready_for_field`

## Current Verified Items

Runtime smoke has passed with visual context success on:

- `35`: attraction with Google proxy image URLs.
- `15`: cafe with external selected images.
- `60`: cafe/restaurant context from manual web sources.
