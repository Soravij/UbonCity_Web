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

function createHippieRoasterItem(overrides = {}) {
  return createItem({
    id: 53,
    title: "Hippie Roaster",
    structured_context: {
      item: {
        id: 53,
        title: "Hippie Roaster",
        type: "place",
        category: "cafes",
        lang: "th",
        description_clean: "clean text",
      },
      approved_context: [
        {
          context_type: "mention",
          selected_text: "Phone: 0659391488",
          provenance: {
            evidence_source_url: "https://www.wongnai.com/reviews/842964bb159942f887e7cc5244fda433",
          },
        },
        {
          context_type: "mention",
          selected_text: "Website: https://www.facebook.com/hippieroaster?locale=th_TH",
          provenance: {
            evidence_source_url: "https://www.facebook.com/hippieroaster/?locale=th_TH",
          },
        },
      ],
      evidence_blocks: [
        {
          block_type: "mention",
          text_value: "Phone: 065 939 1488",
          source_url: "https://maps.google.com/?cid=4182277082282715109",
        },
      ],
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
  });
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

test("internal agent engine fills deterministic CTA candidates for generate and revise when backend omits ai_cta_contact_json", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === "https://example.com/photo.jpg") {
      return new Response("fake-image-bytes", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    const body = JSON.parse(String(options.body || "{}"));
    if (body.task === "visual_context") {
      return Response.json({
        output_text: JSON.stringify({ visual_summary: "proxy visual summary" }),
      });
    }
    return Response.json({
      output_text: JSON.stringify({
        field_pack: {
          status: "draft",
          ai_summary: "proxy field pack",
          story_angle: "proxy angle",
          social_hook: "proxy hook",
          ai_cta_contact_json: {
            phone: "4182277082",
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
    const item = createHippieRoasterItem();
    const visual = await engine.generateVisualContext(item);
    const generated = await engine.generateFieldPack({ ...item, visual_context: visual });
    const revised = await engine.reviseFieldPack({ ...item, visual_context: visual }, generated, "tighten");

    assert.equal(generated.ai_cta_contact_json.phone, "0659391488");
    assert.equal(generated.ai_cta_contact_json.facebook_url, "https://www.facebook.com/hippieroaster/?locale=th_TH");
    assert.equal(Object.prototype.hasOwnProperty.call(generated.ai_cta_contact_json, "primary_cta"), false);
    assert.equal(revised.ai_cta_contact_json.phone, "0659391488");
    assert.equal(revised.ai_cta_contact_json.facebook_url, "https://www.facebook.com/hippieroaster/?locale=th_TH");
    assert.equal(Object.prototype.hasOwnProperty.call(revised.ai_cta_contact_json, "primary_cta"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
