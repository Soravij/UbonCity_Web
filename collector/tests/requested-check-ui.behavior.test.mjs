import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const itemEditorJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "item-editor.js"), "utf8");
const repositoryJs = fs.readFileSync(path.join(collectorRoot, "db", "repository.mjs"), "utf8");

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf("(", start);
  assert.notEqual(paramsStart, -1, `${functionName} should have params`);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") paramsDepth += 1;
    if (char === ")") {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${functionName}`);
}

function loadConstValue(sourceText, constName) {
  const marker = `const ${constName} = `;
  const start = sourceText.indexOf(marker);
  assert.notEqual(start, -1, `${constName} should exist`);
  const valueStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let stringChar = "";
  for (let index = valueStart; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    const prev = sourceText[index - 1];
    if (inString) {
      if (char === stringChar && prev !== "\\") {
        inString = false;
        stringChar = "";
      }
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      inString = true;
      stringChar = char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") depth -= 1;
    if (char === ";" && depth === 0) {
      const expression = sourceText.slice(valueStart, index).trim();
      return Function(`return (${expression});`)();
    }
  }
  throw new Error(`Could not extract const ${constName}`);
}

function loadNamedFunction(sourceText, functionName, dependencies = {}) {
  const source = extractFunctionSource(sourceText, functionName);
  const dependencyNames = Object.keys(dependencies);
  const dependencyValues = Object.values(dependencies);
  return Function(...dependencyNames, `${source}; return ${functionName};`)(...dependencyValues);
}

const REQUESTED_CHECK_GROUP_TEMPLATES = loadConstValue(itemEditorJs, "REQUESTED_CHECK_GROUP_TEMPLATES");
const getRequestedCheckDefaultGroupLabel = loadNamedFunction(itemEditorJs, "getRequestedCheckDefaultGroupLabel", {
  REQUESTED_CHECK_GROUP_TEMPLATES,
});
const buildRequestedChecksEditorState = loadNamedFunction(itemEditorJs, "buildRequestedChecksEditorState", {
  REQUESTED_CHECK_GROUP_TEMPLATES,
  state: { item: { type: "place" } },
});
const isPlaceRequestedCheckItem = loadNamedFunction(itemEditorJs, "isPlaceRequestedCheckItem", {
  state: { item: { type: "place" } },
});
const getRequestedCheckEditorGroups = loadNamedFunction(itemEditorJs, "getRequestedCheckEditorGroups", {
  buildRequestedChecksEditorState,
  isPlaceRequestedCheckItem,
  state: { item: { type: "place" } },
});
const buildRequestedChecksPreviewHtml = loadNamedFunction(itemEditorJs, "buildRequestedChecksPreviewHtml", {
  escapeHtml: (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;"),
});
const normalizeRequestedCheckKey = loadNamedFunction(itemEditorJs, "normalizeRequestedCheckKey");
const mergeRequestedChecksForSave = loadNamedFunction(itemEditorJs, "mergeRequestedChecksForSave", {
  REQUESTED_CHECK_GROUP_TEMPLATES,
  getRequestedCheckDefaultGroupLabel,
  normalizeRequestedCheckKey,
});
const buildRequestedChecksHandoffPayload = loadNamedFunction(repositoryJs, "buildRequestedChecksHandoffPayload", {
  normalizeRequestedChecksJson: (value) => value,
});

test("delete custom check removes it from saved payload instead of reviving existing state", () => {
  const existingState = {
    version: 1,
    groups: [
      {
        group_key: "custom",
        group_label: "เช็กเพิ่ม",
        checks: [
          {
            key: "parking_fee",
            requested: true,
            label: "ค่าจอดรถ",
            instruction: "ถามค่าจอดรถล่าสุด",
            answer_type: "text",
            suggested_value: "ฟรี 2 ชั่วโมง",
            source: { kind: "ai", confidence: "medium" },
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/ติดต่อ",
        checks: [],
      },
      {
        group_key: "taxonomy",
        group_label: "หมวดหมู่",
        checks: [],
      },
      {
        group_key: "custom",
        group_label: "เช็กเพิ่ม",
        checks: [],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, existingState);
  const customGroup = result.groups.find((group) => group.group_key === "custom");

  assert.deepEqual(customGroup?.checks || [], []);
});

test("retained check preserves provenance while applying curator edits", () => {
  const existingState = {
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/ติดต่อ",
        checks: [
          {
            key: "phone",
            requested: false,
            label: "เบอร์โทร",
            instruction: "ขอเบอร์ที่ติดต่อได้จริง",
            answer_type: "phone",
            suggested_value: "0812345678",
            source: { kind: "ai", confidence: "high" },
            condition_prompt: null,
            evidence_required: true,
          },
        ],
      },
    ],
  };
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/ติดต่อ",
        checks: [
          {
            key: "phone",
            requested: true,
            label: "เบอร์ติดต่อหลัก",
            instruction: "ยืนยันเบอร์ล่าสุด",
            answer_type: "phone",
            condition_prompt: "ถ้ามีหลายเบอร์ให้ระบุเบอร์หลัก",
            evidence_required: false,
          },
        ],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, existingState);
  const phoneCheck = result.groups[0].checks[0];

  assert.equal(phoneCheck.requested, true);
  assert.equal(phoneCheck.label, "เบอร์ติดต่อหลัก");
  assert.equal(phoneCheck.instruction, "ยืนยันเบอร์ล่าสุด");
  assert.equal(phoneCheck.condition_prompt, "ถ้ามีหลายเบอร์ให้ระบุเบอร์หลัก");
  assert.equal(phoneCheck.evidence_required, false);
  assert.equal(phoneCheck.suggested_value, "0812345678");
  assert.deepEqual(phoneCheck.source, { kind: "ai", confidence: "high" });
});

test("requested-check editor shows CTA templates for place items", () => {
  const groups = getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
  }, {
    type: "place",
  });

  const ctaGroup = groups.find((group) => group.group_key === "cta_contact");
  const taxonomyGroup = groups.find((group) => group.group_key === "taxonomy");

  assert.ok(ctaGroup);
  assert.deepEqual(
    ctaGroup.checks.map((check) => check.key),
    ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]
  );
  assert.ok(taxonomyGroup);
});

test("requested-check editor hides CTA templates for non-place items", () => {
  const groups = getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
  }, {
    type: "event",
  });

  assert.equal(groups.some((group) => group.group_key === "cta_contact"), false);
  assert.equal(groups.some((group) => group.group_key === "taxonomy"), true);
});

test("ai suggested values do not auto-set requested=true in editor groups", () => {
  const groups = getRequestedCheckEditorGroups({
    ai_cta_contact_json: {
      phone: "0812345678",
      primary_cta: "line",
      confidence: "medium",
    },
    ai_taxonomy_json: {
      category: "attractions",
      tags: ["family", "museum"],
      confidence: "medium",
    },
    requested_checks_json: { version: 1, groups: [] },
  }, {
    type: "place",
  });

  const ctaPhone = groups.find((group) => group.group_key === "cta_contact")?.checks.find((check) => check.key === "phone");
  const taxonomyCategory = groups.find((group) => group.group_key === "taxonomy")?.checks.find((check) => check.key === "category");

  assert.equal(ctaPhone?.requested, false);
  assert.equal(ctaPhone?.suggested_value, "0812345678");
  assert.equal(taxonomyCategory?.requested, false);
  assert.equal(taxonomyCategory?.suggested_value, "attractions");
});

test("requested-check preview shows only requested=true checks", () => {
  const html = buildRequestedChecksPreviewHtml({
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/contact",
        checks: [
          { key: "phone", label: "เบอร์โทร", requested: true },
          { key: "line_url", label: "LINE", requested: true },
          { key: "facebook_url", label: "Facebook", requested: false },
        ],
      },
      {
        group_key: "taxonomy",
        group_label: "Taxonomy",
        checks: [
          { key: "category", label: "หมวดหลัก", requested: true },
          { key: "tags", label: "tags", requested: true },
        ],
      },
      {
        group_key: "custom",
        group_label: "Custom",
        checks: [
          { key: "parking", label: "ที่จอดรถ", requested: true },
        ],
      },
    ],
  });

  assert.match(html, /CTA\/contact/);
  assert.match(html, /เบอร์โทร/);
  assert.match(html, /LINE/);
  assert.match(html, /Taxonomy/);
  assert.match(html, /หมวดหลัก/);
  assert.match(html, /tags/);
  assert.match(html, /Custom/);
  assert.match(html, /ที่จอดรถ/);
  assert.doesNotMatch(html, /Facebook/);
});

test("requested-check preview shows clear empty state when nothing is selected", () => {
  const html = buildRequestedChecksPreviewHtml({
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/contact",
        checks: [
          { key: "phone", label: "เบอร์โทร", requested: false },
        ],
      },
    ],
  });

  assert.match(html, /ยังไม่ได้เลือกรายการที่จะส่งให้คนไปเช็ก/);
});

test("save merge preserves hidden legacy cta_contact checks for non-place items", () => {
  const existingState = {
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/contact",
        checks: [
          {
            key: "phone",
            requested: true,
            label: "เบอร์โทร",
            instruction: "ยืนยันเบอร์",
            answer_type: "phone",
            suggested_value: "0812345678",
            source: { kind: "ai", confidence: "high" },
            condition_prompt: null,
            evidence_required: true,
          },
        ],
      },
      {
        group_key: "taxonomy",
        group_label: "Taxonomy",
        checks: [
          {
            key: "category",
            requested: true,
            label: "หมวดหลัก",
            instruction: "ยืนยันหมวด",
            answer_type: "text",
            suggested_value: "festival",
            source: null,
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "taxonomy",
        group_label: "Taxonomy",
        checks: [
          {
            key: "category",
            requested: true,
            label: "หมวดหลัก",
            instruction: "ยืนยันหมวด",
            answer_type: "text",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
      {
        group_key: "custom",
        group_label: "Custom",
        checks: [],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, existingState);
  const ctaGroup = result.groups.find((group) => group.group_key === "cta_contact");

  assert.ok(ctaGroup);
  assert.equal(ctaGroup.checks[0].requested, true);
  assert.equal(ctaGroup.checks[0].label, "เบอร์โทร");
});

test("non-place preview omits hidden legacy cta_contact checks", () => {
  const groups = getRequestedCheckEditorGroups({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            { key: "phone", requested: true, label: "เบอร์โทร", instruction: "ยืนยันเบอร์", answer_type: "phone" },
          ],
        },
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "หมวดหลัก", instruction: "ยืนยันหมวด", answer_type: "text" },
          ],
        },
      ],
    },
  }, {
    type: "event",
  });

  const html = buildRequestedChecksPreviewHtml({ version: 1, groups });
  assert.doesNotMatch(html, /CTA\/contact/);
  assert.match(html, /หมวดหมู่/);
  assert.match(html, /หมวดหลัก/);
});

test("duplicate custom keys are rejected before provenance can merge ambiguously", () => {
  const existingState = {
    version: 1,
    groups: [
      {
        group_key: "custom",
        group_label: "เช็กเพิ่ม",
        checks: [
          {
            key: "parking",
            requested: true,
            label: "ที่จอดรถ",
            instruction: "ถามเรื่องที่จอดรถ",
            answer_type: "text",
            suggested_value: "มีลานจอด",
            source: { kind: "ai", confidence: "medium" },
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "custom",
        group_label: "เช็กเพิ่ม",
        checks: [
          {
            key: " parking ",
            requested: true,
            label: "ที่จอดรถด้านหน้า",
            instruction: "ถามลานหน้า",
            answer_type: "text",
            condition_prompt: null,
            evidence_required: false,
          },
          {
            key: "parking",
            requested: false,
            label: "ที่จอดรถด้านหลัง",
            instruction: "ถามลานหลัง",
            answer_type: "text",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };

  assert.throws(
    () => mergeRequestedChecksForSave(uiState, existingState),
    /duplicate requested check key/i
  );
});

test("edited custom key becomes a new identity and does not inherit old provenance", () => {
  const existingState = {
    version: 1,
    groups: [
      {
        group_key: "custom",
        group_label: "เช็กเพิ่ม",
        checks: [
          {
            key: "parking",
            requested: true,
            label: "ที่จอดรถ",
            instruction: "ถามเรื่องที่จอดรถ",
            answer_type: "text",
            suggested_value: "มีลานจอด",
            source: { kind: "ai", confidence: "medium" },
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "custom",
        group_label: "เช็กเพิ่ม",
        checks: [
          {
            key: "parking_capacity",
            requested: true,
            label: "จำนวนที่จอดรถ",
            instruction: "ถามจำนวนที่จอด",
            answer_type: "text",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, existingState);
  const customCheck = result.groups.find((group) => group.group_key === "custom")?.checks[0];

  assert.equal(customCheck?.key, "parking_capacity");
  assert.equal(customCheck?.suggested_value, null);
  assert.equal(customCheck?.source, null);
});

test("retained custom key preserves provenance while curator fields change", () => {
  const existingState = {
    version: 1,
    groups: [
      {
        group_key: "custom",
        group_label: "เช็กเพิ่ม",
        checks: [
          {
            key: "parking",
            requested: false,
            label: "ที่จอดรถ",
            instruction: "ถามเรื่องที่จอดรถ",
            answer_type: "text",
            suggested_value: "มีลานจอด",
            source: { kind: "ai", confidence: "medium" },
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "custom",
        group_label: "เช็กเพิ่ม",
        checks: [
          {
            key: "parking",
            requested: true,
            label: "ข้อมูลที่จอดรถ",
            instruction: "ถามจำนวนและรูปแบบที่จอด",
            answer_type: "text",
            condition_prompt: "ถ้ามีหลายโซนให้แยก",
            evidence_required: true,
          },
        ],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, existingState);
  const customCheck = result.groups.find((group) => group.group_key === "custom")?.checks[0];

  assert.equal(customCheck?.requested, true);
  assert.equal(customCheck?.label, "ข้อมูลที่จอดรถ");
  assert.equal(customCheck?.instruction, "ถามจำนวนและรูปแบบที่จอด");
  assert.equal(customCheck?.condition_prompt, "ถ้ามีหลายโซนให้แยก");
  assert.equal(customCheck?.evidence_required, true);
  assert.equal(customCheck?.suggested_value, "มีลานจอด");
  assert.deepEqual(customCheck?.source, { kind: "ai", confidence: "medium" });
});

test("built-in keys stay on template identity even if UI sends a changed key", () => {
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/ติดต่อ",
        checks: [
          {
            key: "phone_number_override",
            requested: true,
            label: "เบอร์โทร",
            instruction: "ขอเบอร์จริง",
            answer_type: "phone",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, {});
  const ctaCheck = result.groups.find((group) => group.group_key === "cta_contact")?.checks[0];

  assert.equal(ctaCheck?.key, "phone");
});

test("AI suggestion metadata does not auto-request a check", () => {
  const existingState = {
    version: 1,
    groups: [
      {
        group_key: "taxonomy",
        group_label: "หมวดหมู่",
        checks: [
          {
            key: "tags",
            requested: false,
            label: "แท็ก",
            instruction: "ดูว่าแท็กไหนควรเติม",
            answer_type: "multi_select",
            suggested_value: ["วิวแม่น้ำ", "คาเฟ่"],
            source: { kind: "ai", confidence: "medium" },
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "taxonomy",
        group_label: "หมวดหมู่",
        checks: [
          {
            key: "category",
            requested: false,
            label: "หมวดหลัก",
            instruction: "ยืนยันหมวดหลักของสถานที่",
            answer_type: "text",
            condition_prompt: null,
            evidence_required: false,
          },
          {
            key: "subtype",
            requested: false,
            label: "หมวดย่อย",
            instruction: "ยืนยันหมวดย่อยที่ตรงที่สุด",
            answer_type: "text",
            condition_prompt: null,
            evidence_required: false,
          },
          {
            key: "tags",
            requested: false,
            label: "แท็ก",
            instruction: "ดูว่าแท็กไหนควรเติม",
            answer_type: "multi_select",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, existingState);
  const taxonomyGroup = result.groups.find((group) => group.group_key === "taxonomy");
  const tagsCheck = taxonomyGroup?.checks.find((check) => check.key === "tags");

  assert.equal(tagsCheck?.requested, false);
  assert.deepEqual(tagsCheck?.suggested_value, ["วิวแม่น้ำ", "คาเฟ่"]);
});

test("group labels in saved payload come from stable defaults, not DOM summary text", () => {
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "ข้อความแสดงผลที่ไม่ควรถูก persist",
        checks: [
          {
            key: "phone",
            requested: true,
            label: "เบอร์โทร",
            instruction: "ขอเบอร์จริง",
            answer_type: "phone",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, {});

  assert.equal(result.groups[0].group_label, "CTA/ติดต่อ");
});

test("requested-check UI still does not expose editable provenance or suggested_value inputs", () => {
  assert.equal(itemEditorJs.includes('data-check-field="source"'), false);
  assert.equal(itemEditorJs.includes('data-check-field="suggested_value"'), false);
});

test("buildRequestedChecksHandoffPayload omits requested_checks when nothing is selected", () => {
  const result = buildRequestedChecksHandoffPayload({
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/ติดต่อ",
        checks: [
          { key: "phone", requested: false },
        ],
      },
    ],
  });

  assert.equal(result, null);
});
