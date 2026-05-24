import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExternalAgentPayload,
  buildFieldPackPrompt,
  buildFieldPackRevisionPrompt,
  createAgentGenerationEngine,
  normalizeFieldPack,
} from "../services/agent-generation.mjs";

function createItem(overrides = {}) {
  return {
    id: 35,
    title: "Test Place",
    type: "place",
    category: "cafes",
    lang: "th",
    workflow_status: "cleaned",
    visual_image_urls: ["https://example.com/photo.jpg"],
    structured_context: {
      context_version: "v1",
      content_item_id: 35,
      item: {
        id: 35,
        title: "Test Place",
        type: "place",
        category: "cafes",
        lang: "th",
        slug: "test-place",
        description_clean: "clean text",
        source_url: "https://example.com/source",
      },
      approved_context: [
        {
          id: 1,
          context_type: "fact",
          selected_text: "approved context",
        },
      ],
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

function fieldPackResponse() {
  return {
    field_pack: {
      status: "ready_for_field",
      ai_summary: "field brief",
      story_angle: "field angle",
      social_hook: "field hook",
      checklists: {
        must_verify_fact: ["verify opening hours"],
        must_capture: [
          { capture_type: "photo", item_text: "capture entrance" },
        ],
        must_ask_question: ["ask staff about rules"],
      },
    },
  };
}

test("external agent payload carries structured context and not raw description", () => {
  const item = createItem({
    description_raw: "legacy raw text",
    agent_profile: {
      agent_key: "field_pack_agent",
      display_name: "Field Pack Agent",
      profile_text: "custom tone profile",
    },
  });
  const payload = buildExternalAgentPayload("generate_field_pack", item, { model: "agent-v1" });

  assert.equal(payload.schema_version, "collector_agent_request_v1");
  assert.equal(payload.task, "generate_field_pack");
  assert.equal(payload.content_item_id, 35);
  assert.equal(payload.model, "agent-v1");
  assert.deepEqual(payload.mcp.tools, ["validate_clean_minimum", "get_clean_context"]);
  assert.equal(payload.structured_context.item.description_clean, "clean text");
  assert.equal(payload.prompt_input.agent_profile.profile_text, "custom tone profile");
  assert.equal(JSON.stringify(payload).includes("legacy raw text"), false);
});

test("field pack prompt blocks article output and requires handoff contract", () => {
  const prompt = buildFieldPackPrompt(createItem({ agent_profile: { profile_text: "use a practical field producer tone" } }));
  assert.match(prompt, /field_pack/);
  assert.match(prompt, /NOT an article-writing task/);
  assert.match(prompt, /must_capture/);
  assert.match(prompt, /capture_type/);
  assert.match(prompt, /Never output description_clean/);
  assert.match(prompt, /use a practical field producer tone/);
});

test("field pack revision prompt includes previous pack and revision note", () => {
  const prompt = buildFieldPackRevisionPrompt(
    createItem(),
    fieldPackResponse().field_pack,
    "make it more practical"
  );

  assert.match(prompt, /revise the current handoff field pack/);
  assert.match(prompt, /previous_field_pack/);
  assert.match(prompt, /revision_note/);
  assert.match(prompt, /make it more practical/);
  assert.match(prompt, /Never output description_clean/);
});

test("field pack normalizer rejects article output fields", () => {
  assert.throws(
    () => normalizeFieldPack({
      field_pack: {
        ...fieldPackResponse().field_pack,
        description_clean: "article body",
      },
    }),
    /must not include article\/output fields/
  );
});

test("external agent engine normalizes visual context and field pack responses", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === "https://example.com/photo.jpg") {
      return new Response("fake-image-bytes", {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
        },
      });
    }
    const body = JSON.parse(String(options.body || "{}"));
    calls.push({ url, body, authorization: options.headers?.Authorization || "" });
    if (body.task === "generate_visual_context") {
      return Response.json({
        visual_context: {
          visual_summary: "mock garden mood",
          setting_cues: ["trees"],
        },
      });
    }
    return Response.json(fieldPackResponse());
  };

  try {
    const engine = createAgentGenerationEngine({
      enabled: true,
      agentEngine: "external",
      externalAgentUrl: "https://agent.example/run/",
      externalAgentToken: "secret-token",
      model: "agent-v1",
    });
    const item = createItem({
      agent_profile: {
        agent_key: "field_pack_agent",
        display_name: "Field Pack Agent",
        profile_text: "custom tone profile",
      },
    });
    const visual = await engine.generateVisualContext(item);
    const fieldPack = await engine.generateFieldPack({ ...item, visual_context: visual });
    const revised = await engine.reviseFieldPack(
      { ...item, visual_context: visual },
      fieldPack,
      "make it more practical"
    );

    assert.equal(visual.visual_summary, "mock garden mood");
    assert.deepEqual(visual.setting_cues, ["trees"]);
    assert.equal(fieldPack.status, "ready_for_field");
    assert.equal(fieldPack.ai_summary, "field brief");
    assert.equal(fieldPack.field_pack_checklists.length, 3);
    assert.equal(revised.status, "ready_for_field");
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, "https://agent.example/run");
    assert.equal(calls[0].authorization, "Bearer secret-token");
    assert.equal(calls[0].body.task, "generate_visual_context");
    assert.equal(calls[0].body.images.length, 1);
    assert.equal(calls[1].body.task, "generate_field_pack");
    assert.equal(calls[1].body.agent_profile.profile_text, "custom tone profile");
    assert.equal(calls[1].body.prompt_input.agent_profile.profile_text, "custom tone profile");
    assert.equal(calls[1].body.visual_context.visual_summary, "mock garden mood");
    assert.equal(calls[2].body.task, "revise_field_pack");
    assert.equal(calls[2].body.agent_profile.profile_text, "custom tone profile");
    assert.equal(calls[2].body.previous_field_pack.ai_summary, "field brief");
    assert.equal(calls[2].body.revision_note, "make it more practical");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
