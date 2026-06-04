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
  const classes = new Set();
  const syncClassName = (node) => {
    node.className = Array.from(classes).join(" ");
  };
  const node = {
    id,
    disabled: false,
    value: "",
    innerHTML: "",
    textContent: "",
    className: "",
    dataset: {},
    style: {},
    focus() {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    removeChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    addEventListener() {},
    classList: {
      add(...tokens) {
        for (const token of tokens) {
          if (token) classes.add(token);
        }
        syncClassName(node);
      },
      remove(...tokens) {
        for (const token of tokens) classes.delete(token);
        syncClassName(node);
      },
      toggle(token, force) {
        if (!token) return false;
        if (force === true) {
          classes.add(token);
          syncClassName(node);
          return true;
        }
        if (force === false) {
          classes.delete(token);
          syncClassName(node);
          return false;
        }
        if (classes.has(token)) {
          classes.delete(token);
          syncClassName(node);
          return false;
        }
        classes.add(token);
        syncClassName(node);
        return true;
      },
      contains(token) { return classes.has(token); },
    },
  };
  return node;
}

function loadHarness() {
  const elements = new Map();
  const source = read("server/public/article-submit-page.js")
    .replace(/^\uFEFF?import[\s\S]+?from "\.\/article-workflow-core\.js";\s*/u, "")
    .replace(
      /\binit\(\);\s*$/u,
      `
globalThis.__articleSubmitTestHooks = {
  state,
  buildTranslationRows,
  renderTranslationSummary,
  renderTranslationRecheckPanel,
  getTranslationRecheckGateState,
  translationRecheckStatusFromRow,
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

  const state = {
    itemId: 48,
    item: null,
    user: { role: "admin" },
    articleProcess: { status: "ready_for_review" },
    assets: [],
    translations: [],
    readiness: null,
    busy: false,
  };

  const context = {
    console,
    document,
    window: {
      location: { search: "?id=48", origin: "http://127.0.0.1:5062", href: "" },
      open() {},
    },
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    state,
    api: async () => ({}),
    canApproveArticle: () => true,
    canManageTranslations: () => true,
    canSyncArticle: () => true,
    collectWorkspacePayload: () => ({ item: {} }),
    currentOtherTransportMeta: () => ({}),
    currentReviewNote: () => "",
    currentRole: () => "admin",
    escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
    formatDateTime(value) {
      return value ? String(value) : "-";
    },
    getArticleStatus: () => "ready_for_review",
    articleStatusLabel: () => "ready_for_review",
    latestDraft: () => null,
    loadTranslations: async () => [],
    loadWorkspace: async () => ({}),
    otherTransportSubtypeLabel: () => "-",
    primaryAssignment: () => null,
    qs(id) {
      return document.getElementById(id);
    },
    reviewPreviewUrl: () => "/article-preview.html?id=48",
    renderActivityLog() {},
    renderAuthStatus() {},
    renderProcessBar() {},
    reviewUrl: () => "/article-submit.html?id=48",
    roleArticleFallbackUrl: () => "/",
    sanitizeUrl: (value) => String(value || ""),
    setBanner() {},
    setInlineStatus() {},
    isOtherTransportItem: () => false,
    validateWorkspace: () => ({ ok: true, missing: [] }),
    workspaceUrl: () => "/article-workspace.html?id=48",
    globalThis: null,
  };
  context.globalThis = context;

  vm.runInNewContext(source, context, { filename: "article-submit-page.js" });
  return {
    hooks: context.__articleSubmitTestHooks,
    elements,
  };
}

test("translation recheck treats missing status as not_checked and not ready", () => {
  const { hooks } = loadHarness();
  hooks.state.readiness = {
    translations: [
      { lang: "en", status: "passed" },
      { lang: "lo", status: "passed" },
    ],
  };
  hooks.state.translations = [
    { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "passed" },
  ];

  const gate = hooks.getTranslationRecheckGateState();

  assert.equal(gate.allReady, false);
  assert.equal(gate.counts.not_checked, 1);
  assert.deepEqual(gate.blockingLangs, ["EN"]);
});

test("translation recheck panel renders placeholder state and tolerates malformed issues json", () => {
  const { hooks, elements } = loadHarness();
  hooks.state.readiness = {
    translations: [{ lang: "en", status: "passed" }],
  };
  hooks.state.translations = [
    {
      lang: "en",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      recheck_issues_json: "{bad json",
    },
  ];

  hooks.renderTranslationRecheckPanel();

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /Translation recheck has not run yet\./);
  assert.match(html, /not_checked/i);
});

test("translation recheck blocks approve and sync actions until all required locales pass", () => {
  const { hooks, elements } = loadHarness();
  hooks.state.readiness = {
    translations: [
      { lang: "en", status: "passed" },
      { lang: "lo", status: "passed" },
    ],
  };
  hooks.state.translations = [
    {
      lang: "en",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "passed",
    },
    {
      lang: "lo",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
    },
  ];

  hooks.applyActionGuards();

  assert.equal(elements.get("btn-approve-sync").disabled, true);
  assert.equal(elements.get("btn-send-main-site").disabled, true);
});

test("translation summary preserves generate button loading state while toggling priority classes", () => {
  const { hooks, elements } = loadHarness();
  elements.set("btn-generate-translations", createElement("btn-generate-translations"));
  hooks.state.readiness = {
    translations: [{ lang: "en", status: "passed" }],
  };
  hooks.state.translations = [
    {
      lang: "en",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
    },
  ];

  const button = elements.get("btn-generate-translations");
  button.classList.add("is-loading");

  hooks.renderTranslationSummary();

  assert.equal(button.classList.contains("is-loading"), true);
  assert.equal(button.classList.contains("utility-action"), true);
  assert.equal(button.classList.contains("ok"), false);
});

test("translation package summary only shows package-oriented fields", () => {
  const { hooks, elements } = loadHarness();
  hooks.state.readiness = {
    translations: [
      { lang: "lo", status: "passed" },
      { lang: "zh", status: "stale" },
      { lang: "en", status: "not_ready" },
    ],
  };
  hooks.state.translations = [
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
    { lang: "zh", translation_status: "ready", automatic_check_status: "passed", stale_flag: 1 },
    { lang: "en", translation_status: "", automatic_check_status: "", stale_flag: 0 },
  ];

  hooks.renderTranslationSummary();

  const html = elements.get("translation-summary").innerHTML;
  const hint = elements.get("translation-package-hint").textContent;
  assert.match(html, /Package status/);
  assert.match(html, /Required locales/);
  assert.match(html, /Missing locales/);
  assert.match(html, /Stale locales/);
  assert.match(html, /LO \/ Lao/);
  assert.match(html, /ZH \/ Chinese/);
  assert.match(html, /EN \/ English/);
  assert.match(html, /translated/);
  assert.match(html, /stale/);
  assert.match(html, /missing/);
  assert.doesNotMatch(html, /Ready now/);
  assert.doesNotMatch(html, /not_checked/i);
  assert.equal(hint, "Source changed after translation. Regenerate stale translations.");
});
