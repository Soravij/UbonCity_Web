import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

function createElement(id = "", value = "") {
  return {
    id,
    value,
    innerHTML: "",
    textContent: "",
    className: "",
    style: {},
    dataset: {},
    disabled: false,
    checked: false,
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
  };
}

async function loadCoreModule(missingIds = []) {
  const elements = new Map();
  const missing = new Set(missingIds);
  const getElementById = (id) => {
    if (missing.has(id)) return null;
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };

  global.window = {
    location: { search: "?id=48", origin: "http://127.0.0.1:5062" },
  };
  global.document = {
    getElementById,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: { appendChild() {}, classList: { toggle() {} } },
    addEventListener() {},
    createElement() { return createElement(); },
  };
  global.sessionStorage = { getItem() { return ""; } };
  global.localStorage = { getItem() { return ""; }, setItem() {} };
  global.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({}),
  });
  global.FormData = class FormData {};
  global.DOMParser = class DOMParser {
    parseFromString() {
      return { body: { innerHTML: "", querySelectorAll() { return []; } } };
    }
  };

  const moduleUrl = `${pathToFileURL(path.resolve("D:/UbonCity_Web/collector/server/public/article-workflow-core.js")).href}?t=${Date.now()}`;
  const mod = await import(moduleUrl);
  return { mod, elements };
}

const CONFIRMED_INPUT_IDS = [
  "confirmed-phone",
  "confirmed-line-url",
  "confirmed-facebook-url",
  "confirmed-website-url",
  "confirmed-primary-cta",
  "confirmed-category",
  "confirmed-subtype",
  "confirmed-tags",
  "confirmed-meta-status",
  "confirmed-note",
];

test("collectWorkspacePayload mirrors stored confirmed draft metadata when confirmed inputs are absent", async () => {
  const { mod, elements } = await loadCoreModule(CONFIRMED_INPUT_IDS);
  mod.state.item = {
    id: 48,
    title: "Test place",
    summary: "Summary",
    meta_title: "Meta",
    meta_description: "Meta description",
    description_clean: "Body",
    description_raw: "Body",
    slug: "test-place",
  };
  mod.state.articleProcess = {
    latest_draft: {
      draft_title: "Draft title",
      excerpt: "Draft excerpt",
      body: "Draft body",
      meta_title: "Draft meta",
      meta_description: "Draft meta description",
      confirmed_cta_contact_json: {
        phone: "0812345678",
        line_url: "https://line.me/ti/p/test-line",
        facebook_url: "https://facebook.com/test-place",
        website_url: "https://example.com/test-place",
        primary_cta: "line",
      },
      confirmed_taxonomy_json: {
        category: "attractions",
        subtype: "museum",
        tags: ["family", "art"],
      },
      confirmed_meta_status: "confirmed",
      confirmed_note: "accepted from assignment #7 round 1 submission #9",
    },
  };

  elements.set("article-title", createElement("article-title", "ชื่อบทความ"));
  elements.set("article-excerpt", createElement("article-excerpt", "คำเกริ่น"));
  elements.set("article-slug", createElement("article-slug", "test-place"));
  elements.set("article-meta-title", createElement("article-meta-title", "เมตาไตเติล"));
  elements.set("article-meta-description", createElement("article-meta-description", "เมตาคำอธิบาย"));
  elements.set("article-body", createElement("article-body", "เนื้อหา"));

  const payload = mod.collectWorkspacePayload();

  assert.equal(payload.item.confirmed_cta_contact_json, undefined);
  assert.equal(payload.item.confirmed_taxonomy_json, undefined);
  assert.equal(payload.item.confirmed_meta_status, undefined);
  assert.equal(payload.draft.draft_title, "ชื่อบทความ");
  // no DOM inputs exist anymore — payload must mirror the stored draft values untouched
  assert.deepEqual(payload.draft.confirmed_cta_contact_json, {
    phone: "0812345678",
    line_url: "https://line.me/ti/p/test-line",
    facebook_url: "https://facebook.com/test-place",
    website_url: "https://example.com/test-place",
    primary_cta: "line",
  });
  assert.deepEqual(payload.draft.confirmed_taxonomy_json, {
    category: "attractions",
    subtype: "museum",
    tags: ["family", "art"],
  });
  assert.equal(payload.draft.confirmed_meta_status, "confirmed");
  assert.equal(payload.draft.confirmed_note, "accepted from assignment #7 round 1 submission #9");
});

test("collectWorkspacePayload returns safe confirmed metadata defaults when no confirmed data exists", async () => {
  const { mod, elements } = await loadCoreModule(CONFIRMED_INPUT_IDS);
  mod.state.item = {
    id: 48,
    title: "Test place",
    summary: "",
    meta_title: "",
    meta_description: "",
    description_clean: "",
    description_raw: "",
    slug: "",
  };
  mod.state.articleProcess = {
    latest_draft: {
      confirmed_cta_contact_json: mod.defaultConfirmedCtaContact(),
      confirmed_taxonomy_json: mod.defaultConfirmedTaxonomy(),
      confirmed_meta_status: "not_started",
      confirmed_note: "",
    },
  };

  [
    "article-title",
    "article-excerpt",
    "article-slug",
    "article-meta-title",
    "article-meta-description",
    "article-body",
  ].forEach((id) => elements.set(id, createElement(id, "")));

  const payload = mod.collectWorkspacePayload();
  assert.deepEqual(payload.draft.confirmed_cta_contact_json, {
    phone: "",
    line_url: "",
    facebook_url: "",
    website_url: "",
    primary_cta: "",
  });
  assert.deepEqual(payload.draft.confirmed_taxonomy_json, {
    category: "",
    subtype: "",
    tags: [],
  });
  assert.equal(payload.draft.confirmed_meta_status, "not_started");
  assert.equal(payload.draft.confirmed_note, "");
});

test("normalizeCommaSeparatedTags dedupes and trims tag input", async () => {
  const { mod } = await loadCoreModule();
  assert.deepEqual(
    mod.normalizeCommaSeparatedTags("family, art, Family,  cafe , ,art"),
    ["family", "art", "cafe"]
  );
});

test("article suggestion apply helper only updates title excerpt and body", async () => {
  const { mod } = await loadCoreModule();
  const currentValues = {
    title: "เดิม",
    excerpt: "เก่า",
    body: "ก่อนแก้",
    confirmed_cta_contact_json: {
      phone: "0812345678",
      primary_cta: "phone",
    },
    confirmed_taxonomy_json: {
      category: "attractions",
      subtype: "museum",
      tags: ["family"],
    },
  };

  const nextValues = mod.applyArticleSuggestionFieldValues(currentValues, {
    title: "ชื่อใหม่",
    excerpt: "คำเกริ่นใหม่",
    body: "เนื้อหาใหม่",
  });

  assert.equal(nextValues.title, "ชื่อใหม่");
  assert.equal(nextValues.excerpt, "คำเกริ่นใหม่");
  assert.equal(nextValues.body, "เนื้อหาใหม่");
  assert.deepEqual(nextValues.confirmed_cta_contact_json, currentValues.confirmed_cta_contact_json);
  assert.deepEqual(nextValues.confirmed_taxonomy_json, currentValues.confirmed_taxonomy_json);
});

test("seo suggestion apply helper only updates meta fields", async () => {
  const { mod } = await loadCoreModule();
  const currentValues = {
    meta_title: "เมตาเดิม",
    meta_description: "คำอธิบายเดิม",
    confirmed_cta_contact_json: {
      phone: "0812345678",
      primary_cta: "phone",
    },
    confirmed_taxonomy_json: {
      category: "attractions",
      subtype: "museum",
      tags: ["family"],
    },
  };

  const nextValues = mod.applySeoSuggestionFieldValues(currentValues, {
    meta_title: "เมตาใหม่",
    meta_description: "คำอธิบายใหม่",
  });

  assert.equal(nextValues.meta_title, "เมตาใหม่");
  assert.equal(nextValues.meta_description, "คำอธิบายใหม่");
  assert.deepEqual(nextValues.confirmed_cta_contact_json, currentValues.confirmed_cta_contact_json);
  assert.deepEqual(nextValues.confirmed_taxonomy_json, currentValues.confirmed_taxonomy_json);
});
