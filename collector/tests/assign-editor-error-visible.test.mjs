import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const SOURCE_PATH = path.join(root, "server", "public", "article-intake.js");

function readSource() {
  return fs.readFileSync(SOURCE_PATH, "utf8");
}

function extractFunctionBlock(source, name) {
  const signatures = [`async function ${name}`, `function ${name}`];
  const start = signatures
    .map((s) => source.indexOf(s))
    .find((i) => i >= 0) ?? -1;
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = paramsStart; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) { bodyStart = source.indexOf("{", i); break; }
    }
  }
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function block: ${name}`);
}

function createElement(id = "") {
  const classes = new Set();
  const listeners = {};
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
    addEventListener(name, handler) { listeners[name] = handler; },
    listeners,
    classList: {
      add(...tokens) {
        for (const t of tokens) { if (t) classes.add(t); }
        syncClassName(node);
      },
      remove(...tokens) {
        for (const t of tokens) classes.delete(t);
        syncClassName(node);
      },
      contains(token) { return classes.has(token); },
    },
  };
  return node;
}

function loadHarness(options = {}) {
  const elements = new Map();
  const source = readSource();

  const setBannerSrc = extractFunctionBlock(source, "setBanner");
  const assignEditorSrc = extractFunctionBlock(source, "assignEditor");
  const wireSrc = extractFunctionBlock(source, "wire");

  const selectEl = createElement("editor-assignee-select");
  selectEl.value = "5";
  elements.set("editor-assignee-select", selectEl);

  elements.set("btn-assign-editor", createElement("btn-assign-editor"));
  elements.set("btn-back-home", createElement("btn-back-home"));
  elements.set("btn-open-selected-workspace", createElement("btn-open-selected-workspace"));
  elements.set("workspace-status", createElement("workspace-status"));

  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };

  const state = {
    itemId: 1,
    item: null,
    articleProcess: {},
    processByItemId: {},
    items: [],
    busy: false,
  };

  const apiImpl = options.api || (async () => ({}));
  const inlineStatusCalls = [];

  const context = {
    console,
    document,
    window: {
      location: { search: "?id=1", origin: "http://127.0.0.1:5062", href: "" },
    },
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    state,
    api: apiImpl,
    renderAll() {},
    applyActionGuards() {},
    async prefetchProcessSummaries() {},
    queueRows() { return []; },
    primaryEntryUrl() { return "/"; },
    workspaceUrl() { return "/"; },
    async loadIntake() {},
    setInlineStatus(id, message, kind) {
      inlineStatusCalls.push({ id, message, kind });
    },
    qs(id) { return document.getElementById(id); },
    globalThis: null,
  };
  context.globalThis = context;

  const code = `
${setBannerSrc}
${assignEditorSrc}
${wireSrc}
globalThis.__testHooks = { setBanner, assignEditor, wire };
`;

  vm.runInNewContext(code, context, { filename: "article-intake-test.js" });
  return { hooks: context.__testHooks, elements, state, inlineStatusCalls };
}

test("assignEditor error path: wire click handler calls setBanner with error", async () => {
  const apiError = new Error("ไม่พบผู้รับผิดชอบ");
  const apiImpl = async () => { throw apiError; };
  const { hooks, elements } = loadHarness({ api: apiImpl });

  hooks.wire();
  const btn = elements.get("btn-assign-editor");
  await btn.listeners["click"]();

  const banner = elements.get("workspace-status");
  assert.ok(banner, "workspace-status element should exist");
  assert.equal(banner.textContent, "ไม่พบผู้รับผิดชอบ");
  assert.ok(banner.classList.contains("is-error"), "should have is-error class");
  assert.ok(!banner.classList.contains("hidden"), "should not be hidden");
});

test("assignEditor success path: wire click handler shows success banner", async () => {
  const { hooks, elements } = loadHarness({ api: async () => ({}) });

  hooks.wire();
  const btn = elements.get("btn-assign-editor");
  await btn.listeners["click"]();

  const banner = elements.get("workspace-status");
  assert.ok(banner, "workspace-status element should exist");
  assert.equal(banner.textContent, "มอบหมายงานเขียนแล้ว");
  assert.ok(banner.classList.contains("is-success"), "should have is-success class");
  assert.ok(!banner.classList.contains("hidden"), "should not be hidden");
  assert.ok(!banner.classList.contains("is-error"), "should not have is-error");
});

test("setBanner('') clears text and adds hidden class", () => {
  const { hooks, elements } = loadHarness();

  elements.get("workspace-status").textContent = "old message";
  elements.get("workspace-status").classList.add("is-error");

  hooks.setBanner("");

  const banner = elements.get("workspace-status");
  assert.equal(banner.textContent, "");
  assert.ok(banner.classList.contains("hidden"), "should have hidden class");
  assert.ok(!banner.classList.contains("is-error"), "should not have is-error");
  assert.ok(!banner.classList.contains("is-loading"), "should not have is-loading");
  assert.ok(!banner.classList.contains("is-success"), "should not have is-success");
});
