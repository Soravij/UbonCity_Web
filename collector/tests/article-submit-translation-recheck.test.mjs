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

function loadHarness(options = {}) {
  const elements = new Map();
  const source = read("server/public/article-submit-page.js")
    .replace(/^\uFEFF?import[\s\S]+?from "\.\/article-workflow-core\.js";\s*/u, "")
    .replace(
      /\binit\(\);\s*$/u,
      `
globalThis.__articleSubmitTestHooks = {
  state,
  buildTranslationRows,
  refreshTranslations,
  loadCurrentReadiness,
  renderTranslationSummary,
  renderTranslationRecheckPanel,
  renderTranslationReviewSummary,
  getTranslationRecheckGateState,
  init,
  runTranslationRecheck,
  validateRecheckResponseLocale,
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

  const apiImpl = options.api || (async () => ({}));
  const loadTranslationsImpl = options.loadTranslations || (async () => []);
  const loadWorkspaceImpl = options.loadWorkspace || (async () => ({}));
  const inlineStatuses = [];
  const banners = [];

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
    api: apiImpl,
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
    loadTranslations: async (...args) => loadTranslationsImpl(...args),
    loadWorkspace: async (...args) => loadWorkspaceImpl(state, ...args),
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
    setBanner(message, tone) {
      banners.push({ message, tone });
    },
    setInlineStatus(id, message, tone) {
      inlineStatuses.push({ id, message, tone });
    },
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
    inlineStatuses,
    banners,
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
  assert.match(html, /Not checked/);
  assert.match(html, /<strong>Score:<\/strong> -/);
  assert.match(html, /data-translation-recheck-lang="en"/);
  assert.match(html, /<button type="button" class="utility-action" data-translation-recheck-lang="en"[^>]*>Recheck<\/button>/);
  assert.match(html, /Not ready: EN need translation recheck\./);
  assert.doesNotMatch(html, /Translation recheck has not run yet\./);
  assert.doesNotMatch(html, /Required locales/);
  assert.doesNotMatch(html, /Readiness/);
  assert.doesNotMatch(html, /Technical details and future actions/);
});

test("translation recheck panel enables Recheck only for eligible not_checked rows", () => {
  const { hooks, elements } = loadHarness();
  hooks.state.readiness = {
    translations: [
      { lang: "en", status: "passed" },
      { lang: "lo", status: "failed" },
      { lang: "zh", status: "stale" },
      { lang: "ja", status: "not_ready" },
    ],
  };
  hooks.state.translations = [
    { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
    { lang: "lo", translation_status: "ready", automatic_check_status: "failed", stale_flag: 0 },
    { lang: "zh", translation_status: "ready", automatic_check_status: "passed", stale_flag: 1, translation_recheck_status: "stale" },
    { lang: "ja", translation_status: "", automatic_check_status: "", stale_flag: 0 },
  ];

  hooks.renderTranslationRecheckPanel();

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /data-translation-recheck-lang="en"(?![^>]*disabled)/);
  assert.match(html, /<button type="button" class="utility-action" data-translation-recheck-lang="lo" disabled>Recheck<\/button>/);
  assert.match(html, /Technical QA must pass first/);
  assert.match(html, /<button type="button" class="utility-action" data-translation-recheck-lang="ja" disabled>Recheck<\/button>/);
  assert.match(html, /Translation is missing/);
  assert.match(html, /Translation is stale/);
});

test("global busy disables eligible Recheck buttons", () => {
  const { hooks, elements } = loadHarness();
  hooks.state.busy = true;
  hooks.state.readiness = {
    translations: [{ lang: "en", status: "passed" }],
  };
  hooks.state.translations = [
    { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
  ];

  hooks.renderTranslationRecheckPanel();

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /data-translation-recheck-lang="en" disabled>Recheck<\/button>/);
});

test("translation recheck locale cards show status-specific default actions and diagnostics-only details", () => {
  const { hooks, elements } = loadHarness();
  hooks.state.readiness = {
    translations: [
      { lang: "en", status: "passed" },
      { lang: "lo", status: "passed" },
      { lang: "zh", status: "passed" },
      { lang: "th", status: "passed" },
    ],
  };
  hooks.state.translations = [
    { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_score: 8.4 },
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "passed", translation_recheck_score: 8.9 },
    {
      lang: "zh",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "failed",
      back_translation_th: "แปลกลับไทยของ zh",
      recheck_summary_th: "มีความคลาดเคลื่อนของความหมายบางจุด",
      recheck_issues: [{ type: "accuracy", severity: "high", problem_th: "ความหมายเพี้ยน", suggestion_th: "แก้ให้ตรงต้นฉบับ" }],
    },
    { lang: "th", translation_status: "ready", automatic_check_status: "passed", stale_flag: 1, translation_recheck_status: "stale" },
  ];

  hooks.renderTranslationRecheckPanel();

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /View technical details below/);
  assert.match(html, /data-translation-recheck-lang="en"/);
  assert.match(html, /<strong>Score:<\/strong> 8.4\/10/);
  assert.match(html, /<button type="button" class="utility-action" data-translation-recheck-lang="zh"[^>]*>Recheck again<\/button>/);
  assert.match(html, /<button type="button" class="utility-action" disabled>Repair<\/button>/);
  assert.match(html, /<button type="button" class="utility-action" disabled>Regenerate<\/button>/);
  assert.match(html, /Back translation/);
  assert.match(html, /แปลกลับไทยของ zh/);
  assert.match(html, /มีความคลาดเคลื่อนของความหมายบางจุด/);
  assert.match(html, /ความหมายเพี้ยน/);
  assert.doesNotMatch(html, /Technical details and future actions/);
  assert.doesNotMatch(html, /View back translation/);
  assert.doesNotMatch(html, /View issues/);
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

test("translation recheck warning and failed statuses keep final actions blocked", () => {
  for (const recheckStatus of ["warning", "failed"]) {
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
        translation_recheck_status: recheckStatus,
      },
    ];

    hooks.applyActionGuards();

    assert.equal(elements.get("btn-approve-sync").disabled, true);
    assert.equal(elements.get("btn-send-main-site").disabled, true);
  }
});

test("recheck action refreshes translations and renders warning result after completion", async () => {
  const updatedTranslations = [
    {
      lang: "lo",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "warning",
      translation_recheck_score: 10,
      back_translation_th: "back translation lo",
      recheck_summary_th: "summary lo",
      recheck_issues: [{ problem_th: "term mismatch" }],
      rechecked_at: "2026-06-05T06:00:00.000Z",
    },
  ];
  let loadTranslationsCalls = 0;
  const { hooks, elements } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "lo", translation_recheck_status: "warning", translation_recheck_score: 10 }] },
      readiness: {
        translations: [{ lang: "lo", status: "passed" }],
      },
      translations: updatedTranslations,
    }),
    loadTranslations: async () => {
      loadTranslationsCalls += 1;
      hooks.state.translations = updatedTranslations;
      return updatedTranslations;
    },
  });
  hooks.state.readiness = {
    translations: [{ lang: "lo", status: "passed" }],
  };
  hooks.state.translations = [
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
  ];

  await hooks.runTranslationRecheck("lo");

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.equal(loadTranslationsCalls, 1);
  assert.match(html, /Warning/);
  assert.match(html, /<strong>Score:<\/strong> 10\/10/);
  assert.match(html, /back translation lo/);
  assert.match(html, /summary lo/);
  assert.match(html, /term mismatch/);
  assert.doesNotMatch(html, /Not checked/);
});

test("clicking locale-specific recheck uses the exact requested URL", async () => {
  for (const lang of ["en", "zh", "lo"]) {
    const calls = [];
    const { hooks } = loadHarness({
      api: async (url) => {
        calls.push(url);
        return {
          ok: true,
          result: { locales: [{ lang, translation_recheck_status: "passed", translation_recheck_score: 10 }] },
          readiness: { translations: [{ lang, status: "passed" }] },
          translations: [{ lang, translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "passed", translation_recheck_score: 10 }],
        };
      },
      loadTranslations: async () => {
        hooks.state.translations = [{ lang, translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "passed", translation_recheck_score: 10 }];
        return hooks.state.translations;
      },
    });
    hooks.state.readiness = { translations: [{ lang, status: "passed" }] };
    hooks.state.translations = [{ lang, translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 }];

    await hooks.runTranslationRecheck(lang);

    assert.equal(calls[0], `/api/items/48/translations/${lang}/recheck`);
  }
});

test("recheck action renders passed result and updates final send readiness only when all locales passed", async () => {
  const updatedTranslations = [
    {
      lang: "en",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "passed",
      translation_recheck_score: 10,
    },
    {
      lang: "lo",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "passed",
      translation_recheck_score: 9.4,
    },
  ];
  const { hooks, elements } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "en", translation_recheck_status: "passed", translation_recheck_score: 10 }] },
      readiness: {
        translations: [
          { lang: "en", status: "passed" },
          { lang: "lo", status: "passed" },
        ],
      },
      translations: updatedTranslations,
    }),
    loadTranslations: async () => {
      hooks.state.translations = updatedTranslations;
      return updatedTranslations;
    },
  });
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

  await hooks.runTranslationRecheck("en");

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /Ready: all required locales passed translation recheck\./);
  assert.match(html, /View technical details below/);
  assert.match(html, /<strong>Score:<\/strong> 10\/10/);
  assert.equal(hooks.getTranslationRecheckGateState().allReady, true);
  assert.equal(elements.get("btn-approve-sync").disabled, false);
});

test("recheck action immediately renders warning result even if refreshTranslations fails", async () => {
  const immediateTranslations = [
    {
      lang: "lo",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "warning",
      translation_recheck_score: 10,
      back_translation_th: "warning back translation",
      recheck_summary_th: "warning summary",
      recheck_issues: [{ problem_th: "warning issue" }],
    },
  ];
  const { hooks, elements, inlineStatuses } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "lo", translation_recheck_status: "warning", translation_recheck_score: 10 }] },
      readiness: {
        translations: [{ lang: "lo", status: "passed" }],
      },
      translations: immediateTranslations,
    }),
    loadTranslations: async () => {
      throw new Error("network stale");
    },
  });
  hooks.state.readiness = {
    translations: [{ lang: "lo", status: "passed" }],
  };
  hooks.state.translations = [
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
  ];

  await hooks.runTranslationRecheck("lo");

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /Warning/);
  assert.match(html, /warning back translation/);
  assert.match(html, /warning summary/);
  assert.match(html, /warning issue/);
  assert.doesNotMatch(html, /Not checked/);
  assert.match(inlineStatuses.at(-1)?.message || "", /refresh pending/i);
});

test("requested EN but response locales only contains LO is rejected and does not apply", async () => {
  const { hooks, elements, inlineStatuses } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "lo", translation_recheck_status: "warning", translation_recheck_score: 10 }] },
      readiness: { translations: [{ lang: "en", status: "passed" }] },
      translations: [{ lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "warning", translation_recheck_score: 10 }],
    }),
    loadTranslations: async () => {
      throw new Error("should not refresh on mismatch");
    },
  });
  hooks.state.readiness = { translations: [{ lang: "en", status: "passed" }, { lang: "lo", status: "passed" }] };
  hooks.state.translations = [
    { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
  ];

  await hooks.runTranslationRecheck("en");

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(inlineStatuses.at(-1)?.message || "", /different locale than requested/i);
  assert.match(html, /data-translation-recheck-lang="en"/);
  assert.doesNotMatch(html, /<strong>Score:<\/strong> 10\/10/);
  assert.equal(hooks.state.translationRecheckBusyLang || "", "");
});

test("requested EN but result.translation.lang = LO is rejected", async () => {
  const { hooks, inlineStatuses } = loadHarness({
    api: async () => ({
      ok: true,
      translation: { lang: "lo", translation_recheck_status: "warning", translation_recheck_score: 10 },
    }),
  });
  hooks.state.readiness = { translations: [{ lang: "en", status: "passed" }] };
  hooks.state.translations = [{ lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 }];

  await hooks.runTranslationRecheck("en");

  assert.match(inlineStatuses.at(-1)?.message || "", /different locale than requested/i);
  assert.equal(hooks.state.translationRecheckBusyLang || "", "");
});

test("requested EN but readiness-only response is rejected and does not apply readiness", async () => {
  const initialReadiness = { translations: [{ lang: "en", status: "passed" }, { lang: "lo", status: "passed" }] };
  const { hooks, elements, inlineStatuses } = loadHarness({
    api: async () => ({
      ok: true,
      readiness: { translations: [{ lang: "en", status: "passed" }] },
    }),
  });
  hooks.state.readiness = initialReadiness;
  hooks.state.translations = [
    { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
  ];

  await hooks.runTranslationRecheck("en");
  hooks.renderTranslationRecheckPanel();

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(inlineStatuses.at(-1)?.message || "", /(did not include the requested locale|different locale than requested)/i);
  assert.equal(hooks.state.readiness, initialReadiness);
  assert.equal(hooks.state.busy, false);
  assert.equal(hooks.state.translationRecheckBusyLang || "", "");
  assert.doesNotMatch(html, /data-translation-recheck-lang="en" disabled>Recheck<\/button>/);
  assert.doesNotMatch(html, /data-translation-recheck-lang="lo" disabled>Recheck<\/button>/);
});

test("result.translations with mismatched result.locales is rejected", async () => {
  const { hooks, inlineStatuses } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "lo", translation_recheck_status: "warning", translation_recheck_score: 10 }] },
      translations: [
        { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "passed", translation_recheck_score: 10 },
        { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "warning", translation_recheck_score: 10 },
      ],
    }),
  });
  hooks.state.readiness = { translations: [{ lang: "en", status: "passed" }, { lang: "lo", status: "passed" }] };
  hooks.state.translations = [
    { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
  ];

  await hooks.runTranslationRecheck("en");

  assert.match(inlineStatuses.at(-1)?.message || "", /different locale than requested/i);
  assert.equal(hooks.state.translations.find((row) => row.lang === "en")?.translation_recheck_status, undefined);
});

test("recheck action immediately renders passed result even if refreshTranslations fails", async () => {
  const immediateTranslations = [
    {
      lang: "en",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "passed",
      translation_recheck_score: 10,
    },
    {
      lang: "lo",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "passed",
      translation_recheck_score: 9.5,
    },
  ];
  const { hooks, elements } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "en", translation_recheck_status: "passed", translation_recheck_score: 10 }] },
      readiness: {
        translations: [
          { lang: "en", status: "passed" },
          { lang: "lo", status: "passed" },
        ],
      },
      translations: immediateTranslations,
    }),
    loadTranslations: async () => {
      throw new Error("network stale");
    },
  });
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

  await hooks.runTranslationRecheck("en");

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /Ready: all required locales passed translation recheck\./);
  assert.match(html, /<strong>Score:<\/strong> 10\/10/);
  assert.equal(hooks.getTranslationRecheckGateState().allReady, true);
  assert.doesNotMatch(html, /Not checked/);
});

test("warning and failed eligible rows show enabled Recheck again", () => {
  for (const recheckStatus of ["warning", "failed"]) {
    const { hooks, elements } = loadHarness();
    hooks.state.readiness = { translations: [{ lang: "lo", status: "passed" }] };
    hooks.state.translations = [{
      lang: "lo",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: recheckStatus,
    }];

    hooks.renderTranslationRecheckPanel();
    const html = elements.get("translation-recheck-panel").innerHTML;
    assert.match(html, /data-translation-recheck-lang="lo"[^>]*>Recheck again<\/button>/);
    assert.doesNotMatch(html, /data-translation-recheck-lang="lo" disabled>Recheck again<\/button>/);
  }
});

test("global busy disables eligible Recheck again buttons", () => {
  const { hooks, elements } = loadHarness();
  hooks.state.busy = true;
  hooks.state.readiness = { translations: [{ lang: "lo", status: "passed" }] };
  hooks.state.translations = [{
    lang: "lo",
    translation_status: "ready",
    automatic_check_status: "passed",
    stale_flag: 0,
    translation_recheck_status: "warning",
  }];

  hooks.renderTranslationRecheckPanel();

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /data-translation-recheck-lang="lo" disabled>Recheck again<\/button>/);
});

test("warning rows that are not eligible do not show enabled Recheck again and show reason", () => {
  const rows = [
    { lang: "lo", translation_status: "ready", automatic_check_status: "failed", stale_flag: 0, translation_recheck_status: "warning", expected: /Technical QA must pass first/ },
    { lang: "zh", translation_status: "ready", automatic_check_status: "passed", stale_flag: 1, translation_recheck_status: "warning", expected: /Translation is stale/ },
    { lang: "en", translation_status: "", automatic_check_status: "", stale_flag: 0, translation_recheck_status: "warning", expected: /Translation is missing/ },
  ];
  for (const row of rows) {
    const { hooks, elements } = loadHarness();
    hooks.state.readiness = { translations: [{ lang: row.lang, status: "passed" }] };
    hooks.state.translations = [row];
    hooks.renderTranslationRecheckPanel();
    const html = elements.get("translation-recheck-panel").innerHTML;
    assert.match(html, row.expected);
    if (Number(row.stale_flag || 0) === 1) {
      assert.doesNotMatch(html, /Recheck again<\/button>/);
      assert.match(html, /<button type="button" class="utility-action" disabled>Regenerate<\/button>/);
      continue;
    }
    assert.match(html, new RegExp(`data-translation-recheck-lang="${row.lang}" disabled>Recheck again<\\/button>`));
  }
});

test("if only result.locales is returned for requested LO, UI applies status and score only", async () => {
  const { hooks, elements } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "lo", translation_recheck_status: "warning", translation_recheck_score: 10 }] },
    }),
    loadTranslations: async () => {
      throw new Error("network stale");
    },
  });
  hooks.state.readiness = { translations: [{ lang: "lo", status: "passed" }] };
  hooks.state.translations = [{ lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 }];

  await hooks.runTranslationRecheck("lo");

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /Warning/);
  assert.match(html, /<strong>Score:<\/strong> 10\/10/);
  assert.doesNotMatch(html, /Back translation/);
  assert.doesNotMatch(html, /Issue list/);
});

test("buttons do not stay globally disabled after mismatch", async () => {
  const { hooks, elements } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "lo", translation_recheck_status: "warning", translation_recheck_score: 10 }] },
    }),
  });
  hooks.state.readiness = { translations: [{ lang: "en", status: "passed" }, { lang: "zh", status: "passed" }] };
  hooks.state.translations = [
    { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
    { lang: "zh", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
  ];

  await hooks.runTranslationRecheck("en");
  hooks.renderTranslationRecheckPanel();

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /data-translation-recheck-lang="en"/);
  assert.match(html, /data-translation-recheck-lang="zh"/);
  assert.equal(hooks.state.busy, false);
  assert.equal(hooks.state.translationRecheckBusyLang || "", "");
  assert.doesNotMatch(html, /data-translation-recheck-lang="en" disabled>Recheck<\/button>/);
  assert.doesNotMatch(html, /data-translation-recheck-lang="zh" disabled>Recheck<\/button>/);
});

test("canonical refresh data wins when refreshTranslations succeeds after immediate apply", async () => {
  const immediateTranslations = [
    {
      lang: "lo",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "warning",
      translation_recheck_score: 10,
      recheck_summary_th: "immediate summary",
    },
  ];
  const canonicalTranslations = [
    {
      lang: "lo",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "warning",
      translation_recheck_score: 8.5,
      recheck_summary_th: "canonical summary",
    },
  ];
  const { hooks, elements } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "lo", translation_recheck_status: "warning", translation_recheck_score: 10 }] },
      readiness: {
        translations: [{ lang: "lo", status: "passed" }],
      },
      translations: immediateTranslations,
    }),
    loadTranslations: async () => {
      hooks.state.translations = canonicalTranslations;
      return canonicalTranslations;
    },
  });
  hooks.state.readiness = {
    translations: [{ lang: "lo", status: "passed" }],
  };
  hooks.state.translations = [
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
  ];

  await hooks.runTranslationRecheck("lo");

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /canonical summary/);
  assert.doesNotMatch(html, /immediate summary/);
});

test("after success busy resets and other eligible Recheck buttons become clickable again", async () => {
  const updatedTranslations = [
    {
      lang: "en",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "passed",
      translation_recheck_score: 10,
    },
    {
      lang: "lo",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "warning",
      translation_recheck_score: 9,
    },
  ];
  const { hooks, elements } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "en", translation_recheck_status: "passed", translation_recheck_score: 10 }] },
      readiness: { translations: [{ lang: "en", status: "passed" }, { lang: "lo", status: "passed" }] },
      translations: updatedTranslations,
    }),
    loadTranslations: async () => {
      hooks.state.translations = updatedTranslations;
      return updatedTranslations;
    },
  });
  hooks.state.readiness = { translations: [{ lang: "en", status: "passed" }, { lang: "lo", status: "passed" }] };
  hooks.state.translations = [
    { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "warning" },
  ];

  await hooks.runTranslationRecheck("en");

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.equal(hooks.state.busy, false);
  assert.match(html, /data-translation-recheck-lang="lo"[^>]*>Recheck again<\/button>/);
  assert.doesNotMatch(html, /data-translation-recheck-lang="lo" disabled>Recheck again<\/button>/);
});

test("after refresh failure busy resets and eligible Recheck buttons become clickable again", async () => {
  const { hooks, elements } = loadHarness({
    api: async () => ({
      ok: true,
      result: { locales: [{ lang: "en", translation_recheck_status: "warning", translation_recheck_score: 10 }] },
      readiness: { translations: [{ lang: "en", status: "passed" }, { lang: "lo", status: "passed" }] },
      translations: [
        { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "warning", translation_recheck_score: 10 },
        { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
      ],
    }),
    loadTranslations: async () => {
      throw new Error("refresh failed");
    },
  });
  hooks.state.readiness = { translations: [{ lang: "en", status: "passed" }, { lang: "lo", status: "passed" }] };
  hooks.state.translations = [
    { lang: "en", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
    { lang: "lo", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0 },
  ];

  await hooks.runTranslationRecheck("en");

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.equal(hooks.state.busy, false);
  assert.match(html, /data-translation-recheck-lang="lo"[^>]*>Recheck<\/button>/);
  assert.doesNotMatch(html, /data-translation-recheck-lang="lo" disabled>Recheck<\/button>/);
});

test("translation recheck parses API output from either recheck_issues_json or recheck_issues", () => {
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
      translation_recheck_status: "warning",
      recheck_issues_json: JSON.stringify([{ problem_th: "json issue" }]),
    },
    {
      lang: "lo",
      translation_status: "ready",
      automatic_check_status: "passed",
      stale_flag: 0,
      translation_recheck_status: "warning",
      recheck_issues: [{ problem_th: "object issue" }],
    },
  ];

  hooks.renderTranslationRecheckPanel();

  const html = elements.get("translation-recheck-panel").innerHTML;
  assert.match(html, /json issue/);
  assert.match(html, /object issue/);
});

test("translation summary preserves generate button loading state while toggling priority classes", () => {
  const { hooks, elements } = loadHarness();
  elements.set("btn-generate-translations", createElement("btn-generate-translations"));
  elements.set("translation-package-actions", createElement("translation-package-actions"));
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
  const actions = elements.get("translation-package-actions");
  button.classList.add("is-loading");

  hooks.renderTranslationSummary();

  assert.equal(button.classList.contains("is-loading"), true);
  assert.equal(button.classList.contains("utility-action"), true);
  assert.equal(button.classList.contains("ok"), false);
  assert.equal(actions.classList.contains("hidden"), true);
  assert.equal(elements.get("translation-package-hint").textContent, "");
});

test("translation package summary only shows package-oriented fields", () => {
  const { hooks, elements } = loadHarness();
  elements.set("translation-package-actions", createElement("translation-package-actions"));
  elements.set("btn-generate-translations", createElement("btn-generate-translations"));
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
  assert.equal(elements.get("translation-package-actions").classList.contains("hidden"), false);
  assert.equal(elements.get("btn-generate-translations").textContent, "Regenerate translations");
});

test("fingerprint mismatch makes translation package stale and translation recheck not ready", () => {
  const { hooks, elements } = loadHarness();
  elements.set("translation-package-actions", createElement("translation-package-actions"));
  elements.set("btn-generate-translations", createElement("btn-generate-translations"));
  hooks.state.readiness = {
    current_source_fingerprint: "current-fingerprint",
    translations: [
      { lang: "lo", status: "passed" },
      { lang: "zh", status: "passed" },
      { lang: "en", status: "passed" },
    ],
  };
  hooks.state.translations = [
    { lang: "lo", source_fingerprint: "old-fingerprint", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "passed" },
    { lang: "zh", source_fingerprint: "old-fingerprint", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "passed" },
    { lang: "en", source_fingerprint: "old-fingerprint", translation_status: "ready", automatic_check_status: "passed", stale_flag: 0, translation_recheck_status: "passed" },
  ];

  hooks.renderTranslationSummary();
  hooks.renderTranslationRecheckPanel();
  hooks.renderTranslationReviewSummary();
  hooks.applyActionGuards();

  const summaryHtml = elements.get("translation-summary").innerHTML;
  const recheckHtml = elements.get("translation-recheck-panel").innerHTML;
  const finalHtml = elements.get("translation-review-summary").innerHTML;
  assert.match(summaryHtml, /Package status/);
  assert.match(summaryHtml, />stale</);
  assert.match(summaryHtml, /Stale locales/);
  assert.equal(elements.get("btn-generate-translations").textContent, "Regenerate translations");
  assert.equal(elements.get("translation-package-actions").classList.contains("hidden"), false);
  assert.match(recheckHtml, /Not ready:/);
  assert.match(recheckHtml, /Stale/);
  assert.doesNotMatch(recheckHtml, /Ready: all required locales passed translation recheck\./);
  assert.match(finalHtml, /Final send/);
  assert.match(finalHtml, /blocked/);
  assert.equal(elements.get("btn-approve-sync").disabled, true);
  assert.equal(elements.get("btn-send-main-site").disabled, true);
});

test("initial article-submit load fetches live readiness and shows fingerprint mismatch as stale without manual refresh", async () => {
  const apiCalls = [];
  const { hooks, elements } = loadHarness({
    loadWorkspace: async (state) => {
      state.articleProcess = { status: "ready_for_sync" };
      state.translations = [
        {
          lang: "en",
          source_fingerprint: "old-fingerprint",
          translation_status: "ready",
          automatic_check_status: "passed",
          stale_flag: 0,
          translation_recheck_status: "passed",
        },
      ];
    },
    api: async (url) => {
      apiCalls.push(url);
      if (url === "/api/items/48/export-readiness") {
        return {
          current_source_fingerprint: "current-fingerprint",
          translations: [{ lang: "en", status: "passed" }],
        };
      }
      return {};
    },
  });
  elements.set("translation-package-actions", createElement("translation-package-actions"));
  elements.set("btn-generate-translations", createElement("btn-generate-translations"));

  await hooks.init();

  const summaryHtml = elements.get("translation-summary").innerHTML;
  const recheckHtml = elements.get("translation-recheck-panel").innerHTML;
  const finalHtml = elements.get("translation-review-summary").innerHTML;
  assert.deepEqual(apiCalls, ["/api/items/48/export-readiness"]);
  assert.equal(hooks.state.readiness?.current_source_fingerprint, "current-fingerprint");
  assert.match(summaryHtml, />stale</);
  assert.match(summaryHtml, /Stale locales/);
  assert.match(recheckHtml, /Not ready: EN need translation recheck\./);
  assert.match(finalHtml, /Final send/);
  assert.match(finalHtml, /blocked/);
  assert.equal(elements.get("btn-send-main-site").disabled, true);
});

test("initial article-submit load still renders when export readiness fetch fails", async () => {
  const apiCalls = [];
  const { hooks, elements, banners } = loadHarness({
    loadWorkspace: async (state) => {
      state.articleProcess = { status: "ready_for_sync" };
      state.translations = [
        {
          lang: "en",
          source_fingerprint: "old-fingerprint",
          translation_status: "ready",
          automatic_check_status: "passed",
          stale_flag: 0,
          translation_recheck_status: "passed",
        },
      ];
    },
    api: async (url) => {
      apiCalls.push(url);
      if (url === "/api/items/48/export-readiness") {
        throw new Error("temporary readiness failure");
      }
      return {};
    },
  });
  elements.set("translation-package-actions", createElement("translation-package-actions"));
  elements.set("btn-generate-translations", createElement("btn-generate-translations"));

  await hooks.init();

  const summaryHtml = elements.get("translation-summary").innerHTML;
  const recheckHtml = elements.get("translation-recheck-panel").innerHTML;
  const finalHtml = elements.get("translation-review-summary").innerHTML;
  assert.deepEqual(apiCalls, ["/api/items/48/export-readiness"]);
  assert.equal(hooks.state.readiness, null);
  assert.match(summaryHtml, /Package status/);
  assert.match(summaryHtml, /missing/);
  assert.match(recheckHtml, /Not ready: EN need translation recheck\./);
  assert.match(finalHtml, /blocked/);
  assert.equal(elements.get("btn-send-main-site").disabled, true);
  assert.equal(elements.get("btn-refresh-readiness").disabled, false);
  assert.match(String(banners[0]?.message || ""), /โหลดสถานะความพร้อมไม่สำเร็จ/);
});

test("translation package button label resets from stale to missing state", () => {
  const { hooks, elements } = loadHarness();
  elements.set("translation-package-actions", createElement("translation-package-actions"));
  elements.set("btn-generate-translations", createElement("btn-generate-translations"));

  hooks.state.readiness = {
    translations: [{ lang: "zh", status: "stale" }],
  };
  hooks.state.translations = [
    { lang: "zh", translation_status: "ready", automatic_check_status: "passed", stale_flag: 1 },
  ];

  hooks.renderTranslationSummary();

  assert.equal(elements.get("btn-generate-translations").textContent, "Regenerate translations");

  hooks.state.readiness = { translations: [] };
  hooks.state.translations = [];

  hooks.renderTranslationSummary();

  assert.equal(elements.get("btn-generate-translations").textContent, "Generate translations");
  assert.equal(elements.get("translation-package-actions").classList.contains("hidden"), false);
});
