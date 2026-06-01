import express from "express";
import { buildCleanStructuredContext, validateCleanMinimum } from "../../services/clean-context.mjs";

function jsonRpcError(id, code, message, data = null) {
  const payload = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
  if (data != null) payload.error.data = data;
  return payload;
}

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  };
}

function createToolResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent: value,
  };
}

function toText(value) {
  return String(value || "").trim();
}

function parseContentItemId(args) {
  const contentItemId = Number(args?.content_item_id || 0);
  return Number.isInteger(contentItemId) && contentItemId > 0 ? contentItemId : null;
}

function buildFieldPackContractPrompt(context) {
  const title = toText(context?.item?.title);
  const lang = toText(context?.item?.lang || "th") || "th";
  return {
    contract_version: "field_pack_contract_v1",
    content_item_id: Number(context?.content_item_id || 0) || null,
    title,
    lang,
    output_format: "json_only",
    required_json_keys: ["field_pack"],
    field_pack_schema: {
      status: "ready_for_field",
      ai_summary: "string",
      ai_highlights: "string[]",
      ai_unknowns: "string[]",
      editor_summary: "string",
      verified_facts: "string[]",
      uncertain_facts: "string[]",
      story_angle: "string",
      field_notes: "string",
      social_hook: "string",
      social_caption_angle: "string",
      social_shot_emphasis: "string[]",
      social_on_camera_points: "string[]",
      checklists: {
        must_verify_fact: "string[]",

        must_capture: "object[]",
        must_ask_question: "string[]",
      },
      field_pack_references: "object[]",
      field_pack_media_hints: "object[]",
    },
    grounding_rules: [
      "Use only the supplied clean structured context.",
      "Use approved_context as the primary source of truth.",
      "Use item fields for identity and traceable place facts.",
      "Use image_context only for visible cues and shot planning.",
      "Use evidence_blocks only as supporting clues; never override approved_context.",
      "Do not use description_raw.",
      "Do not output description_clean, description_raw, article body, slug, meta_title, or meta_description.",
      "This is a handoff field pack for people doing field/content work, not an article draft.",
      "Do not invent facts, ratings, prices, phone numbers, routes, opening hours, or claims that are not in the context.",
      "If context is thin or uncertain, put it into ai_unknowns or must_verify_fact instead of filling gaps.",
      "Return valid JSON only. No markdown fences. No commentary outside JSON.",
    ],
    style_rules: [
      lang === "th" ? "Write concise natural Thai instructions." : "Write in the requested item language.",
      "must_capture is an array of objects with capture_type (photo/video/both) and item_text. Make each item concrete enough for a person with a camera.",
      "Make must_verify_fact checkable.",
      "Make must_ask_question useful for staff/local people/visitors.",
      "social_hook and social_caption_angle are direction notes, not final published copy.",
    ],
    structured_context: context,
  };
}

function buildTools() {
  const itemIdInputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["content_item_id"],
    properties: {
      content_item_id: {
        type: "integer",
        minimum: 1,
        description: "Collector content item id.",
      },
    },
  };

  return [
    {
      name: "get_clean_context",
      description: "Return clean-based structured context for one content item.",
      inputSchema: itemIdInputSchema,
    },
    {
      name: "get_field_pack_contract_prompt",
      description: "Return clean context plus strict JSON field-pack handoff contract instructions for one content item.",
      inputSchema: itemIdInputSchema,
    },
    {
      name: "get_draft_contract_prompt",
      description: "Deprecated alias for get_field_pack_contract_prompt.",
      inputSchema: itemIdInputSchema,
    },
    {
      name: "validate_clean_minimum",
      description: "Validate minimum clean requirements before sending to agent.",
      inputSchema: itemIdInputSchema,
    },
  ];
}

function parseAllowedItemIds(raw) {
  const ids = new Set();
  for (const part of String(raw || "").split(",")) {
    const id = Number(String(part || "").trim());
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

function isAllowedPublicTestItem(args, allowedItemIds) {
  if (!allowedItemIds || allowedItemIds.size === 0) return true;
  const contentItemId = parseContentItemId(args);
  return Boolean(contentItemId && allowedItemIds.has(contentItemId));
}

function getCleanContextOrError(repo, contentItemId) {
  const context = buildCleanStructuredContext(repo, contentItemId);
  if (!context) {
    return {
      ok: false,
      error: jsonRpcError(null, -32004, "Content item not found", {
        content_item_id: contentItemId,
      }),
    };
  }
  return { ok: true, context };
}

function callTool(repo, name, args) {
  const contentItemId = parseContentItemId(args);
  if (!contentItemId) {
    return {
      ok: false,
      error: jsonRpcError(null, -32602, "Invalid params", {
        reason: "content_item_id must be a positive integer",
      }),
    };
  }

  if (name === "get_clean_context") {
    const outcome = getCleanContextOrError(repo, contentItemId);
    return outcome.ok ? { ok: true, result: createToolResult(outcome.context) } : outcome;
  }

  if (name === "validate_clean_minimum") {
    return {
      ok: true,
      result: createToolResult(validateCleanMinimum(repo, contentItemId)),
    };
  }

  if (name === "get_field_pack_contract_prompt" || name === "get_draft_contract_prompt") {
    const outcome = getCleanContextOrError(repo, contentItemId);
    return outcome.ok
      ? { ok: true, result: createToolResult(buildFieldPackContractPrompt(outcome.context)) }
      : outcome;
  }

  return {
    ok: false,
    error: jsonRpcError(null, -32601, "Tool not found", {
      tool: name,
    }),
  };
}

function handleJsonRpcRequest(repo, tools, body) {
  const id = body.id ?? null;
  const method = String(body.method || "").trim();

  if (body.jsonrpc !== "2.0" || !method) {
    return jsonRpcError(id, -32600, "Invalid Request");
  }

  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "collector-clean-context",
        version: "1.0.0",
      },
      capabilities: {
        tools: {},
      },
    });
  }

  if (method === "tools/list") {
    return jsonRpcResult(id, { tools });
  }

  if (method === "tools/call") {
    const outcome = callTool(repo, String(body.params?.name || "").trim(), body.params?.arguments || {});
    if (!outcome.ok) {
      return {
        ...outcome.error,
        id,
      };
    }
    return jsonRpcResult(id, outcome.result);
  }

  return jsonRpcError(id, -32601, "Method not found");
}

export function createCollectorMcpRouter({ repo, requireRole }) {
  const router = express.Router();
  const tools = buildTools();

  router.post(
    "/",
    requireRole("owner", "admin", "editor", "user"),
    (req, res) => {
      res.json(handleJsonRpcRequest(repo, tools, req.body || {}));
    }
  );

  return router;
}

export function createCollectorMcpPublicTestRouter({ repo }) {
  const router = express.Router();
  const tools = buildTools();

  router.post("/", (req, res) => {
    const configuredToken = String(process.env.COLLECTOR_MCP_PUBLIC_TEST_TOKEN || "").trim();
    if (!configuredToken) {
      res.status(404).json({ error: "MCP public test endpoint is disabled" });
      return;
    }

    const token = String(req.query?.token || "").trim();
    if (!token || token !== configuredToken) {
      res.status(401).json({ error: "Invalid MCP public test token" });
      return;
    }

    const body = req.body || {};
    const method = String(body.method || "").trim();
    const toolName = String(body.params?.name || "").trim();
    const allowedItemIds = parseAllowedItemIds(process.env.COLLECTOR_MCP_PUBLIC_TEST_ITEM_IDS || "");
    const allowedTools = ["validate_clean_minimum", "get_clean_context", "get_field_pack_contract_prompt", "get_draft_contract_prompt"];
    if (method === "tools/call" && !isAllowedPublicTestItem(body.params?.arguments || {}, allowedItemIds)) {
      res.json(jsonRpcError(body.id ?? null, -32003, "Content item is not allowed for public MCP test"));
      return;
    }
    if (method === "tools/call" && !allowedTools.includes(toolName)) {
      res.json(jsonRpcError(body.id ?? null, -32601, "Tool not available on public MCP test endpoint"));
      return;
    }

    res.json(handleJsonRpcRequest(repo, tools, body));
  });

  return router;
}
