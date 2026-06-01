import assert from "node:assert/strict";
import test from "node:test";

import { createAgentGenerationEngine } from "../services/agent-generation.mjs";

function createItem(overrides = {}) {
  return {
    id: 88,
    title: "Proxy Test Place",
    type: "place",
    category: "cafes",
    lang: "th",
    workflow_status: "cleaned",
    visual_image_urls: ["https://example.com/photo.jpg"],
    structured_context: {
      item: {
        id: 88,
        title: "Proxy Test Place",
        type: "place",
        category: "cafes",
        lang: "th",
        description_clean: "clean text",
      },
      approved_context: [{ id: 1, context_type: "fact", selected_text: "approved context" }],
      evidence_blocks: [],
      image_context: {
        selected_urls: ["https://example.com/photo.jpg"],
        gallery_urls: ["https://example.com/photo.jpg"],
        inline_urls: [],
        selected_count: 1,
      },
      completeness: {
        has_minimum_required: true,
        minimum_missing: [],
        quality_gaps: [],
      },
    },
    ...overrides,
  };
}

test("internal agent engine proxies visual context and field pack generation to backend", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === "https://example.com/photo.jpg") {
      return new Response("fake-image-bytes", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }

    calls.push({
      url: String(url),
      headers: options.headers || {},
      body: JSON.parse(String(options.body || "{}")),
    });

    const task = calls.at(-1)?.body?.task;
    if (task === "visual_context") {
      return Response.json({
        output_text: JSON.stringify({
          visual_summary: "proxy visual summary",
          setting_cues: ["trees"],
        }),
      });
    }

    return Response.json({
      output_text: JSON.stringify({
        field_pack: {
          status: "draft",
          ai_summary: "proxy field pack",
          story_angle: "proxy angle",
          social_hook: "proxy hook",
          checklists: {
            must_verify_fact: ["verify opening hours"],
            must_capture: [{ capture_type: "photo", item_text: "capture entrance" }],
            must_ask_question: ["ask staff about opening hours"],
          },
        },
      }),
    });
  };

  try {
    const engine = createAgentGenerationEngine({
      enabled: true,
      agentEngine: "internal",
      backendApiBase: "https://backend.example/api",
      backendSyncToken: "sync-token",
      features: {
        visualContext: { provider: "google", model: "gemini-2.5-flash" },
        fieldPack: { provider: "openai", model: "gpt-5.4-mini" },
      },
    });

    const item = createItem();
    const visual = await engine.generateVisualContext(item);
    const fieldPack = await engine.generateFieldPack({ ...item, visual_context: visual });

    assert.equal(visual.visual_summary, "proxy visual summary");
    assert.equal(fieldPack.ai_summary, "proxy field pack");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://backend.example/api/internal/ai/json");
    assert.equal(calls[0].headers["x-lifecycle-token"], "sync-token");
    assert.equal(calls[0].body.task, "visual_context");
    assert.equal(calls[0].body.provider, "google");
    assert.equal(calls[0].body.model, "gemini-2.5-flash");
    assert.equal(Array.isArray(calls[0].body.image_inputs), true);
    assert.equal(calls[1].body.task, "field_pack");
    assert.equal(calls[1].body.provider, "openai");
    assert.equal(calls[1].body.model, "gpt-5.4-mini");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
