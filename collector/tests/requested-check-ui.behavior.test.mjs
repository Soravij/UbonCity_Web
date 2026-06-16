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
const normalizeRequestedCheckCandidate = loadNamedFunction(itemEditorJs, "normalizeRequestedCheckCandidate", {
  hasRequestedCheckMeaningfulValue,
});
const parseFieldPackContractFromWriterNotes = loadNamedFunction(itemEditorJs, "parseFieldPackContractFromWriterNotes");
const getGuidanceSourceObjects = loadNamedFunction(itemEditorJs, "getGuidanceSourceObjects", {
  state: { item: { type: "place", category: "attractions" } },
  parseFieldPackContractFromWriterNotes,
});
const readGuidanceAliasValue = loadNamedFunction(itemEditorJs, "readGuidanceAliasValue");
const normalizeGuidanceDisplayValue = loadNamedFunction(itemEditorJs, "normalizeGuidanceDisplayValue");
const extractVerifiedFactValue = loadNamedFunction(itemEditorJs, "extractVerifiedFactValue");
const extractThaiPhoneCandidate = loadNamedFunction(itemEditorJs, "extractThaiPhoneCandidate");
const collectGuidanceReferenceUrls = loadNamedFunction(itemEditorJs, "collectGuidanceReferenceUrls");
const buildRequestedCheckStatusRow = loadNamedFunction(itemEditorJs, "buildRequestedCheckStatusRow", {
  hasRequestedCheckMeaningfulValue,
  formatRequestedCheckSuggestedValue: (value) => {
    if (Array.isArray(value)) return value.join(", ");
    return value == null ? "" : String(value);
  },
});
const resolveGuidanceRowValue = loadNamedFunction(itemEditorJs, "resolveGuidanceRowValue", {
  state: { item: { type: "place", category: "attractions" } },
  taxonomyFieldLabel: (key) => String(key || ""),
  normalizeRequestedCheckCandidate,
  hasRequestedCheckMeaningfulValue,
  normalizeGuidanceDisplayValue,
  extractVerifiedFactValue,
  buildRequestedCheckStatusRow,
});
const extractRequestedCheckArticleContextHints = loadNamedFunction(itemEditorJs, "extractRequestedCheckArticleContextHints");
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
  normalizeRequestedCheckCandidate,
  getGuidanceSourceObjects,
  readGuidanceAliasValue,
  normalizeGuidanceDisplayValue,
  extractThaiPhoneCandidate,
  collectGuidanceReferenceUrls,
  resolveGuidanceRowValue,
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
    getGuidanceSourceObjects,
    readGuidanceAliasValue,
    normalizeGuidanceDisplayValue,
    collectGuidanceReferenceUrls,
    resolveGuidanceRowValue,
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
const buildFieldPackApiPayload = loadNamedFunction(itemEditorJs, "buildFieldPackApiPayload", {
  state: {
    fieldPack: {
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "taxonomy",
            group_label: "Taxonomy",
            checks: [
              { key: "parking", label: "Parking", requested: true, instruction: "verify parking", answer_type: "text" },
            ],
          },
        ],
      },
    },
  },
  readFieldPackFormState: () => ({
    id: 1,
    status: "draft",
    writer_ready: false,
    ai_summary: "",
    ai_highlights: [],
    ai_unknowns: [],
    editor_summary: "",
    verified_facts: [],
    uncertain_facts: [],
    story_angle: "",
    field_notes: "",
    must_verify_facts: [],
    must_capture_items: [],
    must_capture_shots: [],
    must_ask_questions: [],
    social_hook: "",
    social_shot_emphasis: [],
    social_on_camera_points: [],
    social_caption_angle: "",
    requested_checks_json: { version: 1, groups: [] },
    references_text: "",
    writer_references_text: "",
    external_media_hints_text: "",
    selected_media_hints: [],
    rendered_content_asset_ids: [],
    field_assignment: {},
    writer_assignment: {},
  }),
  buildFieldPackTopLevelPayload: loadNamedFunction(itemEditorJs, "buildFieldPackTopLevelPayload"),
  buildFieldPackChecklistPayload: () => [],
  buildFieldPackReferencePayload: () => [],
  buildFieldPackMediaHintPayload: () => [],
  buildFieldPackAssignmentPayload: () => [],
  mergeRequestedChecksForSave,
  buildRequestedChecksEditorState,
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
  assert.match(itemEditorJs, /Field Pack Guidance/);
  assert.match(itemEditorJs, /Source details/);
});

test("requested-check compact view is guidance-first and does not expose requested checkbox labels", () => {
  assert.match(itemEditorJs, /Suggested Focus/);
  assert.match(itemEditorJs, /Article context/);
  assert.doesNotMatch(itemEditorJs, /Focus\/context signal/);
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

test("CTA review resolves phone from clean source aliases before marking missing", () => {
  const summary = buildRequestedChecksCompactSummaryData({
    publishable_source: {
      national_phone_number: "096-3435931",
    },
    requested_checks_json: { version: 1, groups: [] },
  }, getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" }), { type: "place", category: "restaurants" });

  const phoneRow = summary.ctaRows.find((row) => row.key === "phone");
  assert.equal(phoneRow?.value, "096-3435931");
  assert.doesNotMatch(phoneRow?.value || "", /No value/i);
  assert.ok(!phoneRow?.statuses.includes("missing"));
});

test("curation review resolves category from clean source data", () => {
  const summary = buildRequestedChecksCompactSummaryData({
    publishable_source: {
      category: "restaurants",
    },
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "attractions",
  }, getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "attractions" }), { type: "place", category: "attractions" });

  const categoryRow = summary.taxonomyRows.find((row) => row.key === "category");
  assert.equal(categoryRow?.value, "restaurants");
  assert.ok(!categoryRow?.statuses.includes("unknown"));
});

test("curation review formats opening hours from clean source fields into readable text", () => {
  const html = buildRequestedChecksEditorHtml({
    publishable_source: {
      open_now: true,
      opening_hours_weekday_text: ["Mon: 10:30-1:00", "Tue: 10:30-1:00"],
    },
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "restaurants",
  }, { type: "place", category: "restaurants" });
  const curationHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "Curation Review");

  assert.match(curationHtml, /Opening Hours Note/);
  assert.match(curationHtml, /Open now: yes/);
  assert.match(curationHtml, /Mon: 10:30-1:00/);
  assert.doesNotMatch(curationHtml, /\[.*Mon: 10:30-1:00.*\]/);
});

test("curation review normalizes nearby arrays from clean source without raw brackets", () => {
  const html = buildRequestedChecksEditorHtml({
    publishable_source: {
      nearby_landmarks: ["See photos and videos taken at this location"],
    },
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "restaurants",
  }, { type: "place", category: "restaurants" });
  const curationHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "Curation Review");

  assert.match(curationHtml, /See photos and videos taken at this location/);
  assert.doesNotMatch(curationHtml, /\["See photos and videos taken at this location"\]/);
});

test("unknown clean-source confidence does not get ai filled badge", () => {
  const html = buildRequestedChecksEditorHtml({
    publishable_source: {
      confidence: "unknown",
    },
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "restaurants",
  }, { type: "place", category: "restaurants" });
  const curationHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "Curation Review");
  const confidenceRow = extractCompactSummaryRow(curationHtml, "Confidence");

  assert.match(confidenceRow, /No value|unknown/i);
  assert.doesNotMatch(confidenceRow, /ai filled/i);
});

test("default guidance only shows No value when all accepted CTA sources are empty", () => {
  const html = buildRequestedChecksEditorHtml({
    publishable_source: {
      phone: "096-3435931",
      website_url: "https://example.com",
    },
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" });
  const ctaHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "CTA Review");
  const phoneRow = extractCompactSummaryRow(ctaHtml, "Phone");
  const websiteRow = extractCompactSummaryRow(ctaHtml, "Website URL");

  assert.doesNotMatch(phoneRow, /No value/i);
  assert.doesNotMatch(websiteRow, /No value/i);
});

test("category resolves from item.category and writer_notes core factual fields when ai taxonomy is null", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    core_factual_fields: {
      category: "restaurants",
    },
  });
  const html = buildRequestedChecksEditorHtml({
    ai_taxonomy_json: { category: null },
    curated_taxonomy_json: {
      category: { checked: false, found: false, value: null },
    },
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" });
  const curationHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "Curation Review");
  const categoryRow = extractCompactSummaryRow(curationHtml, "Category");

  assert.match(categoryRow, /restaurants/);
  assert.doesNotMatch(categoryRow, /No value/i);
});

test("facebook reference URL maps into CTA review when ai and curated shells are empty", () => {
  const html = buildRequestedChecksEditorHtml({
    ai_cta_contact_json: {
      phone: null,
      facebook_url: null,
      website_url: null,
    },
    curated_cta_contact_json: {
      phone: { checked: false, found: false, value: null },
      facebook_url: { checked: false, found: false, value: null },
      website_url: { checked: false, found: false, value: null },
    },
    references: [
      { label: "Facebook", url: "https://facebook.com/FuPanich", source_family: "facebook" },
      { label: "Google Maps", url: "https://maps.google.com/?cid=123", source_family: "google_maps" },
      { label: "Wongnai", url: "https://www.wongnai.com/restaurants/fupanich", source_family: "wongnai" },
    ],
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" });
  const ctaHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "CTA Review");
  const facebookRow = extractCompactSummaryRow(ctaHtml, "Facebook URL");
  const primaryCtaRow = extractCompactSummaryRow(ctaHtml, "Primary CTA");

  assert.match(facebookRow, /facebook\.com\/FuPanich/);
  assert.doesNotMatch(facebookRow, /No value/i);
  assert.match(primaryCtaRow, /map/i);
});

test("phone fallback only maps from verified facts when a thai phone pattern is present", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    verification: {
      verified_facts: ["phone: 096-3435931"],
    },
  });
  const html = buildRequestedChecksEditorHtml({
    ai_cta_contact_json: {
      phone: null,
    },
    curated_cta_contact_json: {
      phone: { checked: false, found: false, value: null },
    },
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" });
  const ctaHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "CTA Review");
  const phoneRow = extractCompactSummaryRow(ctaHtml, "Phone");

  assert.match(phoneRow, /096-3435931/);
  assert.doesNotMatch(phoneRow, /No value/i);
});

test("opening hours note stays missing when writer_notes contract has no hours data", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    core_factual_fields: {
      category: "restaurants",
    },
  });
  const html = buildRequestedChecksEditorHtml({
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" });
  const curationHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "Curation Review");
  const openingHoursRow = extractCompactSummaryRow(curationHtml, "Opening Hours Note");

  assert.match(openingHoursRow, /No value/i);
});

test("default item editor surface renders CTA and Curation guidance only once", () => {
  const html = buildRequestedChecksEditorHtml({
    references: [
      { label: "Facebook", url: "https://facebook.com/FuPanich", source_family: "facebook" },
    ],
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" });

  assert.equal((html.match(/CTA Review/g) || []).length, 1);
  assert.equal((html.match(/Curation Review/g) || []).length, 1);
  assert.equal((html.match(/<strong>Phone<\/strong>/g) || []).length, 1);
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
  assert.match(html, /Field Pack Guidance/);
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
  assert.equal((html.match(/Taxonomy evidence/g) || []).length, 0);
});

test("taxonomy evidence area is collapsed and does not duplicate the row table title", () => {
  assert.match(itemEditorJs, /<summary>Source details<\/summary>/);
  assert.doesNotMatch(itemEditorHtml, /Taxonomy Evidence/);
  assert.doesNotMatch(itemEditorHtml, /<h2 class="section-title">Taxonomy Review<\/h2>/);
});

test("item editor removes stale standalone taxonomy and contract panel wiring", () => {
  assert.doesNotMatch(itemEditorJs, /renderFieldPackContractPanel\(\)/);
  assert.doesNotMatch(itemEditorJs, /renderTaxonomyReviewPanel\(\)/);
  assert.doesNotMatch(itemEditorJs, /function renderFieldPackContractPanel/);
  assert.doesNotMatch(itemEditorJs, /function renderTaxonomyReviewPanel/);
});

test("item editor default guidance does not render taxonomy evidence block", () => {
  const html = buildRequestedChecksEditorHtml({
    ai_taxonomy_json: { parking: "street side" },
    writer_notes: JSON.stringify({
      contract_version: "1",
      taxonomy_version: "page_curation_taxonomy_v1",
      verification: {
        verified_facts: ["Parking: street side"],
        needs_verification: ["parking"],
        publish_blockers: [],
      },
    }),
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "attractions" });
  const guidanceHtml = extractDefaultGuidanceHtml(html);

  assert.doesNotMatch(guidanceHtml, /Taxonomy evidence/);
  assert.doesNotMatch(guidanceHtml, /Verified facts/);
  assert.doesNotMatch(guidanceHtml, /Unmatched verified facts/);
});

test("taxonomy guidance scopes configured rows for place items", () => {
  const summary = buildRequestedChecksCompactSummaryData({
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "attractions",
  }, getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "attractions" }), { type: "place", category: "attractions" });

  assert.equal(summary.taxonomyRows.length, 0);
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

  assert.equal(summary.taxonomyRows.length, 0);
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

test("runtime preview keeps unmatched verified facts only in source details debug JSON", () => {
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

  assert.match(html, /Source details/);
  assert.match(html, /Debug JSON/);
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

test("item editor guidance does not render advanced requested-check editor controls", () => {
  const html = buildRequestedChecksEditorHtml({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place" });

  assert.doesNotMatch(html, /Advanced edit requested checks/);
  assert.doesNotMatch(html, /data-check-field="requested"/);
  assert.doesNotMatch(html, /data-check-field="instruction"/);
  assert.doesNotMatch(html, /Add custom check/);
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

  const ctaGroupIndex = html.indexOf('data-requested-group="cta_contact"');
  const firstEditableRequestedIndex = html.indexOf('data-check-field="requested"');

  assert.equal(ctaGroupIndex, -1);
  assert.equal(firstEditableRequestedIndex, -1);
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

test("CTA review normalizes object-shaped values instead of dumping raw JSON", () => {
  const html = buildRequestedChecksEditorHtml({
    ai_cta_contact_json: {
      phone: { checked: false, found: false, value: null },
      website_url: { checked: true, found: true, value: "https://example.com" },
      facebook_url: { checked: true, found: true, value: null },
    },
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "attractions" });
  const ctaHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "CTA Review");

  assert.match(ctaHtml, /https:\/\/example\.com/);
  assert.match(ctaHtml, /found/i);
  assert.doesNotMatch(ctaHtml, /\{"checked":false,"found":false,"value":null\}/);
  assert.doesNotMatch(ctaHtml, /\{"checked":true,"found":true,"value":"https:\/\/example\.com"\}/);
});

test("curation review renders ai-filled values directly without seeding a giant unknown table", () => {
  const html = buildRequestedChecksEditorHtml({
    ai_taxonomy_json: {
      category: "restaurants",
      opening_hours_note: "Open now: yes",
      nearby: "See photos and videos taken at this location",
    },
    requested_checks_json: { version: 1, groups: [] },
    content_type: "place",
    category: "attractions",
  }, { type: "place", category: "attractions" });
  const curationHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "Curation Review");

  assert.match(curationHtml, /restaurants/);
  assert.match(curationHtml, /Open now: yes/);
  assert.match(curationHtml, /See photos and videos taken at this location/);
  assert.match(curationHtml, /ai filled/i);
  assert.ok((curationHtml.match(/class="summary-row"/g) || []).length <= 8);
});

test("item editor guidance removes old handoff wording", () => {
  const html = buildRequestedChecksEditorHtml({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place" });
  const guidanceHtml = extractDefaultGuidanceHtml(html);

  assert.doesNotMatch(guidanceHtml, /Will ask worker|Handoff selected|Only selected checks will be sent/i);
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

test("buildFieldPackApiPayload preserves existing requested_checks_json when item editor has no requested-check DOM", () => {
  const result = buildFieldPackApiPayload();

  assert.deepEqual(result.requested_checks_json, {
    version: 1,
    groups: [
      {
        group_key: "taxonomy",
        group_label: "Taxonomy",
        checks: [
          { key: "parking", label: "Parking", requested: true, instruction: "verify parking", answer_type: "text" },
        ],
      },
    ],
  });
});
