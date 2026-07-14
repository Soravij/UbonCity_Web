import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCtaContactCandidatesFromStructuredContext,
  mergeAiCtaWithDeterministicCandidates,
} from "../server/cta-contact-normalizer.mjs";
import {
  buildFieldPackPrompt,
  buildFieldPackRevisionPrompt,
  buildPromptInput,
  createAgentGenerationEngine,
  normalizeFieldPack,
} from "../services/agent-generation.mjs";
import { buildFieldPackPayloadFromAgent, saveAgentFieldPack } from "../services/workflow.mjs";

function context() {
  return {
    approved_context: [
      {
        selected_text: "Phone: 082-222-2222 | LINE: https://line.me/ti/p/ubon | Facebook: https://facebook.com/uboncity | Website: https://ubon.example/contact",
        provenance: { evidence_source_url: "https://official.example/contact" },
      },
    ],
    evidence_blocks: [
      { text_value: "Website: https://unapproved.example", source_url: "https://unapproved.example" },
    ],
  };
}

function item(overrides = {}) {
  return {
    id: 1,
    type: "place",
    title: "CTA test place",
    lang: "th",
    structured_context: context(),
    ...overrides,
  };
}

function pack(overrides = {}) {
  return {
    ai_summary: "brief",
    story_angle: "angle",
    checklists: {
      must_verify_fact: ["verify"],
      must_capture: [{ capture_type: "photo", item_text: "entrance" }],
      must_ask_question: ["ask"],
    },
    ...overrides,
  };
}

test("extracts phone, LINE, Facebook, website and approved provenance only", () => {
  const result = deriveCtaContactCandidatesFromStructuredContext(context());
  assert.equal(result.phone, "0822222222");
  assert.equal(result.line_url, "https://line.me/ti/p/ubon");
  assert.equal(result.facebook_url, "https://facebook.com/uboncity");
  assert.equal(result.website_url, "https://ubon.example/contact");
  assert.deepEqual(result.source, ["https://official.example/contact"]);
  assert.equal(result.website_url === "https://facebook.com/uboncity", false);
  assert.equal(result.website_url === "https://official.example/contact", false);
  assert.equal(result.website_url === "https://unapproved.example/", false);
});

test("generic provenance URL never becomes a website candidate", () => {
  const result = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [{ selected_text: "Approved fact without contact", provenance: { evidence_source_url: "https://generic-source.example/article" } }],
  });
  assert.deepEqual(result, {});
});

test("prebuilt CTA candidates cannot bypass approved-context extraction", () => {
  const result = mergeAiCtaWithDeterministicCandidates({}, {
    cta_contact_candidates: { website_url: "https://generic-source.example/article" },
    approved_context: [],
  });
  assert.deepEqual(result, {});
});

test("deterministic candidates take precedence and repair AI omissions", () => {
  const result = mergeAiCtaWithDeterministicCandidates({
    phone: "0811111111",
    website_url: "https://ai.example",
    source: ["https://ai.example"],
  }, context());
  assert.equal(result.phone, "0822222222");
  assert.equal(result.website_url, "https://ubon.example/contact");
  assert.equal(result.facebook_url, "https://facebook.com/uboncity");
  assert.equal(result.line_url, "https://line.me/ti/p/ubon");
  assert.deepEqual(result.source, ["https://official.example/contact"]);
});

test("initial and revision field-pack normalization have CTA parity after AI omission", () => {
  const initial = normalizeFieldPack(pack(), { item: item() });
  const revision = normalizeFieldPack(pack(), { item: item() });
  assert.deepEqual(initial.ai_cta_contact_json, revision.ai_cta_contact_json);
  assert.equal(initial.ai_cta_contact_json.phone, "0822222222");
  assert.equal(initial.ai_cta_contact_json.website_url, "https://ubon.example/contact");
});

test("a regenerate the approved context no longer supports clears the stale suggestion", () => {
  const existing = {
    id: 9,
    ai_cta_contact_json: {
      phone: "0804415224",
      website_url: "https://existing.example",
      source: ["https://existing.example"],
    },
  };
  // AI ran and returned no CTA, and the phone is gone from the approved context: it must not survive,
  // or the Work Return form would keep prefilling a value nobody can vouch for any more.
  const saved = buildFieldPackPayloadFromAgent(pack(), existing, {
    item: item({ structured_context: { approved_context: [] } }),
  });
  assert.deepEqual(saved.ai_cta_contact_json, {});
  assert.equal(Object.hasOwn(saved, "structured_context"), false);
});

test("a regenerate still supported by the approved context keeps the value with its provenance", () => {
  const existing = { id: 9, ai_cta_contact_json: { phone: "0804415224" } };
  const saved = buildFieldPackPayloadFromAgent(pack(), existing, { item: item() });
  assert.equal(saved.ai_cta_contact_json.phone, "0822222222");
  assert.deepEqual(saved.ai_cta_contact_json.source, ["https://official.example/contact"]);
});

test("the deterministic/no-AI path never erases stored CTA suggestions", () => {
  const existing = { id: 9, ai_cta_contact_json: { phone: "0804415224", source: ["https://existing.example/"] } };
  const saved = buildFieldPackPayloadFromAgent(null, existing, {
    item: item({ structured_context: { approved_context: [] } }),
  });
  assert.equal(saved.ai_cta_contact_json.phone, "0804415224");
  assert.deepEqual(saved.ai_cta_contact_json.source, ["https://existing.example/"]);
});

test("CTA is place-only: a non-place item generates no suggestions and keeps legacy data untouched", () => {
  const eventItem = item({ type: "event" });
  assert.deepEqual(normalizeFieldPack(pack(), { item: eventItem }).ai_cta_contact_json, {});
  assert.deepEqual(buildPromptInput(eventItem).cta_contact_candidates, {});

  const legacy = { id: 9, ai_cta_contact_json: { phone: "0804415224" } };
  const saved = buildFieldPackPayloadFromAgent(pack(), legacy, { item: eventItem });
  assert.equal(saved.ai_cta_contact_json.phone, "0804415224");
});

test("revision save path updates the repository with the resolved CTA", () => {
  let updateCall = null;
  const existing = { id: 9, ai_cta_contact_json: { website_url: "https://existing.example" } };
  const repo = {
    getItem: () => ({ id: 1 }),
    getCurrentFieldPackByItem: () => existing,
    updateFieldPack: (id, payload) => {
      updateCall = { id, payload };
      return { id, ...payload };
    },
    createFieldPack: () => { throw new Error("expected update path"); },
  };
  saveAgentFieldPack(repo, item(), pack(), "tester@example.com");
  assert.equal(updateCall.id, 9);
  assert.equal(updateCall.payload.ai_cta_contact_json.website_url, "https://ubon.example/contact");
});

function requestedChecksWithPhone(phone) {
  return {
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/ติดต่อ",
        checks: [
          {
            key: "phone",
            requested: true,
            label: "เบอร์โทร",
            instruction: "ขอเบอร์ที่ติดต่อได้จริง",
            answer_type: "phone",
            suggested_value: phone,
            source: { kind: "ai", confidence: "unknown", note: null },
          },
        ],
      },
    ],
  };
}

function saveWithRequestedChecks(repo, itemValue, fieldPack) {
  saveAgentFieldPack(repo, itemValue, fieldPack, "tester@example.com");
}

test("clearing a suggestion also clears it in requested_checks_json, which is what the handoff reads", () => {
  let updateCall = null;
  const existing = {
    id: 9,
    ai_cta_contact_json: { phone: "0804415224" },
    // the stale suggestion already materialized into the structure the handoff snapshot is built from
    requested_checks_json: requestedChecksWithPhone("0804415224"),
  };
  const repo = {
    getItem: () => ({ id: 1 }),
    getCurrentFieldPackByItem: () => existing,
    updateFieldPack: (id, payload) => { updateCall = { id, payload }; return { id, ...payload }; },
    createFieldPack: () => { throw new Error("expected update path"); },
  };
  // AI ran, and the phone is gone from the approved context
  saveWithRequestedChecks(repo, item({ structured_context: { approved_context: [] } }), pack());
  const phoneCheck = updateCall.payload.requested_checks_json.groups[0].checks[0];
  assert.equal(phoneCheck.suggested_value, null);
  assert.equal(phoneCheck.source, null);
  // the curator's own configuration of the row survives
  assert.equal(phoneCheck.requested, true);
  assert.equal(phoneCheck.label, "เบอร์โทร");
  assert.equal(phoneCheck.answer_type, "phone");
});

test("a still-supported suggestion is re-pointed into requested_checks_json", () => {
  let updateCall = null;
  const existing = {
    id: 9,
    ai_cta_contact_json: { phone: "0804415224" },
    requested_checks_json: requestedChecksWithPhone("0804415224"),
  };
  const repo = {
    getItem: () => ({ id: 1 }),
    getCurrentFieldPackByItem: () => existing,
    updateFieldPack: (id, payload) => { updateCall = { id, payload }; return { id, ...payload }; },
    createFieldPack: () => { throw new Error("expected update path"); },
  };
  saveWithRequestedChecks(repo, item(), pack());
  const phoneCheck = updateCall.payload.requested_checks_json.groups[0].checks[0];
  assert.equal(phoneCheck.suggested_value, "0822222222");
  assert.equal(phoneCheck.source.kind, "ai");
});

test("a run with no AI pack leaves requested_checks_json untouched", () => {
  let updateCall = null;
  const existing = {
    id: 9,
    ai_cta_contact_json: { phone: "0804415224" },
    requested_checks_json: requestedChecksWithPhone("0804415224"),
  };
  const repo = {
    getItem: () => ({ id: 1 }),
    getCurrentFieldPackByItem: () => existing,
    updateFieldPack: (id, payload) => { updateCall = { id, payload }; return { id, ...payload }; },
    createFieldPack: () => { throw new Error("expected update path"); },
  };
  saveWithRequestedChecks(repo, item({ structured_context: { approved_context: [] } }), null);
  assert.equal(Object.hasOwn(updateCall.payload, "requested_checks_json"), false);
});

test("external engine initial and revision generation keep deterministic CTA and approved provenance", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    field_pack: pack({
      ai_cta_contact_json: { phone: "0811111111", source: ["https://ai.example/untrusted"] },
    }),
  });
  try {
    const engine = createAgentGenerationEngine({
      enabled: true,
      agentEngine: "external",
      externalAgentUrl: "https://agent.example/run",
      externalAgentToken: "test-token",
    });
    const initial = await engine.generateFieldPack(item());
    const revision = await engine.reviseFieldPack(item(), pack(), "revise");
    assert.deepEqual(initial.ai_cta_contact_json, revision.ai_cta_contact_json);
    assert.equal(initial.ai_cta_contact_json.phone, "0822222222");
    assert.equal(initial.ai_cta_contact_json.facebook_url, "https://facebook.com/uboncity");
    assert.deepEqual(initial.ai_cta_contact_json.source, ["https://official.example/contact"]);
    assert.equal(initial.ai_cta_contact_json.source.includes("https://ai.example/untrusted"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("both prompts carry CTA candidates as unconfirmed suggestions", () => {
  const promptInput = buildPromptInput(item());
  assert.equal(promptInput.cta_contact_candidates.phone, "0822222222");
  const initialPrompt = buildFieldPackPrompt(item());
  const revisionPrompt = buildFieldPackRevisionPrompt(item(), pack(), "revise");
  assert.match(initialPrompt, /ai_cta_contact_json/);
  assert.match(revisionPrompt, /ai_cta_contact_json/);
  assert.match(initialPrompt, /cta_contact_candidates/);
  assert.match(revisionPrompt, /cta_contact_candidates/);
});