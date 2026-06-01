import "dotenv/config";
import { createTestClient } from "./lib/test-client.mjs";

function readCliOption(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] ?? "").trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function endpoint(token) {
  return `/api/mcp-chatgpt-test?token=${encodeURIComponent(token)}`;
}

async function main() {
  const client = createTestClient({ auth: false });
  const contentItemId = Number(readCliOption("--item") || process.env.COLLECTOR_TEST_ITEM_ID || 0) || 0;
  const token = String(readCliOption("--token") || process.env.COLLECTOR_MCP_PUBLIC_TEST_TOKEN || "").trim();
  if (!token) {
    throw new Error("Set --token <token> or COLLECTOR_MCP_PUBLIC_TEST_TOKEN");
  }

  const invalidToken = await client.post("/api/mcp-chatgpt-test?token=wrong-token", {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });
  assert(invalidToken.status === 401, `invalid token status mismatch: ${invalidToken.status} ${JSON.stringify(invalidToken.body)}`);

  const tools = await client.post(endpoint(token), {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  assert(tools.status === 200, `tools/list status mismatch: ${tools.status} ${JSON.stringify(tools.body)}`);
  const toolNames = (tools.body?.result?.tools || []).map((tool) => String(tool?.name || ""));
  assert(toolNames.includes("validate_clean_minimum"), `validate_clean_minimum missing: ${JSON.stringify(tools.body)}`);
  assert(toolNames.includes("get_clean_context"), `get_clean_context missing: ${JSON.stringify(tools.body)}`);
  assert(toolNames.includes("get_field_pack_contract_prompt"), `get_field_pack_contract_prompt missing: ${JSON.stringify(tools.body)}`);
  assert(toolNames.includes("get_draft_contract_prompt"), `deprecated get_draft_contract_prompt alias missing: ${JSON.stringify(tools.body)}`);

  const output = {
    ok: true,
    endpoint: "/api/mcp-chatgpt-test",
    checks: {
      invalid_token: invalidToken.body,
      tools_list: tools.body,
    },
  };

  if (contentItemId > 0) {
    const minimum = await client.post(endpoint(token), {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "validate_clean_minimum",
        arguments: { content_item_id: contentItemId },
      },
    });
    assert(minimum.status === 200, `validate_clean_minimum status mismatch: ${minimum.status} ${JSON.stringify(minimum.body)}`);
    assert(!minimum.body?.error, `validate_clean_minimum returned error: ${JSON.stringify(minimum.body)}`);

    const context = await client.post(endpoint(token), {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_clean_context",
        arguments: { content_item_id: contentItemId },
      },
    });
    assert(context.status === 200, `get_clean_context status mismatch: ${context.status} ${JSON.stringify(context.body)}`);
    assert(!context.body?.error, `get_clean_context returned error: ${JSON.stringify(context.body)}`);
    assert(Number(context.body?.result?.structuredContent?.content_item_id || 0) === contentItemId, `content_item_id mismatch: ${JSON.stringify(context.body)}`);

    const fieldPackPrompt = await client.post(endpoint(token), {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "get_field_pack_contract_prompt",
        arguments: { content_item_id: contentItemId },
      },
    });
    assert(fieldPackPrompt.status === 200, `get_field_pack_contract_prompt status mismatch: ${fieldPackPrompt.status} ${JSON.stringify(fieldPackPrompt.body)}`);
    assert(!fieldPackPrompt.body?.error, `get_field_pack_contract_prompt returned error: ${JSON.stringify(fieldPackPrompt.body)}`);
    assert(fieldPackPrompt.body?.result?.structuredContent?.contract_version === "field_pack_contract_v1", `field pack contract version mismatch: ${JSON.stringify(fieldPackPrompt.body)}`);
    assert(
      (fieldPackPrompt.body?.result?.structuredContent?.required_json_keys || []).includes("field_pack"),
      `field pack contract missing field_pack: ${JSON.stringify(fieldPackPrompt.body)}`
    );
    assert(
      (fieldPackPrompt.body?.result?.structuredContent?.grounding_rules || []).some((rule) => String(rule || "").includes("not an article draft")),
      `field pack contract missing article guard: ${JSON.stringify(fieldPackPrompt.body)}`
    );
    assert(
      Boolean(fieldPackPrompt.body?.result?.structuredContent?.field_pack_schema?.checklists?.must_capture_shot),
      `field pack contract missing checklist schema: ${JSON.stringify(fieldPackPrompt.body)}`
    );

    output.content_item_id = contentItemId;
    output.checks.validate_clean_minimum = minimum.body;
    output.checks.get_clean_context = {
      jsonrpc: context.body?.jsonrpc,
      id: context.body?.id,
      result: {
        content_item_id: context.body?.result?.structuredContent?.content_item_id,
        title: context.body?.result?.structuredContent?.item?.title,
        approved_context_count: Array.isArray(context.body?.result?.structuredContent?.approved_context)
          ? context.body.result.structuredContent.approved_context.length
          : 0,
        selected_image_count: Number(context.body?.result?.structuredContent?.image_context?.selected_count || 0) || 0,
      },
    };
    output.checks.get_field_pack_contract_prompt = {
      jsonrpc: fieldPackPrompt.body?.jsonrpc,
      id: fieldPackPrompt.body?.id,
      result: {
        contract_version: fieldPackPrompt.body?.result?.structuredContent?.contract_version,
        output_format: fieldPackPrompt.body?.result?.structuredContent?.output_format,
        required_json_keys: fieldPackPrompt.body?.result?.structuredContent?.required_json_keys,
      },
    };
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(`smoke-mcp-chatgpt-test: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
