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

async function createPageHarness({
  itemType = "place",
  evidenceItems = [],
  latestDraft = null,
  confirmedMetaSource = "accepted",
} = {}) {
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
    articleProcess: { confirmed_meta_source: confirmedMetaSource },
  };
  const statusCalls = [];
  getElement("field-return-evidence-panel");
  getElement("field-return-evidence-status");
  getElement("confirmed-cta-summary");
  getElement("confirmed-taxonomy-summary");
  getElement("confirmed-meta-status-summary");

  const context = {
    Map,
    Set,
    Object,
    Array,
    String,
    state,
    qs(id) {
      return getElement(id);
    },
    fieldReturnEvidence() {
      return { version: 1, items: evidenceItems };
    },
    latestDraft() {
      return latestDraft;
    },
    escapeHtml,
    formatDateTime,
    isPlaceItem: coreMod.isPlaceItem,
    defaultConfirmedCtaContact: coreMod.defaultConfirmedCtaContact,
    defaultConfirmedTaxonomy: coreMod.defaultConfirmedTaxonomy,
    setInlineStatus(id, message, kind = "success") {
      statusCalls.push({ id, message, kind });
      const node = getElement(id);
      node.textContent = String(message || "");
      node.className = kind;
    },
  };
  context.globalThis = context;
  vm.runInNewContext(`
${extractFunctionBlock(pageSource, "fieldReturnEvidenceGroupLabel")}
${extractFunctionBlock(pageSource, "renderFieldReturnEvidenceValue")}
${extractFunctionBlock(pageSource, "renderFieldReturnEvidencePanel")}
${extractFunctionBlock(pageSource, "confirmedSummaryValue")}
${extractFunctionBlock(pageSource, "acceptedFieldReturnEvidenceByGroup")}
${extractFunctionBlock(pageSource, "hasAcceptedConfirmedMetadata")}
${extractFunctionBlock(pageSource, "renderConfirmedCtaSummary")}
${extractFunctionBlock(pageSource, "renderConfirmedTaxonomySummary")}
${extractFunctionBlock(pageSource, "renderConfirmedMetaStatusSummary")}
${extractFunctionBlock(pageSource, "renderConfirmedMetaSummary")}
globalThis.__pageHooks = {
  renderFieldReturnEvidencePanel,
  renderConfirmedMetaSummary,
};
`, context, { filename: "article-workspace-field-return-page.js" });
  return {
    hooks: context.__pageHooks,
    elements,
    getElement,
    state,
    statusCalls,
  };
}

test("CTA apply helper rejects non-place context", async () => {
  const mod = await loadCoreModule();
  mod.state.item = { type: "event" };
  assert.equal(mod.canApplyFieldReturnEvidenceToConfirmedCta({
    key: "cta_contact.phone",
    found: true,
    value: "0812345678",
        submission_source: "accepted",
  }, { type: "event" }), false);
  assert.deepEqual(
    mod.applyFieldReturnEvidenceToConfirmedCta({ phone: "0899999999" }, {
      key: "cta_contact.phone",
      found: true,
      value: "0812345678",
        submission_source: "accepted",
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

test("renderFieldReturnEvidencePanel is read-only and hides CTA rows for non-place items", async () => {
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
        submission_source: "accepted",
        condition_note: "ต้องโทรยืนยันก่อนเผยแพร่",
        evidence: "โทรสอบถาม",
        note: "",
        submitted_at: "2026-06-12T10:00:00.000Z",
        submitted_by: "checker",
      },
    ],
  });
  placeHarness.hooks.renderFieldReturnEvidencePanel();
  const placeHtml = placeHarness.getElement("field-return-evidence-panel").innerHTML;
  assert.match(placeHtml, /cta_contact\.phone/);
  assert.match(placeHtml, /0812345678/);
  assert.match(placeHtml, /ต้องโทรยืนยันก่อนเผยแพร่/);
  assert.doesNotMatch(placeHtml, /data-action="apply-field-return-evidence"/);
  assert.doesNotMatch(placeHtml, /ใช้ค่านี้/);

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
        submission_source: "accepted",
        condition_note: "ต้องโทรยืนยันก่อนเผยแพร่",
        evidence: "โทรสอบถาม",
        note: "",
        submitted_at: "2026-06-12T10:00:00.000Z",
        submitted_by: "checker",
      },
    ],
  });
  eventHarness.hooks.renderFieldReturnEvidencePanel();
  assert.doesNotMatch(eventHarness.getElement("field-return-evidence-panel").innerHTML, /cta_contact\.phone/);
  assert.doesNotMatch(eventHarness.getElement("field-return-evidence-panel").innerHTML, /เบอร์โทร/);
});

test("renderFieldReturnEvidencePanel shows empty state for non-accepted evidence", async () => {
  const harness = await createPageHarness({
    itemType: "place",
    evidenceItems: [{
      key: "cta_contact.phone",
      group_key: "cta_contact",
      checked: true,
      found: true,
      value: "0812345678",
      submission_source: "latest",
    }],
  });

  harness.hooks.renderFieldReturnEvidencePanel();
  assert.match(harness.getElement("field-return-evidence-panel").innerHTML, /ยังไม่มีข้อมูลที่คนเช็กส่งกลับ/);
});
test("renderConfirmedMetaSummary shows accepted confirmed values read-only", async () => {
  const harness = await createPageHarness({
    itemType: "place",
    evidenceItems: [
      {
        key: "cta_contact.line_url",
        group_key: "cta_contact",
        check_key: "line_url",
        label: "ลิงก์ LINE",
        checked: true,
        found: false,
        value: null,
        submission_source: "accepted",
      },
      {
        key: "taxonomy.price_range",
        group_key: "taxonomy",
        check_key: "price_range",
        label: "ช่วงราคา",
        checked: true,
        found: true,
        value: { number: 120, unit: "บาท" },
        submission_source: "accepted",
      },
    ],
    latestDraft: {
      confirmed_cta_contact_json: {
        phone: "0812345678",
        line_url: null,
        facebook_url: null,
        website_url: null,
        primary_cta: "phone",
      },
      confirmed_taxonomy_json: { category: "attractions", subtype: "museum", tags: ["family"] },
      confirmed_meta_status: "confirmed",
      confirmed_at: "2026-07-13T10:00:00.000Z",
      confirmed_note: "accepted from assignment #7 round 1 submission #9",
    },
  });

  harness.hooks.renderConfirmedMetaSummary();

  // the persisted confirmed values are the accumulated truth across rounds and are shown read-only
  const ctaHtml = harness.getElement("confirmed-cta-summary").innerHTML;
  assert.match(ctaHtml, /0812345678/);
  // a value cleared by a "checked, not found" answer renders as not found, never as an editable field
  assert.match(ctaHtml, /ไม่พบ/);
  assert.doesNotMatch(ctaHtml, /<input|<select|<textarea/);

  const taxonomyHtml = harness.getElement("confirmed-taxonomy-summary").innerHTML;
  // reserved keys can never be requested checks, so they come from the confirmed taxonomy itself
  assert.match(taxonomyHtml, /attractions/);
  assert.match(taxonomyHtml, /museum/);
  assert.match(taxonomyHtml, /family/);
  // non-reserved Curation answers surface from the accepted evidence with compact number/unit formatting
  assert.match(taxonomyHtml, /ช่วงราคา/);
  assert.match(taxonomyHtml, /120 บาท/);
  assert.doesNotMatch(taxonomyHtml, /<input|<select|<textarea/);

  const statusHtml = harness.getElement("confirmed-meta-status-summary").innerHTML;
  assert.match(statusHtml, /ยืนยันแล้ว/);
  assert.match(statusHtml, /accepted from assignment #7 round 1 submission #9/);
});

test("renderConfirmedMetaSummary hides draft values that reviewer acceptance never wrote", async () => {
  const harness = await createPageHarness({
    itemType: "place",
    evidenceItems: [],
    // legacy row: confirmed_* was self-set in the workspace before the acceptance pipeline existed
    confirmedMetaSource: "legacy",
    latestDraft: {
      confirmed_cta_contact_json: { phone: "draft-only" },
      confirmed_taxonomy_json: { category: "draft-only" },
      confirmed_meta_status: "confirmed",
    },
  });
  harness.hooks.renderConfirmedMetaSummary();
  assert.match(harness.getElement("confirmed-cta-summary").innerHTML, /ยังไม่มีข้อมูลยืนยันจากผู้ตรวจ/);
  assert.doesNotMatch(harness.getElement("confirmed-cta-summary").innerHTML, /draft-only/);
  assert.match(harness.getElement("confirmed-taxonomy-summary").innerHTML, /ยังไม่มีข้อมูลยืนยันจากผู้ตรวจ/);
  assert.doesNotMatch(harness.getElement("confirmed-taxonomy-summary").innerHTML, /draft-only/);
  assert.match(harness.getElement("confirmed-meta-status-summary").innerHTML, /ยืนยันแล้ว/);
});
