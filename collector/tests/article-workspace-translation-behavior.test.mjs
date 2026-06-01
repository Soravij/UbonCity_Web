import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve("D:/UbonCity_Web/collector");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function createElement(id = "") {
  return {
    id,
    disabled: false,
    value: "",
    innerHTML: "",
    textContent: "",
    className: "",
    dataset: {},
    style: {},
    selectionStart: 0,
    selectionEnd: 0,
    focus() {},
    setSelectionRange() {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    removeChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    addEventListener() {},
    classList: {
      add() {},
      remove() {},
      contains() { return false; },
    },
  };
}

function loadHarness() {
  const elements = new Map();
  const source = read("server/public/article-workspace.js").replace(
    /\binit\(\);\s*$/,
    `
globalThis.__articleWorkspaceTestHooks = {
  state,
  mergeTranslationReadinessRows,
  getTranslationGateState,
  openTranslationDetail,
  refreshTranslations,
  renderTranslationSummary,
  renderTranslationReviewSummary,
  applyActionGuards,
};
`,
  );

  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    FormData: class FormData {},
    DOMParser: class DOMParser {},
    window: {
      location: { search: "?id=48", origin: "http://127.0.0.1:5062", href: "" },
      innerWidth: 1400,
      innerHeight: 900,
    },
    document,
    sessionStorage: {
      getItem(key) {
        return key === "collector_token" ? "token" : "";
      },
    },
    fetch: async () => ({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({}),
    }),
  };
  context.globalThis = context;

  vm.runInNewContext(source, context, { filename: "article-workspace.js" });
  return {
    context,
    hooks: context.__articleWorkspaceTestHooks,
    elements,
  };
}

test("refreshTranslations preserves missing translation targets as blockers", async () => {
  const { context, hooks } = loadHarness();
  hooks.state.user = { role: "admin" };
  hooks.state.articleProcess = { status: "ready_for_review" };
  hooks.state.readiness = {
    translations: [
      { lang: "th", status: "passed" },
      { lang: "en", status: "passed" },
      { lang: "zh", status: "not_ready" },
      { lang: "ja", status: "not_ready" },
    ],
  };

  context.loadTranslations = async () => {
    hooks.state.translations = [
      { lang: "th", translation_status: "ready", automatic_check_status: "passed", updated_at: "2026-04-05 14:00:00" },
      { lang: "en", translation_status: "ready", automatic_check_status: "passed", updated_at: "2026-04-05 14:00:00" },
    ];
  };

  await hooks.refreshTranslations();

  assert.deepEqual(
    JSON.parse(JSON.stringify(hooks.state.readiness.translations)),
    [
      { lang: "th", status: "passed" },
      { lang: "en", status: "passed" },
      { lang: "zh", status: "not_ready" },
      { lang: "ja", status: "not_ready" },
    ],
  );
  const gate = hooks.getTranslationGateState();
  assert.equal(gate.allReady, false);
  assert.deepEqual(gate.blockingLangs, ["ZH", "JA"]);
});

test("generate translations action stays available before sync for admins", () => {
  const { hooks, elements } = loadHarness();
  hooks.state.user = { role: "admin" };
  hooks.state.articleProcess = { status: "ready_for_review" };
  hooks.state.readiness = {
    translations: [
      { lang: "th", status: "passed" },
      { lang: "en", status: "not_ready" },
    ],
  };

  hooks.applyActionGuards();

  assert.equal(elements.get("btn-generate-translations").disabled, false);
});

test("translation detail popup exposes automatic check failure reasons", () => {
  const { hooks, elements } = loadHarness();
  hooks.state.user = { role: "admin" };
  hooks.state.articleProcess = { status: "ready_for_review" };
  hooks.state.readiness = {
    translations: [
      { lang: "en", status: "failed" },
    ],
  };
  hooks.state.translations = [
    {
      lang: "en",
      translation_status: "check_failed",
      automatic_check_status: "failed",
      automatic_check_report: {
        issues: ["source language leakage too high", "target language shape mismatch"],
      },
      updated_at: "2026-04-05 14:00:00",
    },
  ];

  hooks.renderTranslationSummary();
  hooks.renderTranslationReviewSummary();
  hooks.openTranslationDetail("en");

  assert.match(elements.get("translation-detail-body").innerHTML, /source language leakage too high/);
  assert.match(elements.get("translation-detail-body").innerHTML, /target language shape mismatch/);
});
