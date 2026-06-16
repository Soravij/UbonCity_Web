import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const itemEditorJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "item-editor.js"), "utf8");
const itemEditorHtml = fs.readFileSync(path.join(collectorRoot, "server", "public", "item-editor.html"), "utf8");
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

function extractCompactSummaryRow(html, label) {
  const escapedLabel = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<div class="summary-row">\\s*<strong>${escapedLabel}<\\/strong>[\\s\\S]*?<\\/div>`);
  const match = html.match(pattern);
  return match ? match[0] : "";
}

function extractDefaultGuidanceHtml(html) {
  return String(html).split('<details class="secondary-panel">\n      <summary>Advanced edit requested checks</summary>')[0];
}

function extractSectionHtml(html, heading) {
  const escapedHeading = String(heading).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<section class="article-brief-section">\\s*<h3>${escapedHeading}<\\/h3>[\\s\\S]*?<\\/section>`);
  const match = String(html).match(pattern);
  return match ? match[0] : "";
}

const REQUESTED_CHECK_GROUP_TEMPLATES = loadConstValue(itemEditorJs, "REQUESTED_CHECK_GROUP_TEMPLATES");
const REQUESTED_CHECK_ANSWER_TYPE_OPTIONS = loadConstValue(itemEditorJs, "REQUESTED_CHECK_ANSWER_TYPE_OPTIONS");
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
const normalizeRequestedCheckKey = loadNamedFunction(itemEditorJs, "normalizeRequestedCheckKey");
const mergeRequestedChecksForSave = loadNamedFunction(itemEditorJs, "mergeRequestedChecksForSave", {
  REQUESTED_CHECK_GROUP_TEMPLATES,
  getRequestedCheckDefaultGroupLabel,
  normalizeRequestedCheckKey,
});
const buildRequestedChecksHandoffPayload = loadNamedFunction(repositoryJs, "buildRequestedChecksHandoffPayload", {
  normalizeRequestedChecksJson: (value) => value,
});
const hasRequestedCheckMeaningfulValue = loadNamedFunction(itemEditorJs, "hasRequestedCheckMeaningfulValue");
const buildRequestedCheckStatusRow = loadNamedFunction(itemEditorJs, "buildRequestedCheckStatusRow", {
  hasRequestedCheckMeaningfulValue,
  formatRequestedCheckSuggestedValue: (value) => {
    if (Array.isArray(value)) return value.join(", ");
    return value == null ? "" : String(value);
  },
});
const extractRequestedCheckArticleContextHints = loadNamedFunction(itemEditorJs, "extractRequestedCheckArticleContextHints");
const parseFieldPackContractFromWriterNotes = loadNamedFunction(itemEditorJs, "parseFieldPackContractFromWriterNotes");
const parseTaxonomyContract = loadNamedFunction(itemEditorJs, "parseTaxonomyContract");
const toReviewList = loadNamedFunction(itemEditorJs, "toReviewList");
const taxonomyFieldLabel = loadNamedFunction(itemEditorJs, "taxonomyFieldLabel");
const normalizeItemGuidanceToken = loadNamedFunction(itemEditorJs, "normalizeItemGuidanceToken");
const resolveItemGuidanceScope = loadNamedFunction(itemEditorJs, "resolveItemGuidanceScope", {
  state: { item: { type: "place", category: "attractions" } },
  normalizeItemGuidanceToken,
});
const isTaxonomyConfigRelevantForScope = loadNamedFunction(itemEditorJs, "isTaxonomyConfigRelevantForScope");
const extractVerifiedFactSignals = loadNamedFunction(itemEditorJs, "extractVerifiedFactSignals");
const getRequestedCheckStatusBadge = loadNamedFunction(itemEditorJs, "getRequestedCheckStatusBadge", {
  escapeHtml: (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;"),
});
const buildRequestedChecksCompactSummaryData = loadNamedFunction(itemEditorJs, "buildRequestedChecksCompactSummaryData", {
  state: { item: { type: "place" } },
  isPlaceRequestedCheckItem,
  REQUESTED_CHECK_GROUP_TEMPLATES,
  getCompactGuidanceLabel: loadNamedFunction(itemEditorJs, "getCompactGuidanceLabel"),
  extractRequestedCheckArticleContextHints,
  buildTaxonomyGuidanceRows: loadNamedFunction(itemEditorJs, "buildTaxonomyGuidanceRows", {
    state: { item: { type: "place", category: "attractions" } },
    parseTaxonomyContract,
    parseFieldPackContractFromWriterNotes,
    toReviewList,
    taxonomyFieldLabel,
    resolveItemGuidanceScope,
    isTaxonomyConfigRelevantForScope,
    extractVerifiedFactSignals,
    hasRequestedCheckMeaningfulValue,
    buildRequestedCheckStatusRow,
  }),
  parseFieldPackContractFromWriterNotes,
  parseTaxonomyContract,
  toReviewList,
  extractVerifiedFactSignals,
  taxonomyFieldLabel,
  hasRequestedCheckMeaningfulValue,
  buildRequestedCheckStatusRow,
});
const renderRequestedCheckCompactRows = loadNamedFunction(itemEditorJs, "renderRequestedCheckCompactRows", {
  escapeHtml: (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;"),
  getRequestedCheckStatusBadge,
});
const buildRequestedChecksEditorHtml = loadNamedFunction(itemEditorJs, "buildRequestedChecksEditorHtml", {
  state: { item: { type: "place" } },
  escapeHtml: (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;"),
  getRequestedCheckEditorGroups,
  isPlaceRequestedCheckItem,
  buildRequestedChecksGuidanceModel: loadNamedFunction(itemEditorJs, "buildRequestedChecksGuidanceModel", {
    state: { item: { type: "place", category: "attractions" } },
    filterRequestedCheckGroupsForItem: loadNamedFunction(itemEditorJs, "filterRequestedCheckGroupsForItem", {
      shouldKeepRequestedCheckGroupForItem: loadNamedFunction(itemEditorJs, "shouldKeepRequestedCheckGroupForItem", {
        isPlaceRequestedCheckItem,
        state: { item: { type: "place", category: "attractions" } },
      }),
      state: { item: { type: "place", category: "attractions" } },
    }),
    getRequestedCheckEditorGroups,
    buildRequestedChecksCompactSummaryData,
  }),
  renderRequestedChecksGuidanceHtml: loadNamedFunction(itemEditorJs, "renderRequestedChecksGuidanceHtml", {
    escapeHtml: (value) => String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;"),
    renderRequestedCheckCompactRows,
    getRequestedCheckStatusBadge,
    toReviewList,
    hasRequestedCheckMeaningfulValue,
  }),
  buildRequestedChecksCompactSummaryData,
  renderRequestedCheckCompactRows,
  getRequestedCheckStatusBadge,
  REQUESTED_CHECK_ANSWER_TYPE_OPTIONS,
  formatRequestedCheckSuggestedValue: (value) => {
    if (Array.isArray(value)) return value.join(", ");
    return value == null ? "" : String(value);
  },
});
const buildRequestedChecksPreviewHtml = loadNamedFunction(itemEditorJs, "buildRequestedChecksPreviewHtml", {
  state: { item: { type: "place", category: "attractions" }, fieldPack: {} },
  buildRequestedChecksCompactPreviewHtml: loadNamedFunction(itemEditorJs, "buildRequestedChecksCompactPreviewHtml", {
    state: { item: { type: "place", category: "attractions" }, fieldPack: {} },
    buildRequestedChecksGuidanceModel: loadNamedFunction(itemEditorJs, "buildRequestedChecksGuidanceModel", {
      state: { item: { type: "place", category: "attractions" } },
      filterRequestedCheckGroupsForItem: loadNamedFunction(itemEditorJs, "filterRequestedCheckGroupsForItem", {
        shouldKeepRequestedCheckGroupForItem: loadNamedFunction(itemEditorJs, "shouldKeepRequestedCheckGroupForItem", {
          isPlaceRequestedCheckItem,
          state: { item: { type: "place", category: "attractions" } },
        }),
        state: { item: { type: "place", category: "attractions" } },
      }),
      getRequestedCheckEditorGroups,
      buildRequestedChecksCompactSummaryData,
    }),
    renderRequestedChecksGuidanceHtml: loadNamedFunction(itemEditorJs, "renderRequestedChecksGuidanceHtml", {
      escapeHtml: (value) => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;"),
      renderRequestedCheckCompactRows,
      getRequestedCheckStatusBadge,
      toReviewList,
      hasRequestedCheckMeaningfulValue,
    }),
  }),
});

test("delete custom check removes it from saved payload instead of reviving existing state", () => {
  const existingState = {
    version: 1,
    groups: [
      {
        group_key: "custom",
        group_label: "Custom checks",
        checks: [
          {
            key: "parking_fee",
            requested: true,
            label: "Parking fee",
            instruction: "Confirm the latest parking fee",
            answer_type: "text",
            suggested_value: "Free for 2 hours",
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
        group_label: "CTA/contact",
        checks: [],
      },
      {
        group_key: "taxonomy",
        group_label: "Taxonomy",
        checks: [],
      },
      {
        group_key: "custom",
        group_label: "Custom checks",
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
        group_label: "CTA/contact",
        checks: [
          {
            key: "phone",
            requested: false,
            label: "Phone",
            instruction: "Request a real contact phone number",
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
        group_label: "CTA/contact",
        checks: [
          {
            key: "phone",
            requested: true,
            label: "Primary phone",
            instruction: "Confirm the latest phone number",
            answer_type: "phone",
            condition_prompt: "If there are multiple numbers, identify the primary one",
            evidence_required: false,
          },
        ],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, existingState);
  const phoneCheck = result.groups[0].checks[0];

  assert.equal(phoneCheck.requested, true);
  assert.equal(phoneCheck.label, "Primary phone");
  assert.equal(phoneCheck.instruction, "Confirm the latest phone number");
  assert.equal(phoneCheck.condition_prompt, "If there are multiple numbers, identify the primary one");
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
          { key: "phone", label: "Phone", requested: true },
          { key: "line_url", label: "LINE", requested: true },
          { key: "facebook_url", label: "Facebook", requested: false },
        ],
      },
      {
        group_key: "taxonomy",
        group_label: "Taxonomy",
        checks: [
          { key: "category", label: "Category", requested: true },
          { key: "tags", label: "tags", requested: true },
        ],
      },
      {
        group_key: "custom",
        group_label: "Custom",
        checks: [
          { key: "parking", label: "Parking", requested: true },
        ],
      },
    ],
  });

  assert.match(html, /CTA Review/);
  assert.match(html, /Phone/);
  assert.match(html, /LINE/);
  assert.match(html, /Suggested Focus/);
  assert.match(html, /Category/);
  assert.match(html, /tags/);
  assert.match(html, /Article context/);
  assert.match(html, /Parking/);
  assert.doesNotMatch(html, /workflow-badge workflow-badge-sent">Facebook/);
  assert.doesNotMatch(html, /Ã Â¸|Ã Â¹|à¹€à¸˜|à¹€à¸™â‚¬|ï¿½/);
});

test("requested-check preview shows clear empty state when nothing is selected", () => {
  const html = buildRequestedChecksPreviewHtml({
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/contact",
        checks: [
          { key: "phone", label: "Phone", requested: false },
        ],
      },
    ],
  });

  assert.match(html, /No suggested focus selected\./);
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
            label: "Phone",
            instruction: "Confirm phone number",
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
            label: "Category",
            instruction: "Confirm category",
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
            label: "Category",
            instruction: "Confirm category",
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
  assert.equal(ctaGroup.checks[0].label, "Phone");
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
            { key: "phone", requested: true, label: "Phone", instruction: "Confirm phone", answer_type: "phone" },
          ],
        },
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "Category", instruction: "Confirm category", answer_type: "text" },
          ],
        },
      ],
    },
  }, {
    type: "event",
  });

  const html = buildRequestedChecksPreviewHtml({ version: 1, groups });
  assert.match(html, /CTA Review/);
  assert.match(html, /Suggested Focus/);
  assert.match(html, /Category/);
  assert.doesNotMatch(html, /workflow-badge workflow-badge-sent">Phone/);
  assert.doesNotMatch(html, /Ã Â¸|Ã Â¹|à¹€à¸˜|à¹€à¸™â‚¬|ï¿½/);
});

test("duplicate custom keys are rejected before provenance can merge ambiguously", () => {
  const existingState = {
    version: 1,
    groups: [
      {
        group_key: "custom",
        group_label: "Custom checks",
        checks: [
          {
            key: "parking",
            requested: true,
            label: "Parking",
            instruction: "Confirm parking details",
            answer_type: "text",
            suggested_value: "Parking available",
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
        group_label: "Custom checks",
        checks: [
          {
            key: " parking ",
            requested: true,
            label: "Front parking",
            instruction: "Check the front parking area",
            answer_type: "text",
            condition_prompt: null,
            evidence_required: false,
          },
          {
            key: "parking",
            requested: false,
            label: "Rear parking",
            instruction: "Check the rear parking area",
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
        group_label: "Custom checks",
        checks: [
          {
            key: "parking",
            requested: true,
            label: "Parking",
            instruction: "Confirm parking details",
            answer_type: "text",
            suggested_value: "Parking available",
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
        group_label: "Custom checks",
        checks: [
          {
            key: "parking_capacity",
            requested: true,
            label: "Parking capacity",
            instruction: "Confirm parking capacity",
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
        group_label: "Custom checks",
        checks: [
          {
            key: "parking",
            requested: false,
            label: "Parking",
            instruction: "Confirm parking details",
            answer_type: "text",
            suggested_value: "Parking available",
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
        group_label: "Custom checks",
        checks: [
          {
            key: "parking",
            requested: true,
            label: "Parking details",
            instruction: "Confirm parking capacity and format",
            answer_type: "text",
            condition_prompt: "If there are multiple zones, separate them",
            evidence_required: true,
          },
        ],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, existingState);
  const customCheck = result.groups.find((group) => group.group_key === "custom")?.checks[0];

  assert.equal(customCheck?.requested, true);
  assert.equal(customCheck?.label, "Parking details");
  assert.equal(customCheck?.instruction, "Confirm parking capacity and format");
  assert.equal(customCheck?.condition_prompt, "If there are multiple zones, separate them");
  assert.equal(customCheck?.evidence_required, true);
  assert.equal(customCheck?.suggested_value, "Parking available");
  assert.deepEqual(customCheck?.source, { kind: "ai", confidence: "medium" });
});

test("built-in keys stay on template identity even if UI sends a changed key", () => {
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/contact",
        checks: [
          {
            key: "phone_number_override",
            requested: true,
            label: "Phone",
            instruction: "Request a real contact phone number",
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
        group_label: "Taxonomy",
        checks: [
          {
            key: "tags",
            requested: false,
            label: "Tags",
            instruction: "Check which tags should be added",
            answer_type: "multi_select",
            suggested_value: ["River view", "Cafe"],
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
        group_label: "Taxonomy",
        checks: [
          {
            key: "category",
            requested: false,
            label: "Category",
            instruction: "Confirm the primary category for the place",
            answer_type: "text",
            condition_prompt: null,
            evidence_required: false,
          },
          {
            key: "subtype",
            requested: false,
            label: "Subtype",
            instruction: "Confirm the most accurate subtype",
            answer_type: "text",
            condition_prompt: null,
            evidence_required: false,
          },
          {
            key: "tags",
            requested: false,
            label: "Tags",
            instruction: "Check which tags should be added",
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
  assert.deepEqual(tagsCheck?.suggested_value, ["River view", "Cafe"]);
});

test("group labels in saved payload come from stable defaults, not DOM summary text", () => {
  const uiState = {
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "Summary text that must not persist",
        checks: [
          {
            key: "phone",
            requested: true,
            label: "Phone",
            instruction: "Request a real contact phone number",
            answer_type: "phone",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, {});

  assert.equal(result.groups[0].group_label, getRequestedCheckDefaultGroupLabel("cta_contact"));
});

test("requested-check UI still does not expose editable provenance or suggested_value inputs", () => {
  assert.equal(itemEditorJs.includes('data-check-field="source"'), false);
  assert.equal(itemEditorJs.includes('data-check-field="suggested_value"'), false);
});

test("requested-check UI exposes compact CTA review and collapsed advanced editor affordance", () => {
  assert.match(itemEditorJs, /CTA Review/);
  assert.match(itemEditorJs, /Advanced edit requested checks/);
});

test("requested-check compact view is guidance-first and does not expose requested checkbox labels", () => {
  assert.match(itemEditorJs, /Suggested Focus/);
  assert.match(itemEditorJs, /Article context/);
  assert.match(itemEditorJs, /Focus\/context signal/);
});

test("compact CTA summary keeps missing and suggested fields visible with explicit statuses", () => {
  const groups = getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
    ai_cta_contact_json: {
      facebook_url: "https://facebook.com/example",
    },
    confirmed_cta_contact_json: {
      website_url: "https://example.com",
    },
  }, { type: "place" });

  const summary = buildRequestedChecksCompactSummaryData({
    ai_cta_contact_json: {
      facebook_url: "https://facebook.com/example",
    },
    confirmed_cta_contact_json: {
      website_url: "https://example.com",
    },
  }, groups, { type: "place" });

  const phoneRow = summary.ctaRows.find((row) => row.key === "phone");
  const facebookRow = summary.ctaRows.find((row) => row.key === "facebook_url");
  const websiteRow = summary.ctaRows.find((row) => row.key === "website_url");

  assert.deepEqual(phoneRow?.statuses, ["missing"]);
  assert.deepEqual(facebookRow?.statuses, ["ai filled", "needs verification"]);
  assert.deepEqual(websiteRow?.statuses, ["confirmed"]);
});

test("runtime preview renders ai_taxonomy_json-only taxonomy guidance and hides empty taxonomy message", () => {
  const html = buildRequestedChecksPreviewHtml({
    version: 1,
    groups: [],
  }, {
    ai_taxonomy_json: {
      parking: "street side",
      family_friendly: "yes",
    },
    requested_checks_json: { version: 1, groups: [] },
  });

  assert.match(html, /Curation Review/);
  assert.match(html, /Parking/);
  assert.match(html, /street side/);
  assert.match(html, /ai filled/i);
  assert.doesNotMatch(html, /No taxonomy review signals available/);
});

test("editor surface renders ai_taxonomy_json-only taxonomy guidance and hides empty taxonomy message", () => {
  const html = buildRequestedChecksEditorHtml({
    ai_taxonomy_json: {
      parking: "street side",
      family_friendly: "yes",
    },
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place" });

  assert.match(html, /Parking/);
  assert.match(html, /street side/);
  assert.match(html, /ai filled/i);
  assert.doesNotMatch(html, /No taxonomy review signals available/);
});

test("rendered compact guidance surface rejects mojibake", () => {
  const html = buildRequestedChecksEditorHtml({
    ai_taxonomy_json: {
      parking: "street side",
    },
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", label: "Category", requested: true, instruction: "Confirm category", answer_type: "text" },
          ],
        },
      ],
    },
  }, { type: "place", category: "attractions" });

  assert.match(html, /CTA Review/);
  assert.match(html, /AI Guidance/);
  assert.match(html, /Curation Review/);
  assert.match(html, /Suggested Focus/);
  assert.match(html, /Article context/);
  assert.doesNotMatch(html, /à¹€à¸˜|à¹€à¸™â‚¬|Ã Â¸|Ã Â¹|ï¿½/);
});

test("default item editor output avoids duplicate taxonomy review blocks", () => {
  const html = buildRequestedChecksEditorHtml({
    ai_taxonomy_json: {
      parking: "street side",
    },
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "attractions" });

  assert.equal((html.match(/Curation Review/g) || []).length, 1);
  assert.equal((html.match(/Taxonomy Review/g) || []).length, 0);
  assert.equal((html.match(/Taxonomy evidence/g) || []).length, 1);
});

test("taxonomy evidence area is collapsed and does not duplicate the row table title", () => {
  assert.match(itemEditorJs, /<summary>Taxonomy evidence<\/summary>/);
  assert.match(itemEditorHtml, /Taxonomy Evidence/);
  assert.doesNotMatch(itemEditorHtml, /<h2 class="section-title">Taxonomy Review<\/h2>/);
});

test("taxonomy guidance scopes configured rows for place items", () => {
  const summary = buildRequestedChecksCompactSummaryData({
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "attractions",
  }, getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "attractions" }), { type: "place", category: "attractions" });

  assert.ok(summary.taxonomyRows.some((row) => row.key === "parking"));
  assert.ok(summary.taxonomyRows.every((row) => row.key !== "hotel_amenities"));
  assert.ok(summary.taxonomyRows.every((row) => row.key !== "event_date_hints"));
});

test("taxonomy guidance scopes configured rows for event items", () => {
  const summary = buildRequestedChecksCompactSummaryData({
    requested_checks_json: { version: 1, groups: [] },
    content_type: "event",
    category: "events",
  }, getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "event", category: "events" }), { type: "event", category: "events" });

  assert.ok(summary.taxonomyRows.some((row) => row.key === "event_date_hints"));
});

test("explicit ai_taxonomy_json keys still render outside seeded config scope", () => {
  const summary = buildRequestedChecksCompactSummaryData({
    ai_taxonomy_json: {
      hotel_amenities: ["pool"],
    },
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "attractions",
  }, getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "attractions" }), { type: "place", category: "attractions" });

  const hotelRow = summary.taxonomyRows.find((row) => row.key === "hotel_amenities");
  assert.equal(hotelRow?.value, "pool");
  assert.deepEqual(hotelRow?.statuses, ["ai filled", "needs verification"]);
});

test("compact taxonomy summary keeps unknown and needs-verification rows visible", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    verification: {
      needs_verification: ["parking"],
      publish_blockers: [],
    },
    practical_profile: {
      parking: "unknown",
      family_friendly: "unknown",
    },
    place_profile: {
      photo_spots: ["river corner"],
    },
  });
  const groups = getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
    writer_notes: writerNotes,
  }, { type: "place" });

  const summary = buildRequestedChecksCompactSummaryData({
    requested_checks_json: { version: 1, groups: [] },
    writer_notes: writerNotes,
  }, groups, { type: "place" });

  const parkingRow = summary.taxonomyRows.find((row) => row.label === "Parking");
  const familyRow = summary.taxonomyRows.find((row) => row.label === "Family Friendly");
  const photoRow = summary.taxonomyRows.find((row) => row.label === "Photo Spots");

  assert.deepEqual(parkingRow?.statuses, ["unknown", "needs verification"]);
  assert.deepEqual(familyRow?.statuses, ["unknown"]);
  assert.deepEqual(photoRow?.statuses, ["suggested"]);
});

test("contract enrichment takes priority over ai_taxonomy_json suggestions", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    verification: {
      needs_verification: ["parking"],
      publish_blockers: [],
    },
    practical_profile: {
      parking: "covered lot",
    },
  });
  const groups = getRequestedCheckEditorGroups({
    ai_taxonomy_json: { parking: "street side" },
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place" });

  const summary = buildRequestedChecksCompactSummaryData({
    ai_taxonomy_json: { parking: "street side" },
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
  }, groups, { type: "place" });

  const parkingRow = summary.taxonomyRows.find((row) => row.key === "parking");
  assert.equal(parkingRow?.value, "covered lot");
  assert.deepEqual(parkingRow?.statuses, ["suggested", "needs verification"]);
});

test("verified fact signals safely match taxonomy rows by label prefix", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    verification: {
      verified_facts: ["Parking: available"],
      needs_verification: [],
      publish_blockers: [],
    },
    practical_profile: {
      parking: "available",
    },
  });
  const summary = buildRequestedChecksCompactSummaryData({
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "attractions",
  }, getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
    writer_notes: writerNotes,
  }, { type: "place", category: "attractions" }), { type: "place", category: "attractions" });

  const parkingRow = summary.taxonomyRows.find((row) => row.key === "parking");
  assert.equal(parkingRow?.value, "available");
  assert.deepEqual(parkingRow?.statuses, ["found", "verified"]);
});

test("unmatched verified facts do not mark unrelated taxonomy rows verified", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    verification: {
      verified_facts: ["name: Abe Specialty Coffee"],
      needs_verification: [],
      publish_blockers: [],
    },
    practical_profile: {
      parking: "available",
    },
  });
  const summary = buildRequestedChecksCompactSummaryData({
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "cafes",
  }, getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
    writer_notes: writerNotes,
  }, { type: "place", category: "cafes" }), { type: "place", category: "cafes" });

  const parkingRow = summary.taxonomyRows.find((row) => row.key === "parking");
  assert.deepEqual(parkingRow?.statuses, ["suggested"]);
  assert.ok(summary.taxonomyEvidence?.unmatchedVerifiedFacts.some((hint) => hint.includes("Abe Specialty Coffee")));
});

test("runtime preview keeps unmatched verified facts in taxonomy review", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    verification: {
      verified_facts: ["name: Abe Specialty Coffee"],
      needs_verification: [],
      publish_blockers: [],
    },
    practical_profile: {
      parking: "available",
    },
  });
  const html = buildRequestedChecksPreviewHtml({
    version: 1,
    groups: [],
  }, {
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "cafes",
  });

  assert.match(html, /Taxonomy evidence/);
  assert.match(html, /Unmatched verified facts/);
  assert.match(html, /name: Abe Specialty Coffee/);
  assert.doesNotMatch(html, /found verified[^]*Parking/i);
});

test("field return taxonomy evidence stays visible and takes priority", () => {
  const groups = getRequestedCheckEditorGroups({
    ai_taxonomy_json: { category: "cafe" },
    field_return_payload_json: {
      taxonomy_return: {
        category: { checked: true, found: true, value: "restaurant" },
      },
    },
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place" });

  const summary = buildRequestedChecksCompactSummaryData({
    ai_taxonomy_json: { category: "cafe" },
    field_return_payload_json: {
      taxonomy_return: {
        category: { checked: true, found: true, value: "restaurant" },
      },
    },
    requested_checks_json: { version: 1, groups: [] },
  }, groups, { type: "place" });

  const categoryRow = summary.taxonomyRows.find((row) => row.key === "category");
  assert.equal(categoryRow?.value, "restaurant");
  assert.deepEqual(categoryRow?.statuses, ["found"]);
});

test("runtime preview merges ai taxonomy writer notes and field return by priority", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    verification: {
      needs_verification: ["parking"],
      publish_blockers: [],
    },
    practical_profile: {
      parking: "covered lot",
    },
  });
  const html = buildRequestedChecksPreviewHtml({
    version: 1,
    groups: [],
  }, {
    ai_taxonomy_json: { parking: "street side" },
    writer_notes: writerNotes,
    field_return_payload_json: {
      taxonomy_return: {
        parking: { checked: true, found: true, value: "garage" },
      },
    },
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "attractions",
  });

  const parkingRowHtml = extractCompactSummaryRow(html, "Parking");
  assert.match(parkingRowHtml, /Parking/);
  assert.match(parkingRowHtml, /garage/);
  assert.doesNotMatch(parkingRowHtml, /covered lot/);
  assert.doesNotMatch(parkingRowHtml, /street side/);
  assert.match(html, /covered lot/);
});

test("runtime preview still renders selected requested-check focus", () => {
  const html = buildRequestedChecksPreviewHtml({
    version: 1,
    groups: [
      {
        group_key: "taxonomy",
        group_label: "Taxonomy",
        checks: [
          { key: "parking", label: "Parking", requested: true },
        ],
      },
    ],
  });

  assert.match(html, /Parking/);
});

test("default requested-check view stays read-only until advanced edit section", () => {
  const html = buildRequestedChecksEditorHtml({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place" });

  const advancedIndex = html.indexOf("Advanced edit requested checks");
  const firstEditableRequestedIndex = html.indexOf('data-check-field="requested"');

  assert.notEqual(advancedIndex, -1);
  assert.notEqual(firstEditableRequestedIndex, -1);
  assert.ok(firstEditableRequestedIndex > advancedIndex);
});

test("non-place editor renders CTA place-only note exactly once", () => {
  const html = buildRequestedChecksEditorHtml({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "event" });

  const noteMatches = html.match(/CTA Review applies to place items only\./g) || [];
  assert.equal(noteMatches.length, 1);
});

test("non-place default compact view does not render CTA/contact editable controls", () => {
  const html = buildRequestedChecksEditorHtml({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "event" });

  const advancedIndex = html.indexOf("Advanced edit requested checks");
  const ctaGroupIndex = html.indexOf('data-requested-group="cta_contact"');
  const firstEditableRequestedIndex = html.indexOf('data-check-field="requested"');

  assert.equal(ctaGroupIndex, -1);
  assert.notEqual(advancedIndex, -1);
  assert.notEqual(firstEditableRequestedIndex, -1);
  assert.ok(firstEditableRequestedIndex > advancedIndex);
});

test("place item editor still renders CTA Review compact rows", () => {
  const html = buildRequestedChecksEditorHtml({
    ai_cta_contact_json: {
      website_url: "https://example.com",
    },
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place" });

  assert.match(html, /CTA Review/);
  assert.match(html, /https:\/\/example\.com/);
  assert.match(html, /ai filled/);
});

test("compact CTA review renders English fallback labels in default view", () => {
  const html = buildRequestedChecksEditorHtml({
    ai_cta_contact_json: {
      phone: "0812345678",
      line_url: "https://line.me/example",
      facebook_url: "https://facebook.com/example",
      website_url: "https://example.com",
      primary_cta: "map",
    },
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "attractions" });
  const guidanceHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "CTA Review");

  assert.match(guidanceHtml, /Phone/);
  assert.match(guidanceHtml, /LINE URL/);
  assert.match(guidanceHtml, /Facebook URL/);
  assert.match(guidanceHtml, /Website URL/);
  assert.match(guidanceHtml, /Primary CTA/);
});

test("compact CTA review default view does not render Thai CTA labels", () => {
  const html = buildRequestedChecksEditorHtml({
    ai_cta_contact_json: {
      phone: "0812345678",
    },
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "attractions" });
  const guidanceHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "CTA Review");

  assert.doesNotMatch(guidanceHtml, /เบอร์โทร|ลิงก์ LINE|ลิงก์ Facebook|ลิงก์เว็บไซต์|CTA หลัก/);
});

test("advanced requested-check editor is collapsed by default and contains editable controls", () => {
  const html = buildRequestedChecksEditorHtml({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place" });

  assert.match(html, /<details class="secondary-panel">\s*<summary>Advanced edit requested checks<\/summary>/);
  assert.match(html, /data-check-field="requested"/);
  assert.match(html, /data-check-field="instruction"/);
});

test("buildRequestedChecksHandoffPayload omits requested_checks when nothing is selected", () => {
  const result = buildRequestedChecksHandoffPayload({
    version: 1,
    groups: [
      {
        group_key: "cta_contact",
        group_label: "CTA/contact",
        checks: [
          { key: "phone", requested: false },
        ],
      },
    ],
  });

  assert.equal(result, null);
});
