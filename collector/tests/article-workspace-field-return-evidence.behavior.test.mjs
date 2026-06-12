import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const pageSource = fs.readFileSync(path.resolve("D:/UbonCity_Web/collector/server/public/article-workspace-page.js"), "utf8");
const coreModulePath = path.resolve("D:/UbonCity_Web/collector/server/public/article-workflow-core.js");

function extractFunctionBlock(source, name) {
  const signature = `function ${name}`;
  const start = source.indexOf(signature);
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

function createElement(id = "", value = "") {
  return {
    id,
    value,
    innerHTML: "",
    textContent: "",
    className: "",
    dataset: {},
    listeners: {},
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
  };
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
  return import(moduleUrl);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  return String(value || "").trim() || "-";
}

async function createPageHarness({ itemType = "place", evidenceItems = [], confirmedValues = {}, confirmResult = true } = {}) {
  const coreMod = await loadCoreModule();
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };
  const state = {
    item: {
      type: itemType,
      title: "Original title",
      summary: "Original summary",
      meta_title: "Original meta title",
      meta_description: "Original meta description",
    },
  };
  const statusCalls = [];
  let dirtyCalls = 0;
  let confirmCalls = 0;
  getElement("field-return-evidence-panel");
  getElement("field-return-evidence-status");
  getElement("article-title").value = "Original title";
  getElement("article-excerpt").value = "Original summary";
  getElement("article-body").value = "Original body";
  getElement("article-meta-title").value = "Original meta title";
  getElement("article-meta-description").value = "Original meta description";
  getElement("confirmed-phone").value = confirmedValues.phone || "";
  getElement("confirmed-line-url").value = confirmedValues.line_url || "";
  getElement("confirmed-facebook-url").value = confirmedValues.facebook_url || "";
  getElement("confirmed-website-url").value = confirmedValues.website_url || "";
  getElement("confirmed-primary-cta").value = confirmedValues.primary_cta || "";

  const context = {
    Map,
    state,
    window: {
      confirm() {
        confirmCalls += 1;
        return confirmResult;
      },
    },
    qs(id) {
      return getElement(id);
    },
    fieldReturnEvidence() {
      return { version: 1, items: evidenceItems };
    },
    escapeHtml,
    formatDateTime,
    isPlaceItem: coreMod.isPlaceItem,
    canApplyFieldReturnEvidenceToConfirmedCta: coreMod.canApplyFieldReturnEvidenceToConfirmedCta,
    setInlineStatus(id, message, kind = "success") {
      statusCalls.push({ id, message, kind });
      const node = getElement(id);
      node.textContent = String(message || "");
      node.className = kind;
    },
    applyFieldReturnEvidenceToConfirmedCta: coreMod.applyFieldReturnEvidenceToConfirmedCta,
    fillField(id, value) {
      getElement(id).value = String(value ?? "");
    },
    setWorkspaceDirty() {
      dirtyCalls += 1;
    },
    renderSubmitReadiness() {},
    renderStatusChip() {},
    applyActionGuards() {},
  };
  context.globalThis = context;
  vm.runInNewContext(`
${extractFunctionBlock(pageSource, "fieldReturnEvidenceGroupLabel")}
${extractFunctionBlock(pageSource, "renderFieldReturnEvidenceValue")}
${extractFunctionBlock(pageSource, "renderFieldReturnEvidencePanel")}
${extractFunctionBlock(pageSource, "applyFieldReturnEvidenceByKey")}
${extractFunctionBlock(pageSource, "handleFieldReturnEvidencePanelClick")}
globalThis.__pageHooks = {
  renderFieldReturnEvidencePanel,
  applyFieldReturnEvidenceByKey,
  handleFieldReturnEvidencePanelClick,
};
`, context, { filename: "article-workspace-field-return-page.js" });
  return {
    hooks: context.__pageHooks,
    elements,
    getElement,
    state,
    statusCalls,
    getDirtyCalls: () => dirtyCalls,
    getConfirmCalls: () => confirmCalls,
  };
}

test("CTA apply helper rejects non-place context", async () => {
  const mod = await loadCoreModule();
  mod.state.item = { type: "event" };
  assert.equal(mod.canApplyFieldReturnEvidenceToConfirmedCta({
    key: "cta_contact.phone",
    found: true,
    value: "0812345678",
  }, { type: "event" }), false);
  assert.deepEqual(
    mod.applyFieldReturnEvidenceToConfirmedCta({ phone: "0899999999" }, {
      key: "cta_contact.phone",
      found: true,
      value: "0812345678",
    }, { type: "event" }),
    {
      phone: "0899999999",
      line_url: null,
      facebook_url: null,
      website_url: null,
      primary_cta: null,
    }
  );
});

test("renderFieldReturnEvidencePanel renders CTA apply action for place only", async () => {
  const placeHarness = await createPageHarness({
    itemType: "place",
    evidenceItems: [
      {
        key: "cta_contact.phone",
        group_key: "cta_contact",
        label: "เบอร์โทร",
        checked: true,
        found: true,
        value: "0812345678",
        condition_note: "",
        evidence: "โทรสอบถาม",
        note: "",
        submitted_at: "2026-06-12T10:00:00.000Z",
        submitted_by: "checker",
      },
    ],
  });
  placeHarness.hooks.renderFieldReturnEvidencePanel();
  assert.match(placeHarness.getElement("field-return-evidence-panel").innerHTML, /data-action="apply-field-return-evidence"/);

  const eventHarness = await createPageHarness({
    itemType: "event",
    evidenceItems: [
      {
        key: "cta_contact.phone",
        group_key: "cta_contact",
        label: "เบอร์โทร",
        checked: true,
        found: true,
        value: "0812345678",
        condition_note: "",
        evidence: "โทรสอบถาม",
        note: "",
        submitted_at: "2026-06-12T10:00:00.000Z",
        submitted_by: "checker",
      },
    ],
  });
  eventHarness.hooks.renderFieldReturnEvidencePanel();
  assert.doesNotMatch(eventHarness.getElement("field-return-evidence-panel").innerHTML, /data-action="apply-field-return-evidence"/);
  assert.doesNotMatch(eventHarness.getElement("field-return-evidence-panel").innerHTML, /cta_contact\.phone/);
  assert.doesNotMatch(eventHarness.getElement("field-return-evidence-panel").innerHTML, /เบอร์โทร/);
});

test("applyFieldReturnEvidenceByKey updates actual confirmed CTA field and marks workspace dirty", async () => {
  const harness = await createPageHarness({
    itemType: "place",
    evidenceItems: [
      {
        key: "cta_contact.phone",
        group_key: "cta_contact",
        label: "เบอร์โทร",
        checked: true,
        found: true,
        value: "0812345678",
        condition_note: "",
        evidence: "โทรสอบถาม",
        note: "",
        submitted_at: "2026-06-12T10:00:00.000Z",
        submitted_by: "checker",
      },
    ],
    confirmedValues: {
      phone: "",
      line_url: "https://line.me/existing",
      facebook_url: "https://facebook.com/existing",
      website_url: "https://existing.example.com",
      primary_cta: "phone",
    },
  });

  const applied = harness.hooks.applyFieldReturnEvidenceByKey("cta_contact.phone");
  assert.equal(applied, true);
  assert.equal(harness.getElement("confirmed-phone").value, "0812345678");
  assert.equal(harness.getElement("confirmed-line-url").value, "https://line.me/existing");
  assert.equal(harness.getElement("article-title").value, "Original title");
  assert.equal(harness.getElement("article-body").value, "Original body");
  assert.equal(harness.getDirtyCalls(), 1);
});

test("delegated click handler uses selector and dataset path to apply evidence", async () => {
  const harness = await createPageHarness({
    itemType: "place",
    evidenceItems: [
      {
        key: "cta_contact.phone",
        group_key: "cta_contact",
        label: "เบอร์โทร",
        checked: true,
        found: true,
        value: "0812345678",
      },
    ],
    confirmedValues: {
      phone: "",
      line_url: "https://line.me/existing",
      facebook_url: "https://facebook.com/existing",
      website_url: "https://existing.example.com",
      primary_cta: "phone",
    },
  });

  const result = harness.hooks.handleFieldReturnEvidencePanelClick({
    target: {
      closest(selector) {
        assert.equal(selector, "[data-action='apply-field-return-evidence']");
        return {
          dataset: {
            action: "apply-field-return-evidence",
            fieldReturnKey: "cta_contact.phone",
          },
        };
      },
    },
  });

  assert.equal(result, true);
  assert.equal(harness.getElement("confirmed-phone").value, "0812345678");
  assert.equal(harness.getElement("article-title").value, "Original title");
  assert.equal(harness.getElement("article-excerpt").value, "Original summary");
  assert.equal(harness.getElement("article-meta-title").value, "Original meta title");
  assert.equal(harness.getDirtyCalls(), 1);
});

test("applyFieldReturnEvidenceByKey exercises overwrite confirmation and rejects invalid or not-found values", async () => {
  const overwriteHarness = await createPageHarness({
    itemType: "place",
    evidenceItems: [
      {
        key: "cta_contact.phone",
        group_key: "cta_contact",
        label: "เบอร์โทร",
        checked: true,
        found: true,
        value: "0812345678",
      },
      {
        key: "cta_contact.primary_cta",
        group_key: "cta_contact",
        label: "ปุ่มหลัก",
        checked: true,
        found: true,
        value: "website",
      },
      {
        key: "cta_contact.line_url",
        group_key: "cta_contact",
        label: "ลิงก์ LINE",
        checked: true,
        found: false,
        value: "https://line.me/ignored",
      },
    ],
    confirmedValues: {
      phone: "0899999999",
      primary_cta: "phone",
    },
    confirmResult: false,
  });

  assert.equal(overwriteHarness.hooks.applyFieldReturnEvidenceByKey("cta_contact.phone"), false);
  assert.equal(overwriteHarness.getConfirmCalls(), 1);
  assert.equal(overwriteHarness.getElement("confirmed-phone").value, "0899999999");
  assert.equal(overwriteHarness.hooks.applyFieldReturnEvidenceByKey("cta_contact.primary_cta"), false);
  assert.equal(overwriteHarness.hooks.applyFieldReturnEvidenceByKey("cta_contact.line_url"), false);
  assert.equal(overwriteHarness.getDirtyCalls(), 0);
});
