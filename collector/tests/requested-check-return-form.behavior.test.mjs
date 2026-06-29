import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(collectorRoot, "server", "public", "styles.css"), "utf8");
const repositoryJs = fs.readFileSync(path.join(collectorRoot, "db", "repository.mjs"), "utf8");

function extractFunctionSource(source, functionName) {
  const asyncMarker = `async function ${functionName}`;
  const marker = `function ${functionName}`;
  const asyncStart = source.indexOf(asyncMarker);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(marker);
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

function loadNamedFunction(sourceText, functionName, dependencies = {}) {
  const source = extractFunctionSource(sourceText, functionName);
  const dependencyNames = Object.keys(dependencies);
  const dependencyValues = Object.values(dependencies);
  return Function(...dependencyNames, `${source}; return ${functionName};`)(...dependencyValues);
}

function loadNamedAsyncFunction(sourceText, functionName, dependencies = {}) {
  const source = extractFunctionSource(sourceText, functionName);
  const dependencyNames = Object.keys(dependencies);
  const dependencyValues = Object.values(dependencies);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return AsyncFunction(...dependencyNames, `${source}; return ${functionName};`)(...dependencyValues);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createMockDomNode(initial = {}) {
  const classSet = new Set();
  const attributes = new Map();
  const node = {
    innerHTML: "",
    textContent: "",
    value: "",
    placeholder: "",
    href: "",
    disabled: false,
    querySelector: () => null,
    querySelectorAll: () => [],
    insertAdjacentHTML: () => {},
    remove: () => {},
    setAttribute(name, value) {
      attributes.set(String(name), String(value));
    },
    removeAttribute(name) {
      attributes.delete(String(name));
    },
    getAttribute(name) {
      return attributes.has(String(name)) ? attributes.get(String(name)) : null;
    },
  };
  Object.defineProperty(node, "className", {
    get() {
      return [...classSet].join(" ");
    },
    set(value) {
      classSet.clear();
      String(value || "")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .forEach((token) => classSet.add(token));
    },
    enumerable: true,
    configurable: true,
  });
  node.classList = {
    add(...tokens) {
      tokens.flat().map((token) => String(token || "").trim()).filter(Boolean).forEach((token) => classSet.add(token));
      return undefined;
    },
    remove(...tokens) {
      tokens.flat().map((token) => String(token || "").trim()).filter(Boolean).forEach((token) => classSet.delete(token));
      return undefined;
    },
    toggle(token, force) {
      const name = String(token || "").trim();
      if (!name) return classSet.has(name);
      const shouldAdd = force === undefined ? !classSet.has(name) : force === true;
      if (shouldAdd) classSet.add(name);
      else classSet.delete(name);
      return classSet.has(name);
    },
    contains(token) {
      return classSet.has(String(token || "").trim());
    },
  };
  Object.assign(node, initial);
  return node;
}

function createRequestedCheckRenderHarness(state) {
  const nodes = new Map();
  const ids = [
    "assignment-submission-workspace-help",
    "assignment-submission-brief-label",
    "assignment-submission-verified-label",
    "assignment-submission-question-label",
    "assignment-submission-requested-checks-wrap",
    "assignment-submission-requested-checks-label",
    "assignment-submission-requested-checks-fields",
    "assignment-submission-capture-label",
    "assignment-submission-additional-label",
    "assignment-submission-files-label",
    "assignment-submission-verified-fields",
    "assignment-submission-question-fields",
    "assignment-submission-capture-guide",
    "assignment-submission-reset-notice",
    "assignment-submit-callout",
    "assignment-submission-brief-link",
    "assignment-submission-additional-text",
    "btn-assignment-sync-upload",
    "btn-assignment-submit",
    "assignment-submission-context",
    "assignment-submission-file-list",
  ];
  ids.forEach((id) => nodes.set(id, createMockDomNode()));
  nodes.get("assignment-submission-requested-checks-wrap").className = "assignment-brief-section";
  nodes.get("assignment-submission-requested-checks-fields").className = "assignment-brief-grid";
  nodes.get("assignment-submission-verified-fields").className = "assignment-brief-grid";
  nodes.get("assignment-submission-question-fields").className = "assignment-brief-grid";
  nodes.get("assignment-submission-capture-guide").className = "assignment-brief-grid";
  nodes.get("assignment-submission-file-list").className = "assignment-brief-grid";
  return {
    nodes,
    qs: (id) => nodes.get(id) || null,
    renderAssignmentSubmissionForm: loadNamedFunction(appJs, "renderAssignmentSubmissionForm", {
      state,
      qs: (id) => nodes.get(id) || null,
      getAssignmentSubmissionFormConfig: () => ({
        workspaceHelp: "workspace help",
        briefLabel: "brief",
        verifiedLabel: "verified",
        questionLabel: "question",
        captureLabel: "capture",
        additionalLabel: "additional",
        filesLabel: "files",
        additionalPlaceholder: "เพิ่มเติม",
        emptyVerified: "empty verified",
        emptyQuestion: "empty question",
        emptyCapture: "empty capture",
        verifiedPrompts: [],
        verifiedGroupName: "verified",
        verifiedAnswers: "verified_answers",
        questionPrompts: [],
        questionGroupName: "question",
        questionAnswers: "question_answers",
        answerPlaceholder: "placeholder",
        captureItems: [],
      }),
      renderAssignmentSubmissionContext: () => {},
      getAssignmentLandingItemId: () => 0,
      buildAssignmentBriefUrl: () => "/brief",
      getAssignmentSubmissionPrefillPayload: () => ({
        verified_answers: [],
        question_answers: [],
        capture_files: [],
      }),
      getAssignmentRequestedCheckGroupsFromHandoffPackage,
      normalizeAssignmentRequestedCheckReturnDraft,
      getAssignmentRequestedCheckReturnDraftPrefill: loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
        state,
        getLatestAssignmentSubmissionRow: () => null,
        getAssignmentSubmissionDraftKey: () => "12:1",
        normalizeAssignmentRequestedCheckReturnDraft,
        hasUsableAssignmentRequestedCheckReturnRows,
      }),
      isEditorUser: () => false,
      loadAssignmentRequestedCheckHandoffSource: async () => null,
      setAssignmentDraftSaveStatus: () => {},
      clearAssignmentCaptureUploads: () => {},
      renderAssignmentSubmissionFileList: () => {},
      buildAssignmentSubmissionGateState: () => ({}),
      renderAssignmentSubmissionGatePanel: () => {},
      applyAssignmentModernClasses: () => {},
      renderAssignmentRequestedCheckSection: loadNamedFunction(appJs, "renderAssignmentRequestedCheckSection", {
        state,
        qs: (id) => nodes.get(id) || null,
        getAssignmentRequestedCheckGroupsFromHandoffPackage,
        getAssignmentRequestedCheckReturnDraftPrefill: loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
          state,
          getLatestAssignmentSubmissionRow: () => null,
          getAssignmentSubmissionDraftKey: () => "12:1",
          normalizeAssignmentRequestedCheckReturnDraft,
          hasUsableAssignmentRequestedCheckReturnRows,
        }),
        normalizeAssignmentRequestedCheckReturnDraft,
        buildAssignmentRequestedCheckReturnSectionHtml,
        setAssignmentRequestedCheckReturnDraftState: loadNamedFunction(appJs, "setAssignmentRequestedCheckReturnDraftState", {
          state,
        }),
        hasUsableAssignmentRequestedCheckReturnRows,
        updateAssignmentRequestedCheckReturnRowState: () => {},
        isEditorUser: () => false,
        loadAssignmentRequestedCheckHandoffSource: async () => null,
      }),
      buildAssignmentRequestedCheckReturnSectionHtml,
      updateAssignmentRequestedCheckReturnRowState: () => {},
      buildAssignmentCaptureUploadCards: () => "",
      buildAssignmentSubmissionPromptInputs: (items = [], groupName, answers = [], placeholderText = "") =>
        `<div data-rendered-group="${escapeHtml(groupName || "")}" data-rendered-placeholder="${escapeHtml(placeholderText || "")}"></div>`,
      escapeHtml,
    }),
  };
}

function parseJson(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function normalizeStringListInput(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeOptionalUrlValue(value) {
  return String(value || "").trim() || null;
}

function normalizePrimaryCtaValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["map", "phone", "line"].includes(normalized) ? normalized : null;
}

function normalizeJsonSafeValue(value) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function hasMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return String(value || "").trim().length > 0;
}

function normalizeFieldReturnEvidence(rawValue) {
  const row = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  return {
    evidence_deliverable_id: row.evidence_deliverable_id == null || row.evidence_deliverable_id === ""
      ? null
      : Number(row.evidence_deliverable_id || 0) || null,
    evidence_source_url: String(row.evidence_source_url || "").trim() || null,
  };
}

const normalizeAssignmentRequestedCheckKeyPart = loadNamedFunction(appJs, "normalizeAssignmentRequestedCheckKeyPart");
const buildAssignmentRequestedCheckReturnKey = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnKey", {
  normalizeAssignmentRequestedCheckKeyPart,
});
const formatRequestedCheckSuggestedValue = loadNamedFunction(appJs, "formatRequestedCheckSuggestedValue");
const toCategoryLabel = loadNamedFunction(appJs, "toCategoryLabel", {
  CONTENT_CATEGORY_OPTIONS: [
    { value: "restaurants", label: "ร้านอาหารและคาเฟ่" },
    { value: "attractions", label: "สถานที่ท่องเที่ยว" },
  ],
});
const hasAssignmentRequestedCheckMeaningfulValue = loadNamedFunction(appJs, "hasAssignmentRequestedCheckMeaningfulValue", {
  formatRequestedCheckSuggestedValue,
});
const hasAssignmentRequestedCheckMeaningfulSuggestedValue = loadNamedFunction(appJs, "hasAssignmentRequestedCheckMeaningfulSuggestedValue", {
  hasAssignmentRequestedCheckMeaningfulValue,
});
const cloneAssignmentRequestedCheckValue = loadNamedFunction(appJs, "cloneAssignmentRequestedCheckValue");
const areAssignmentRequestedCheckValuesEqual = loadNamedFunction(appJs, "areAssignmentRequestedCheckValuesEqual", {
  cloneAssignmentRequestedCheckValue,
});
const isAssignmentCurationRenderableCheck = loadNamedFunction(appJs, "isAssignmentCurationRenderableCheck");
const resolveAssignmentCurationCheckPlacement = loadNamedFunction(appJs, "resolveAssignmentCurationCheckPlacement", {
  isAssignmentCurationRenderableCheck,
  hasAssignmentRequestedCheckMeaningfulValue,
});
const getAssignmentRequestedCheckGroupsFromHandoffPackage = loadNamedFunction(appJs, "getAssignmentRequestedCheckGroupsFromHandoffPackage", {
  normalizeAssignmentRequestedCheckKeyPart,
  buildAssignmentRequestedCheckReturnKey,
});
const getAssignmentRequestedCheckDefaultValue = loadNamedFunction(appJs, "getAssignmentRequestedCheckDefaultValue");
const isAssignmentRequestedCheckTaxonomyBooleanRow = loadNamedFunction(appJs, "isAssignmentRequestedCheckTaxonomyBooleanRow");
const buildAssignmentRequestedCheckReturnDraftFromHandoffPackage = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnDraftFromHandoffPackage", {
  getAssignmentRequestedCheckGroupsFromHandoffPackage,
  getAssignmentRequestedCheckDefaultValue,
  cloneAssignmentRequestedCheckValue,
  isAssignmentRequestedCheckTaxonomyBooleanRow,
});
const normalizeAssignmentRequestedCheckReturnDraft = loadNamedFunction(appJs, "normalizeAssignmentRequestedCheckReturnDraft", {
  buildAssignmentRequestedCheckReturnDraftFromHandoffPackage,
});
const getAssignmentRequestedCheckReturnRows = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnRows");
const hasUsableAssignmentRequestedCheckReturnRows = loadNamedFunction(appJs, "hasUsableAssignmentRequestedCheckReturnRows", {
  getAssignmentRequestedCheckReturnRows,
});
const setAssignmentRequestedCheckReturnDraftState = loadNamedFunction(appJs, "setAssignmentRequestedCheckReturnDraftState", {
  state: { assignments: {} },
});
const buildAssignmentRequestedCheckReturnSubmissionRow = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnSubmissionRow", {
  isAssignmentRequestedCheckTaxonomyBooleanRow,
});
const buildAssignmentRequestedCheckReturnPayloadFromDraft = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnPayloadFromDraft", {
  normalizeAssignmentRequestedCheckReturnDraft,
  buildAssignmentRequestedCheckReturnSubmissionRow,
});
const buildAssignmentRequestedCheckReturnValueInputHtml = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnValueInputHtml", {
  escapeHtml,
});
const buildAssignmentRequestedCheckReturnSecondaryFieldsHtml = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnSecondaryFieldsHtml", {
  escapeHtml,
});
const buildAssignmentRequestedCheckReturnRowHtml = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnRowHtml", {
  hasAssignmentRequestedCheckMeaningfulSuggestedValue,
  areAssignmentRequestedCheckValuesEqual,
  buildAssignmentRequestedCheckReturnValueInputHtml,
  buildAssignmentRequestedCheckReturnSecondaryFieldsHtml,
  isAssignmentRequestedCheckTaxonomyBooleanRow,
  escapeHtml,
});
const buildAssignmentRequestedCheckReturnSectionHtml = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnSectionHtml", {
  getAssignmentRequestedCheckGroupsFromHandoffPackage,
  normalizeAssignmentRequestedCheckReturnDraft,
  buildAssignmentRequestedCheckReturnRowHtml,
  isAssignmentCurationRenderableCheck,
  resolveAssignmentCurationCheckPlacement,
  hasAssignmentRequestedCheckMeaningfulValue,
  escapeHtml,
});
const getAssignmentReviewRequestedCheckSafeUrl = loadNamedFunction(appJs, "getAssignmentReviewRequestedCheckSafeUrl", {
  window: { location: { origin: "http://localhost" } },
});
const formatAssignmentReviewRequestedCheckValueHtml = loadNamedFunction(appJs, "formatAssignmentReviewRequestedCheckValueHtml", {
  formatRequestedCheckSuggestedValue,
  escapeHtml,
  getAssignmentReviewRequestedCheckSafeUrl,
});
const buildAssignmentReviewRequestedCheckRowHtml = loadNamedFunction(appJs, "buildAssignmentReviewRequestedCheckRowHtml", {
  getAssignmentReviewRequestedCheckFallbackLabel: (returnKey) => String(returnKey || "").trim().toLowerCase().split(".").pop().replace(/_/g, " ").trim() || String(returnKey || "").trim().toLowerCase(),
  formatAssignmentReviewRequestedCheckValueHtml,
  escapeHtml,
});
const buildAssignmentReviewRequestedCheckRowsForGroup = loadNamedFunction(appJs, "buildAssignmentReviewRequestedCheckRowsForGroup", {
  isAssignmentCurationRenderableCheck,
  resolveAssignmentCurationCheckPlacement,
  getAssignmentReviewRequestedCheckFallbackLabel: (returnKey) => String(returnKey || "").trim().toLowerCase().split(".").pop().replace(/_/g, " ").trim() || String(returnKey || "").trim().toLowerCase(),
});
const buildAssignmentReviewRequestedCheckCardsHtml = loadNamedFunction(appJs, "buildAssignmentReviewRequestedCheckCardsHtml", {
  state: { assignments: {} },
  getLatestAssignmentSubmissionRow: () => null,
  getAssignmentRequestedCheckGroupsFromHandoffPackage,
  buildAssignmentReviewRequestedCheckRowsForGroup,
  buildAssignmentReviewRequestedCheckRowHtml,
  isAssignmentCurationRenderableCheck,
  resolveAssignmentCurationCheckPlacement,
  escapeHtml,
  formatRequestedCheckSuggestedValue,
  window: { location: { origin: "http://localhost" } },
});
const updateAssignmentRequestedCheckReturnRowState = loadNamedFunction(appJs, "updateAssignmentRequestedCheckReturnRowState");
const readAssignmentRequestedCheckReturnDraftFromForm = loadNamedFunction(appJs, "readAssignmentRequestedCheckReturnDraftFromForm");

const normalizeRequestedCheckAnswerType = loadNamedFunction(repositoryJs, "normalizeRequestedCheckAnswerType");
const normalizeRequestedCheckReturnKey = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturnKey");
const parseStrictFiniteNumericInput = loadNamedFunction(repositoryJs, "parseStrictFiniteNumericInput");
const inferRequestedCheckAnswerTypeFromReturnRow = loadNamedFunction(repositoryJs, "inferRequestedCheckAnswerTypeFromReturnRow", {
  normalizeRequestedCheckAnswerType,
  hasMeaningfulValue,
});
const normalizeRequestedCheckReturnValue = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturnValue", {
  normalizeOptionalUrlValue,
  parseStrictFiniteNumericInput,
  normalizeStringListInput,
  normalizeJsonSafeValue,
});
const isRequestedCheckAnswerComplete = loadNamedFunction(repositoryJs, "isRequestedCheckAnswerComplete", {
  normalizeRequestedCheckAnswerType,
  parseStrictFiniteNumericInput,
  normalizeHttpUrl: normalizeOptionalUrlValue,
});
const normalizeRequestedCheckReturnEntry = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturnEntry", {
  normalizeRequestedCheckAnswerType,
  inferRequestedCheckAnswerTypeFromReturnRow,
  normalizeFieldReturnEvidence,
  normalizeRequestedCheckReturnValue,
  hasMeaningfulValue,
  isRequestedCheckAnswerComplete,
});
const hasRequestedCheckEvidence = loadNamedFunction(repositoryJs, "hasRequestedCheckEvidence");
const hasMeaningfulRequestedCheckValue = loadNamedFunction(repositoryJs, "hasMeaningfulRequestedCheckValue");
const hasSuppliedRequestedCheckValue = loadNamedFunction(repositoryJs, "hasSuppliedRequestedCheckValue", {
  hasMeaningfulRequestedCheckValue,
  parseStrictFiniteNumericInput,
});
const inferRequestedCheckReturnStatus = loadNamedFunction(repositoryJs, "inferRequestedCheckReturnStatus", {
  normalizeRequestedCheckAnswerType,
  isRequestedCheckAnswerComplete,
  hasRequestedCheckEvidence,
  hasSuppliedRequestedCheckValue,
});
const normalizeRequestedCheckReturns = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturns", {
  normalizeRequestedCheckReturnKey,
  normalizeRequestedCheckReturnEntry,
  parseJson,
});

function createReviewContentNode() {
  return createMockDomNode({
    innerHTML: "",
    querySelector(selector) {
      if (selector !== "#assignment-review-requested-check-cards") return null;
      if (!String(this.innerHTML || "").includes('id="assignment-review-requested-check-cards"')) return null;
      return {
        remove: () => {
          this.innerHTML = String(this.innerHTML || "").replace(/\s*<div id="assignment-review-requested-check-cards"[\s\S]*$/, "");
        },
      };
    },
    insertAdjacentHTML(position, html) {
      if (String(position || "").toLowerCase() !== "beforeend") return;
      this.innerHTML += String(html || "");
    },
  });
}

function createReviewHarness(overrides = {}) {
  const assignmentId = Number(overrides.assignmentId || 24);
  const latestSubmissionRow = overrides.latestSubmissionRow || {
    id: 12,
    field_return_payload_json: {
      requested_check_returns: {
        "cta_contact.phone": {
          checked: true,
          found: true,
          value: "0812345678",
          answer_type: "phone",
        },
        "cta_contact.website_url": {
          checked: true,
          found: false,
          value: "https://example.com",
          answer_type: "url",
        },
        "taxonomy.parking": {
          checked: true,
          found: true,
          value: false,
          answer_type: "boolean",
        },
        "taxonomy.pet_friendly": {
          checked: true,
          found: true,
          value: true,
          answer_type: "boolean",
        },
        "taxonomy.average_price_per_person": {
          checked: true,
          found: true,
          value: { number: 0, unit: "บาท" },
          answer_type: "number_with_unit",
          condition_note: "ฟรี",
        },
      },
    },
  };
  const handoffPackage = overrides.handoffPackage || {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/ติดต่อ",
          checks: [
            { key: "phone", requested: true, label: "Phone", answer_type: "phone" },
            { key: "website_url", requested: true, label: "Website", answer_type: "url" },
          ],
        },
        {
          group_key: "taxonomy",
          group_label: "Curation",
          checks: [
            { key: "parking", requested: true, label: "Parking", answer_type: "boolean" },
            { key: "pet_friendly", requested: true, label: "Pet Friendly", answer_type: "boolean" },
            { key: "average_price_per_person", requested: true, label: "Average Price", answer_type: "number_with_unit" },
            { key: "category", requested: true, label: "Category", answer_type: "select" },
          ],
        },
      ],
    },
  };
  const contentNode = createReviewContentNode();
  const nodes = new Map([
    ["assignment-review-submission-card", createMockDomNode({ className: "assignment-brief-card" })],
    ["assignment-review-submission-content", contentNode],
    ["assignment-review-submission-text", createMockDomNode({ className: "assignment-brief-empty" })],
    ["assignment-review-submission-photos", createMockDomNode({ className: "assignment-brief-empty" })],
    ["assignment-review-submission-videos", createMockDomNode({ className: "assignment-brief-empty" })],
    ["assignment-review-hover-preview", createMockDomNode({ className: "asset-hover-preview hidden" })],
    ["assignment-review-hover-preview-image", createMockDomNode()],
    ["assignment-review-summary-card", createMockDomNode({ className: "assignment-brief-card" })],
    ["assignment-review-summary-content", createMockDomNode()],
    ["assignment-review-summary-brief-link-wrap", createMockDomNode()],
    ["assignment-review-summary-brief-link", createMockDomNode()],
  ]);
  const state = {
    assignments: {
      selectedId: assignmentId,
      latestSubmissionRows: { [assignmentId]: latestSubmissionRow },
      latestSubmissionArticlePayloads: {},
      latestSubmissionLoaded: { [assignmentId]: true },
      deliverablesBundle: null,
      handoffSourcePackages: { [assignmentId]: handoffPackage },
      requestedCheckReturnDrafts: {
        [assignmentId]: {
          requested_check_returns: {
            "cta_contact.phone": { checked: false, found: false, value: "ignored-draft" },
          },
        },
      },
      requestedCheckReturnDraftDirty: { [assignmentId]: true },
      requestedCheckReturnDraftSources: { [assignmentId]: "user_edit" },
      reviewSelectedVideoKey: "",
    },
  };
  const windowMock = { location: { origin: "http://localhost" } };
  const getLatestAssignmentSubmissionRow = overrides.getLatestAssignmentSubmissionRow || ((assignment = null) => {
    const id = Number(assignment?.id || assignmentId || 0) || 0;
    return state.assignments.latestSubmissionRows?.[id] || null;
  });
  const buildAssignmentReviewRequestedCheckCardsHtmlFn = loadNamedFunction(appJs, "buildAssignmentReviewRequestedCheckCardsHtml", {
    state,
    getLatestAssignmentSubmissionRow,
    getAssignmentRequestedCheckGroupsFromHandoffPackage,
    buildAssignmentReviewRequestedCheckRowsForGroup,
    buildAssignmentReviewRequestedCheckRowHtml,
    isAssignmentCurationRenderableCheck,
    resolveAssignmentCurationCheckPlacement,
    escapeHtml,
    formatRequestedCheckSuggestedValue,
    window: windowMock,
  });
  const renderAssignmentReviewSubmissionContent = loadNamedFunction(appJs, "renderAssignmentReviewSubmissionContent", {
    state,
    qs: (id) => nodes.get(id) || null,
    getAssignmentPageMode: () => "review",
    getLatestAssignmentSubmissionRow,
    buildAssignmentReviewTextSections: () => [],
    getAssignmentReviewTextDeliverables: () => [],
    getAssignmentReviewMediaItems: () => [],
    hideAssignmentReviewHoverPreview: () => {},
    showAssignmentReviewHoverPreview: () => {},
    positionAssignmentReviewHoverPreview: () => {},
    buildAssignmentReviewRequestedCheckCardsHtml: buildAssignmentReviewRequestedCheckCardsHtmlFn,
    escapeHtml,
  });
  return {
    assignment: { id: assignmentId, state: "submitted" },
    state,
    nodes,
    contentNode,
    windowMock,
    getLatestAssignmentSubmissionRow,
    buildAssignmentReviewRequestedCheckCardsHtml: buildAssignmentReviewRequestedCheckCardsHtmlFn,
    renderAssignmentReviewSubmissionContent,
  };
}

function loadAssignmentReviewMediaBundleSelector() {
  return loadNamedFunction(appJs, "selectAssignmentReviewMediaBundle");
}

function loadAssignmentReviewMediaItemsHarness(state, overrides = {}) {
  const selector = loadAssignmentReviewMediaBundleSelector();
  return loadNamedFunction(appJs, "getAssignmentReviewMediaItems", {
    state,
    getLatestAssignmentSubmissionRow: overrides.getLatestAssignmentSubmissionRow || ((assignment = null) => {
      const id = Number(assignment?.id || 0) || 0;
      return state.assignments.latestSubmissionRows?.[id] || null;
    }),
    selectAssignmentReviewMediaBundle: selector,
    resolveAssignmentReviewMediaUrl: overrides.resolveAssignmentReviewMediaUrl || ((row) => String(row?.public_url || row?.source_url || "").trim()),
    summarizeAssignmentReviewMediaLabel: overrides.summarizeAssignmentReviewMediaLabel || ((row, fallbackPrefix) => String(row?.title || "").trim() || fallbackPrefix),
    getAssignmentDeliverableLabel: overrides.getAssignmentDeliverableLabel || ((type) => type),
  });
}

test("review media selector uses latest submission deliverables when present", () => {
  const selectAssignmentReviewMediaBundle = loadAssignmentReviewMediaBundleSelector();
  const result = selectAssignmentReviewMediaBundle(
    [
      { id: 12, media_payload_json: { assets: [{ id: 991, mime_type: "image/jpeg", public_url: "https://cdn.example.com/payload-latest.jpg" }] } },
      { id: 11, media_payload_json: { assets: [{ id: 881, mime_type: "image/jpeg", public_url: "https://cdn.example.com/payload-prev.jpg" }] } },
    ],
    [
      { id: 201, submission_id: 12, deliverable_type: "photos", source_url: "https://cdn.example.com/latest-1.jpg", title: "latest 1" },
      { id: 101, submission_id: 11, deliverable_type: "photos", source_url: "https://cdn.example.com/prev-1.jpg", title: "prev 1" },
    ],
    "photos"
  );

  assert.equal(result.source_submission_id, 12);
  assert.equal(result.source_type, "deliverables");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].url, "https://cdn.example.com/latest-1.jpg");
});

test("review media selector falls back to newest previous deliverable bundle and never concatenates history", () => {
  const selectAssignmentReviewMediaBundle = loadAssignmentReviewMediaBundleSelector();
  const previousRows = Array.from({ length: 14 }, (_, index) => ({
    id: 100 + index,
    submission_id: 11,
    deliverable_type: "photos",
    source_url: `https://cdn.example.com/prev-${index + 1}.jpg`,
    title: `prev ${index + 1}`,
  }));
  const accumulatedPayload = Array.from({ length: 39 }, (_, index) => ({
    id: 500 + index,
    mime_type: "image/jpeg",
    public_url: `https://cdn.example.com/payload-${index + 1}.jpg`,
  }));
  const result = selectAssignmentReviewMediaBundle(
    [
      { id: 12, media_payload_json: { assets: accumulatedPayload } },
      { id: 11, media_payload_json: { assets: [] } },
    ],
    previousRows,
    "photos"
  );

  assert.equal(result.source_submission_id, 11);
  assert.equal(result.source_type, "deliverables");
  assert.equal(result.items.length, 14);
  assert.equal(result.items[0].url, "https://cdn.example.com/prev-1.jpg");
  assert.equal(result.items.some((item) => item.url === "https://cdn.example.com/payload-1.jpg"), false);
});

test("review media selector ignores text deliverables, uses newest valid previous bundle only, and falls back to one payload bundle", () => {
  const selectAssignmentReviewMediaBundle = loadAssignmentReviewMediaBundleSelector();
  const resultWithPrevious = selectAssignmentReviewMediaBundle(
    [
      { id: 14, media_payload_json: { assets: [] } },
      { id: 13, media_payload_json: { assets: [] } },
      { id: 12, media_payload_json: { assets: [] } },
    ],
    [
      { id: 301, submission_id: 13, deliverable_type: "caption_draft", source_url: "https://cdn.example.com/text.txt", title: "ignore text" },
      { id: 201, submission_id: 12, deliverable_type: "photos", source_url: "https://cdn.example.com/older-valid.jpg", title: "older valid" },
      { id: 211, submission_id: 13, deliverable_type: "photos", source_url: "https://cdn.example.com/newer-valid.jpg", title: "newer valid" },
    ],
    "photos"
  );

  assert.equal(resultWithPrevious.source_submission_id, 13);
  assert.equal(resultWithPrevious.items.length, 1);
  assert.equal(resultWithPrevious.items[0].url, "https://cdn.example.com/newer-valid.jpg");

  const payloadFallback = selectAssignmentReviewMediaBundle(
    [
      { id: 15, media_payload_json: { assets: [{ id: 901, mime_type: "text/plain", public_url: "https://cdn.example.com/readme.txt" }] } },
      { id: 14, media_payload_json: { assets: [{ id: 902, mime_type: "image/jpeg", public_url: "https://cdn.example.com/fallback.jpg", file_name: "fallback.jpg" }] } },
      { id: 13, media_payload_json: { assets: [{ id: 903, mime_type: "image/jpeg", public_url: "https://cdn.example.com/older-fallback.jpg", file_name: "older-fallback.jpg" }] } },
    ],
    [],
    "photos"
  );

  assert.equal(payloadFallback.source_submission_id, 14);
  assert.equal(payloadFallback.source_type, "payload");
  assert.equal(payloadFallback.items.length, 1);
  assert.equal(payloadFallback.items[0].url, "https://cdn.example.com/fallback.jpg");
});

test("review media items keep CTA and taxonomy on latest submission while gallery uses selected previous media bundle", () => {
  const state = {
    assignments: {
      deliverablesBundle: {
        assignment_id: 24,
        latest_submission_id: 12,
        deliverables_by_type: {},
      },
      latestSubmissionRows: {
        24: {
          id: 12,
          field_return_payload_json: {
            requested_check_returns: {
              "cta_contact.phone": { checked: true, found: true, value: "0812345678", answer_type: "phone" },
            },
          },
          media_payload_json: {
            assets: Array.from({ length: 39 }, (_, index) => ({
              id: 700 + index,
              mime_type: "image/jpeg",
              public_url: `https://cdn.example.com/payload-${index + 1}.jpg`,
            })),
          },
        },
      },
      submissionRowsByAssignment: {
        24: [
          {
            id: 12,
            field_return_payload_json: {
              requested_check_returns: {
                "cta_contact.phone": { checked: true, found: true, value: "0812345678", answer_type: "phone" },
              },
            },
            media_payload_json: {
              assets: Array.from({ length: 39 }, (_, index) => ({
                id: 700 + index,
                mime_type: "image/jpeg",
                public_url: `https://cdn.example.com/payload-${index + 1}.jpg`,
              })),
            },
          },
          { id: 11, media_payload_json: { assets: [] } },
        ],
      },
      deliverableRowsByAssignment: {
        24: Array.from({ length: 14 }, (_, index) => ({
          id: 400 + index,
          submission_id: 11,
          deliverable_type: "photos",
          source_url: `https://cdn.example.com/prev-${index + 1}.jpg`,
          title: `prev ${index + 1}`,
        })),
      },
    },
  };
  const getAssignmentReviewMediaItems = loadAssignmentReviewMediaItemsHarness(state);
  const photoItems = getAssignmentReviewMediaItems({ id: 24, latest_submission_id: 12 }, "photos");

  assert.equal(photoItems.length, 14);
  assert.equal(photoItems[0].url, "https://cdn.example.com/prev-1.jpg");
  assert.equal(photoItems.some((item) => item.url === "https://cdn.example.com/payload-1.jpg"), false);
  assert.equal(state.assignments.latestSubmissionRows[24].field_return_payload_json.requested_check_returns["cta_contact.phone"].value, "0812345678");
});

test("loadAssignmentDeliverablesBundle keeps latest-bundle media when all-deliverables history request fails", async () => {
  const state = {
    assignments: {
      selectedId: 24,
      deliverablesBundle: null,
      deliverableRowsByAssignment: {},
      latestSubmissionRows: {
        24: {
          id: 12,
          media_payload_json: {
            assets: Array.from({ length: 39 }, (_, index) => ({
              id: 700 + index,
              mime_type: "image/jpeg",
              public_url: `https://cdn.example.com/payload-${index + 1}.jpg`,
              file_name: `payload-${index + 1}.jpg`,
            })),
          },
        },
      },
      submissionRowsByAssignment: {
        24: [
          {
            id: 12,
            media_payload_json: {
              assets: Array.from({ length: 39 }, (_, index) => ({
                id: 700 + index,
                mime_type: "image/jpeg",
                public_url: `https://cdn.example.com/payload-${index + 1}.jpg`,
                file_name: `payload-${index + 1}.jpg`,
              })),
            },
          },
        ],
      },
    },
  };
  const assignment = { id: 24, latest_submission_id: 12 };
  const latestBundle = {
    assignment_id: 24,
    latest_submission_id: 12,
    deliverables_by_type: {
      photos: Array.from({ length: 14 }, (_, index) => ({
        id: 201 + index,
        submission_id: 12,
        deliverable_type: "photos",
        source_url: `https://cdn.example.com/latest-bundle-${index + 1}.jpg`,
        title: `latest bundle ${index + 1}`,
      })),
    },
    missing_deliverable_types: [],
  };
  const calls = [];
  const renderStates = [];
  const loadAssignmentDeliverablesBundle = await loadNamedAsyncFunction(appJs, "loadAssignmentDeliverablesBundle", {
    state,
    isEditorUser: () => false,
    ensureSelectedAssignmentId: () => 24,
    api: async (path) => {
      calls.push(path);
      if (path === "/api/assignments/24/deliverables/latest-bundle") {
        return { bundle: latestBundle };
      }
      if (path === "/api/assignments/24/deliverables") {
        throw new Error("history endpoint failed");
      }
      throw new Error(`unexpected path ${path}`);
    },
    getAssignmentById: () => assignment,
    renderAssignmentDeliverablesSummary: (bundle) => {
      renderStates.push({ kind: "summary", photoCount: Array.isArray(bundle?.deliverables_by_type?.photos) ? bundle.deliverables_by_type.photos.length : 0 });
    },
    renderAssignmentReviewSummary: () => {
      renderStates.push({ kind: "review-summary" });
    },
    renderAssignmentReviewSubmissionContent: () => {
      renderStates.push({ kind: "review-content", selectedBundle: state.assignments.deliverablesBundle });
    },
    setStatus: () => {},
  });

  const result = await loadAssignmentDeliverablesBundle({ showStatus: false });
  const getAssignmentReviewMediaItems = loadAssignmentReviewMediaItemsHarness(state, {
    getLatestAssignmentSubmissionRow: () => state.assignments.latestSubmissionRows[24],
  });
  const photoItems = getAssignmentReviewMediaItems(assignment, "photos");

  assert.equal(result, latestBundle);
  assert.deepEqual(calls, [
    "/api/assignments/24/deliverables/latest-bundle",
    "/api/assignments/24/deliverables",
  ]);
  assert.equal(state.assignments.deliverablesBundle, latestBundle);
  assert.deepEqual(state.assignments.deliverableRowsByAssignment[24], []);
  assert.equal(photoItems.length, 14);
  assert.equal(photoItems[0].url, "https://cdn.example.com/latest-bundle-1.jpg");
  assert.equal(photoItems.some((item) => item.url === "https://cdn.example.com/payload-1.jpg"), false);
  assert.equal(renderStates.some((entry) => entry.kind === "review-content" && entry.selectedBundle === latestBundle), true);
});

test("review requested-check cards use latest submission payload and render CTA/Curation read-only", () => {
  const harness = createReviewHarness();
  const html = harness.buildAssignmentReviewRequestedCheckCardsHtml(harness.assignment);

  assert.match(html, /data-review-requested-check-group="cta_contact"/);
  assert.match(html, /data-review-requested-check-group="taxonomy"/);
  assert.match(html, /CTA\/ติดต่อ/);
  assert.match(html, /Curation/);
  assert.match(html, /0812345678/);
  assert.match(html, /ไม่พบ/);
  assert.match(html, /ไม่มี/);
  assert.match(html, /มี/);
  assert.match(html, /0 บาท/);
  assert.doesNotMatch(html, /ignored-draft/);
  assert.doesNotMatch(html, /Category/);
});

test("review renderer mounts requested-check cards once and does not call editable requested-check renderer", () => {
  const harness = createReviewHarness();
  let editableCalls = 0;
  const renderAssignmentReviewSubmissionContent = loadNamedFunction(appJs, "renderAssignmentReviewSubmissionContent", {
    state: harness.state,
    qs: (id) => harness.nodes.get(id) || null,
    getAssignmentPageMode: () => "review",
    getLatestAssignmentSubmissionRow: harness.getLatestAssignmentSubmissionRow,
    buildAssignmentReviewTextSections: () => [],
    getAssignmentReviewTextDeliverables: () => [],
    getAssignmentReviewMediaItems: () => [],
    hideAssignmentReviewHoverPreview: () => {},
    showAssignmentReviewHoverPreview: () => {},
    positionAssignmentReviewHoverPreview: () => {},
    buildAssignmentReviewRequestedCheckCardsHtml: harness.buildAssignmentReviewRequestedCheckCardsHtml,
    buildAssignmentReviewRequestedCheckRowsForGroup,
    renderAssignmentRequestedCheckSection: () => {
      editableCalls += 1;
    },
    escapeHtml,
  });

  renderAssignmentReviewSubmissionContent(harness.assignment);
  renderAssignmentReviewSubmissionContent(harness.assignment);

  assert.equal(editableCalls, 0);
  assert.match(harness.contentNode.innerHTML, /assignment-review-requested-check-cards/);
  assert.equal((harness.contentNode.innerHTML.match(/assignment-review-requested-check-cards/g) || []).length, 1);
});

test("review requested-check cards stay empty when latest submission has no requested returns", () => {
  const harness = createReviewHarness({
    latestSubmissionRow: {
      id: 12,
      field_return_payload_json: {
        requested_check_returns: {},
      },
    },
  });
  const html = harness.buildAssignmentReviewRequestedCheckCardsHtml(harness.assignment);

  assert.equal(html, "");
  harness.renderAssignmentReviewSubmissionContent(harness.assignment);
  assert.doesNotMatch(harness.contentNode.innerHTML, /assignment-review-requested-check-cards/);
});

test("requested-check section uses namespaced keys and hides reserved taxonomy metadata rows", () => {
  const handoffPackage = {
    requested_checks: {
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
              instruction: "Use the phone number that is actually reachable",
              answer_type: "phone",
              suggested_value: "0812345678",
              evidence_required: true,
            },
            {
              key: "line_url",
              requested: false,
              label: "LINE",
              instruction: "Still render from handoff",
              answer_type: "url",
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
              instruction: "Must not render as editable row",
              answer_type: "text",
              suggested_value: "restaurants",
            },
          ],
        },
      ],
    },
    niche: "restaurants",
  };

  const groups = getAssignmentRequestedCheckGroupsFromHandoffPackage(handoffPackage);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].checks[0].return_key, "cta_contact.phone");
  assert.equal(groups[1].checks[0].return_key, "taxonomy.category");
  assert.deepEqual(
    [...new Set(groups.flatMap((group) => group.checks.map((check) => check.return_key)))].sort(),
    ["cta_contact.line_url", "cta_contact.phone", "taxonomy.category"]
  );

  const draft = buildAssignmentRequestedCheckReturnDraftFromHandoffPackage(handoffPackage);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].checked, false);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].value, "0812345678");
  assert.equal(draft.requested_check_returns["taxonomy.category"].value, "restaurants");
  assert.equal(getAssignmentRequestedCheckDefaultValue("boolean"), null);
  assert.deepEqual(getAssignmentRequestedCheckDefaultValue("multi_select"), []);
  assert.deepEqual(getAssignmentRequestedCheckDefaultValue("number_with_unit"), { number: "", unit: "" });

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, draft);
  assert.ok(sectionHtml.includes('data-requested-check-return-key="cta_contact.phone"'));
  assert.ok(sectionHtml.includes('data-requested-check-return-key="cta_contact.line_url"'));
  assert.equal((sectionHtml.match(/data-requested-check-return-key="cta_contact\.phone"/g) || []).length, 1);
  assert.equal((sectionHtml.match(/data-requested-check-return-key="cta_contact\.line_url"/g) || []).length, 1);
  assert.equal((sectionHtml.match(/requested-check-row-status/g) || []).length, 2);
  assert.equal((sectionHtml.match(/AI แนะนำ/g) || []).length, 1);
  assert.equal((sectionHtml.match(/data-requested-check-group="/g) || []).length, 1);
  assert.equal((sectionHtml.match(/class="assignment-brief-section full-span assignment-capture-card requested-check-cta-row"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/class="assignment-capture-row requested-check-row-main"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/class="assignment-capture-title requested-check-row-label"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/class="assignment-capture-actions requested-check-row-status"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/class="requested-check-row-secondary"/g) || []).length, 0);
  assert.doesNotMatch(sectionHtml, /หลักฐาน \(จำเป็น\)/);
  assert.equal((sectionHtml.match(/class="requested-check-cta-list"/g) || []).length, 0);
  assert.equal((sectionHtml.match(/class="requested-check-cta-card"/g) || []).length, 0);
  assert.equal(sectionHtml.includes('data-requested-check-return-key="taxonomy.category"'), false);
  assert.equal(sectionHtml.includes('data-requested-check-group="taxonomy"'), false);
  assert.doesNotMatch(sectionHtml, /หมวดหลัก|หมวดย่อย|แท็ก|จาก Clean|requested-check-curation-category-context/);
  assert.match(sectionHtml, /AI แนะนำ/);
  assert.doesNotMatch(sectionHtml, /Manual|ข้อมูลเพิ่มเติม/);
});

test("requested-check draft prefills suggested values without auto-checking namespaced keys", () => {
  const handoffPackage = {
    requested_checks: {
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
              answer_type: "phone",
              suggested_value: "0812345678",
            },
          ],
        },
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            {
              key: "tags",
              requested: true,
              label: "Tags",
              answer_type: "multi_select",
              suggested_value: ["family", "cafe"],
            },
          ],
        },
      ],
    },
  };

  const draft = buildAssignmentRequestedCheckReturnDraftFromHandoffPackage(handoffPackage);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].checked, false);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].value, "0812345678");
  assert.equal(draft.requested_check_returns["cta_contact.phone"].evidence, "");
  assert.equal(draft.requested_check_returns["taxonomy.tags"].checked, false);
  assert.deepEqual(draft.requested_check_returns["taxonomy.tags"].value, ["family", "cafe"]);
});

test("requested-check draft prefills CTA values for new handoffs with checked false", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            { key: "phone", requested: true, label: "Phone", answer_type: "phone", suggested_value: "0659391488", evidence_required: true },
            { key: "facebook_url", requested: true, label: "Facebook", answer_type: "url", suggested_value: "https://www.facebook.com/hippieroaster/?locale=th_TH" },
          ],
        },
      ],
    },
  };

  const draft = buildAssignmentRequestedCheckReturnDraftFromHandoffPackage(handoffPackage);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].checked, false);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].value, "0659391488");
  assert.equal(draft.requested_check_returns["cta_contact.phone"].evidence, "");
  assert.equal(draft.requested_check_returns["cta_contact.phone"].suggested_value, "0659391488");
  assert.equal(draft.requested_check_returns["cta_contact.facebook_url"].checked, false);
  assert.equal(draft.requested_check_returns["cta_contact.facebook_url"].value, "https://www.facebook.com/hippieroaster/?locale=th_TH");
  assert.equal(Object.prototype.hasOwnProperty.call(draft.requested_check_returns, "cta_contact.primary_cta"), false);
});

test("requested-check draft keeps taxonomy boolean suggestions separate from confirmed checkbox state", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "parking", requested: true, label: "Parking", answer_type: "boolean", suggested_value: true },
            { key: "pet_friendly", requested: true, label: "Pet Friendly", answer_type: "boolean", suggested_value: false },
          ],
        },
      ],
    },
  };

  const draft = buildAssignmentRequestedCheckReturnDraftFromHandoffPackage(handoffPackage);
  assert.equal(draft.requested_check_returns["taxonomy.parking"].checked, false);
  assert.equal(draft.requested_check_returns["taxonomy.parking"].value, false);
  assert.equal(draft.requested_check_returns["taxonomy.parking"].suggested_value, true);
  assert.equal(draft.requested_check_returns["taxonomy.pet_friendly"].checked, false);
  assert.equal(draft.requested_check_returns["taxonomy.pet_friendly"].value, false);
  assert.equal(draft.requested_check_returns["taxonomy.pet_friendly"].suggested_value, false);
});
test("requested-check draft prefill ignores empty current draft objects and falls back to latest submission values", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          checks: [
            { key: "phone", requested: true, answer_type: "phone" },
          ],
        },
        {
          group_key: "taxonomy",
          checks: [
            { key: "parking", requested: true, answer_type: "boolean" },
          ],
        },
      ],
    },
  };
  const state = {
    assignments: {
      selectedId: 12,
      requestedCheckReturnDrafts: {
        12: {
          requested_check_returns: {},
        },
      },
      latestSubmissionRows: {
        12: {
          field_return_payload_json: {
            requested_check_returns: {
              "cta_contact.phone": { checked: true, value: "0811111111", evidence: "signage" },
              "taxonomy.parking": { checked: true, value: false },
            },
          },
        },
      },
    },
  };
  const assignment = { id: 12 };
  const loadPrefill = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
    state,
    getLatestAssignmentSubmissionRow: () => state.assignments.latestSubmissionRows[12],
    getAssignmentSubmissionDraftKey: () => "12:1",
    normalizeAssignmentRequestedCheckReturnDraft,
    hasUsableAssignmentRequestedCheckReturnRows,
  });

  const draft = loadPrefill(assignment, handoffPackage);

  assert.equal(draft.requested_check_returns["cta_contact.phone"].value, "0811111111");
  assert.equal(draft.requested_check_returns["taxonomy.parking"].value, false);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].checked, true);
});

test("requested-check draft prefill prefers current local draft over server draft and latest submission", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          checks: [
            { key: "phone", requested: true, answer_type: "phone" },
          ],
        },
      ],
    },
  };
  const state = {
    assignments: {
      selectedId: 12,
      requestedCheckReturnDrafts: {
        12: {
          requested_check_returns: {
            "cta_contact.phone": { checked: true, value: "0999999999", evidence: "local edit" },
          },
        },
      },
      requestedCheckReturnDraftDirty: {
        12: true,
      },
      requestedCheckReturnDraftSources: {
        12: "user_edit",
      },
      serverSubmissionDraftPayloads: {
        "12:1": {
          field_return_payload_json: {
            requested_check_returns: {
              "cta_contact.phone": { checked: true, value: "0888888888", evidence: "server draft" },
            },
          },
        },
      },
      latestSubmissionRows: {
        12: {
          field_return_payload_json: {
            requested_check_returns: {
              "cta_contact.phone": { checked: true, value: "0811111111", evidence: "latest submission" },
            },
          },
        },
      },
    },
  };
  const loadPrefill = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
    state,
    getLatestAssignmentSubmissionRow: () => state.assignments.latestSubmissionRows[12],
    getAssignmentSubmissionDraftKey: () => "12:1",
    normalizeAssignmentRequestedCheckReturnDraft,
    hasUsableAssignmentRequestedCheckReturnRows,
  });

  const draft = loadPrefill({ id: 12 }, handoffPackage);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].value, "0999999999");
  assert.equal(draft.requested_check_returns["cta_contact.phone"].evidence, "local edit");
});

test("requested-check draft prefill prefers current revision server draft over latest submission when local draft is empty", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          checks: [
            { key: "parking", requested: true, answer_type: "boolean" },
          ],
        },
      ],
    },
  };
  const state = {
    assignments: {
      selectedId: 12,
      requestedCheckReturnDrafts: {
        12: {
          requested_check_returns: {},
        },
      },
      serverSubmissionDraftPayloads: {
        "12:1": {
          field_return_payload_json: {
            requested_check_returns: {
              "taxonomy.parking": { checked: true, value: false },
            },
          },
        },
      },
      latestSubmissionRows: {
        12: {
          field_return_payload_json: {
            requested_check_returns: {
              "taxonomy.parking": { checked: true, value: true },
            },
          },
        },
      },
    },
  };
  const loadPrefill = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
    state,
    getLatestAssignmentSubmissionRow: () => state.assignments.latestSubmissionRows[12],
    getAssignmentSubmissionDraftKey: () => "12:1",
    normalizeAssignmentRequestedCheckReturnDraft,
    hasUsableAssignmentRequestedCheckReturnRows,
  });

  const draft = loadPrefill({ id: 12 }, handoffPackage);
  assert.equal(draft.requested_check_returns["taxonomy.parking"].value, false);
});

test("requested-check draft prefill lets usable server draft beat non-dirty schema defaults", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          checks: [
            { key: "parking", requested: true, answer_type: "boolean" },
          ],
        },
      ],
    },
  };
  const state = {
    assignments: {
      selectedId: 12,
      requestedCheckReturnDrafts: {
        12: normalizeAssignmentRequestedCheckReturnDraft(null, handoffPackage),
      },
      requestedCheckReturnDraftDirty: {
        12: false,
      },
      requestedCheckReturnDraftSources: {
        12: "schema_default",
      },
      serverSubmissionDraftPayloads: {
        "12:1": {
          field_return_payload_json: {
            requested_check_returns: {
              "taxonomy.parking": { checked: true, value: true },
            },
          },
        },
      },
    },
  };
  const loadPrefill = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
    state,
    getLatestAssignmentSubmissionRow: () => null,
    getAssignmentSubmissionDraftKey: () => "12:1",
    normalizeAssignmentRequestedCheckReturnDraft,
    hasUsableAssignmentRequestedCheckReturnRows,
  });

  const draft = loadPrefill({ id: 12 }, handoffPackage);
  assert.equal(draft.requested_check_returns["taxonomy.parking"].value, true);
  assert.equal(draft.requested_check_returns["taxonomy.parking"].checked, true);
});

test("requested-check draft prefill lets latest submission beat empty server returns and schema defaults", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          checks: [
            { key: "phone", requested: true, answer_type: "phone" },
          ],
        },
      ],
    },
  };
  const state = {
    assignments: {
      selectedId: 12,
      requestedCheckReturnDrafts: {
        12: normalizeAssignmentRequestedCheckReturnDraft(null, handoffPackage),
      },
      requestedCheckReturnDraftDirty: {
        12: false,
      },
      requestedCheckReturnDraftSources: {
        12: "schema_default",
      },
      serverSubmissionDraftPayloads: {
        "12:1": {
          field_return_payload_json: {
            requested_check_returns: {},
          },
        },
      },
      latestSubmissionRows: {
        12: {
          field_return_payload_json: {
            requested_check_returns: {
              "cta_contact.phone": { checked: true, value: "0811111111", evidence: "latest submission" },
            },
          },
        },
      },
    },
  };
  const loadPrefill = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
    state,
    getLatestAssignmentSubmissionRow: () => state.assignments.latestSubmissionRows[12],
    getAssignmentSubmissionDraftKey: () => "12:1",
    normalizeAssignmentRequestedCheckReturnDraft,
    hasUsableAssignmentRequestedCheckReturnRows,
  });

  const draft = loadPrefill({ id: 12 }, handoffPackage);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].value, "0811111111");
  assert.equal(draft.requested_check_returns["cta_contact.phone"].evidence, "latest submission");
});

test("requested-check section renders CTA before legacy custom groups and hides reserved taxonomy placeholder rows", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "Category", answer_type: "text" },
          ],
        },
        {
          group_key: "custom",
          group_label: "Custom",
          checks: [
            { key: "parking", requested: true, label: "Parking", answer_type: "text" },
          ],
        },
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            { key: "phone", requested: true, label: "Phone", answer_type: "phone", evidence_required: true, suggested_value: "0812345678" },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  const ctaIndex = sectionHtml.indexOf('data-requested-check-group="cta_contact"');
  const customIndex = sectionHtml.indexOf('data-requested-check-group="custom"');
  assert.ok(ctaIndex >= 0);
  assert.ok(customIndex > ctaIndex);
  assert.equal(sectionHtml.includes('data-requested-check-group="taxonomy"'), false);
  assert.equal(sectionHtml.includes('data-requested-check-field="evidence"'), false);
  assert.equal(sectionHtml.includes('data-requested-check-return-key="taxonomy.category"'), false);
  assert.match(sectionHtml, /<div class="assignment-brief-label">CTA\/ติดต่อ<\/div>/);
  assert.doesNotMatch(sectionHtml, /<div class="assignment-brief-label">Curation<\/div>/);
  assert.equal(sectionHtml.includes('data-requested-check-group="custom"'), true);
  assert.equal(sectionHtml.includes('data-requested-check-return-key="custom.parking"'), true);
});

test("requested-check section omits empty groups instead of rendering empty cards", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);

  assert.equal(sectionHtml.trim(), "");
  assert.equal(sectionHtml.includes("data-requested-check-row"), false);
  assert.equal(sectionHtml.includes('data-requested-check-field="checked"'), false);
});

test("requested-check section renders all five standard CTA checks with editable values", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            { key: "phone", requested: true, label: "Phone", answer_type: "phone", suggested_value: "0812345678" },
            { key: "line_url", requested: true, label: "LINE", answer_type: "url" },
            { key: "facebook_url", requested: true, label: "Facebook", answer_type: "url" },
            { key: "website_url", requested: true, label: "Website", answer_type: "url" },
            { key: "primary_cta", requested: true, label: "Primary CTA", answer_type: "text" },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  for (const key of ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]) {
    assert.match(sectionHtml, new RegExp(`data-requested-check-return-key="cta_contact\\.${key}"`));
  }
  assert.equal((sectionHtml.match(/requested-check-row-status/g) || []).length, 5);
  assert.match(sectionHtml, /value="0812345678"/);
  assert.match(sectionHtml, /data-requested-check-field="value" type="url" value=""/);
  assert.match(sectionHtml, /AI แนะนำ/);
  assert.doesNotMatch(sectionHtml, /Manual/);
});

test("requested-check section places only real suggested taxonomy rows into Curation primary area", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "price_range", requested: true, label: "Price Range", answer_type: "number_with_unit" },
            { key: "subtype", requested: true, label: "Subtype", answer_type: "text" },
            { key: "tags", requested: true, label: "Tags", answer_type: "multi_select" },
            { key: "distance", requested: true, label: "Distance", answer_type: "number_with_unit", suggested_value: { number: 5, unit: "km" } },
          ],
        },
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            { key: "phone", requested: true, label: "Phone", answer_type: "phone", suggested_value: "0812345678" },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  const curationStart = sectionHtml.indexOf('data-requested-check-group="taxonomy"');
  const detailsStart = sectionHtml.indexOf('<details class="requested-check-curation-more"');
  assert.ok(curationStart >= 0);
  assert.ok(detailsStart > curationStart);
  assert.equal(sectionHtml.includes('data-requested-check-return-key="taxonomy.category"'), false);
  assert.ok(sectionHtml.indexOf('data-requested-check-return-key="taxonomy.distance"') < detailsStart);
  assert.equal(sectionHtml.includes('data-requested-check-return-key="taxonomy.subtype"'), false);
  assert.equal(sectionHtml.includes('data-requested-check-return-key="taxonomy.tags"'), false);
  assert.ok(sectionHtml.indexOf('data-requested-check-return-key="taxonomy.price_range"') > detailsStart);
  assert.match(sectionHtml, /ตัวเลือกเพิ่มเติม \(1\)/);
});

test("requested-check section keeps additional taxonomy rows collapsed by default and opens them for checked or meaningful saved values", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "Category", answer_type: "text" },
            { key: "subtype", requested: true, label: "Subtype", answer_type: "text" },
            { key: "parking", requested: true, label: "Parking", answer_type: "text" },
          ],
        },
      ],
    },
  };

  const collapsedHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  assert.match(collapsedHtml, /<details class="requested-check-curation-more">/);
  assert.doesNotMatch(collapsedHtml, /<details class="requested-check-curation-more" open>/);
  assert.match(collapsedHtml, /ตัวเลือกเพิ่มเติม \(1\)/);

  const checkedHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, {
    requested_check_returns: {
      "taxonomy.parking": {
        checked: true,
        value: "",
      },
    },
  });
  assert.match(checkedHtml, /<details class="requested-check-curation-more" open>/);

  const valuedHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, {
    requested_check_returns: {
      "taxonomy.parking": {
        checked: false,
        value: "มีที่จอด",
      },
    },
  });
  assert.match(valuedHtml, /<details class="requested-check-curation-more" open>/);

  const conditionedHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, {
    requested_check_returns: {
      "taxonomy.parking": {
        checked: false,
        value: "",
        condition_note: "เฉพาะหน้าร้าน",
      },
    },
  });
  assert.match(conditionedHtml, /<details class="requested-check-curation-more" open>/);
});

test("requested-check section omits Curation entirely when only reserved taxonomy keys exist", () => {
  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, {
    requested_checks: {
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
  }, null);

  assert.equal(sectionHtml.includes('data-requested-check-group="taxonomy"'), false);
  assert.doesNotMatch(sectionHtml, /Curation|ตัวเลือกเพิ่มเติม|requested-check-curation-more|requested-check-curation-category-context/);
});

test("requested-check section keeps edited additional taxonomy values in the additional panel without promoting them", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "Category", answer_type: "text" },
            { key: "parking", requested: true, label: "Parking", answer_type: "text" },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, {
    requested_check_returns: {
      "taxonomy.parking": {
        checked: false,
        value: "จอดได้ 10 คัน",
      },
    },
  });
  const detailsStart = sectionHtml.indexOf('<details class="requested-check-curation-more" open>');
  assert.ok(detailsStart >= 0);
  assert.ok(sectionHtml.indexOf('data-requested-check-return-key="taxonomy.parking"') > detailsStart);
  assert.match(sectionHtml, /value="จอดได้ 10 คัน"/);
});

test("requested-check curation helper treats only non-reserved taxonomy keys as renderable", () => {
  assert.equal(isAssignmentCurationRenderableCheck({ group_key: "cta_contact", check_key: "phone" }), false);
  assert.equal(isAssignmentCurationRenderableCheck({ group_key: "taxonomy", check_key: "" }), false);
  assert.equal(isAssignmentCurationRenderableCheck({ group_key: "taxonomy", check_key: "category" }), false);
  assert.equal(isAssignmentCurationRenderableCheck({ group_key: "taxonomy", check_key: "subtype" }), false);
  assert.equal(isAssignmentCurationRenderableCheck({ group_key: "taxonomy", check_key: "tags" }), false);
  assert.equal(isAssignmentCurationRenderableCheck({ group_key: "taxonomy", check_key: "air_conditioning" }), true);
});

test("requested-check curation placement uses only meaningful suggested values for primary fallback", () => {
  assert.equal(
    resolveAssignmentCurationCheckPlacement(
      { group_key: "taxonomy", check_key: "air_conditioning", answer_type: "boolean", suggested_value: true },
      { value: false, condition_note: "ริมร้าน" }
    ),
    "primary"
  );
  assert.equal(
    resolveAssignmentCurationCheckPlacement(
      { group_key: "taxonomy", check_key: "parking", answer_type: "text", suggested_value: "" },
      { value: "มีที่จอด", condition_note: "หน้าร้าน" }
    ),
    "additional"
  );
  assert.equal(
    resolveAssignmentCurationCheckPlacement(
      { group_key: "taxonomy", check_key: "tags", answer_type: "multi_select", suggested_value: ["family"] },
      { value: ["family"] }
    ),
    "hidden"
  );
});

test("requested-check section keeps edited prefilled values and hides AI chip when value diverges", () => {
  const handoffPackage = {
    requested_checks: {
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
              answer_type: "phone",
              suggested_value: "0812345678",
            },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, {
    requested_check_returns: {
      "cta_contact.phone": {
        checked: true,
        value: "0999999999",
      },
    },
  });

  assert.match(sectionHtml, /value="0999999999"/);
  assert.equal(sectionHtml.includes('value="0812345678"'), false);
  assert.doesNotMatch(sectionHtml, /AI แนะนำ|Manual/);
});

test("requested-check section renders compact CTA rows with optional AI chip and no details disclosure", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            { key: "phone", requested: true, label: "Phone", answer_type: "phone", suggested_value: "" },
            { key: "line_url", requested: true, label: "LINE", answer_type: "url", suggested_value: null },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  assert.match(sectionHtml, /<div class="assignment-capture-row requested-check-row-main">\s*<label class="assignment-inline-check">/);
  assert.match(sectionHtml, /<div class="assignment-capture-title requested-check-row-label">/);
  assert.match(sectionHtml, /<div class="assignment-capture-actions requested-check-row-status">/);
  assert.match(sectionHtml, /<div class="requested-check-row-value">/);
  assert.match(sectionHtml, /<div class="assignment-brief-section full-span requested-check-cta-section" data-requested-check-group="cta_contact">/);
  assert.equal((sectionHtml.match(/requested-check-row-status/g) || []).length, 2);
  assert.equal((sectionHtml.match(/AI แนะนำ/g) || []).length, 0);
  assert.ok(sectionHtml.includes('<div class="assignment-capture-actions requested-check-row-status"></div>'));
  assert.equal((sectionHtml.match(/class="requested-check-cta-list"/g) || []).length, 0);
  assert.doesNotMatch(sectionHtml, /<details|<summary|รายละเอียด|Manual/);
});

test("requested-check CTA rows do not render condition inputs", () => {
  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            { key: "phone", requested: true, label: "Phone", answer_type: "phone" },
          ],
        },
      ],
    },
  }, null);
  assert.equal(sectionHtml.includes('data-requested-check-field="condition_note"'), false);
});

test("requested-check section shows no AI chip for null or empty suggestions", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            { key: "phone", requested: true, label: "Phone", answer_type: "phone", suggested_value: "" },
            { key: "line_url", requested: true, label: "LINE", answer_type: "url", suggested_value: null },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  assert.equal((sectionHtml.match(/requested-check-row-status/g) || []).length, 2);
  assert.ok(sectionHtml.includes('<div class="assignment-capture-actions requested-check-row-status"></div>'));
  assert.doesNotMatch(sectionHtml, /AI แนะนำ|Manual/);
});

test("requested-check section renders condition input on visible taxonomy rows and keeps AI badge tied to main value only", () => {
  const handoffPackage = {
    niche: "restaurants",
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "parking", requested: true, label: "Parking", answer_type: "boolean", suggested_value: true },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, {
    requested_check_returns: {
      "taxonomy.parking": {
        checked: true,
        value: true,
        condition_note: "front area",
      },
    },
  });
  assert.match(sectionHtml, /data-requested-check-field="condition_note"/);
  assert.match(sectionHtml, /requested-check-curation-row/);
  assert.match(sectionHtml, /value="front area"/);
  assert.equal(sectionHtml.includes("AI แนะนำ"), true);

  const divergedHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, {
    requested_check_returns: {
      "taxonomy.parking": {
        checked: true,
        value: false,
        condition_note: "front area",
      },
    },
  });
  assert.equal(divergedHtml.includes("AI แนะนำ"), true);
});

test("taxonomy boolean row renders as a single checkbox without a second value selector or helper text", () => {
  const rowHtml = buildAssignmentRequestedCheckReturnRowHtml(
    {
      return_key: "taxonomy.parking",
      group_key: "taxonomy",
      check_key: "parking",
      label: "Parking",
      answer_type: "boolean",
      suggested_value: true,
      evidence_required: false,
    },
    {
      checked: false,
      value: false,
      condition_note: "",
      evidence: "",
    },
    {
      showConditionNote: true,
      rowModifierClass: "requested-check-curation-row",
    }
  );

  assert.equal((rowHtml.match(/type="checkbox"/g) || []).length, 1);
  assert.equal(rowHtml.includes('data-requested-check-field="value"'), false);
  assert.doesNotMatch(rowHtml, /assignment-brief-text/);
  assert.equal(rowHtml.includes("AI แนะนำ"), true);
  assert.doesNotMatch(rowHtml, /type="checkbox"\s+checked\b/);
});

test("non-taxonomy boolean rows keep the original true-false value control", () => {
  const rowHtml = buildAssignmentRequestedCheckReturnRowHtml(
    {
      return_key: "custom.pet_friendly",
      group_key: "custom",
      check_key: "pet_friendly",
      label: "Pet friendly",
      answer_type: "boolean",
      suggested_value: true,
      evidence_required: false,
    },
    {
      checked: true,
      value: false,
      condition_note: "",
      evidence: "",
    },
    {}
  );

  assert.equal((rowHtml.match(/type="checkbox"/g) || []).length, 1);
  assert.equal(rowHtml.includes('data-requested-check-field="value"'), true);
  assert.equal(rowHtml.includes("ไม่เลือก = ไม่มี"), false);
  assert.equal(rowHtml.includes("AI แนะนำ"), false);
});

test("taxonomy boolean suggestion false does not auto-confirm or remove the AI badge", () => {
  const rowHtml = buildAssignmentRequestedCheckReturnRowHtml(
    {
      return_key: "taxonomy.pet_friendly",
      group_key: "taxonomy",
      check_key: "pet_friendly",
      label: "Pet friendly",
      answer_type: "boolean",
      suggested_value: false,
      evidence_required: false,
    },
    {
      checked: false,
      value: false,
      condition_note: "",
      evidence: "",
    },
    {}
  );

  assert.equal(rowHtml.includes("AI แนะนำ"), true);
  assert.match(rowHtml, /type="checkbox"/);
  assert.doesNotMatch(rowHtml, /type="checkbox"\s+checked\b/);
});

test("taxonomy boolean prior confirmed true from draft still renders checked", () => {
  const rowHtml = buildAssignmentRequestedCheckReturnRowHtml(
    {
      return_key: "taxonomy.parking",
      group_key: "taxonomy",
      check_key: "parking",
      label: "Parking",
      answer_type: "boolean",
      suggested_value: false,
      evidence_required: false,
    },
    {
      checked: true,
      value: true,
      condition_note: "",
      evidence: "",
    },
    {}
  );

  assert.match(rowHtml, /type="checkbox"\s+checked\b/);
  assert.equal(rowHtml.includes("AI แนะนำ"), true);
});

test("writeAssignmentSubmissionDraft merges local article and requested-check sections before scheduling save", () => {
  const state = {
    assignments: {
      contextFieldPack: null,
      requestedCheckReturnDrafts: {
        12: {
      requested_check_returns: {
        "taxonomy.parking": { checked: false, value: false, group_key: "taxonomy", answer_type: "boolean" },
      },
    },
      },
      submissionDrafts: {
        "12:1": {
          article_payload_json: { additional_text: "existing article" },
        },
      },
    },
  };
  const scheduledPayloads = [];
  const writeDraft = loadNamedFunction(appJs, "writeAssignmentSubmissionDraft", {
    state,
    getAssignmentSubmissionDraftKey: () => "12:1",
    normalizeAssignmentSubmissionPayload: (payload) => payload,
    buildAssignmentRequestedCheckReturnPayloadFromDraft,
    scheduleSaveAssignmentSubmissionServerDraft: (id, payload) => {
      scheduledPayloads.push({ id, payload });
    },
  });
  const readDraft = loadNamedFunction(appJs, "readAssignmentSubmissionDraft", {
    state,
    getAssignmentSubmissionDraftKey: () => "12:1",
    normalizeAssignmentSubmissionPayload: (payload) => payload,
  });

  writeDraft(12, null, { id: 12 }, { includeArticle: false, includeRequestedChecks: true });

  assert.deepEqual(state.assignments.submissionDrafts["12:1"], {
    article_payload_json: { additional_text: "existing article" },
    field_return_payload_json: {
      requested_check_returns: {
        "taxonomy.parking": {
          checked: true,
          value: false,
          condition_note: null,
          evidence: null,
          note: null,
        },
      },
    },
  });
  assert.deepEqual(scheduledPayloads[0], {
    id: 12,
    payload: state.assignments.submissionDrafts["12:1"],
  });
  assert.deepEqual(readDraft(12, { id: 12 }), { additional_text: "existing article" });
});

test("writeAssignmentSubmissionDraft preserves requested-check section during article-only local save", () => {
  const state = {
    assignments: {
      contextFieldPack: null,
      requestedCheckReturnDrafts: {},
      submissionDrafts: {
        "12:1": {
          article_payload_json: { additional_text: "existing article" },
          field_return_payload_json: {
            requested_check_returns: {
              "taxonomy.parking": { checked: true, value: false },
            },
          },
        },
      },
    },
  };
  const scheduledPayloads = [];
  const writeDraft = loadNamedFunction(appJs, "writeAssignmentSubmissionDraft", {
    state,
    getAssignmentSubmissionDraftKey: () => "12:1",
    normalizeAssignmentSubmissionPayload: (payload) => payload,
    buildAssignmentRequestedCheckReturnPayloadFromDraft,
    scheduleSaveAssignmentSubmissionServerDraft: (id, payload) => {
      scheduledPayloads.push({ id, payload });
    },
  });

  writeDraft(12, { additional_text: "updated article" }, { id: 12 }, { includeArticle: true, includeRequestedChecks: false });

  assert.deepEqual(state.assignments.submissionDrafts["12:1"], {
    article_payload_json: { additional_text: "updated article" },
    field_return_payload_json: {
      requested_check_returns: {
        "taxonomy.parking": { checked: true, value: false },
      },
    },
  });
  assert.deepEqual(scheduledPayloads[0], {
    id: 12,
    payload: state.assignments.submissionDrafts["12:1"],
  });
});

test("requested-check normalize keeps edited prefilled values through rerender merges", () => {
  const handoffPackage = {
    requested_checks: {
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
              answer_type: "phone",
              suggested_value: "0812345678",
            },
          ],
        },
      ],
    },
  };

  const normalized = normalizeAssignmentRequestedCheckReturnDraft({
    requested_check_returns: {
      "cta_contact.phone": {
        checked: true,
        value: "0999999999",
        note: "edited",
      },
    },
  }, handoffPackage);

  assert.equal(normalized.requested_check_returns["cta_contact.phone"].value, "0999999999");
  assert.equal(normalized.requested_check_returns["cta_contact.phone"].checked, true);
  assert.equal(normalized.requested_check_returns["cta_contact.phone"].note, "edited");
});

test("requested-check normalize keeps edited evidence through rerender merges", () => {
  const handoffPackage = {
    requested_checks: {
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
              answer_type: "phone",
              suggested_value: "0812345678",
              evidence_required: true,
            },
          ],
        },
      ],
    },
  };

  const normalized = normalizeAssignmentRequestedCheckReturnDraft({
    requested_check_returns: {
      "cta_contact.phone": {
        checked: true,
        value: "0999999999",
        evidence: "storefront sign",
      },
    },
  }, handoffPackage);

  assert.equal(normalized.requested_check_returns["cta_contact.phone"].checked, true);
  assert.equal(normalized.requested_check_returns["cta_contact.phone"].value, "0999999999");
  assert.equal(normalized.requested_check_returns["cta_contact.phone"].evidence, "storefront sign");
});

test("requested-check empty loaded state hides the requested-check surface through the submission form", async () => {
  const state = {
    assignments: {
      selectedId: 12,
      contextItemId: 27,
      contextFieldPack: {},
      requestedCheckReturnDrafts: {
        12: {
          requested_check_returns: {},
        },
      },
      handoffSourcePackages: {},
      handoffSourceSnapshotIds: {},
      handoffSourceLoaded: {},
    },
  };
  const assignment = {
    id: 12,
    content_item_id: 27,
    brief_json: { title: "Brief" },
  };
  const harness = createRequestedCheckRenderHarness(state);
  const loadAssignmentRequestedCheckHandoffSource = await loadNamedAsyncFunction(appJs, "loadAssignmentRequestedCheckHandoffSource", {
    state,
    isEditorUser: () => false,
    api: async () => ({
      handoff: {
        handoff_package_json: {
          requested_checks: {
            version: 1,
            groups: [],
          },
        },
      },
    }),
    rerenderAssignmentRequestedCheckSurfaces: loadNamedFunction(appJs, "rerenderAssignmentRequestedCheckSurfaces", {
      state,
      renderAssignmentHandoffBrief: () => {},
      renderAssignmentRequestedCheckSection: loadNamedFunction(appJs, "renderAssignmentRequestedCheckSection", {
        state,
        qs: harness.qs,
        getAssignmentRequestedCheckGroupsFromHandoffPackage,
        getAssignmentRequestedCheckReturnDraftPrefill: loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
          state,
          getLatestAssignmentSubmissionRow: () => null,
          getAssignmentSubmissionDraftKey: () => "12:1",
          normalizeAssignmentRequestedCheckReturnDraft,
          hasUsableAssignmentRequestedCheckReturnRows,
        }),
        normalizeAssignmentRequestedCheckReturnDraft,
        buildAssignmentRequestedCheckReturnSectionHtml,
        setAssignmentRequestedCheckReturnDraftState: loadNamedFunction(appJs, "setAssignmentRequestedCheckReturnDraftState", {
          state,
        }),
        hasUsableAssignmentRequestedCheckReturnRows,
        updateAssignmentRequestedCheckReturnRowState: () => {},
        isEditorUser: () => false,
        loadAssignmentRequestedCheckHandoffSource: async () => null,
      }),
      getAssignmentSubmissionFormAssignment: (value) => value,
      getAssignmentById: () => assignment,
      getAssignmentPageMode: () => "work",
    }),
  });

  await loadAssignmentRequestedCheckHandoffSource(assignment);

  const wrapNode = harness.nodes.get("assignment-submission-requested-checks-wrap");
  const fieldsNode = harness.nodes.get("assignment-submission-requested-checks-fields");

  assert.equal(wrapNode.classList.contains("hidden"), true);
  assert.equal(fieldsNode.innerHTML.trim(), "");
  assert.equal(fieldsNode.innerHTML.includes("data-requested-check-row"), false);
  assert.equal(fieldsNode.innerHTML.includes('data-requested-check-field="checked"'), false);
});

test("requested-check form reader merges visible CTA values into the existing draft without clearing hidden taxonomy values", () => {
  const rowNode = {
    getAttribute(name) {
      if (name === "data-requested-check-return-key") return "cta_contact.phone";
      if (name === "data-requested-check-answer-type") return "phone";
      return null;
    },
    querySelector(selector) {
      if (selector === "[data-requested-check-field='checked']") return { checked: true };
      if (selector === "[data-requested-check-field='value']") return { value: "0999999999" };
      return null;
    },
  };
  const formNode = {
    querySelectorAll(selector) {
      return selector === "[data-requested-check-row]" ? [rowNode] : [];
    },
  };
  const state = {
    assignments: {
      requestedCheckReturnDrafts: {
        12: {
          requested_check_returns: {
            "cta_contact.phone": {
              checked: true,
              value: "0812345678",
              condition_note: "old condition",
              evidence: "old evidence",
              note: "old note",
            },
            "taxonomy.category": {
              checked: true,
              value: "cafe",
              condition_note: "keep category",
              evidence: "keep evidence",
              note: "keep note",
            },
          },
        },
      },
      requestedCheckReturnDraftDirty: {
        12: true,
      },
      requestedCheckReturnDraftSources: {
        12: "user_edit",
      },
    },
  };
  const readDraft = loadNamedFunction(appJs, "readAssignmentRequestedCheckReturnDraftFromForm", {
    qs: () => formNode,
    state,
  });

  const draft = readDraft(12);

  assert.deepEqual(draft.requested_check_returns["cta_contact.phone"], {
    checked: true,
    value: "0999999999",
    condition_note: "old condition",
    evidence: "old evidence",
    note: "old note",
    answer_type: "phone",
  });
  assert.deepEqual(draft.requested_check_returns["taxonomy.category"], {
    checked: true,
    value: "cafe",
    condition_note: "keep category",
    evidence: "keep evidence",
    note: "keep note",
  });
});

test("requested-check form reader keeps hidden custom rows and reads taxonomy compound values without changing payload shape", () => {
  const multiSelectRowNode = {
    getAttribute(name) {
      if (name === "data-requested-check-return-key") return "taxonomy.tags";
      if (name === "data-requested-check-answer-type") return "multi_select";
      return null;
    },
    querySelector(selector) {
      if (selector === "[data-requested-check-field='checked']") return { checked: true };
      if (selector === "[data-requested-check-field='value']") return { value: "cafe\nfamily\nrooftop" };
      return null;
    },
  };
  const numberRowNode = {
    getAttribute(name) {
      if (name === "data-requested-check-return-key") return "taxonomy.price_range";
      if (name === "data-requested-check-answer-type") return "number_with_unit";
      return null;
    },
    querySelector(selector) {
      if (selector === "[data-requested-check-field='checked']") return { checked: true };
      if (selector === "[data-requested-check-field='value-number']") return { value: "500" };
      if (selector === "[data-requested-check-field='value-unit']") return { value: "บาท" };
      return null;
    },
  };
  const formNode = {
    querySelectorAll(selector) {
      return selector === "[data-requested-check-row]" ? [multiSelectRowNode, numberRowNode] : [];
    },
  };
  const state = {
    assignments: {
      requestedCheckReturnDrafts: {
        12: {
          requested_check_returns: {
            "custom.parking": {
              checked: true,
              value: "covered lot",
              condition_note: "keep custom",
              evidence: "photo",
              note: "preserve me",
            },
          },
        },
      },
    },
  };
  const readDraft = loadNamedFunction(appJs, "readAssignmentRequestedCheckReturnDraftFromForm", {
    qs: () => formNode,
    state,
  });

  const draft = readDraft(12);
  assert.deepEqual(draft.requested_check_returns["taxonomy.tags"].value, ["cafe", "family", "rooftop"]);
  assert.deepEqual(draft.requested_check_returns["taxonomy.price_range"].value, { number: 500, unit: "บาท" });
  assert.deepEqual(draft.requested_check_returns["custom.parking"], {
    checked: true,
    value: "covered lot",
    condition_note: "keep custom",
    evidence: "photo",
    note: "preserve me",
  });

  const payload = buildAssignmentRequestedCheckReturnPayloadFromDraft(draft);
  assert.deepEqual(payload.requested_check_returns["taxonomy.tags"], {
    checked: true,
    value: ["cafe", "family", "rooftop"],
    condition_note: null,
    evidence: null,
    note: null,
  });
  assert.deepEqual(payload.requested_check_returns["taxonomy.price_range"], {
    checked: true,
    value: { number: 500, unit: "บาท" },
    condition_note: null,
    evidence: null,
    note: null,
  });
});

test("requested-check row state toggles taxonomy condition input with checkbox without erasing the condition text", () => {
  const checkedField = { checked: false };
  const valueField = { disabled: false, value: "kept" };
  const conditionField = { disabled: false, value: "front area" };
  const rowNode = {
    getAttribute(name) {
      if (name === "data-requested-check-answer-type") return "text";
      return null;
    },
    querySelector(selector) {
      if (selector === "[data-requested-check-field='checked']") return checkedField;
      if (selector === "[data-requested-check-field='value']") return valueField;
      if (selector === "[data-requested-check-field='condition_note']") return conditionField;
      return null;
    },
    classList: {
      toggle() {},
    },
  };

  updateAssignmentRequestedCheckReturnRowState(rowNode);
  assert.equal(valueField.disabled, true);
  assert.equal(conditionField.disabled, true);
  assert.equal(conditionField.value, "front area");

  checkedField.checked = true;
  updateAssignmentRequestedCheckReturnRowState(rowNode);
  assert.equal(valueField.disabled, false);
  assert.equal(conditionField.disabled, false);
  assert.equal(conditionField.value, "front area");
});

test("requested-check row state toggles structured multi_select children without erasing selections", () => {
  const checkedField = { checked: false };
  const valueMultiA = { disabled: false, checked: true, value: "cafe" };
  const valueMultiB = { disabled: false, checked: false, value: "family" };
  const rowNode = {
    getAttribute(name) {
      if (name === "data-requested-check-answer-type") return "multi_select";
      return null;
    },
    querySelector(selector) {
      if (selector === "[data-requested-check-field='checked']") return checkedField;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-requested-check-field='value-multi']") return [valueMultiA, valueMultiB];
      return [];
    },
    classList: {
      toggle() {},
    },
  };

  updateAssignmentRequestedCheckReturnRowState(rowNode);
  assert.equal(valueMultiA.disabled, true);
  assert.equal(valueMultiB.disabled, true);
  assert.equal(valueMultiA.checked, true);

  checkedField.checked = true;
  updateAssignmentRequestedCheckReturnRowState(rowNode);
  assert.equal(valueMultiA.disabled, false);
  assert.equal(valueMultiB.disabled, false);
  assert.equal(valueMultiA.checked, true);
});

test("requested-check row html does not render evidence controls for active CTA rows", () => {
  const html = buildAssignmentRequestedCheckReturnRowHtml(
    {
      return_key: "cta_contact.phone",
      group_key: "cta_contact",
      check_key: "phone",
      label: "Phone",
      answer_type: "phone",
      suggested_value: "0659391488",
      evidence_required: true,
    },
    {
      checked: false,
      value: "0659391488",
      evidence: "",
    },
    {
      showConditionNote: false,
    }
  );

  assert.doesNotMatch(html, /class="requested-check-row-secondary"/);
  assert.doesNotMatch(html, /evidence/);
  assert.doesNotMatch(html, /data-requested-check-field="evidence"/);
  assert.doesNotMatch(html, /found|verified/);
});

test("requested-check form reader returns canonical multi_select array from structured controls", () => {
  const multiSelectRowNode = {
    getAttribute(name) {
      if (name === "data-requested-check-return-key") return "taxonomy.tags";
      if (name === "data-requested-check-answer-type") return "multi_select";
      return null;
    },
    querySelector(selector) {
      if (selector === "[data-requested-check-field='checked']") return { checked: true };
      return null;
    },
    querySelectorAll(selector) {
      if (selector !== "[data-requested-check-field='value-multi']") return [];
      return [
        { checked: true, value: "cafe" },
        { checked: true, value: "family" },
        { checked: true, value: "cafe" },
        { checked: false, value: "rooftop" },
      ];
    },
  };
  const formNode = {
    querySelectorAll(selector) {
      return selector === "[data-requested-check-row]" ? [multiSelectRowNode] : [];
    },
  };
  const state = {
    assignments: {
      requestedCheckReturnDrafts: {},
    },
  };
  const readDraft = loadNamedFunction(appJs, "readAssignmentRequestedCheckReturnDraftFromForm", {
    qs: () => formNode,
    state,
  });

  const draft = readDraft(12);
  assert.deepEqual(draft.requested_check_returns["taxonomy.tags"].value, ["cafe", "family"]);
});

test("requested-check submission form render path outputs CTA before Curation and preserves edited taxonomy values", () => {
  const state = {
    assignments: {
      selectedId: 12,
      contextItemId: 27,
      contextFieldPack: {},
      requestedCheckReturnDrafts: {
        12: {
          requested_check_returns: {
            "cta_contact.phone": {
              checked: true,
              value: "0999999999",
              note: "edited",
            },
            "taxonomy.category": {
              checked: false,
              value: "",
            },
            "taxonomy.parking": {
              checked: false,
              value: "ริมถนน",
            },
          },
        },
      },
      requestedCheckReturnDraftDirty: {
        12: true,
      },
      requestedCheckReturnDraftSources: {
        12: "user_edit",
      },
      handoffSourcePackages: {
        12: {
          niche: "restaurants",
          requested_checks: {
            version: 1,
            groups: [
              {
                group_key: "taxonomy",
                group_label: "Taxonomy",
                checks: [
                  { key: "category", requested: true, label: "Category", answer_type: "text" },
                  { key: "parking", requested: true, label: "Parking", answer_type: "text" },
                ],
              },
              {
                group_key: "cta_contact",
                group_label: "CTA/contact",
                checks: [
                  { key: "phone", requested: true, label: "Phone", answer_type: "phone", suggested_value: "0812345678" },
                  { key: "line_url", requested: false, label: "LINE", answer_type: "url" },
                ],
              },
            ],
          },
        },
      },
      handoffSourceLoaded: {
        12: true,
      },
    },
  };
  const assignment = {
    id: 12,
    content_item_id: 27,
    brief_json: { title: "Brief" },
  };
  const harness = createRequestedCheckRenderHarness(state);

  harness.renderAssignmentSubmissionForm(assignment, "work");

  const wrapNode = harness.nodes.get("assignment-submission-requested-checks-wrap");
  const fieldsNode = harness.nodes.get("assignment-submission-requested-checks-fields");
  assert.equal(wrapNode.classList.contains("hidden"), false);
  const ctaIndex = fieldsNode.innerHTML.indexOf('data-requested-check-group="cta_contact"');
  const taxonomyIndex = fieldsNode.innerHTML.indexOf('data-requested-check-group="taxonomy"');
  assert.ok(ctaIndex >= 0);
  assert.ok(taxonomyIndex > ctaIndex);
  assert.match(fieldsNode.innerHTML, /value="0999999999"/);
  assert.equal(fieldsNode.innerHTML.includes('value="0812345678"'), false);
  assert.match(fieldsNode.innerHTML, /data-requested-check-return-key="cta_contact.line_url"/);
  assert.equal(fieldsNode.innerHTML.includes('data-requested-check-return-key="taxonomy.category"'), false);
  assert.doesNotMatch(fieldsNode.innerHTML, /requested-check-curation-category-context|หมวดหลัก|จาก Clean/);
  assert.match(fieldsNode.innerHTML, /<details class="requested-check-curation-more" open>/);
  assert.match(fieldsNode.innerHTML, /data-requested-check-return-key="taxonomy.parking"/);
  assert.ok(fieldsNode.innerHTML.includes('value="ริมถนน"'));
  assert.equal(fieldsNode.innerHTML.includes("Manual"), false);
});

test("requested-check section does not render condition, evidence, or note controls for CTA rows", () => {
  const handoffPackage = {
    requested_checks: {
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
              answer_type: "phone",
              suggested_value: "0812345678",
            },
            {
              key: "line_url",
              requested: true,
              label: "LINE",
              answer_type: "url",
            },
            {
              key: "facebook_url",
              requested: true,
              label: "Facebook",
              answer_type: "url",
            },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  const textareaCount = (sectionHtml.match(/<textarea /g) || []).length;
  assert.equal(textareaCount, 0);
  assert.equal(sectionHtml.includes('data-requested-check-field="condition_note"'), false);
  assert.equal(sectionHtml.includes('data-requested-check-field="evidence"'), false);
  assert.equal(sectionHtml.includes('data-requested-check-field="note"'), false);
  assert.equal(sectionHtml.includes('requested-check-row-secondary'), false);
  assert.doesNotMatch(sectionHtml, /<details|<summary|รายละเอียด|เงื่อนไข|หลักฐาน|หมายเหตุ/);
});

test("requested-check return form renders legacy custom rows from old immutable snapshots", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            { key: "phone", requested: true, label: "Phone", answer_type: "phone", suggested_value: "0812345678" },
          ],
        },
        {
          group_key: "custom",
          group_label: "Custom",
          checks: [
            { key: "parking", requested: true, label: "Parking", answer_type: "text" },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  assert.equal((sectionHtml.match(/class="assignment-brief-section full-span requested-check-cta-section"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/class="assignment-brief-section full-span assignment-capture-card requested-check-cta-row"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/class="assignment-capture-row requested-check-row-main"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/class="assignment-capture-title requested-check-row-label"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/class="assignment-capture-actions requested-check-row-status"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/class="requested-check-cta-list"/g) || []).length, 0);
  assert.equal((sectionHtml.match(/class="requested-check-cta-card"/g) || []).length, 0);
  assert.equal((sectionHtml.match(/class="assignment-brief-card"/g) || []).length, 0);
  assert.equal((sectionHtml.match(/class="assignment-brief-grid requested-check-group-grid"/g) || []).length, 0);
  assert.equal((sectionHtml.match(/data-requested-check-row/g) || []).length, 2);
  assert.equal(sectionHtml.includes('data-requested-check-group="custom"'), true);
  assert.equal(sectionHtml.includes('data-requested-check-return-key="custom.parking"'), true);
  assert.match(sectionHtml, /<div class="assignment-brief-label">Custom<\/div>/);
  assert.match(sectionHtml, /data-requested-check-field="value"/);
});

test("requested-check taxonomy section is omitted when only reserved placeholder rows exist", () => {
  const handoffPackage = {
    niche: "restaurants",
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "Category", answer_type: "text" },
            { key: "tags", requested: true, label: "Tags", answer_type: "multi_select" },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  assert.equal(sectionHtml.trim(), "");
  assert.doesNotMatch(sectionHtml, /data-requested-check-group="taxonomy"|Curation|ตัวเลือกเพิ่มเติม|taxonomy\.category|taxonomy\.tags/);
});

test("requested-check mobile CSS keeps one-column CTA rows with stacked secondary controls", () => {
  assert.match(stylesCss, /@media \(max-width: 900px\)/);
  assert.match(stylesCss, /requested-check-row-main/);
  assert.match(stylesCss, /requested-check-cta-section/);
  assert.match(stylesCss, /requested-check-cta-row/);
  assert.match(
    stylesCss,
    /#assignment-submission-requested-checks-fields[\s\S]*?\.requested-check-row-main\s*\{[\s\S]*?grid-template-columns:\s*20px 150px 76px minmax\(0,\s*1fr\);/
  );
  assert.match(
    stylesCss,
    /#assignment-submission-capture-guide\s+\.assignment-capture-card,\s*#assignment-submission-requested-checks-fields\s+\.assignment-capture-card\s*\{[\s\S]*?padding:\s*8px 10px;/
  );
  assert.match(
    stylesCss,
    /#assignment-submission-requested-checks-fields[\s\S]*?\.requested-check-cta-section\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?align-self:\s*start;[\s\S]*?gap:\s*4px;/
  );
  assert.match(stylesCss, /\.requested-check-curation-more/);
  assert.match(stylesCss, /\.requested-check-curation-more-summary/);
  assert.match(stylesCss, /\.requested-check-curation-more-list/);
  assert.match(stylesCss, /\.requested-check-curation-section\s*\{/);
  assert.match(stylesCss, /\.requested-check-curation-section\s+\.requested-check-curation-row\s+\.requested-check-row-main\s*\{/);
  assert.match(stylesCss, /#assignment-submission-requested-checks-fields\s+\.requested-check-curation-section\s+\.requested-check-curation-row\s+\.requested-check-row-main\s*\{[\s\S]*?grid-template-columns:\s*20px 140px minmax\(0,\s*1fr\) minmax\(180px,\s*1fr\);/);
  assert.match(stylesCss, /#assignment-submission-requested-checks-fields\s+\.requested-check-curation-section\s+\.requested-check-curation-row\s+\.requested-check-row-condition\s*\{/);
  assert.match(stylesCss, /@media \(max-width: 900px\) \{[\s\S]*?#assignment-submission-requested-checks-fields\s+\.requested-check-curation-section\s+\.requested-check-curation-row\s+\.requested-check-row-main\s*\{[\s\S]*?grid-template-columns:\s*20px minmax\(0,\s*1fr\);/);
  assert.match(stylesCss, /@media \(max-width: 900px\) \{[\s\S]*?#assignment-submission-requested-checks-fields\s+\.requested-check-curation-section\s+\.requested-check-curation-row\s+\.requested-check-row-condition\s*\{[\s\S]*?grid-column:\s*2 \/ -1;/);
  assert.match(
    stylesCss,
    /#assignment-submission-requested-checks-fields[\s\S]*?\.requested-check-row-value textarea\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?height:\s*32px;/
  );
  assert.match(
    stylesCss,
    /#assignment-submission-capture-guide\s+\.assignment-capture-row,\s*#assignment-submission-requested-checks-fields\s+\.assignment-capture-row\s*\{[\s\S]*?display:\s*grid;[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*10px;/
  );
  assert.match(
    stylesCss,
    /#assignment-submission-capture-guide\s+\.assignment-capture-title,\s*#assignment-submission-requested-checks-fields\s+\.assignment-capture-title\s*\{[\s\S]*?font-size:\s*0\.9rem;[\s\S]*?line-height:\s*1\.3;/
  );
  assert.match(
    stylesCss,
    /#assignment-submission-requested-checks-fields[\s\S]*?\.requested-check-row-value input,\s*#assignment-submission-requested-checks-fields[\s\S]*?\.requested-check-row-value select\s*\{[\s\S]*?font-size:\s*0\.9rem;[\s\S]*?line-height:\s*1\.3;/
  );
  assert.doesNotMatch(
    stylesCss,
    /#assignment-submission-requested-checks-fields[\s\S]*?\.requested-check-cta-row\s*\+\s*\.requested-check-cta-row\s*\{[\s\S]*?margin-top:\s*4px;/
  );
  assert.match(stylesCss, /requested-check-row-value \{\s*grid-column: 2 \/ -1;/);
  assert.match(stylesCss, /requested-check-row-secondary/);
  assert.match(stylesCss, /requested-check-row-secondary-label/);
});

test("requested-check payload builder keeps field_return_payload_json separate and strips internal metadata", () => {
  assert.equal(buildAssignmentRequestedCheckReturnPayloadFromDraft({
    requested_check_returns: {},
  }), null);
  const payload = buildAssignmentRequestedCheckReturnPayloadFromDraft({
    requested_check_returns: {
      "cta_contact.phone": {
        checked: true,
        value: "0812345678",
        condition_note: "Reachable only at night",
        evidence: "https://example.com/evidence",
        note: "Checked by eye",
        answer_type: "phone",
        label: "Phone",
        group_key: "cta_contact",
      },
      "taxonomy.tags": {
        checked: false,
        value: ["cafe", "family"],
        answer_type: "multi_select",
      },
    },
  });

  assert.deepEqual(payload, {
    requested_check_returns: {
      "cta_contact.phone": {
        checked: true,
        value: "0812345678",
        condition_note: "Reachable only at night",
        evidence: "https://example.com/evidence",
        note: "Checked by eye",
      },
      "taxonomy.tags": {
        checked: true,
        value: null,
        condition_note: null,
        evidence: null,
        note: null,
      },
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload.requested_check_returns["cta_contact.phone"], "answer_type"), false);
});

test("requested-check payload builder normalizes untouched CTA rows to not_found instead of reporting AI suggestion", () => {
  const payload = buildAssignmentRequestedCheckReturnPayloadFromDraft({
    requested_check_returns: {
      "cta_contact.phone": {
        checked: false,
        value: "0812345678",
        suggested_value: "0812345678",
        answer_type: "phone",
        group_key: "cta_contact",
      },
    },
  });

  assert.deepEqual(payload, {
    requested_check_returns: {
      "cta_contact.phone": {
        checked: true,
        value: null,
        condition_note: null,
        evidence: null,
        note: null,
      },
    },
  });
});

test("requested-check payload builder normalizes unchecked taxonomy booleans to reported false", () => {
  const payload = buildAssignmentRequestedCheckReturnPayloadFromDraft({
    requested_check_returns: {
      "taxonomy.parking": {
        checked: false,
        value: true,
        suggested_value: true,
        answer_type: "boolean_with_conditions",
        group_key: "taxonomy",
      },
    },
  });

  assert.deepEqual(payload, {
    requested_check_returns: {
      "taxonomy.parking": {
        checked: true,
        value: false,
        condition_note: null,
        evidence: null,
        note: null,
      },
    },
  });
});

test("requested-check return normalization infers runtime types from payload shape", () => {
  const normalized = normalizeRequestedCheckReturns({
    " CTA Contact . Phone ": { checked: true, value: "0812345678" },
    "taxonomy.tags": { checked: true, value: ["cafe", "family", "cafe"] },
    "custom.count": { checked: true, value: { number: 5, unit: "คน" } },
    "custom.flag": { checked: true, value: true, condition_note: "เฉพาะชั้นล่าง" },
    "custom.note": { checked: true, note: "มีบันได", value: null },
  });

  assert.ok(normalized["cta_contact.phone"]);
  assert.ok(normalized["taxonomy.tags"]);
  assert.ok(normalized["custom.count"]);
  assert.ok(normalized["custom.flag"]);
  assert.ok(normalized["custom.note"]);
  assert.equal(normalized["cta_contact.phone"].answer_type, "text");
  assert.equal(normalized["taxonomy.tags"].answer_type, "multi_select");
  assert.equal(normalized["custom.count"].answer_type, "number_with_unit");
  assert.equal(normalized["custom.flag"].answer_type, "boolean_with_conditions");
  assert.equal(normalized["custom.note"].answer_type, "note_only");
  assert.deepEqual(normalized["taxonomy.tags"].value, ["cafe", "family"]);
  assert.deepEqual(normalized["custom.count"].value, { number: 5, unit: "คน" });
  assert.equal(normalized["custom.flag"].condition_note, "เฉพาะชั้นล่าง");
  assert.equal(normalized["custom.note"].note, "มีบันได");
});

test("requested-check evidence free text persists through normalizer", () => {
  const normalized = normalizeRequestedCheckReturnEntry({
    checked: true,
    answer_type: "note_only",
    condition_note: "กลางแจ้งเท่านั้น",
    evidence: "ดูพื้นที่จริง",
    note: "มีป้ายชัดเจน",
  }, "field_return_payload_json.requested_check_returns.custom.parking");

  assert.equal(normalized.found, true);
  assert.equal(normalized.evidence, "ดูพื้นที่จริง");
  assert.equal(normalized.condition_note, "กลางแจ้งเท่านั้น");
  assert.equal(normalized.note, "มีป้ายชัดเจน");
});

test("requested-check multi_select semantics keep null empty unchecked and invalid states distinct", () => {
  const schema = {
    answer_type: "multi_select",
    allowed_values: ["cafe", "family"],
  };

  const notFound = normalizeRequestedCheckReturnEntry({
    checked: true,
    answer_type: "multi_select",
    value: null,
  }, "field_return_payload_json.requested_check_returns.taxonomy.tags", schema);
  assert.equal(notFound.value, null);
  assert.equal(inferRequestedCheckReturnStatus(notFound, schema), "not_found");

  const explicitEmpty = normalizeRequestedCheckReturnEntry({
    checked: true,
    answer_type: "multi_select",
    value: [],
  }, "field_return_payload_json.requested_check_returns.taxonomy.tags", schema);
  assert.deepEqual(explicitEmpty.value, []);
  assert.equal(inferRequestedCheckReturnStatus(explicitEmpty, schema), "reported");

  const unanswered = normalizeRequestedCheckReturnEntry({
    checked: false,
    answer_type: "multi_select",
    value: [],
  }, "field_return_payload_json.requested_check_returns.taxonomy.tags", schema);
  assert.equal(unanswered.value, null);
  assert.equal(inferRequestedCheckReturnStatus(unanswered, schema), "unanswered");

  const malformed = normalizeRequestedCheckReturnEntry({
    checked: true,
    answer_type: "multi_select",
    value: "cafe",
  }, "field_return_payload_json.requested_check_returns.taxonomy.tags", schema);
  assert.equal(malformed.value, "cafe");
  assert.equal(inferRequestedCheckReturnStatus(malformed, schema), "malformed");
});

test("requested-check note_only empty is not_found and note-or-evidence is reported", () => {
  const schema = { answer_type: "note_only" };

  const empty = normalizeRequestedCheckReturnEntry({
    checked: true,
    answer_type: "note_only",
  }, "field_return_payload_json.requested_check_returns.custom.parking", schema);
  assert.equal(inferRequestedCheckReturnStatus(empty, schema), "not_found");

  const withNote = normalizeRequestedCheckReturnEntry({
    checked: true,
    answer_type: "note_only",
    note: "No sign posted",
  }, "field_return_payload_json.requested_check_returns.custom.parking", schema);
  assert.equal(inferRequestedCheckReturnStatus(withNote, schema), "reported");

  const withEvidence = normalizeRequestedCheckReturnEntry({
    checked: true,
    answer_type: "note_only",
    evidence: "Photo evidence",
  }, "field_return_payload_json.requested_check_returns.custom.parking", schema);
  assert.equal(inferRequestedCheckReturnStatus(withEvidence, schema), "reported");
});

test("requested-check evidence free text does not force found when unchecked", () => {
  const normalized = normalizeRequestedCheckReturnEntry({
    checked: false,
    answer_type: "note_only",
    evidence: "ดูพื้นที่จริง",
    note: "ignored while unchecked",
  }, "field_return_payload_json.requested_check_returns.custom.parking");

  assert.equal(normalized.found, false);
  assert.equal(normalized.evidence, null);
  assert.equal(normalized.value, null);
});

test("suggested value formatter from app.js renders without injected stub", () => {
  assert.equal(formatRequestedCheckSuggestedValue(["cafe", "family"], "multi_select"), "cafe\nfamily");
  assert.equal(formatRequestedCheckSuggestedValue(true, "boolean"), "true");
  assert.equal(formatRequestedCheckSuggestedValue({ number: 5, unit: "คัน" }, "number_with_unit"), JSON.stringify({ number: 5, unit: "คัน" }));
});

test("handoff source load rerenders brief and submission surfaces after async fetch", async () => {
  const calls = [];
  const state = {
    assignments: {
      selectedId: 12,
      handoffSourcePackages: {},
      handoffSourceSnapshotIds: {},
      handoffSourceLoaded: {},
    },
  };
  const renderAssignmentHandoffBriefSpy = () => {
    calls.push("brief");
  };
  const renderAssignmentRequestedCheckSectionSpy = (assignment) => {
    calls.push(`requested-check:${assignment?.id || 0}`);
  };
  const loadAssignmentRequestedCheckHandoffSource = await loadNamedAsyncFunction(appJs, "loadAssignmentRequestedCheckHandoffSource", {
    state,
    isEditorUser: () => false,
    api: async () => ({
      handoff: {
        handoff_package_json: {
          requested_checks: {
            version: 1,
            groups: [
              {
                group_key: "cta_contact",
                group_label: "CTA/contact",
                checks: [{ key: "phone", requested: true, label: "Phone", answer_type: "phone" }],
              },
            ],
          },
        },
      },
    }),
    rerenderAssignmentRequestedCheckSurfaces: loadNamedFunction(appJs, "rerenderAssignmentRequestedCheckSurfaces", {
      state,
      renderAssignmentHandoffBrief: renderAssignmentHandoffBriefSpy,
      renderAssignmentRequestedCheckSection: renderAssignmentRequestedCheckSectionSpy,
      getAssignmentSubmissionFormAssignment: (assignment) => assignment,
      getAssignmentById: (id) => ({ id }),
      getAssignmentPageMode: () => "work",
    }),
  });

  const result = await loadAssignmentRequestedCheckHandoffSource({ id: 12 });
  assert.ok(result?.requested_checks);
  assert.deepEqual(calls, ["brief", "requested-check:12"]);
  assert.equal(state.assignments.handoffSourceLoaded[12], true);
});

test("edited requested-check draft survives async handoff load and rerender path", async () => {
  const calls = [];
  const state = {
    assignments: {
      selectedId: 12,
      requestedCheckReturnDrafts: {
        12: {
          requested_check_returns: {
            "cta_contact.phone": {
              checked: true,
              value: "0999999999",
              note: "edited",
            },
          },
        },
      },
      handoffSourcePackages: {},
      handoffSourceSnapshotIds: {},
      handoffSourceLoaded: {},
    },
  };
  const renderAssignmentHandoffBriefSpy = () => {
    calls.push("brief");
  };
  const renderAssignmentRequestedCheckSectionSpy = () => {
    const handoffPackage = state.assignments.handoffSourcePackages[12] || null;
    const currentDraft = state.assignments.requestedCheckReturnDrafts[12] || null;
    const html = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, currentDraft);
    calls.push(html);
  };
  const loadAssignmentRequestedCheckHandoffSource = await loadNamedAsyncFunction(appJs, "loadAssignmentRequestedCheckHandoffSource", {
    state,
    isEditorUser: () => false,
    api: async () => ({
      handoff: {
        handoff_package_json: {
          requested_checks: {
            version: 1,
            groups: [
              {
                group_key: "cta_contact",
                group_label: "CTA/contact",
                checks: [{ key: "phone", requested: true, label: "Phone", answer_type: "phone", suggested_value: "0812345678" }],
              },
            ],
          },
        },
      },
    }),
    rerenderAssignmentRequestedCheckSurfaces: loadNamedFunction(appJs, "rerenderAssignmentRequestedCheckSurfaces", {
      state,
      renderAssignmentHandoffBrief: renderAssignmentHandoffBriefSpy,
      renderAssignmentRequestedCheckSection: renderAssignmentRequestedCheckSectionSpy,
      getAssignmentSubmissionFormAssignment: (assignment) => assignment,
      getAssignmentById: (id) => ({ id }),
      getAssignmentPageMode: () => "work",
    }),
  });

  await loadAssignmentRequestedCheckHandoffSource({ id: 12 });
  assert.equal(calls[0], "brief");
  assert.match(calls[1], /value="0999999999"/);
  assert.doesNotMatch(calls[1], /Manual/);
  assert.doesNotMatch(calls[1], /AI แนะนำ/);
  assert.equal((calls[1].match(/requested-check-row-status/g) || []).length, 1);
  assert.ok(calls[1].includes('<div class="assignment-capture-actions requested-check-row-status"></div>'));
  assert.doesNotMatch(calls[1], /<details|ข้อมูลเพิ่มเติม/);
  assert.equal(calls[1].includes('value="0812345678"'), false);
  assert.equal(state.assignments.requestedCheckReturnDrafts[12].requested_check_returns["cta_contact.phone"].value, "0999999999");
  assert.equal(state.assignments.requestedCheckReturnDrafts[12].requested_check_returns["cta_contact.phone"].note, "edited");
});

test("loadAssignmentSubmissionServerDraft rerenders requested-check surface after late usable server draft when local draft is not dirty", async () => {
  const calls = [];
  const state = {
    assignments: {
      selectedId: 12,
      requestedCheckReturnDrafts: {
        12: {
          requested_check_returns: {
            "taxonomy.parking": { checked: false, value: false },
          },
        },
      },
      requestedCheckReturnDraftDirty: {
        12: false,
      },
      requestedCheckReturnDraftSources: {
        12: "schema_default",
      },
      serverSubmissionDraftPayloads: {},
      serverSubmissionDraftLoaded: {},
      contextFieldPack: null,
    },
  };
  const loadDraft = await loadNamedAsyncFunction(appJs, "loadAssignmentSubmissionServerDraft", {
    state,
    isEditorUser: () => false,
    api: async () => ({
      draft: {
        field_return_payload_json: {
          requested_check_returns: {
            "taxonomy.parking": { checked: true, value: true },
          },
        },
      },
    }),
    getAssignmentSubmissionDraftKey: () => "12:1",
    normalizeAssignmentSubmissionPayload: (payload) => payload,
    hasUsableAssignmentRequestedCheckReturnRows,
    normalizeAssignmentRequestedCheckReturnDraft,
    setAssignmentRequestedCheckReturnDraftState: loadNamedFunction(appJs, "setAssignmentRequestedCheckReturnDraftState", {
      state,
    }),
    getAssignmentById: (id) => ({ id }),
    renderAssignmentRequestedCheckSection: (assignment, handoffPackage, draft) => {
      calls.push({ assignmentId: assignment?.id || 0, handoffPackage, draft });
    },
  });

  await loadDraft({ id: 12, revision_round: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].assignmentId, 12);
  assert.equal(calls[0].draft?.requested_check_returns?.["taxonomy.parking"]?.value, true);
});

// Repository final-submission validator tests
const validateRequestedCheckReturnsForFinalSubmission = loadNamedFunction(repositoryJs, "validateRequestedCheckReturnsForFinalSubmission", {
  inferRequestedCheckReturnStatus,
  isRequestedCheckAnswerComplete,
  hasRequestedCheckEvidence,
});

test("validator allows required unchecked row during submission mode", () => {
  const schemaMap = new Map();
  schemaMap.set("taxonomy.parking", {
    return_key: "taxonomy.parking",
    group_key: "taxonomy",
    check_key: "parking",
    required: true,
    requested: true,
    answer_type: "boolean",
  });

  assert.doesNotThrow(() => {
    validateRequestedCheckReturnsForFinalSubmission({}, schemaMap);
  });
});

test("validator allows optional unchecked row", () => {
  const schemaMap = new Map();
  schemaMap.set("taxonomy.parking", {
    return_key: "taxonomy.parking",
    group_key: "taxonomy",
    check_key: "parking",
    required: false,
    requested: true,
    answer_type: "boolean",
  });

  assert.doesNotThrow(() => {
    validateRequestedCheckReturnsForFinalSubmission({}, schemaMap);
  });
});

test("validator allows checked blank with evidence_required as not_found", () => {
  const schemaMap = new Map();
  schemaMap.set("cta_contact.phone", {
    return_key: "cta_contact.phone",
    group_key: "cta_contact",
    check_key: "phone",
    required: true,
    requested: true,
    evidence_required: true,
    answer_type: "phone",
  });

  assert.doesNotThrow(() => {
    validateRequestedCheckReturnsForFinalSubmission({
      "cta_contact.phone": {
        checked: true,
        value: "",
        evidence: "",
      },
    }, schemaMap);
  });
});

test("validator allows valid reported value missing required evidence during submission mode", () => {
  const schemaMap = new Map();
  schemaMap.set("cta_contact.phone", {
    return_key: "cta_contact.phone",
    group_key: "cta_contact",
    check_key: "phone",
    required: true,
    requested: true,
    evidence_required: true,
    answer_type: "phone",
  });

  assert.doesNotThrow(() => {
    validateRequestedCheckReturnsForFinalSubmission({
      "cta_contact.phone": {
        checked: true,
        value: "0804415224",
        evidence: "",
      },
    }, schemaMap);
  });
});

test("validator allows valid reported value with evidence", () => {
  const schemaMap = new Map();
  schemaMap.set("cta_contact.phone", {
    return_key: "cta_contact.phone",
    group_key: "cta_contact",
    check_key: "phone",
    required: true,
    requested: true,
    evidence_required: true,
    answer_type: "phone",
  });

  assert.doesNotThrow(() => {
    validateRequestedCheckReturnsForFinalSubmission({
      "cta_contact.phone": {
        checked: true,
        value: "0804415224",
        evidence: "storefront sign",
      },
    }, schemaMap);
  });
});

test("validator allows non-empty malformed multi_select value during submission mode", () => {
  const schemaMap = new Map();
  schemaMap.set("taxonomy.tags", {
    return_key: "taxonomy.tags",
    group_key: "taxonomy",
    check_key: "tags",
    required: true,
    requested: true,
    answer_type: "multi_select",
    allowed_values: ["cafe", "restaurant"],
  });

  assert.doesNotThrow(() => {
    validateRequestedCheckReturnsForFinalSubmission({
      "taxonomy.tags": {
        checked: true,
        value: "cafe",
      },
    }, schemaMap);
  });
});

test("validator does not classify CTA or taxonomy evidence as required in acceptance mode", () => {
  const schemaMap = new Map();
  schemaMap.set("taxonomy.parking", {
    return_key: "taxonomy.parking",
    group_key: "taxonomy",
    check_key: "parking",
    required: true,
    requested: true,
    answer_type: "boolean",
  });
  schemaMap.set("cta_contact.phone", {
    return_key: "cta_contact.phone",
    group_key: "cta_contact",
    check_key: "phone",
    required: true,
    requested: true,
    evidence_required: true,
    answer_type: "phone",
  });

  let caught = null;
  try {
    validateRequestedCheckReturnsForFinalSubmission({
      "cta_contact.phone": {
        checked: true,
        value: "0804415224",
        evidence: "",
      },
    }, schemaMap, "field_return_payload_json.requested_check_returns", { mode: "acceptance" });
  } catch (err) {
    caught = err;
  }

  assert.ok(caught, "should bundle errors");
  assert.ok(Array.isArray(caught.validation_errors));
  assert.ok(caught.validation_errors.length >= 1, "should have at least 1 error");
  const codes = caught.validation_errors.map((e) => e.code);
  assert.ok(codes.includes("required_unanswered"), "should include required_unanswered");
  assert.ok(!codes.includes("required_evidence_missing"), "should not include required_evidence_missing for CTA/taxonomy");
});

test("validator still requires evidence for unrelated groups in acceptance mode", () => {
  const schemaMap = new Map();
  schemaMap.set("custom.proof", {
    return_key: "custom.proof",
    group_key: "custom",
    check_key: "proof",
    required: true,
    requested: true,
    evidence_required: true,
    answer_type: "text",
  });

  let caught = null;
  try {
    validateRequestedCheckReturnsForFinalSubmission({
      "custom.proof": {
        checked: true,
        value: "verified",
        evidence: "",
      },
    }, schemaMap, "field_return_payload_json.requested_check_returns", { mode: "acceptance" });
  } catch (err) {
    caught = err;
  }

  assert.ok(caught, "should bundle errors");
  assert.ok(Array.isArray(caught.validation_errors));
  assert.equal(caught.validation_errors.length, 1);
  assert.equal(caught.validation_errors[0]?.code, "required_evidence_missing");
});

// API route response helper test
const buildSubmissionErrorResponse = (() => {
  return function buildSubmissionErrorResponse(err) {
    if (err && err.code === "REQUESTED_CHECK_VALIDATION_FAILED" && Array.isArray(err.validation_errors) && err.validation_errors.length) {
      return {
        status: 400,
        body: {
          error: "requested_check_validation_failed",
          message: "กรุณาตรวจสอบข้อมูลที่ต้องยืนยัน",
          validation_errors: err.validation_errors,
        },
      };
    }
    return {
      status: 400,
      body: { error: String(err?.message || "Cannot create submission") },
    };
  };
})();

test("buildSubmissionErrorResponse returns structured 400 for validation error", () => {
  const err = new Error("requested_check_validation_failed");
  err.code = "REQUESTED_CHECK_VALIDATION_FAILED";
  err.validation_errors = [{
    return_key: "taxonomy.parking",
    group_key: "taxonomy",
    check_key: "parking",
    code: "required_unanswered",
    status: "unanswered",
    message: "taxonomy.parking is unanswered but required",
  }];

  const result = buildSubmissionErrorResponse(err);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "requested_check_validation_failed");
  assert.equal(result.body.message, "กรุณาตรวจสอบข้อมูลที่ต้องยืนยัน");
  assert.ok(Array.isArray(result.body.validation_errors));
  assert.equal(result.body.validation_errors.length, 1);
  assert.equal(result.body.validation_errors[0].return_key, "taxonomy.parking");
  assert.equal(result.body.validation_errors[0].group_key, "taxonomy");
  assert.equal(result.body.validation_errors[0].check_key, "parking");
  assert.equal(result.body.validation_errors[0].code, "required_unanswered");
  assert.equal(result.body.validation_errors[0].status, "unanswered");
  assert.equal(Object.prototype.hasOwnProperty.call(result.body, "stack"), false);
});

test("buildSubmissionErrorResponse returns fallback for ordinary Error", () => {
  const err = new Error("Something broke");
  const result = buildSubmissionErrorResponse(err);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Something broke");
  assert.equal(Object.prototype.hasOwnProperty.call(result.body, "validation_errors"), false);
});

// Browser API payload test
const apiFunctionSource = extractFunctionSource(appJs, "api");
const __global_qs = (id) => null;
const __global_setStatus = () => {};
const __global_persistAuthReturnTo = () => {};
const __global_applyLogoutUI = () => {};
const __global_redirectToLoginWithExpiredSession = () => {};
const stateStub = { token: "" };

const apiTest = Function(
  "state", "qs", "setStatus", "persistAuthReturnTo", "applyLogoutUI", "redirectToLoginWithExpiredSession",
  `${apiFunctionSource}; return api;`
)(stateStub, __global_qs, __global_setStatus, __global_persistAuthReturnTo, __global_applyLogoutUI, __global_redirectToLoginWithExpiredSession);

test("api helper preserves structured payload on non-2xx JSON response", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      headers: new Map([["content-type", "application/json"]]),
      json: async () => ({
        error: "requested_check_validation_failed",
        message: "กรุณาตรวจสอบข้อมูลที่ต้องยืนยัน",
        validation_errors: [{ return_key: "taxonomy.parking", code: "required_unanswered" }],
      }),
    });
    let caught = null;
    try {
      await apiTest("/api/assignments/1/submissions", { method: "POST" });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "should throw");
    assert.equal(caught.message, "requested_check_validation_failed");
    assert.ok(caught.payload, "should have payload");
    assert.equal(caught.payload.error, "requested_check_validation_failed");
    assert.equal(caught.payload.message, "กรุณาตรวจสอบข้อมูลที่ต้องยืนยัน");
    assert.ok(Array.isArray(caught.payload.validation_errors));
    assert.equal(caught.payload.validation_errors[0].return_key, "taxonomy.parking");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("api helper preserves fallback error message for non-JSON", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      headers: new Map([["content-type", "text/plain"]]),
      json: async () => { throw new Error("not json"); },
    });
    let caught = null;
    try {
      await apiTest("/api/nonexistent", { method: "GET" });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "should throw");
    assert.equal(caught.message, "คำขอล้มเหลว");
    assert.ok(caught.payload);
    assert.equal(caught.payload.error, "คำขอล้มเหลว");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("curation row keeps value and condition input in the main row without an empty secondary block", () => {
  const rowHtml = buildAssignmentRequestedCheckReturnRowHtml(
    {
      return_key: "taxonomy.parking",
      group_key: "taxonomy",
      check_key: "parking",
      label: "Parking",
      answer_type: "text",
      suggested_value: "street parking",
      evidence_required: false,
    },
    {
      checked: true,
      value: "street parking",
      condition_note: "after 18:00",
      evidence: "",
    },
    {
      showConditionNote: true,
      rowModifierClass: "requested-check-curation-row",
    }
  );

  assert.match(rowHtml, /requested-check-row-main[\s\S]*data-requested-check-field="value"[\s\S]*data-requested-check-field="condition_note"/);
  assert.match(rowHtml, /class="requested-check-row-condition"/);
  assert.doesNotMatch(rowHtml, /requested-check-row-secondary[\s\S]*data-requested-check-field="condition_note"/);
  assert.doesNotMatch(rowHtml, /<div class="requested-check-row-secondary">\s*<\/div>/);
  assert.doesNotMatch(rowHtml, /assignment-capture-actions requested-check-row-status"><\/div>/);
});

test("curation boolean row uses checklist layout with only label and condition input in the main row", () => {
  const rowHtml = buildAssignmentRequestedCheckReturnRowHtml(
    {
      return_key: "taxonomy.air_conditioning",
      group_key: "taxonomy",
      check_key: "air_conditioning",
      label: "Air conditioning",
      answer_type: "boolean",
      suggested_value: true,
      evidence_required: false,
    },
    {
      checked: false,
      value: false,
      condition_note: "",
      evidence: "",
    },
    {
      showConditionNote: true,
      rowModifierClass: "requested-check-curation-row",
    }
  );

  assert.match(rowHtml, /requested-check-row-main[\s\S]*data-requested-check-field="condition_note"/);
  assert.doesNotMatch(rowHtml, /requested-check-row-main[\s\S]*data-requested-check-field="value"[\s\S]*data-requested-check-field="condition_note"/);
  assert.doesNotMatch(rowHtml, /requested-check-row-secondary/);
});

test("CTA row keeps condition input outside the main row structure", () => {
  const rowHtml = buildAssignmentRequestedCheckReturnRowHtml(
    {
      return_key: "cta_contact.phone",
      group_key: "cta_contact",
      check_key: "phone",
      label: "Phone",
      answer_type: "text",
      suggested_value: "found",
      evidence_required: true,
    },
    {
      checked: true,
      value: "found",
      condition_note: "front desk",
      evidence: "menu photo",
    },
    {
      showConditionNote: false,
    }
  );

  assert.match(rowHtml, /assignment-capture-actions requested-check-row-status/);
  assert.doesNotMatch(rowHtml, /requested-check-row-secondary[\s\S]*data-requested-check-field="evidence"/);
  assert.doesNotMatch(rowHtml, /class="requested-check-row-condition"/);
});
