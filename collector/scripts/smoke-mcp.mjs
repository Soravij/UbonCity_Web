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

async function main() {
  const client = createTestClient();
  const contentItemId = Number(readCliOption("--item") || process.env.COLLECTOR_TEST_ITEM_ID || 0) || 0;

  const invalidRequest = await client.request("/api/mcp", {
    method: "POST",
    body: {},
  });
  assert(invalidRequest.status === 200, `invalid request status mismatch: ${invalidRequest.status}`);
  assert(invalidRequest.body?.error?.code === -32600, `invalid request code mismatch: ${JSON.stringify(invalidRequest.body)}`);

  const unknownMethod = await client.jsonRpc("does/not/exist", {});
  assert(unknownMethod.status === 200, `unknown method status mismatch: ${unknownMethod.status}`);
  assert(unknownMethod.body?.error?.code === -32601, `unknown method code mismatch: ${JSON.stringify(unknownMethod.body)}`);

  const invalidParams = await client.jsonRpc("tools/call", {
    name: "validate_clean_minimum",
    arguments: { content_item_id: "abc" },
  });
  assert(invalidParams.status === 200, `invalid params status mismatch: ${invalidParams.status}`);
  assert(invalidParams.body?.error?.code === -32602, `invalid params code mismatch: ${JSON.stringify(invalidParams.body)}`);

  const tools = await client.jsonRpc("tools/list", {});
  assert(tools.status === 200, `tools/list status mismatch: ${tools.status}`);

  const output = {
    ok: true,
    checks: {
      invalid_request: invalidRequest.body,
      unknown_method: unknownMethod.body,
      invalid_params: invalidParams.body,
      tools_list: tools.body,
    },
  };

  if (contentItemId > 0) {
    const minimum = await client.jsonRpc("tools/call", {
      name: "validate_clean_minimum",
      arguments: { content_item_id: contentItemId },
    });
    assert(minimum.status === 200, `validate_clean_minimum status mismatch: ${minimum.status}`);

    const context = await client.jsonRpc("tools/call", {
      name: "get_clean_context",
      arguments: { content_item_id: contentItemId },
    });
    assert(context.status === 200, `get_clean_context status mismatch: ${context.status}`);

    output.content_item_id = contentItemId;
    output.checks.validate_clean_minimum = minimum.body;
    output.checks.get_clean_context = context.body;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(`smoke-mcp: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
