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

function extractTemplateRequestedChecksCard(html) {
  const source = String(html);
  const marker = 'id="fp-requested-checks-editor"';
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, "requested checks editor container should exist in template");
  return source.slice(Math.max(0, index - 500), Math.min(source.length, index + 500));
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
let requestedChecksEditorRoot = null;
const readRequestedChecksEditorState = loadNamedFunction(itemEditorJs, "readRequestedChecksEditorState", {
  qs: (id) => (id === "fp-requested-checks-editor" ? requestedChecksEditorRoot : null),
  getRequestedCheckDefaultGroupLabel,
});
const hasRequestedCheckMeaningfulValue = loadNamedFunction(itemEditorJs, "hasRequestedCheckMeaningfulValue");
const buildRequestedChecksEditorState = loadNamedFunction(itemEditorJs, "buildRequestedChecksEditorState", {
  REQUESTED_CHECK_GROUP_TEMPLATES,
  hasRequestedCheckMeaningfulValue,
  state: { item: { type: "place" } },
});
const isPlaceRequestedCheckItem = loadNamedFunction(itemEditorJs, "isPlaceRequestedCheckItem", {
  state: { item: { type: "place" } },
});
const shouldKeepRequestedCheckGroupForItem = loadNamedFunction(itemEditorJs, "shouldKeepRequestedCheckGroupForItem", {
  isPlaceRequestedCheckItem,
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
const truncateRequestedGuidanceValue = loadNamedFunction(itemEditorJs, "truncateRequestedGuidanceValue");
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
const buildRequestedChecksAutoSaveState = loadNamedFunction(itemEditorJs, "buildRequestedChecksAutoSaveState", {
  REQUESTED_CHECK_GROUP_TEMPLATES,
  parseFieldPackContractFromWriterNotes,
  toReviewList,
  normalizeRequestedCheckKey,
  shouldKeepRequestedCheckGroupForItem,
  hasRequestedCheckMeaningfulValue,
  state: { item: { type: "place" } },
});
const mergeRequestedChecksAutoAndManualState = loadNamedFunction(itemEditorJs, "mergeRequestedChecksAutoAndManualState", {
  REQUESTED_CHECK_GROUP_TEMPLATES,
  state: { item: { type: "place" } },
});
const requestedChecksEditorBaselineState = { value: null };
const getRequestedChecksEditorBaselineState = (fieldPack = {}) => {
  return requestedChecksEditorBaselineState.value || buildRequestedChecksEditorState(fieldPack);
};
const setRequestedChecksEditorBaselineState = (nextState = null) => {
  requestedChecksEditorBaselineState.value = nextState && typeof nextState === "object" ? nextState : null;
};
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
  resolveItemGuidanceScope,
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
  truncateRequestedGuidanceValue,
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
const buildFieldPackApiPayloadState = {
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
    ai_cta_contact_json: {
      phone: "0812345678",
      confidence: "high",
    },
    ai_taxonomy_json: {
      category: "attractions",
      confidence: "medium",
    },
    writer_notes: JSON.stringify({
      contract_version: "1",
      taxonomy_version: "page_curation_taxonomy_v1",
      verification: {
        needs_verification: ["parking"],
        publish_blockers: [],
      },
      checklists: {
        missing_data: ["phone"],
      },
    }),
  },
};
const buildFieldPackApiPayload = loadNamedFunction(itemEditorJs, "buildFieldPackApiPayload", {
  state: buildFieldPackApiPayloadState,
  qs: (id) => (id === "fp-requested-checks-editor" ? requestedChecksEditorRoot : null),
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
  buildRequestedChecksAutoSaveState,
  readRequestedChecksEditorState,
  mergeRequestedChecksForSave,
  mergeRequestedChecksAutoAndManualState,
  getRequestedChecksEditorBaselineState,
  setRequestedChecksEditorBaselineState,
  buildRequestedChecksEditorState,
});

function createRequestedChecksEditorRowNode(check) {
  const fields = {
    answer_type: { value: check.answer_type ?? "text" },
    key: { value: check.key ?? "" },
    requested: { checked: check.requested === true },
    label: { value: check.label ?? "" },
    instruction: { value: check.instruction ?? "" },
    condition_prompt: { value: check.condition_prompt ?? "" },
    evidence_required: { checked: check.evidence_required === true },
  };
  return {
    querySelector(selector) {
      const match = String(selector).match(/data-check-field='([^']+)'/);
      return match ? fields[match[1]] || null : null;
    },
  };
}

function createRequestedChecksEditorGroupNode(groupKey, checks) {
  const rowNodes = checks.map((check) => createRequestedChecksEditorRowNode(check));
  return {
    getAttribute(name) {
      return name === "data-requested-group" ? groupKey : null;
    },
    querySelectorAll(selector) {
      return selector === "[data-requested-check-row]" ? rowNodes : [];
    },
  };
}

function createRequestedChecksEditorRoot(groups) {
  const groupNodes = groups.map((group) => createRequestedChecksEditorGroupNode(group.groupKey, group.checks));
  return {
    querySelectorAll(selector) {
      return selector === "[data-requested-group]" ? groupNodes : [];
    },
  };
}

function setBuildFieldPackApiPayloadState(fieldPack) {
  buildFieldPackApiPayloadState.fieldPack = fieldPack;
}

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

  assert.ok(ctaGroup);
  assert.deepEqual(
    ctaGroup.checks.map((check) => check.key),
    ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]
  );
  // No "taxonomy" group: category/subtype/tags are reserved metadata keys
  // (PROJECT_POLICY.md 7A), not editable Curation questions.
  assert.equal(groups.some((group) => group.group_key === "taxonomy"), false);
});

test("requested-check editor hides CTA templates for non-place items", () => {
  const groups = getRequestedCheckEditorGroups({
    requested_checks_json: { version: 1, groups: [] },
  }, {
    type: "event",
  });

  assert.equal(groups.some((group) => group.group_key === "cta_contact"), false);
  assert.equal(groups.some((group) => group.group_key === "taxonomy"), false);
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

  assert.equal(ctaPhone?.requested, false);
  assert.equal(ctaPhone?.suggested_value, "0812345678");
  // ai_taxonomy_json suggestions must not resurrect a "taxonomy" requested-check group.
  assert.equal(groups.some((group) => group.group_key === "taxonomy"), false);
});

test("buildRequestedChecksEditorState prefers current AI suggestions over stale saved values", () => {
  const result = buildRequestedChecksEditorState({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            {
              key: "phone",
              requested: false,
              label: "Stale phone",
              instruction: "stale",
              answer_type: "phone",
              suggested_value: "0999999999",
              condition_prompt: null,
              evidence_required: false,
            },
          ],
        },
      ],
    },
    ai_cta_contact_json: {
      phone: "0812345678",
      confidence: "high",
    },
    ai_taxonomy_json: {},
  });

  const phoneCheck = result.groups
    .find((group) => group.group_key === "cta_contact")
    ?.checks.find((check) => check.key === "phone");

  assert.equal(phoneCheck?.suggested_value, "0812345678");
  assert.deepEqual(phoneCheck?.source, { kind: "ai", confidence: "high", note: null });
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
    ],
  };
  const uiState = {
    version: 1,
    groups: [
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
          group_key: "custom",
          group_label: "Custom",
          checks: [
            { key: "parking", requested: true, label: "Parking", instruction: "Confirm parking", answer_type: "text" },
          ],
        },
      ],
    },
  }, {
    type: "event",
  });

  const html = buildRequestedChecksPreviewHtml({ version: 1, groups });
  assert.match(html, /CTA Review/);
  assert.match(html, /Article context/);
  assert.match(html, /Parking/);
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
        group_key: "custom",
        group_label: "Custom",
        checks: [
          {
            key: "amenities",
            requested: false,
            label: "Amenities",
            instruction: "Check which amenities should be added",
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
        group_key: "custom",
        group_label: "Custom",
        checks: [
          {
            key: "amenities",
            requested: false,
            label: "Amenities",
            instruction: "Check which amenities should be added",
            answer_type: "multi_select",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  };

  const result = mergeRequestedChecksForSave(uiState, existingState);
  const customGroup = result.groups.find((group) => group.group_key === "custom");
  const amenitiesCheck = customGroup?.checks.find((check) => check.key === "amenities");

  assert.equal(amenitiesCheck?.requested, false);
  assert.deepEqual(amenitiesCheck?.suggested_value, ["River view", "Cafe"]);
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

test("requested-check UI has no way to create a new custom group or custom_N key", () => {
  assert.equal(itemEditorJs.includes('"add-requested-check"'), false);
  assert.equal(itemEditorJs.includes('group_key: "custom", group_label: "เช็กเพิ่ม", checks: [] })'), false);
});

test("requested-check group templates never define category/subtype/tags as editable checks", () => {
  const templateKeys = REQUESTED_CHECK_GROUP_TEMPLATES.flatMap((group) => group.checks.map((check) => check.key));
  assert.equal(REQUESTED_CHECK_GROUP_TEMPLATES.some((group) => group.group_key === "taxonomy"), false);
  assert.equal(templateKeys.includes("category"), false);
  assert.equal(templateKeys.includes("subtype"), false);
  assert.equal(templateKeys.includes("tags"), false);
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
  assert.doesNotMatch(curationHtml, /Confidence/);
  assert.doesNotMatch(curationHtml, /ai filled/i);
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
  assert.match(curationHtml, /<strong>Category<\/strong>[^]*restaurants/);
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
  assert.match(curationHtml, /Opening Hours Note/);
  assert.match(curationHtml, /Opening Hours Note[^]*No value/i);
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

test("default curation review keeps restaurant unresolved whitelist and hides metadata dump rows", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    core_factual_fields: {
      title: "Fu Panich",
      type: "place",
      category: "restaurants",
      slug: "fu-panich",
      map_url: "https://maps.google.com/?cid=123",
      google_place_id: "place-123",
      source_url: "https://example.com",
      latitude: "15.1",
      longitude: "104.8",
    },
    universal_curation_profile: {
      nearby: ["See photos and videos taken at this location for access cues and surrounding area context"],
      local_notes: "Long local note that should stay out of default review when it is only context.",
    },
    practical_profile: {
      opening_hours_note: "Open now: yes",
      parking: "unknown",
      pet_friendly: "unknown",
      family_friendly: "unknown",
      accessibility: "unknown",
      price_range: "unknown",
    },
    restaurant_profile: {
      signature_menu: "unknown",
      price_signals: "unknown",
      service_style: "unknown",
      cuisine_type: "unknown",
      seating_vibe: "unknown",
    },
    hotel_profile: {
      hotel_amenities: "unknown",
    },
    event_profile: {
      event_date_hints: "unknown",
    },
  });
  const html = buildRequestedChecksEditorHtml({
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" });
  const curationHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "Curation Review");

  assert.match(curationHtml, /Category/);
  assert.match(curationHtml, /Opening Hours Note/);
  assert.match(curationHtml, /Price Range/);
  assert.match(curationHtml, /Parking/);
  assert.match(curationHtml, /Pet Friendly/);
  assert.match(curationHtml, /Family Friendly/);
  assert.match(curationHtml, /Accessibility/);
  assert.match(curationHtml, /Signature Menu/);
  assert.match(curationHtml, /Price Signals/);
  assert.match(curationHtml, /Service Style/);
  assert.doesNotMatch(curationHtml, /Title|Type|Slug|Map Url|Google Place Id|Source Url|Latitude|Longitude/);
  assert.doesNotMatch(curationHtml, /Cuisine Type|Seating Vibe|Hotel Amenities|Event Date Hints|Local Notes/);
});

test("default curation review hides unknown-only low-value rows and avoids unknown plus needs verification combo", () => {
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    practical_profile: {
      parking: "unknown",
      family_friendly: "unknown",
    },
    universal_curation_profile: {
      highlights: "unknown",
      good_to_know: "unknown",
      why_visit: "unknown",
    },
    restaurant_profile: {
      cuisine_type: "unknown",
      seating_vibe: "unknown",
    },
    verification: {
      needs_verification: ["parking", "family_friendly"],
    },
  });
  const html = buildRequestedChecksEditorHtml({
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" });
  const curationHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "Curation Review");
  assert.match(curationHtml, /Parking[^]*No value/i);
  assert.match(curationHtml, /Parking[^]*needs verification/i);
  assert.doesNotMatch(curationHtml, /Parking[^]*unknown[^]*needs verification/i);
  assert.match(curationHtml, /Family Friendly[^]*No value/i);
  assert.doesNotMatch(curationHtml, /Highlights|Good To Know|Why Visit|Cuisine Type|Seating Vibe/);
});

test("default curation review truncates long nearby values and exposes full value via title", () => {
  const longNearby = "See photos and videos taken at this location for access cues, surrounding area context, storefront recognition, and parking entry hints that would otherwise wrap too much in default review.";
  const writerNotes = JSON.stringify({
    contract_version: "1",
    taxonomy_version: "page_curation_taxonomy_v1",
    universal_curation_profile: {
      nearby: [longNearby],
      nearby_landmarks: [longNearby],
    },
    core_factual_fields: {
      category: "restaurants",
    },
  });
  const html = buildRequestedChecksEditorHtml({
    writer_notes: writerNotes,
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" });
  const curationHtml = extractSectionHtml(extractDefaultGuidanceHtml(html), "Curation Review");

  assert.match(curationHtml, /requested-guidance-grid/);
  assert.match(curationHtml, /title="/);
  assert.match(curationHtml, /See photos and videos taken at this location[^<]*\.\.\./);
  assert.match(curationHtml, new RegExp(`title="${longNearby.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("article context is shortened and avoids full CTA checklist wording", () => {
  const html = buildRequestedChecksEditorHtml({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA",
          checks: [
            { key: "phone", requested: true, instruction: "Confirm phone number", condition_prompt: "Need phone for publish", answer_type: "text" },
            { key: "facebook_url", requested: true, instruction: "Confirm Facebook URL", condition_prompt: "Need Facebook for publish", answer_type: "text" },
            { key: "website_url", requested: true, instruction: "Confirm website URL", condition_prompt: "Need website for publish", answer_type: "text" },
            { key: "line_url", requested: true, instruction: "Confirm line URL", condition_prompt: "Need line for publish", answer_type: "text" },
            { key: "primary_cta", requested: true, instruction: "Confirm primary CTA", condition_prompt: "Need CTA for publish", answer_type: "text" },
          ],
        },
      ],
    },
  }, { type: "place", category: "restaurants" });
  const guidanceHtml = extractDefaultGuidanceHtml(html);

  assert.doesNotMatch(guidanceHtml, /Will ask worker|Only selected checks will be sent|รายการที่จะส่งให้คนไปเช็ก/);
  assert.ok((guidanceHtml.match(/\|/g) || []).length <= 4);
});

test("default guidance removes old handoff or worker style thai wording", () => {
  const html = buildRequestedChecksEditorHtml({
    requested_checks_json: { version: 1, groups: [] },
  }, { type: "place", category: "restaurants" });
  const guidanceHtml = extractDefaultGuidanceHtml(html);

  assert.doesNotMatch(guidanceHtml, /รายการให้เช็กพื้นที่ก่อนส่งงานหน้าร้าน|เลือกเฉพาะรายการที่ต้องการส่งให้คนลงพื้นที่|ส่งให้คนลงพื้นที่|รายการให้เช็ก|handoff|worker/i);
  assert.match(guidanceHtml, /AI guidance \/ curation review|ข้อเสนอจาก AI/i);
});

test("default item editor document removes stale handoff worker card wording", () => {
  const cardHtml = extractTemplateRequestedChecksCard(itemEditorHtml);

  assert.match(cardHtml, /id="fp-requested-checks-editor"/);
  assert.doesNotMatch(
    cardHtml,
    /รายการให้เช็กพื้นที่ก่อนส่งงานหน้าร้าน|รายการให้เช็กเพิ่มก่อนส่งงานหน้างาน|ทีมหน้างาน|ส่งงานหน้าร้าน|ลงพื้นที่|รายการให้เช็ก|worker/i,
  );
  assert.match(cardHtml, /AI guidance|Advanced edit requested checks|requested-checks-editor/i);
});

test("real handoff workflow copy remains in item editor runtime", () => {
  assert.match(itemEditorJs, /ready_for_handoff/);
  assert.match(itemEditorJs, /handoff/);
  assert.match(repositoryJs, /buildRequestedChecksHandoffPayload/);
});

test("article context drops CTA contact checklist prompts and falls back to empty state", () => {
  const html = buildRequestedChecksEditorHtml({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA",
          checks: [
            { key: "phone", requested: true, instruction: "ขอเบอร์ที่ติดต่อได้จริง", condition_prompt: "", answer_type: "text" },
            { key: "line_url", requested: true, instruction: "ถ้ามีให้ขอลิงก์ที่ใช้ได้จริง", condition_prompt: "", answer_type: "text" },
            { key: "facebook_url", requested: true, instruction: "ถ้ามีให้ขอลิงก์เพจที่ถูกต้อง", condition_prompt: "", answer_type: "text" },
            { key: "website_url", requested: true, instruction: "ถ้ามีให้ขอลิงก์เว็บไซต์หลัก", condition_prompt: "", answer_type: "text" },
            { key: "primary_cta", requested: true, instruction: "ยืนยันว่าควรพาคนไปกดอะไรเป็นหลัก", condition_prompt: "", answer_type: "text" },
          ],
        },
      ],
    },
  }, { type: "place", category: "restaurants" });
  const guidanceHtml = extractDefaultGuidanceHtml(html);

  assert.doesNotMatch(guidanceHtml, /ขอเบอร์ที่ติดต่อได้จริง|ถ้ามีให้ขอลิงก์ที่ใช้ได้จริง|ถ้ามีให้ขอลิงก์เพจที่ถูกต้อง|ถ้ามีให้ขอลิงก์เว็บไซต์หลัก|ยืนยันว่าควรพาคนไปกดอะไรเป็นหลัก/);
  assert.match(guidanceHtml, /No article context hints\./);
  assert.match(guidanceHtml, /CTA Review/);
  assert.match(guidanceHtml, /Curation Review/);
  assert.match(guidanceHtml, /requested-guidance-grid/);
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
  assert.equal(hotelRow, undefined);
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

  assert.deepEqual(parkingRow?.statuses, ["needs verification"]);
  assert.equal(familyRow, undefined);
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
  assert.equal(parkingRowHtml, "");
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

test("buildFieldPackApiPayload merges full standard catalogs with saved custom groups when item editor has no requested-check DOM", () => {
  requestedChecksEditorRoot = null;
  setBuildFieldPackApiPayloadState({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "custom",
          group_label: "Custom checks",
          checks: [
            {
              key: "wifi_password",
              requested: true,
              label: "Wi-Fi password",
              instruction: "Ask for Wi-Fi password",
              answer_type: "text",
              suggested_value: "front desk only",
              condition_prompt: null,
              evidence_required: false,
              source: { kind: "manual", confidence: "high" },
            },
          ],
        },
      ],
    },
    ai_cta_contact_json: {},
    ai_taxonomy_json: {},
    writer_notes: "",
  });
  const result = buildFieldPackApiPayload();

  assert.deepEqual(result.requested_checks_json.groups.map((group) => group.group_key), ["cta_contact", "custom"]);
  assert.deepEqual(result.requested_checks_json.groups.find((group) => group.group_key === "cta_contact")?.checks.map((check) => check.key), ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]);
  assert.equal(result.requested_checks_json.groups.some((group) => group.group_key === "taxonomy"), false);
  assert.equal(result.requested_checks_json.groups.find((group) => group.group_key === "custom")?.checks[0].suggested_value, "front desk only");
});

test("buildFieldPackApiPayload prefers current auto CTA recommendations over stale saved rows", () => {
  requestedChecksEditorRoot = null;
  setRequestedChecksEditorBaselineState(null);
  setBuildFieldPackApiPayloadState({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            {
              key: "phone",
              requested: false,
              label: "Stale phone",
              instruction: "stale",
              answer_type: "phone",
              suggested_value: "0999999999",
              condition_prompt: null,
              evidence_required: false,
            },
          ],
        },
      ],
    },
    ai_cta_contact_json: {
      phone: "0812345678",
      confidence: "high",
    },
    ai_taxonomy_json: {},
    writer_notes: JSON.stringify({
      contract_version: "1",
      taxonomy_version: "page_curation_taxonomy_v1",
      verification: {
        needs_verification: ["phone"],
        publish_blockers: [],
      },
      checklists: {
        missing_data: [],
      },
    }),
  });

  const result = buildFieldPackApiPayload();
  const ctaGroup = result.requested_checks_json.groups.find((group) => group.group_key === "cta_contact");
  const phoneCheck = ctaGroup?.checks.find((check) => check.key === "phone");
  const lineUrlCheck = ctaGroup?.checks.find((check) => check.key === "line_url");
  const facebookCheck = ctaGroup?.checks.find((check) => check.key === "facebook_url");
  const websiteCheck = ctaGroup?.checks.find((check) => check.key === "website_url");
  const primaryCtaCheck = ctaGroup?.checks.find((check) => check.key === "primary_cta");

  assert.ok(ctaGroup);
  assert.deepEqual(ctaGroup.checks.map((check) => check.key), ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]);
  assert.equal(phoneCheck?.requested, true);
  assert.equal(phoneCheck?.suggested_value, "0812345678");
  assert.equal(lineUrlCheck?.suggested_value, null);
  assert.equal(facebookCheck?.suggested_value, null);
  assert.equal(websiteCheck?.suggested_value, null);
  assert.equal(primaryCtaCheck?.suggested_value, null);
  assert.equal(phoneCheck?.label, REQUESTED_CHECK_GROUP_TEMPLATES.find((group) => group.group_key === "cta_contact")?.checks.find((check) => check.key === "phone")?.label);
});

test("buildFieldPackApiPayload overlays explicitly edited live CTA checks while preserving untouched auto checks", () => {
  requestedChecksEditorRoot = createRequestedChecksEditorRoot([
    {
      groupKey: "cta_contact",
      checks: [
        {
          key: "phone",
          requested: false,
          label: "Edited phone",
          instruction: "updated instruction",
          answer_type: "phone",
          condition_prompt: "edited condition",
          evidence_required: true,
        },
        {
          key: "line_url",
          requested: false,
          label: "LINE URL",
          instruction: "confirm line",
          answer_type: "url",
          condition_prompt: null,
          evidence_required: false,
        },
      ],
    },
  ]);
  setRequestedChecksEditorBaselineState({
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
            instruction: "confirm phone",
            answer_type: "phone",
            condition_prompt: null,
            evidence_required: false,
          },
          {
            key: "line_url",
            requested: false,
            label: "LINE URL",
            instruction: "confirm line",
            answer_type: "url",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  });
  setBuildFieldPackApiPayloadState({
    ai_cta_contact_json: {
      phone: "0812345678",
      line_url: "https://line.me/example",
      confidence: "high",
    },
    ai_taxonomy_json: {},
    writer_notes: JSON.stringify({
      contract_version: "1",
      taxonomy_version: "page_curation_taxonomy_v1",
      verification: {
        needs_verification: ["phone", "line_url"],
        publish_blockers: [],
      },
      checklists: {
        missing_data: [],
      },
    }),
  });

  const result = buildFieldPackApiPayload();
  const ctaGroup = result.requested_checks_json.groups.find((group) => group.group_key === "cta_contact");
  const phoneCheck = ctaGroup?.checks.find((check) => check.key === "phone");
  const lineUrlCheck = ctaGroup?.checks.find((check) => check.key === "line_url");
  const facebookCheck = ctaGroup?.checks.find((check) => check.key === "facebook_url");

  assert.ok(ctaGroup);
  assert.deepEqual(ctaGroup.checks.map((check) => check.key), ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]);
  assert.equal(phoneCheck?.requested, true);
  assert.equal(phoneCheck?.label, "Edited phone");
  assert.equal(phoneCheck?.instruction, "updated instruction");
  assert.equal(phoneCheck?.condition_prompt, "edited condition");
  assert.equal(phoneCheck?.evidence_required, true);
  assert.equal(phoneCheck?.suggested_value, "0812345678");
  assert.equal(lineUrlCheck?.requested, true);
  assert.equal(lineUrlCheck?.suggested_value, "https://line.me/example");
  assert.equal(facebookCheck?.requested, true);
});

// The "taxonomy" overlay-merge case (category/subtype/tags editable checks) was removed:
// those are reserved metadata keys (PROJECT_POLICY.md 7A), not editable Curation questions.
// The equivalent overlay-merge mechanism is still covered by the cta_contact case above.

test("buildFieldPackApiPayload preserves current custom groups from the live editor without letting stale auto rows override them", () => {
  requestedChecksEditorRoot = createRequestedChecksEditorRoot([
    {
      groupKey: "cta_contact",
      checks: [
        {
          key: "phone",
          requested: false,
          label: "Phone",
          instruction: "confirm phone",
          answer_type: "phone",
          condition_prompt: null,
          evidence_required: false,
        },
      ],
    },
    {
      groupKey: "custom",
      checks: [
        {
          key: "wifi_password",
          requested: true,
          label: "Wi-Fi password",
          instruction: "Ask for Wi-Fi password",
          answer_type: "text",
          condition_prompt: null,
          evidence_required: false,
        },
      ],
    },
  ]);
  setRequestedChecksEditorBaselineState({
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
            instruction: "confirm phone",
            answer_type: "phone",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
      {
        group_key: "custom",
        group_label: "Custom checks",
        checks: [
          {
            key: "wifi_password",
            requested: true,
            label: "Wi-Fi password",
            instruction: "Ask for Wi-Fi password",
            answer_type: "text",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  });
  setBuildFieldPackApiPayloadState({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            {
              key: "phone",
              requested: false,
              label: "Stale phone",
              instruction: "stale",
              answer_type: "phone",
              suggested_value: "0999999999",
              condition_prompt: null,
              evidence_required: false,
            },
          ],
        },
        {
          group_key: "custom",
          group_label: "Custom checks",
          checks: [
            {
              key: "wifi_password",
              requested: true,
              label: "Wi-Fi password",
              instruction: "Ask for Wi-Fi password",
              answer_type: "text",
              suggested_value: null,
              condition_prompt: null,
              evidence_required: false,
              source: null,
            },
          ],
        },
      ],
    },
    ai_cta_contact_json: {
      phone: "0812345678",
      confidence: "high",
    },
    ai_taxonomy_json: {},
    writer_notes: JSON.stringify({
      contract_version: "1",
      taxonomy_version: "page_curation_taxonomy_v1",
      verification: {
        needs_verification: ["phone"],
        publish_blockers: [],
      },
      checklists: {
        missing_data: [],
      },
    }),
  });

  const result = buildFieldPackApiPayload();
  const customGroup = result.requested_checks_json.groups.find((group) => group.group_key === "custom");
  const ctaGroup = result.requested_checks_json.groups.find((group) => group.group_key === "cta_contact");

  assert.ok(customGroup);
  assert.equal(customGroup.checks[0].key, "wifi_password");
  assert.ok(ctaGroup);
  assert.deepEqual(ctaGroup.checks.map((check) => check.key), ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]);
  assert.equal(ctaGroup.checks[0].requested, true);
  assert.equal(ctaGroup.checks[0].suggested_value, "0812345678");
});

test("buildRequestedChecksAutoSaveState emits the full CTA catalog and ignores unsupported AI suggestions", () => {
  const result = buildRequestedChecksAutoSaveState({
    ai_cta_contact_json: {
      phone: "0812345678",
      fax: "999-9999",
      confidence: "high",
    },
    ai_taxonomy_json: {
      category: "attractions",
      parking: "lot",
    },
    writer_notes: JSON.stringify({
      contract_version: "1",
      taxonomy_version: "page_curation_taxonomy_v1",
      verification: {
        needs_verification: ["fax", "parking"],
        publish_blockers: [],
      },
      checklists: {
        missing_data: ["fax", "parking"],
      },
    }),
  });

  const ctaGroup = result.groups.find((group) => group.group_key === "cta_contact");

  assert.deepEqual(ctaGroup?.checks.map((check) => check.key), ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]);
  assert.equal(ctaGroup?.checks.every((check) => check.requested === true), true);
  assert.equal(ctaGroup?.checks.find((check) => check.key === "phone")?.suggested_value, "0812345678");
  assert.equal(ctaGroup?.checks.find((check) => check.key === "line_url")?.suggested_value, null);
  // ai_taxonomy_json must not resurrect a "taxonomy" requested-check group (reserved metadata keys).
  assert.equal(result.groups.some((group) => group.group_key === "taxonomy"), false);
});

// The "emits full taxonomy catalog" case was removed: category/subtype/tags are reserved
// metadata keys (PROJECT_POLICY.md 7A), not editable Curation questions, so no taxonomy
// group is ever auto-generated regardless of AI/writer_notes data.

test("buildFieldPackApiPayload emits the full CTA catalog when the requested-check editor root exists but is empty", () => {
  requestedChecksEditorRoot = createRequestedChecksEditorRoot([]);
  setRequestedChecksEditorBaselineState(null);
  setBuildFieldPackApiPayloadState({
    requested_checks_json: { version: 1, groups: [] },
    ai_cta_contact_json: {
      phone: "0812345678",
      confidence: "high",
    },
    ai_taxonomy_json: {
      category: "attractions",
    },
    writer_notes: "",
  });

  const result = buildFieldPackApiPayload();
  const ctaGroup = result.requested_checks_json.groups.find((group) => group.group_key === "cta_contact");

  assert.ok(ctaGroup);
  assert.deepEqual(ctaGroup.checks.map((check) => check.key), ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]);
  assert.equal(ctaGroup.checks.find((check) => check.key === "phone")?.suggested_value, "0812345678");
  assert.equal(result.requested_checks_json.groups.some((group) => group.group_key === "taxonomy"), false);
});

test("buildFieldPackApiPayload preserves a hidden non-reserved taxonomy row the DOM editor never rendered", () => {
  requestedChecksEditorRoot = createRequestedChecksEditorRoot([
    { groupKey: "cta_contact", checks: [] },
  ]);
  setRequestedChecksEditorBaselineState(null);
  setBuildFieldPackApiPayloadState({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            {
              key: "parking",
              requested: true,
              label: "Parking",
              instruction: "Confirm parking",
              answer_type: "text",
              suggested_value: "Street side",
              condition_prompt: null,
              evidence_required: false,
              source: null,
            },
          ],
        },
      ],
    },
    ai_cta_contact_json: {},
    ai_taxonomy_json: {},
    writer_notes: "",
  });

  const result = buildFieldPackApiPayload();
  const taxonomyGroup = result.requested_checks_json.groups.find((group) => group.group_key === "taxonomy");
  const parkingCheck = taxonomyGroup?.checks?.find((check) => check.key === "parking");

  assert.ok(taxonomyGroup, "a legacy taxonomy group not shown in the editor DOM must still survive save");
  assert.ok(parkingCheck, "the non-reserved taxonomy key must not be dropped");
  assert.equal(parkingCheck.label, "Parking");
  assert.equal(parkingCheck.suggested_value, "Street side");
});

test("buildFieldPackApiPayload keeps reserved taxonomy keys stripped even while preserving the rest of a hidden legacy group", () => {
  requestedChecksEditorRoot = createRequestedChecksEditorRoot([
    { groupKey: "cta_contact", checks: [] },
  ]);
  setRequestedChecksEditorBaselineState(null);
  setBuildFieldPackApiPayloadState({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "Category", answer_type: "text" },
            { key: "subtype", requested: true, label: "Subtype", answer_type: "text" },
            { key: "tags", requested: true, label: "Tags", answer_type: "multi_select" },
            { key: "parking", requested: true, label: "Parking", answer_type: "text", suggested_value: "Street side" },
          ],
        },
      ],
    },
    ai_cta_contact_json: {},
    ai_taxonomy_json: {},
    writer_notes: "",
  });

  const result = buildFieldPackApiPayload();
  const taxonomyGroup = result.requested_checks_json.groups.find((group) => group.group_key === "taxonomy");
  const taxonomyKeys = taxonomyGroup?.checks?.map((check) => check.key) || [];

  assert.equal(taxonomyKeys.includes("category"), false);
  assert.equal(taxonomyKeys.includes("subtype"), false);
  assert.equal(taxonomyKeys.includes("tags"), false);
  assert.deepEqual(taxonomyKeys, ["parking"]);
});

test("buildFieldPackApiPayload does not fabricate a taxonomy or custom group when no legacy data exists", () => {
  requestedChecksEditorRoot = createRequestedChecksEditorRoot([
    { groupKey: "cta_contact", checks: [] },
  ]);
  setRequestedChecksEditorBaselineState(null);
  setBuildFieldPackApiPayloadState({
    requested_checks_json: { version: 1, groups: [] },
    ai_cta_contact_json: {},
    ai_taxonomy_json: {},
    writer_notes: "",
  });

  const result = buildFieldPackApiPayload();

  assert.equal(result.requested_checks_json.groups.some((group) => group.group_key === "taxonomy"), false);
  assert.equal(result.requested_checks_json.groups.some((group) => group.group_key === "custom"), false);
});

test("buildFieldPackApiPayload does not fabricate a taxonomy group when the saved legacy group only ever held reserved keys", () => {
  requestedChecksEditorRoot = createRequestedChecksEditorRoot([
    { groupKey: "cta_contact", checks: [] },
  ]);
  setRequestedChecksEditorBaselineState(null);
  setBuildFieldPackApiPayloadState({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "Category", answer_type: "text" },
            { key: "subtype", requested: true, label: "Subtype", answer_type: "text" },
            { key: "tags", requested: true, label: "Tags", answer_type: "multi_select" },
          ],
        },
      ],
    },
    ai_cta_contact_json: {},
    ai_taxonomy_json: {},
    writer_notes: "",
  });

  const result = buildFieldPackApiPayload();

  assert.equal(result.requested_checks_json.groups.some((group) => group.group_key === "taxonomy"), false);
});

test("buildFieldPackApiPayload CTA overlay-merge behavior is unchanged when a hidden legacy taxonomy row is also preserved", () => {
  requestedChecksEditorRoot = createRequestedChecksEditorRoot([
    {
      groupKey: "cta_contact",
      checks: [
        {
          key: "phone",
          requested: false,
          label: "Edited phone",
          instruction: "updated instruction",
          answer_type: "phone",
          condition_prompt: "edited condition",
          evidence_required: true,
        },
        {
          key: "line_url",
          requested: false,
          label: "LINE URL",
          instruction: "confirm line",
          answer_type: "url",
          condition_prompt: null,
          evidence_required: false,
        },
      ],
    },
  ]);
  setRequestedChecksEditorBaselineState({
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
            instruction: "confirm phone",
            answer_type: "phone",
            condition_prompt: null,
            evidence_required: false,
          },
          {
            key: "line_url",
            requested: false,
            label: "LINE URL",
            instruction: "confirm line",
            answer_type: "url",
            condition_prompt: null,
            evidence_required: false,
          },
        ],
      },
    ],
  });
  setBuildFieldPackApiPayloadState({
    requested_checks_json: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "parking", requested: true, label: "Parking", answer_type: "text", suggested_value: "Street side" },
          ],
        },
      ],
    },
    ai_cta_contact_json: {
      phone: "0812345678",
      line_url: "https://line.me/example",
      confidence: "high",
    },
    ai_taxonomy_json: {},
    writer_notes: JSON.stringify({
      contract_version: "1",
      taxonomy_version: "page_curation_taxonomy_v1",
      verification: {
        needs_verification: ["phone", "line_url"],
        publish_blockers: [],
      },
      checklists: {
        missing_data: [],
      },
    }),
  });

  const result = buildFieldPackApiPayload();
  const ctaGroup = result.requested_checks_json.groups.find((group) => group.group_key === "cta_contact");
  const phoneCheck = ctaGroup?.checks.find((check) => check.key === "phone");
  const lineUrlCheck = ctaGroup?.checks.find((check) => check.key === "line_url");
  const taxonomyGroup = result.requested_checks_json.groups.find((group) => group.group_key === "taxonomy");

  assert.equal(phoneCheck?.requested, true);
  assert.equal(phoneCheck?.label, "Edited phone");
  assert.equal(phoneCheck?.instruction, "updated instruction");
  assert.equal(phoneCheck?.condition_prompt, "edited condition");
  assert.equal(phoneCheck?.suggested_value, "0812345678");
  assert.equal(lineUrlCheck?.requested, true);
  assert.equal(lineUrlCheck?.suggested_value, "https://line.me/example");
  assert.ok(taxonomyGroup, "unrelated hidden taxonomy preservation must not block the CTA overlay-merge path");
  assert.equal(taxonomyGroup.checks[0]?.key, "parking");
});
