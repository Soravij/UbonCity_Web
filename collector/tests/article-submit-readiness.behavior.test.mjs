import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const coreModulePath = path.resolve("D:/UbonCity_Web/collector/server/public/article-workflow-core.js");
const pageSource = fs.readFileSync(path.resolve("D:/UbonCity_Web/collector/server/public/article-workspace-page.js"), "utf8");

function createElement(id = "", value = "") {
  return {
    id,
    value,
    innerHTML: "",
    textContent: "",
    className: "",
    dataset: {},
    disabled: false,
    checked: false,
    style: {},
    listeners: {},
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
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

function extractFunctionBlock(source, name) {
  const signatures = [`async function ${name}`, `function ${name}`];
  const start = signatures
    .map((signature) => source.indexOf(signature))
    .find((index) => index >= 0) ?? -1;
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function block: ${name}`);
}

async function loadCoreModule() {
  const elements = new Map();
  const getElementById = (id) => {
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

  const moduleUrl = `${pathToFileURL(coreModulePath).href}?t=${Date.now()}`;
  const mod = await import(moduleUrl);
  return { mod, elements };
}

function itemByType(type) {
  return {
    id: 48,
    type,
    title: "Item title",
    summary: "Item summary",
    slug: "item-title",
    meta_title: "Meta title",
    meta_description: "Meta description",
    description_clean: "Body",
    description_raw: "Body",
  };
}

function payloadWithConfirmedMeta(overrides = {}) {
  return {
    item: {
      title: "Title",
      summary: "Summary",
      slug: "title",
      meta_title: "Meta title",
      meta_description: "Meta description",
      description_clean: "Body",
      description_raw: "Body",
      ...(overrides.item || {}),
    },
    draft: {
      draft_title: "Title",
      excerpt: "Summary",
      body: "Body",
      meta_title: "Meta title",
      meta_description: "Meta description",
      confirmed_cta_contact_json: {
        phone: "",
        line_url: "",
        facebook_url: "",
        website_url: "",
        primary_cta: "",
        ...(overrides.confirmed_cta_contact_json || {}),
      },
      confirmed_taxonomy_json: {
        category: "",
        subtype: "",
        tags: [],
        ...(overrides.confirmed_taxonomy_json || {}),
      },
      confirmed_meta_status: overrides.confirmed_meta_status ?? "not_started",
      confirmed_note: overrides.confirmed_note ?? "",
      status: "generated",
    },
  };
}

function findEntry(entries, key) {
  return entries.find((entry) => entry.key === key) || null;
}

async function createSubmitHarness({
  validation = { ok: true, missing: [] },
  readiness = { blockers: [], warnings: [], info: [] },
  confirmResult = true,
} = {}) {
  const statusCalls = [];
  const actionCalls = [];
  let confirmCalls = 0;
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };
  getElement("btn-submit-review");
  getElement("review-status");

  const context = {
    window: {
      location: { href: "" },
      confirm(message) {
        confirmCalls += 1;
        context.confirmMessages.push(String(message || ""));
        return confirmResult;
      },
    },
    confirmMessages: [],
    qs(id) {
      return getElement(id);
    },
    validateWorkspace() {
      return validation;
    },
    computeSubmitReadiness() {
      return readiness;
    },
    currentReviewNote() {
      return "";
    },
    async saveWorkspace() {
      actionCalls.push("save");
    },
    async submitWorkspaceForReview() {
      actionCalls.push("submit");
    },
    reviewUrl() {
      return "/article-submit.html?id=48";
    },
    setInlineStatus(id, message, kind = "success") {
      statusCalls.push({ id, message: String(message || ""), kind });
      const node = getElement(id);
      node.textContent = String(message || "");
      node.className = kind;
    },
    state: {},
    workspaceState: { dirty: false },
    event: null,
  };
  context.globalThis = context;

  vm.runInNewContext(`
${extractFunctionBlock(pageSource, "handleSubmitReviewClick")}
globalThis.__pageHooks = { handleSubmitReviewClick };
`, context, { filename: "article-submit-readiness-page.js" });

  return {
    hooks: context.__pageHooks,
    actionCalls,
    statusCalls,
    confirmMessages: context.confirmMessages,
    getConfirmCalls: () => confirmCalls,
    getLocationHref: () => context.window.location.href,
  };
}

async function createReadinessDelegationHarness({ focusResult = true } = {}) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };
  let focusedTarget = null;

  const context = {
    qs(id) {
      return getElement(id);
    },
    focusReadinessTarget(target) {
      focusedTarget = String(target || "");
      return focusResult;
    },
  };
  context.globalThis = context;

  vm.runInNewContext(`
${extractFunctionBlock(pageSource, "handleSubmitReadinessTargetClick")}
${extractFunctionBlock(pageSource, "registerSubmitReadinessTargetDelegation")}
globalThis.__pageHooks = { registerSubmitReadinessTargetDelegation };
`, context, { filename: "article-submit-readiness-delegation.js" });

  return {
    hooks: context.__pageHooks,
    getElement,
    getFocusedTarget: () => focusedTarget,
  };
}

async function createReadinessRenderHarness({ readiness } = {}) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };

  const submitPanel = getElement("submit-readiness-panel");
  const submitStatus = getElement("submit-readiness-status");
  const toggleButton = getElement("btn-toggle-confirmed-meta");
  const confirmedSection = getElement("confirmed-meta-section");
  const phoneField = getElement("confirmed-phone");
  const statusField = getElement("confirmed-meta-status");
  const taxonomyField = getElement("confirmed-category");
  let focusedId = null;
  let scrolledId = null;

  phoneField.focus = () => { focusedId = "confirmed-phone"; };
  statusField.focus = () => { focusedId = "confirmed-meta-status"; };
  taxonomyField.focus = () => { focusedId = "confirmed-category"; };
  confirmedSection.scrollIntoView = () => { scrolledId = "confirmed-meta-section"; };
  phoneField.scrollIntoView = () => { scrolledId = "confirmed-phone"; };
  statusField.scrollIntoView = () => { scrolledId = "confirmed-meta-status"; };
  taxonomyField.scrollIntoView = () => { scrolledId = "confirmed-category"; };

  const actionNodes = [];
  submitPanel.querySelectorAll = (selector) => {
    if (selector !== "[data-readiness-target]") return [];
    return actionNodes;
  };
  submitPanel.querySelector = (selector) => {
    if (selector !== "[data-readiness-target]") return null;
    return actionNodes[0] || null;
  };
  submitPanel.closest = (selector) => selector === ".article-preview-review-card" ? { id: "submit-card" } : null;
  toggleButton.setAttribute = (name, value) => {
    toggleButton[name] = value;
  };

  const context = {
    window: {},
    document: {
      activeElement: null,
    },
    qs(id) {
      return getElement(id);
    },
    computeSubmitReadiness() {
      return readiness;
    },
    escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
    state: {},
    workspaceState: {
      confirmedMetaCollapsed: true,
    },
    renderConfirmedMetaVisibility() {
      confirmedSection.className = context.workspaceState.confirmedMetaCollapsed ? "hidden" : "";
      toggleButton["aria-expanded"] = context.workspaceState.confirmedMetaCollapsed ? "false" : "true";
    },
  };
  context.globalThis = context;

  vm.runInNewContext(`
${extractFunctionBlock(pageSource, "focusReadinessTarget")}
${extractFunctionBlock(pageSource, "handleSubmitReadinessTargetClick")}
${extractFunctionBlock(pageSource, "renderSubmitReadiness")}
globalThis.__pageHooks = {
  focusReadinessTarget,
  handleSubmitReadinessTargetClick,
  renderSubmitReadiness,
};
`, context, { filename: "article-submit-readiness-render.js" });

  const captureActionNodes = () => {
    const matches = [...String(submitPanel.innerHTML || "").matchAll(/data-readiness-target="([^"]+)"[^>]*>([^<]+)</g)];
    actionNodes.length = 0;
    for (const match of matches) {
      actionNodes.push({
        dataset: { readinessTarget: match[1] },
        focus() {},
      });
    }
  };

  return {
    hooks: context.__pageHooks,
    getElement,
    captureActionNodes,
    getActionNodes: () => actionNodes,
    getFocusedId: () => focusedId,
    getScrolledId: () => scrolledId,
    getToggleExpanded: () => toggleButton["aria-expanded"],
    getConfirmedSectionHidden: () => confirmedSection.className.includes("hidden"),
  };
}

test("computeSubmitReadiness mirrors current hard blockers and keeps CTA/taxonomy as non-blocking", async () => {
  const { mod } = await loadCoreModule();
  const readiness = mod.computeSubmitReadiness({
    item: itemByType("place"),
    payload: payloadWithConfirmedMeta({
      item: {
        title: "",
        summary: "",
        slug: "",
        meta_title: "",
        meta_description: "",
        description_clean: "",
        description_raw: "",
      },
    }),
    evidence: {
      version: 1,
      items: [
        { key: "cta_contact.phone", group_key: "cta_contact", found: true, checked: true, value: "0812345678" },
        { key: "taxonomy.category", group_key: "taxonomy", found: true, checked: true, value: "attractions" },
      ],
    },
    hasCover: false,
  });

  assert.deepEqual(
    readiness.blockers.map((entry) => entry.key),
    ["title", "summary", "slug", "meta_title", "meta_description", "body", "cover_image"]
  );
  assert.equal(findEntry(readiness.warnings, "cta_contact.phone")?.severity, "warning");
  assert.equal(findEntry(readiness.warnings, "taxonomy.category")?.severity, "warning");
  assert.equal(findEntry(readiness.warnings, "confirmed_meta_status")?.severity, "warning");
  assert.equal(findEntry(readiness.blockers, "cta_contact.phone"), null);
  assert.equal(findEntry(readiness.blockers, "taxonomy.category"), null);
});

test("computeSubmitReadiness uses Thai SEO labels in readiness blockers", async () => {
  const { mod } = await loadCoreModule();
  const readiness = mod.computeSubmitReadiness({
    item: itemByType("place"),
    payload: payloadWithConfirmedMeta({
      item: {
        meta_title: "",
        meta_description: "",
      },
    }),
    evidence: { version: 1, items: [] },
    hasCover: true,
  });

  assert.equal(findEntry(readiness.blockers, "meta_title")?.label, "ชื่อ SEO");
  assert.equal(findEntry(readiness.blockers, "meta_description")?.label, "คำอธิบาย SEO");
});

test("computeSubmitReadiness warns for place CTA evidence mismatch and preserves confirmed values as info", async () => {
  const { mod } = await loadCoreModule();
  const readiness = mod.computeSubmitReadiness({
    item: itemByType("place"),
    payload: payloadWithConfirmedMeta({
      confirmed_cta_contact_json: {
        phone: "0899999999",
        line_url: "https://line.me/ti/p/existing",
        primary_cta: "phone",
      },
      confirmed_taxonomy_json: {
        category: "attractions",
        subtype: "museum",
        tags: ["family"],
      },
      confirmed_meta_status: "confirmed",
      confirmed_note: "พร้อมส่ง",
    }),
    evidence: {
      version: 1,
      items: [
        { key: "cta_contact.phone", group_key: "cta_contact", found: true, checked: true, value: "0812345678" },
        { key: "cta_contact.line_url", group_key: "cta_contact", found: true, checked: true, value: "https://line.me/ti/p/existing" },
        { key: "taxonomy.category", group_key: "taxonomy", found: true, checked: true, value: "attractions" },
      ],
    },
    hasCover: true,
  });

  assert.equal(findEntry(readiness.warnings, "cta_contact.phone")?.severity, "warning");
  assert.match(findEntry(readiness.warnings, "cta_contact.phone")?.message || "", /ยืนยัน/i);
  assert.equal(findEntry(readiness.info, "confirmed_cta_contact")?.severity, "info");
  assert.equal(findEntry(readiness.info, "confirmed_taxonomy")?.severity, "info");
  assert.equal(findEntry(readiness.info, "confirmed_note")?.severity, "info");
  assert.equal(findEntry(readiness.info, "taxonomy.category")?.severity, "info");
});

test("computeSubmitReadiness excludes place-only CTA warnings for non-place items", async () => {
  const { mod } = await loadCoreModule();
  const readiness = mod.computeSubmitReadiness({
    item: itemByType("event"),
    payload: payloadWithConfirmedMeta({
      confirmed_taxonomy_json: { category: "", subtype: "", tags: [] },
    }),
    evidence: {
      version: 1,
      items: [
        { key: "cta_contact.phone", group_key: "cta_contact", found: true, checked: true, value: "0812345678" },
        { key: "taxonomy.category", group_key: "taxonomy", found: true, checked: true, value: "festival" },
      ],
    },
    hasCover: true,
  });

  assert.equal(findEntry(readiness.warnings, "cta_contact.phone"), null);
  assert.equal(findEntry(readiness.info, "cta_contact_na")?.severity, "info");
  assert.equal(findEntry(readiness.warnings, "taxonomy.category")?.severity, "warning");
});

test("submit handler asks for confirmation when warnings exist and keeps save-before-submit order", async () => {
  const harness = await createSubmitHarness({
    readiness: {
      blockers: [],
      warnings: [{ key: "confirmed_meta_status", severity: "warning", message: "ยังไม่ได้ยืนยัน" }],
      info: [],
    },
    confirmResult: true,
  });

  await harness.hooks.handleSubmitReviewClick();

  assert.deepEqual(harness.actionCalls, ["save", "submit"]);
  assert.equal(harness.getConfirmCalls(), 1);
  assert.match(harness.confirmMessages[0] || "", /ควรตรวจอีกครั้ง/);
  assert.equal(harness.getLocationHref(), "/article-submit.html?id=48");
  assert.equal(harness.statusCalls.at(-1)?.message, "ส่งเข้าตรวจแล้ว");
});

test("submit handler stops on warning confirmation cancel and still blocks true validation errors", async () => {
  const warningHarness = await createSubmitHarness({
    readiness: {
      blockers: [],
      warnings: [{ key: "taxonomy.category", severity: "warning", message: "ยังไม่ยืนยันหมวด" }],
      info: [],
    },
    confirmResult: false,
  });

  await warningHarness.hooks.handleSubmitReviewClick();
  assert.deepEqual(warningHarness.actionCalls, []);
  assert.equal(warningHarness.getConfirmCalls(), 1);

  const blockerHarness = await createSubmitHarness({
    validation: { ok: false, missing: ["title", "body"] },
    readiness: {
      blockers: [{ key: "title", severity: "blocker", message: "ยังไม่มีชื่อเรื่อง" }],
      warnings: [{ key: "confirmed_meta_status", severity: "warning", message: "ยังไม่ได้ยืนยัน" }],
      info: [],
    },
  });

  await blockerHarness.hooks.handleSubmitReviewClick();
  assert.deepEqual(blockerHarness.actionCalls, []);
  assert.equal(blockerHarness.getConfirmCalls(), 0);
  assert.match(blockerHarness.statusCalls.at(-1)?.message || "", /Missing: title, body/);
});

test("renderSubmitReadiness places blocker warning and info text into the submit card container", async () => {
  const harness = await createReadinessRenderHarness({
    readiness: {
      blockers: [{ key: "title", label: "ชื่อบทความ", message: "ยังไม่มีชื่อบทความ", target: "article-title" }],
      warnings: [{ key: "confirmed_meta_status", label: "สถานะการยืนยัน", message: "ยังไม่ได้ยืนยัน", target: "confirmed-meta-status" }],
      info: [{ key: "confirmed_note", label: "บันทึกประกอบ", message: "พร้อมส่ง", target: "confirmed-note" }],
    },
  });

  harness.hooks.renderSubmitReadiness();

  const panelHtml = harness.getElement("submit-readiness-panel").innerHTML;
  assert.match(panelHtml, /ต้องแก้ก่อนส่ง/);
  assert.match(panelHtml, /ควรตรวจอีกครั้ง/);
  assert.match(panelHtml, /พร้อมแล้ว \/ ข้อมูลที่ยืนยันแล้ว/);
  assert.match(panelHtml, /ยังไม่มีชื่อบทความ/);
  assert.match(panelHtml, /ยังไม่ได้ยืนยัน/);
  assert.match(panelHtml, /พร้อมส่ง/);
  assert.equal(harness.getElement("submit-readiness-panel").closest(".article-preview-review-card")?.id, "submit-card");
});

test("renderSubmitReadiness renders target actions and target click opens confirmed meta section then focuses mapped field", async () => {
  const harness = await createReadinessRenderHarness({
    readiness: {
      blockers: [],
      warnings: [
        { key: "cta_contact.phone", label: "เบอร์โทร", message: "ยังไม่ยืนยัน", target: "confirmed-phone" },
        { key: "confirmed_meta_status", label: "สถานะการยืนยัน", message: "ยังไม่ได้ยืนยัน", target: "confirmed-meta-status" },
        { key: "taxonomy.category", label: "หมวดหลัก", message: "ยังไม่ยืนยันหมวด", target: "confirmed-category" },
      ],
      info: [],
    },
  });

  harness.hooks.renderSubmitReadiness();
  harness.captureActionNodes();

  const panelHtml = harness.getElement("submit-readiness-panel").innerHTML;
  assert.match(panelHtml, /ไปแก้ไข/);
  const actionTargets = harness.getActionNodes().map((node) => node.dataset.readinessTarget);
  assert.deepEqual(actionTargets, ["confirmed-phone", "confirmed-meta-status", "confirmed-category"]);

  const firstAction = harness.getActionNodes()[0];
  const clicked = harness.hooks.handleSubmitReadinessTargetClick({
    target: {
      closest(selector) {
        assert.equal(selector, "[data-readiness-target]");
        return firstAction;
      },
    },
    preventDefault() {},
  });
  assert.equal(clicked, true);
  assert.equal(harness.getToggleExpanded(), "true");
  assert.equal(harness.getFocusedId(), "confirmed-phone");
});

test("submit readiness delegation wiring registers click handler on the panel and forwards data-readiness-target", async () => {
  const harness = await createReadinessDelegationHarness();
  harness.hooks.registerSubmitReadinessTargetDelegation();

  const panel = harness.getElement("submit-readiness-panel");
  assert.equal(typeof panel.listeners.click, "function");

  const handled = panel.listeners.click({
    target: {
      closest(selector) {
        assert.equal(selector, "[data-readiness-target]");
        return { dataset: { readinessTarget: "confirmed-line-url" } };
      },
    },
    preventDefault() {},
  });

  assert.equal(handled, true);
  assert.equal(harness.getFocusedTarget(), "confirmed-line-url");
});

test("validateWorkspace and computeSubmitReadiness stay in parity for other_transport hard blockers", async () => {
  const { mod, elements } = await loadCoreModule();
  mod.state.item = {
    id: 88,
    type: "other_transport",
    title: "Transport",
    summary: "Summary",
    slug: "transport",
    meta_title: "Meta title",
    meta_description: "Meta description",
    description_clean: "Body",
    description_raw: "Body",
    source_entity_id: "taxi",
  };
  mod.state.assets = [];
  const ensureElement = (id) => {
    if (!elements.has(id)) global.document.getElementById(id);
    return elements.get(id);
  };

  ensureElement("article-title").value = "";
  ensureElement("article-excerpt").value = "";
  ensureElement("article-slug").value = "";
  ensureElement("article-meta-title").value = "";
  ensureElement("article-meta-description").value = "";
  ensureElement("article-body").value = "";
  ensureElement("other-transport-type").value = "";
  ensureElement("other-transport-contact-name").value = "";
  ensureElement("other-transport-phone").value = "";
  ensureElement("other-transport-contact-details").value = "";
  ensureElement("other-transport-link").value = "";

  const validation = mod.validateWorkspace();
  const readiness = mod.computeSubmitReadiness({
    item: mod.state.item,
    evidence: { version: 1, items: [] },
    hasCover: false,
  });

  assert.deepEqual(validation.missing, [
    "title",
    "summary",
    "meta title",
    "meta description",
    "body",
    "cover image",
    "contact name",
    "contact channel",
  ]);
  assert.deepEqual(readiness.blockers.map((entry) => entry.key), [
    "title",
    "summary",
    "meta_title",
    "meta_description",
    "body",
    "cover_image",
    "transport_contact_name",
    "transport_contact_channel",
  ]);
  assert.equal(findEntry(readiness.warnings, "confirmed_meta_status")?.severity, "warning");
  assert.equal(findEntry(readiness.blockers, "confirmed_meta_status"), null);
});
