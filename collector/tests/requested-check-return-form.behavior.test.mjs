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
    querySelectorAll: () => [],
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
      isEditorUser: () => false,
      loadAssignmentRequestedCheckHandoffSource: async () => null,
      setAssignmentDraftSaveStatus: () => {},
      clearAssignmentCaptureUploads: () => {},
      renderAssignmentSubmissionFileList: () => {},
      buildAssignmentSubmissionGateState: () => ({}),
      renderAssignmentSubmissionGatePanel: () => {},
      applyAssignmentModernClasses: () => {},
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
const hasAssignmentRequestedCheckMeaningfulSuggestedValue = loadNamedFunction(appJs, "hasAssignmentRequestedCheckMeaningfulSuggestedValue", {
  formatRequestedCheckSuggestedValue,
});
const cloneAssignmentRequestedCheckValue = loadNamedFunction(appJs, "cloneAssignmentRequestedCheckValue");
const areAssignmentRequestedCheckValuesEqual = loadNamedFunction(appJs, "areAssignmentRequestedCheckValuesEqual", {
  cloneAssignmentRequestedCheckValue,
});
const getAssignmentRequestedCheckGroupsFromHandoffPackage = loadNamedFunction(appJs, "getAssignmentRequestedCheckGroupsFromHandoffPackage", {
  normalizeAssignmentRequestedCheckKeyPart,
  buildAssignmentRequestedCheckReturnKey,
});
const getAssignmentRequestedCheckDefaultValue = loadNamedFunction(appJs, "getAssignmentRequestedCheckDefaultValue");
const buildAssignmentRequestedCheckReturnDraftFromHandoffPackage = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnDraftFromHandoffPackage", {
  getAssignmentRequestedCheckGroupsFromHandoffPackage,
  getAssignmentRequestedCheckDefaultValue,
  cloneAssignmentRequestedCheckValue,
});
const normalizeAssignmentRequestedCheckReturnDraft = loadNamedFunction(appJs, "normalizeAssignmentRequestedCheckReturnDraft", {
  buildAssignmentRequestedCheckReturnDraftFromHandoffPackage,
});
const buildAssignmentRequestedCheckReturnPayloadFromDraft = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnPayloadFromDraft", {
  normalizeAssignmentRequestedCheckReturnDraft,
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
  escapeHtml,
});
const buildAssignmentRequestedCheckReturnSectionHtml = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnSectionHtml", {
  getAssignmentRequestedCheckGroupsFromHandoffPackage,
  normalizeAssignmentRequestedCheckReturnDraft,
  buildAssignmentRequestedCheckReturnRowHtml,
  escapeHtml,
});
const readAssignmentRequestedCheckReturnDraftFromForm = loadNamedFunction(appJs, "readAssignmentRequestedCheckReturnDraftFromForm");

const normalizeRequestedCheckAnswerType = loadNamedFunction(repositoryJs, "normalizeRequestedCheckAnswerType");
const normalizeRequestedCheckReturnKey = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturnKey");
const inferRequestedCheckAnswerTypeFromReturnRow = loadNamedFunction(repositoryJs, "inferRequestedCheckAnswerTypeFromReturnRow", {
  normalizeRequestedCheckAnswerType,
  hasMeaningfulValue,
});
const normalizeRequestedCheckReturnValue = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturnValue", {
  normalizeOptionalUrlValue,
  normalizeStringListInput,
  normalizeJsonSafeValue,
});
const normalizeRequestedCheckReturnEntry = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturnEntry", {
  inferRequestedCheckAnswerTypeFromReturnRow,
  normalizeFieldReturnEvidence,
  normalizeRequestedCheckReturnValue,
  hasMeaningfulValue,
});
const normalizeRequestedCheckReturns = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturns", {
  normalizeRequestedCheckReturnKey,
  normalizeRequestedCheckReturnEntry,
  parseJson,
});

test("requested-check section uses namespaced keys and renders CTA rows once while hiding taxonomy", () => {
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
              key: "phone",
              requested: true,
              label: "Backup phone label",
              instruction: "Must not collide with CTA namespace",
              answer_type: "text",
            },
          ],
        },
      ],
    },
  };

  const groups = getAssignmentRequestedCheckGroupsFromHandoffPackage(handoffPackage);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].checks[0].return_key, "cta_contact.phone");
  assert.equal(groups[1].checks[0].return_key, "taxonomy.phone");
  assert.deepEqual(
    [...new Set(groups.flatMap((group) => group.checks.map((check) => check.return_key)))].sort(),
    ["cta_contact.line_url", "cta_contact.phone", "taxonomy.phone"]
  );

  const draft = buildAssignmentRequestedCheckReturnDraftFromHandoffPackage(handoffPackage);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].checked, true);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].value, "0812345678");
  assert.deepEqual(draft.requested_check_returns["taxonomy.phone"].value, "");
  assert.equal(getAssignmentRequestedCheckDefaultValue("boolean"), null);
  assert.deepEqual(getAssignmentRequestedCheckDefaultValue("multi_select"), []);
  assert.deepEqual(getAssignmentRequestedCheckDefaultValue("number_with_unit"), { number: "", unit: "" });

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, draft);
  assert.ok(sectionHtml.includes('data-requested-check-return-key="cta_contact.phone"'));
  assert.ok(sectionHtml.includes('data-requested-check-return-key="cta_contact.line_url"'));
  assert.equal((sectionHtml.match(/data-requested-check-return-key="cta_contact\.phone"/g) || []).length, 1);
  assert.equal((sectionHtml.match(/data-requested-check-return-key="cta_contact\.line_url"/g) || []).length, 1);
  assert.equal((sectionHtml.match(/class="requested-check-row-status"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/AI แนะนำ/g) || []).length, 1);
  assert.equal(sectionHtml.includes('data-requested-check-return-key="taxonomy.phone"'), false);
  assert.equal(sectionHtml.includes('data-requested-check-group="taxonomy"'), false);
  assert.match(sectionHtml, /AI แนะนำ/);
  assert.doesNotMatch(sectionHtml, /Manual|ข้อมูลเพิ่มเติม|รายละเอียด/);
});

test("requested-check draft auto-checks and prefills suggested values without changing namespaced keys", () => {
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
  assert.equal(draft.requested_check_returns["cta_contact.phone"].checked, true);
  assert.equal(draft.requested_check_returns["cta_contact.phone"].value, "0812345678");
  assert.equal(draft.requested_check_returns["taxonomy.tags"].checked, true);
  assert.deepEqual(draft.requested_check_returns["taxonomy.tags"].value, ["family", "cafe"]);
});

test("requested-check section renders only the CTA group in Work Return", () => {
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
            { key: "phone", requested: true, label: "Phone", answer_type: "phone", suggested_value: "0812345678" },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  const ctaIndex = sectionHtml.indexOf('data-requested-check-group="cta_contact"');
  assert.ok(ctaIndex >= 0);
  assert.equal(sectionHtml.includes('data-requested-check-group="taxonomy"'), false);
  assert.equal(sectionHtml.includes('data-requested-check-group="custom"'), false);
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
  assert.equal((sectionHtml.match(/class="requested-check-row-status"/g) || []).length, 5);
  assert.match(sectionHtml, /value="0812345678"/);
  assert.match(sectionHtml, /data-requested-check-field="value" type="url" value=""/);
  assert.match(sectionHtml, /AI แนะนำ/);
  assert.doesNotMatch(sectionHtml, /Manual/);
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
  assert.match(sectionHtml, /<div class="requested-check-row-main">\s*<label class="assignment-inline-check">/);
  assert.match(sectionHtml, /<div class="assignment-brief-text requested-check-row-label">/);
  assert.match(sectionHtml, /<div class="requested-check-row-value">/);
  assert.equal((sectionHtml.match(/class="requested-check-row-status"/g) || []).length, 2);
  assert.equal((sectionHtml.match(/AI แนะนำ/g) || []).length, 0);
  assert.ok(sectionHtml.includes('<div class="requested-check-row-status"></div>'));
  assert.doesNotMatch(sectionHtml, /<details|<summary|รายละเอียด|Manual/);
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
  assert.equal((sectionHtml.match(/class="requested-check-row-status"/g) || []).length, 2);
  assert.ok(sectionHtml.includes('<div class="requested-check-row-status"></div>'));
  assert.doesNotMatch(sectionHtml, /AI แนะนำ|Manual/);
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
      renderAssignmentSubmissionForm: harness.renderAssignmentSubmissionForm,
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

test("requested-check submission form render path outputs compact CTA before taxonomy", () => {
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
          },
        },
      },
      handoffSourcePackages: {
        12: {
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
  assert.match(fieldsNode.innerHTML, /data-requested-check-group="cta_contact"/);
  assert.equal(fieldsNode.innerHTML.includes('data-requested-check-group="taxonomy"'), false);
  assert.match(fieldsNode.innerHTML, /value="0999999999"/);
  assert.equal(fieldsNode.innerHTML.includes('value="0812345678"'), false);
  assert.match(fieldsNode.innerHTML, /data-requested-check-return-key="cta_contact.line_url"/);
  assert.doesNotMatch(fieldsNode.innerHTML, /Manual|<details|ข้อมูลเพิ่มเติม|data-requested-check-return-key="taxonomy\./);
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

test("requested-check section uses one outer panel and does not render custom groups in CTA-only mode", () => {
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
  assert.equal((sectionHtml.match(/class="assignment-brief-card"/g) || []).length, 1);
  assert.equal((sectionHtml.match(/data-requested-check-row/g) || []).length, 1);
  assert.equal(sectionHtml.includes('data-requested-check-group="custom"'), false);
  assert.equal(sectionHtml.includes('data-requested-check-return-key="custom.parking"'), false);
  assert.match(sectionHtml, /data-requested-check-field="value"/);
});

test("requested-check taxonomy rows are not rendered in CTA-only Work Return", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "Category", answer_type: "text" },
            { key: "tags", requested: false, label: "Tags", answer_type: "multi_select" },
          ],
        },
      ],
    },
  };

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, null);
  assert.equal(sectionHtml.trim(), "");
  assert.equal(sectionHtml.includes('data-requested-check-return-key="taxonomy.category"'), false);
  assert.equal(sectionHtml.includes('data-requested-check-return-key="taxonomy.tags"'), false);
});

test("requested-check mobile CSS keeps one-column CTA rows without secondary controls", () => {
  assert.match(stylesCss, /@media \(max-width: 900px\)/);
  assert.match(stylesCss, /requested-check-row-main/);
  assert.match(stylesCss, /requested-check-row-value \{\s*grid-column: 2 \/ -1;/);
  assert.doesNotMatch(stylesCss, /requested-check-row-secondary|requested-check-row-details|requested-check-additional/);
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
        checked: false,
        value: ["cafe", "family"],
        condition_note: null,
        evidence: null,
        note: null,
      },
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload.requested_check_returns["cta_contact.phone"], "answer_type"), false);
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
      handoffSourceLoaded: {},
    },
  };
  const renderAssignmentHandoffBriefSpy = () => {
    calls.push("brief");
  };
  const renderAssignmentSubmissionFormSpy = (value) => {
    calls.push(`submission:${value}`);
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
      renderAssignmentSubmissionForm: renderAssignmentSubmissionFormSpy,
      getAssignmentSubmissionFormAssignment: (assignment, mode) => `${assignment?.id || 0}:${mode}`,
      getAssignmentById: (id) => ({ id }),
      getAssignmentPageMode: () => "work",
    }),
  });

  const result = await loadAssignmentRequestedCheckHandoffSource({ id: 12 });
  assert.ok(result?.requested_checks);
  assert.deepEqual(calls, ["brief", "submission:12:work"]);
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
      handoffSourceLoaded: {},
    },
  };
  const renderAssignmentHandoffBriefSpy = () => {
    calls.push("brief");
  };
  const renderAssignmentSubmissionFormSpy = () => {
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
      renderAssignmentSubmissionForm: renderAssignmentSubmissionFormSpy,
      getAssignmentSubmissionFormAssignment: (assignment, mode) => `${assignment?.id || 0}:${mode}`,
      getAssignmentById: (id) => ({ id }),
      getAssignmentPageMode: () => "work",
    }),
  });

  await loadAssignmentRequestedCheckHandoffSource({ id: 12 });
  assert.equal(calls[0], "brief");
  assert.match(calls[1], /value="0999999999"/);
  assert.doesNotMatch(calls[1], /Manual/);
  assert.doesNotMatch(calls[1], /AI แนะนำ/);
  assert.equal((calls[1].match(/class="requested-check-row-status"/g) || []).length, 1);
  assert.ok(calls[1].includes('<div class="requested-check-row-status"></div>'));
  assert.doesNotMatch(calls[1], /<details|ข้อมูลเพิ่มเติม/);
  assert.equal(calls[1].includes('value="0812345678"'), false);
  assert.equal(state.assignments.requestedCheckReturnDrafts[12].requested_check_returns["cta_contact.phone"].value, "0999999999");
  assert.equal(state.assignments.requestedCheckReturnDrafts[12].requested_check_returns["cta_contact.phone"].note, "edited");
});
