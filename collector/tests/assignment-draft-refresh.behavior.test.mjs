import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const indexJs = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

function extractFunctionSource(source, functionName) {
  const asyncPattern = new RegExp(`async function ${functionName}\\s*\\(`);
  const pattern = new RegExp(`function ${functionName}\\s*\\(`);
  const asyncMatch = asyncPattern.exec(source);
  const match = asyncMatch || pattern.exec(source);
  const start = match ? match.index : -1;
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
  let inString = false;
  let stringChar = "";
  let escapeNext = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === stringChar) {
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
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${functionName}`);
}

function loadNamedFunction(sourceText, functionName, dependencies = {}) {
  const source = extractFunctionSource(sourceText, functionName);
  return Function(...Object.keys(dependencies), `${source}; return ${functionName};`)(...Object.values(dependencies));
}

function loadNamedAsyncFunction(sourceText, functionName, dependencies = {}) {
  const source = extractFunctionSource(sourceText, functionName);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return AsyncFunction(...Object.keys(dependencies), `${source}; return ${functionName};`)(...Object.values(dependencies));
}

function createMockDomNode(initial = {}) {
  const listeners = new Map();
  return {
    innerHTML: "",
    textContent: "",
    value: "",
    className: "",
    href: "",
    placeholder: "",
    disabled: false,
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    addEventListener(type, handler) {
      const key = String(type || "");
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(handler);
    },
    emit(type, event = {}) {
      const key = String(type || "");
      for (const handler of listeners.get(key) || []) {
        handler({ currentTarget: this, target: this, preventDefault() {}, ...event });
      }
    },
    setAttribute() {},
    removeAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    ...initial,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const normalizeAssignmentSubmissionPromptAnswers = loadNamedFunction(appJs, "normalizeAssignmentSubmissionPromptAnswers");
const normalizeAssignmentSubmissionFieldPayload = loadNamedFunction(appJs, "normalizeAssignmentSubmissionFieldPayload", {
  parseJsonSafe: (value, fallback = {}) => (value && typeof value === "object" ? value : fallback),
  getFieldPackPromptGroups: () => ({
    mustVerify: ["Verify phone"],
    mustCapture: ["Storefront shot"],
    mustAsk: ["Ask owner"],
  }),
  normalizeAssignmentSubmissionPromptAnswers,
});
const normalizeAssignmentSubmissionPayload = loadNamedFunction(appJs, "normalizeAssignmentSubmissionPayload", {
  getAssignmentSubmissionKind: () => "field",
  normalizeAssignmentSubmissionEditorialPayload: () => ({ direction_answers: [], source_answers: [], additional_text: "" }),
  normalizeAssignmentSubmissionFieldPayload,
});
const isAssignmentSubmissionDraftEditableState = loadNamedFunction(appJs, "isAssignmentSubmissionDraftEditableState");
const getAssignmentCurrentRound = loadNamedFunction(appJs, "getAssignmentCurrentRound");
const getAssignmentRequestedCheckDraftRound = loadNamedFunction(appJs, "getAssignmentRequestedCheckDraftRound", {
  state: { assignments: { requestedCheckReturnDraftRounds: {} } },
  getAssignmentCurrentRound,
  getAssignmentById: () => null,
});
const getAssignmentSubmissionDraftKey = loadNamedFunction(appJs, "getAssignmentSubmissionDraftKey", {
  getAssignmentCurrentRound: () => 1,
});
const readAssignmentSubmissionDraft = loadNamedFunction(appJs, "readAssignmentSubmissionDraft", {
  state: { assignments: { submissionDrafts: {} } },
  getAssignmentSubmissionDraftKey,
  normalizeAssignmentSubmissionPayload,
});
const getLatestAssignmentSubmissionRow = loadNamedFunction(appJs, "getLatestAssignmentSubmissionRow", {
  state: { assignments: { selectedId: 25, latestSubmissionRows: {} } },
});
const getAssignmentRequestedCheckReturnRows = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnRows");
const hasUsableAssignmentRequestedCheckReturnRows = loadNamedFunction(appJs, "hasUsableAssignmentRequestedCheckReturnRows", {
  getAssignmentRequestedCheckReturnRows,
});
const setAssignmentRequestedCheckReturnDraftStateFactory = (state) => loadNamedFunction(appJs, "setAssignmentRequestedCheckReturnDraftState", {
  state,
  getAssignmentCurrentRound,
  getAssignmentById: (id) => ({ id, state: "assigned", revision_round: 0 }),
});
const cloneAssignmentRequestedCheckValue = loadNamedFunction(appJs, "cloneAssignmentRequestedCheckValue");
const isAssignmentRequestedCheckTaxonomyBooleanRow = loadNamedFunction(appJs, "isAssignmentRequestedCheckTaxonomyBooleanRow");
const getAssignmentRequestedCheckDefaultValue = loadNamedFunction(appJs, "getAssignmentRequestedCheckDefaultValue");
const buildAssignmentRequestedCheckReturnDraftFromHandoffPackage = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnDraftFromHandoffPackage", {
  cloneAssignmentRequestedCheckValue,
  isAssignmentRequestedCheckTaxonomyBooleanRow,
  getAssignmentRequestedCheckDefaultValue,
  getAssignmentRequestedCheckGroupsFromHandoffPackage: (handoffPackage) => Array.isArray(handoffPackage?.requested_check_groups) ? handoffPackage.requested_check_groups : [],
});
const normalizeAssignmentRequestedCheckReturnDraft = loadNamedFunction(appJs, "normalizeAssignmentRequestedCheckReturnDraft", {
  buildAssignmentRequestedCheckReturnDraftFromHandoffPackage,
  cloneAssignmentRequestedCheckValue,
});

function createRenderHarness(state, assignment, handoffPackage) {
  const nodes = new Map();
  [
    "assignment-submission-workspace-help",
    "assignment-submission-brief-label",
    "assignment-submission-verified-label",
    "assignment-submission-question-label",
    "assignment-submission-requested-checks-wrap",
    "assignment-submission-requested-checks-label",
    "assignment-submission-requested-checks-fields",
    "assignment-submission-capture-label",
    "assignment-submission-additional-label",
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
    "assignment-deliverables-meta",
    "assignment-deliverables-summary",
    "assignment-draft-save-status",
  ].forEach((id) => nodes.set(id, createMockDomNode()));

  const qs = (id) => nodes.get(id) || null;
  const getAssignmentRequestedCheckGroupsFromHandoffPackage = (pkg) => Array.isArray(pkg?.requested_check_groups) ? pkg.requested_check_groups : [];
  const getAssignmentRequestedCheckReturnDraftPrefill = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
    state,
    isAssignmentSubmissionDraftEditableState,
    getAssignmentCurrentRound,
    getAssignmentRequestedCheckDraftRound: (assignmentId, assignmentArg = null) => Number(state.assignments.requestedCheckReturnDraftRounds?.[assignmentId] || getAssignmentCurrentRound(assignmentArg) || 0) || 0,
    getLatestAssignmentSubmissionRow: (currentAssignment) => state.assignments.latestSubmissionRows?.[Number(currentAssignment?.id || 0)] || null,
    getAssignmentSubmissionDraftKey,
    normalizeAssignmentRequestedCheckReturnDraft,
    hasUsableAssignmentRequestedCheckReturnRows,
  });
  const buildAssignmentRequestedCheckReturnSectionHtml = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnSectionHtml", {
    getAssignmentRequestedCheckGroupsFromHandoffPackage,
    normalizeAssignmentRequestedCheckReturnDraft,
    resolveAssignmentCurationCheckPlacement: () => "primary",
    buildAssignmentRequestedCheckReturnRowHtml: (check, row) => `<div data-key="${escapeHtml(check.return_key)}" data-value="${escapeHtml(JSON.stringify(row?.value ?? null))}"></div>`,
    hasAssignmentRequestedCheckMeaningfulValue: () => true,
  });
  const renderAssignmentRequestedCheckSection = loadNamedFunction(appJs, "renderAssignmentRequestedCheckSection", {
    state,
    qs,
    getAssignmentRequestedCheckGroupsFromHandoffPackage,
    getAssignmentRequestedCheckReturnDraftPrefill,
    normalizeAssignmentRequestedCheckReturnDraft,
    buildAssignmentRequestedCheckReturnSectionHtml,
    setAssignmentRequestedCheckReturnDraftState: setAssignmentRequestedCheckReturnDraftStateFactory(state),
    hasUsableAssignmentRequestedCheckReturnRows,
    updateAssignmentRequestedCheckReturnRowState: () => {},
    isEditorUser: () => false,
    loadAssignmentRequestedCheckHandoffSource: async () => null,
  });
  const getAssignmentSubmissionPrefillPayload = loadNamedFunction(appJs, "getAssignmentSubmissionPrefillPayload", {
    state,
    isAssignmentSubmissionDraftEditableState,
    getAssignmentSubmissionDraftKey,
    normalizeAssignmentSubmissionPayload,
    readAssignmentSubmissionDraft: loadNamedFunction(appJs, "readAssignmentSubmissionDraft", {
      state,
      getAssignmentSubmissionDraftKey,
      normalizeAssignmentSubmissionPayload,
    }),
  });
  const renderAssignmentSubmissionForm = loadNamedFunction(appJs, "renderAssignmentSubmissionForm", {
    state,
    qs,
    getAssignmentSubmissionFormConfig: () => ({
      workspaceHelp: "workspace help",
      briefLabel: "brief",
      verifiedLabel: "verified",
      questionLabel: "question",
      captureLabel: "capture",
      additionalLabel: "additional",
      filesLabel: "files",
      additionalPlaceholder: "additional",
      emptyVerified: "empty verified",
      emptyQuestion: "empty question",
      emptyCapture: "empty capture",
      verifiedPrompts: ["Verify phone"],
      verifiedGroupName: "verified",
      verifiedAnswers: "verified_answers",
      questionPrompts: ["Ask owner"],
      questionGroupName: "question",
      questionAnswers: "question_answers",
      answerPlaceholder: "placeholder",
      captureItems: [],
    }),
    renderAssignmentSubmissionContext: () => {},
    getAssignmentLandingItemId: () => 25,
    buildAssignmentBriefUrl: () => "/brief",
    getAssignmentSubmissionPrefillPayload,
    isEditorUser: () => false,
    loadAssignmentRequestedCheckHandoffSource: async () => null,
    setAssignmentDraftSaveStatus: () => {},
    clearAssignmentCaptureUploads: () => {},
    renderAssignmentDeliverablesSummary: () => {},
    buildAssignmentSubmissionGateState: () => ({ canSubmit: false, checklist: [], blockingReasons: [], warnings: [] }),
    renderAssignmentSubmissionGatePanel: () => {},
    applyAssignmentModernClasses: () => {},
    renderAssignmentRequestedCheckSection,
    buildAssignmentRequestedCheckReturnSectionHtml,
    updateAssignmentRequestedCheckReturnRowState: () => {},
    buildAssignmentCaptureUploadCards: () => "",
    buildAssignmentSubmissionPromptInputs: (_items = [], groupName, answers = []) => answers.map((row) => `${groupName}:${row.prompt}=${row.answer}`).join("|"),
    escapeHtml,
  });

  return { qs, renderAssignmentSubmissionForm, nodes, handoffPackage, assignment };
}

function createAssignmentState() {
  return {
    assignments: {
      selectedId: 25,
      submissionDrafts: {},
      serverSubmissionDraftPayloads: {},
      serverSubmissionDraftLoaded: {},
      serverSubmissionDraftSaveTimers: {},
      requestedCheckReturnDrafts: {},
      requestedCheckReturnDraftDirty: {},
      requestedCheckReturnDraftSources: {},
      handoffSourcePackages: {},
      handoffSourceLoaded: {},
      latestSubmissionArticlePayloads: {},
      latestSubmissionRows: {},
      latestSubmissionLoaded: {},
      latestUploadedAssets: [],
      latestUploadedAssetsKey: "",
      syncedUploadAssetsByKey: {},
      captureUploadDrafts: {},
      captureUploadSyncState: {},
      assetLookup: [],
      contextFieldPack: null,
    },
  };
}

test("server draft text and requested checks restore after refresh bootstrap", async () => {
  const state = createAssignmentState();
  const assignment = { id: 25, state: "assigned", revision_round: 0, content_item_id: 501 };
  state.assignments.selectedId = assignment.id;
  const handoffPackage = {
    requested_check_groups: [
      {
        group_key: "cta_contact",
        checks: [{ return_key: "cta_contact.phone", check_key: "phone", group_key: "cta_contact", answer_type: "text", label: "Phone" }],
      },
      {
        group_key: "taxonomy",
        checks: [{ return_key: "taxonomy.pet_friendly", check_key: "pet_friendly", group_key: "taxonomy", answer_type: "boolean", label: "Pet friendly" }],
      },
    ],
  };
  state.assignments.handoffSourcePackages[25] = handoffPackage;
  const renderCalls = [];
  const getRequestedCheckPrefill = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
    state,
    isAssignmentSubmissionDraftEditableState,
    getAssignmentCurrentRound,
    getAssignmentRequestedCheckDraftRound: () => 1,
    getLatestAssignmentSubmissionRow: (currentAssignment) => state.assignments.latestSubmissionRows?.[Number(currentAssignment?.id || 0)] || null,
    getAssignmentSubmissionDraftKey,
    normalizeAssignmentRequestedCheckReturnDraft,
    hasUsableAssignmentRequestedCheckReturnRows,
  });

  const loadDraft = await loadNamedAsyncFunction(appJs, "loadAssignmentSubmissionServerDraft", {
    state,
    isEditorUser: () => false,
    isAssignmentSubmissionDraftEditableState,
    api: async () => ({
      draft: {
        article_payload_json: {
          verified_answers: [{ prompt: "Verify phone", answer: "0804415224" }],
          capture_answers: [{ prompt: "Storefront shot", answer: "front gate" }],
          question_answers: [{ prompt: "Ask owner", answer: "open daily" }],
          additional_text: "saved note",
        },
        field_return_payload_json: {
          requested_check_returns: {
            "cta_contact.phone": { checked: true, value: "0804415224", answer_type: "text", condition_note: "" },
            "taxonomy.pet_friendly": { checked: true, value: false, answer_type: "boolean", condition_note: "" },
          },
        },
      },
    }),
    getAssignmentSubmissionDraftKey,
    normalizeAssignmentSubmissionPayload,
    readAssignmentSubmissionDraft: loadNamedFunction(appJs, "readAssignmentSubmissionDraft", {
      state,
      getAssignmentSubmissionDraftKey,
      normalizeAssignmentSubmissionPayload,
    }),
    hasUsableAssignmentRequestedCheckReturnRows,
    normalizeAssignmentRequestedCheckReturnDraft,
    setAssignmentRequestedCheckReturnDraftState: setAssignmentRequestedCheckReturnDraftStateFactory(state),
    getAssignmentById: () => assignment,
    renderAssignmentSubmissionForm: (currentAssignment) => {
      renderCalls.push(Number(currentAssignment?.id || 0));
    },
    getAssignmentSubmissionFormAssignment: (currentAssignment) => currentAssignment,
    getAssignmentPageMode: () => "work",
    renderAssignmentRequestedCheckSection: () => {},
  });

  await loadDraft(assignment);

  assert.equal(state.assignments.submissionDrafts["25:1"]?.article_payload_json?.additional_text, "saved note");
  assert.equal(state.assignments.serverSubmissionDraftPayloads["25:1"]?.field_return_payload_json?.requested_check_returns?.["cta_contact.phone"]?.value, "0804415224");
  assert.equal(state.assignments.serverSubmissionDraftPayloads["25:1"]?.field_return_payload_json?.requested_check_returns?.["taxonomy.pet_friendly"]?.value, false);
  assert.equal(getRequestedCheckPrefill(assignment, handoffPackage)?.requested_check_returns?.["cta_contact.phone"]?.value, "0804415224");
  assert.equal(getRequestedCheckPrefill(assignment, handoffPackage)?.requested_check_returns?.["taxonomy.pet_friendly"]?.value, false);
  assert.deepEqual(renderCalls, [25]);
});

test("repeated refresh bootstrap does not replace restored draft with empty values", async () => {
  const state = createAssignmentState();
  const assignment = { id: 25, state: "assigned", revision_round: 0, content_item_id: 501 };
  const getPrefill = loadNamedFunction(appJs, "getAssignmentSubmissionPrefillPayload", {
    state,
    isAssignmentSubmissionDraftEditableState,
    getAssignmentSubmissionDraftKey,
    normalizeAssignmentSubmissionPayload,
    readAssignmentSubmissionDraft: loadNamedFunction(appJs, "readAssignmentSubmissionDraft", {
      state,
      getAssignmentSubmissionDraftKey,
      normalizeAssignmentSubmissionPayload,
    }),
  });
  const loadDraft = await loadNamedAsyncFunction(appJs, "loadAssignmentSubmissionServerDraft", {
    state,
    isEditorUser: () => false,
    isAssignmentSubmissionDraftEditableState,
    api: async () => ({
      draft: {
        article_payload_json: {
          verified_answers: [{ prompt: "Verify phone", answer: "cached" }],
          question_answers: [{ prompt: "Ask owner", answer: "owner answer" }],
          capture_answers: [],
          additional_text: "keep me",
        },
      },
    }),
    getAssignmentSubmissionDraftKey,
    normalizeAssignmentSubmissionPayload,
    readAssignmentSubmissionDraft: loadNamedFunction(appJs, "readAssignmentSubmissionDraft", {
      state,
      getAssignmentSubmissionDraftKey,
      normalizeAssignmentSubmissionPayload,
    }),
    hasUsableAssignmentRequestedCheckReturnRows,
    normalizeAssignmentRequestedCheckReturnDraft,
    setAssignmentRequestedCheckReturnDraftState: setAssignmentRequestedCheckReturnDraftStateFactory(state),
    getAssignmentById: () => assignment,
    renderAssignmentSubmissionForm: () => {},
    getAssignmentSubmissionFormAssignment: (currentAssignment) => currentAssignment,
    getAssignmentPageMode: () => "work",
    renderAssignmentRequestedCheckSection: () => {},
  });

  await loadDraft(assignment);
  const afterFirstRefresh = getPrefill(assignment, null);
  const afterSecondRefresh = getPrefill(assignment, null);

  assert.equal(afterFirstRefresh.additional_text, "keep me");
  assert.equal(afterSecondRefresh.additional_text, "keep me");
  assert.equal(afterSecondRefresh.verified_answers[0]?.answer, "cached");
});

test("non-editable assignment states ignore server draft cache and prefer latest immutable submission", () => {
  const state = createAssignmentState();
  const assignment = { id: 25, state: "submitted", revision_round: 0, content_item_id: 501 };
  state.assignments.serverSubmissionDraftPayloads["25:1"] = {
    article_payload_json: {
      verified_answers: [{ prompt: "Verify phone", answer: "stale draft" }],
      capture_answers: [],
      question_answers: [],
      additional_text: "stale server draft",
    },
  };
  state.assignments.submissionDrafts["25:1"] = {
    article_payload_json: {
      verified_answers: [{ prompt: "Verify phone", answer: "local stale draft" }],
      capture_answers: [],
      question_answers: [],
      additional_text: "local stale draft",
    },
  };
  state.assignments.latestSubmissionArticlePayloads[25] = {
    verified_answers: [{ prompt: "Verify phone", answer: "immutable latest submission" }],
    capture_answers: [],
    question_answers: [],
    additional_text: "immutable latest submission",
  };

  const getPrefill = loadNamedFunction(appJs, "getAssignmentSubmissionPrefillPayload", {
    state,
    isAssignmentSubmissionDraftEditableState,
    getAssignmentSubmissionDraftKey,
    normalizeAssignmentSubmissionPayload,
    readAssignmentSubmissionDraft: loadNamedFunction(appJs, "readAssignmentSubmissionDraft", {
      state,
      getAssignmentSubmissionDraftKey,
      normalizeAssignmentSubmissionPayload,
    }),
  });

  const prefill = getPrefill(assignment, null);

  assert.equal(prefill.additional_text, "immutable latest submission");
  assert.equal(prefill.verified_answers[0]?.answer, "immutable latest submission");
});

test("revision 2 reload preserves latest saved draft text and explicit CTA false instead of latest submission fallback", async () => {
  const state = createAssignmentState();
  const assignment = { id: 25, state: "revision_requested", revision_round: 1, content_item_id: 501 };
  const handoffPackage = {
    requested_check_groups: [
      {
        group_key: "cta_contact",
        checks: [{ return_key: "cta_contact.phone", check_key: "phone", group_key: "cta_contact", answer_type: "text", label: "Phone" }],
      },
      {
        group_key: "taxonomy",
        checks: [{ return_key: "taxonomy.pet_friendly", check_key: "pet_friendly", group_key: "taxonomy", answer_type: "boolean", label: "Pet friendly" }],
      },
    ],
  };
  state.assignments.handoffSourcePackages[25] = handoffPackage;
  state.assignments.latestSubmissionRows[25] = {
    id: 991,
    article_payload_json: {
      verified_answers: [],
      capture_answers: [],
      question_answers: [],
      additional_text: "submitted note only",
    },
    field_return_payload_json: {
      requested_check_returns: {
        "cta_contact.phone": { checked: true, value: null, answer_type: "text", condition_note: "" },
        "taxonomy.pet_friendly": { checked: true, value: false, answer_type: "boolean", condition_note: "" },
      },
    },
  };

  const loadDraft = await loadNamedAsyncFunction(appJs, "loadAssignmentSubmissionServerDraft", {
    state,
    isEditorUser: () => false,
    isAssignmentSubmissionDraftEditableState,
    api: async () => ({
      draft: {
        article_payload_json: {
          verified_answers: [{ prompt: "Verify phone", answer: "draft verify" }],
          capture_answers: [{ prompt: "Storefront shot", answer: "draft capture" }],
          question_answers: [{ prompt: "Ask owner", answer: "draft ask" }],
          additional_text: "draft note",
        },
        field_return_payload_json: {
          requested_check_returns: {
            "cta_contact.phone": { checked: false, value: "0800000000", answer_type: "text", condition_note: "" },
            "taxonomy.pet_friendly": { checked: false, value: false, answer_type: "boolean", condition_note: "" },
          },
        },
      },
      source: "latest_saved_draft_fallback",
      revision_round: 2,
    }),
    getAssignmentSubmissionDraftKey: () => "25:2",
    normalizeAssignmentSubmissionPayload,
    readAssignmentSubmissionDraft: loadNamedFunction(appJs, "readAssignmentSubmissionDraft", {
      state,
      getAssignmentSubmissionDraftKey: () => "25:2",
      normalizeAssignmentSubmissionPayload,
    }),
    hasUsableAssignmentRequestedCheckReturnRows,
    normalizeAssignmentRequestedCheckReturnDraft,
    setAssignmentRequestedCheckReturnDraftState: setAssignmentRequestedCheckReturnDraftStateFactory(state),
    getAssignmentById: () => assignment,
    renderAssignmentSubmissionForm: () => {},
    getAssignmentSubmissionFormAssignment: (currentAssignment) => currentAssignment,
    getAssignmentPageMode: () => "work",
    renderAssignmentRequestedCheckSection: () => {},
  });

  await loadDraft(assignment);

  const getPrefill = loadNamedFunction(appJs, "getAssignmentSubmissionPrefillPayload", {
    state,
    isAssignmentSubmissionDraftEditableState,
    getAssignmentSubmissionDraftKey: () => "25:2",
    normalizeAssignmentSubmissionPayload,
    readAssignmentSubmissionDraft: loadNamedFunction(appJs, "readAssignmentSubmissionDraft", {
      state,
      getAssignmentSubmissionDraftKey: () => "25:2",
      normalizeAssignmentSubmissionPayload,
    }),
  });
  const getRequestedCheckPrefill = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
    state,
    isAssignmentSubmissionDraftEditableState,
    getAssignmentCurrentRound,
    getAssignmentRequestedCheckDraftRound: () => 2,
    getLatestAssignmentSubmissionRow: () => state.assignments.latestSubmissionRows[25],
    getAssignmentSubmissionDraftKey: () => "25:2",
    normalizeAssignmentRequestedCheckReturnDraft,
    hasUsableAssignmentRequestedCheckReturnRows,
  });

  const articlePrefill = getPrefill(assignment, null);
  const requestedPrefill = getRequestedCheckPrefill(assignment, handoffPackage);

  assert.equal(articlePrefill.verified_answers[0]?.answer, "draft verify");
  assert.equal(articlePrefill.capture_answers[0]?.answer, "draft capture");
  assert.equal(articlePrefill.question_answers[0]?.answer, "draft ask");
  assert.equal(articlePrefill.additional_text, "draft note");
  assert.equal(requestedPrefill.requested_check_returns["cta_contact.phone"].checked, false);
  assert.equal(requestedPrefill.requested_check_returns["cta_contact.phone"].value, "0800000000");
  assert.equal(requestedPrefill.requested_check_returns["taxonomy.pet_friendly"].checked, false);
  assert.equal(requestedPrefill.requested_check_returns["taxonomy.pet_friendly"].value, false);
});

test("server draft cache stays raw until field pack loads and rerender restores prompt answers", async () => {
  const makeSubmissionNormalizer = () => {
    const normalizeAssignmentSubmissionPromptAnswersReal = loadNamedFunction(appJs, "normalizeAssignmentSubmissionPromptAnswers");
    const getFieldPackPromptGroups = (fieldPack = null) => {
      const checklists = Array.isArray(fieldPack?.checklists) ? fieldPack.checklists : [];
      return {
        mustVerify: checklists
          .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === "must_verify_fact")
          .map((row) => String(row?.item_text || "").trim())
          .filter(Boolean),
        mustCapture: checklists
          .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === "must_capture")
          .map((row) => String(row?.item_text || "").trim())
          .filter(Boolean),
        mustAsk: checklists
          .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === "must_ask_question")
          .map((row) => String(row?.item_text || "").trim())
          .filter(Boolean),
      };
    };
    const normalizeAssignmentSubmissionFieldPayloadReal = loadNamedFunction(appJs, "normalizeAssignmentSubmissionFieldPayload", {
      parseJsonSafe: (value, fallback = {}) => (value && typeof value === "object" ? value : fallback),
      getFieldPackPromptGroups,
      normalizeAssignmentSubmissionPromptAnswers: normalizeAssignmentSubmissionPromptAnswersReal,
    });
    return loadNamedFunction(appJs, "normalizeAssignmentSubmissionPayload", {
      getAssignmentSubmissionKind: () => "field",
      normalizeAssignmentSubmissionEditorialPayload: () => ({ verified_answers: [], capture_answers: [], question_answers: [], additional_text: "" }),
      normalizeAssignmentSubmissionFieldPayload: normalizeAssignmentSubmissionFieldPayloadReal,
    });
  };

  for (const scenario of [
    { assignment: { id: 25, state: "assigned", revision_round: 0, content_item_id: 501 }, draftKey: "25:1" },
    { assignment: { id: 25, state: "revision_requested", revision_round: 1, content_item_id: 501 }, draftKey: "25:2" },
  ]) {
    const state = createAssignmentState();
    state.assignments.selectedId = 25;
    state.assignments.contextFieldPack = null;
    state.assignments.contextFieldPackStatus = "";
    const normalizeAssignmentSubmissionPayloadReal = makeSubmissionNormalizer();
    const serverDraftResponse = {
      draft: {
        article_payload_json: {
          verified_answers: [{ prompt: "Verify phone", answer: "draft verify" }],
          capture_answers: [{ prompt: "Storefront shot", answer: "draft capture" }],
          question_answers: [{ prompt: "Ask owner", answer: "draft ask" }],
          additional_text: "draft note",
        },
        field_return_payload_json: {
          requested_check_returns: {
            "cta_contact.phone": { checked: false, value: "0800000000", answer_type: "text", condition_note: "" },
            "taxonomy.pet_friendly": { checked: false, value: false, answer_type: "boolean", condition_note: "" },
          },
        },
      },
      source: "latest_saved_draft_fallback",
      revision_round: Number(scenario.assignment.revision_round || 0) + 1,
    };

    const loadDraft = await loadNamedAsyncFunction(appJs, "loadAssignmentSubmissionServerDraft", {
      state,
      isEditorUser: () => false,
      isAssignmentSubmissionDraftEditableState,
      api: async () => serverDraftResponse,
      getAssignmentSubmissionDraftKey: () => scenario.draftKey,
      normalizeAssignmentSubmissionPayload: normalizeAssignmentSubmissionPayloadReal,
      readAssignmentSubmissionDraft: () => null,
      hasUsableAssignmentRequestedCheckReturnRows,
      normalizeAssignmentRequestedCheckReturnDraft,
      setAssignmentRequestedCheckReturnDraftState: setAssignmentRequestedCheckReturnDraftStateFactory(state),
      getAssignmentById: () => scenario.assignment,
      renderAssignmentSubmissionForm: () => {},
      getAssignmentSubmissionFormAssignment: (currentAssignment) => currentAssignment,
      getAssignmentPageMode: () => "work",
      renderAssignmentRequestedCheckSection: () => {},
    });

    await loadDraft(scenario.assignment);

    const cachedDraft = state.assignments.serverSubmissionDraftPayloads[scenario.draftKey];
    assert.equal(cachedDraft.article_payload_json.verified_answers[0]?.answer, "draft verify");
    assert.equal(cachedDraft.article_payload_json.capture_answers[0]?.answer, "draft capture");
    assert.equal(cachedDraft.article_payload_json.question_answers[0]?.answer, "draft ask");
    assert.equal(cachedDraft.article_payload_json.additional_text, "draft note");

    const getPrefill = loadNamedFunction(appJs, "getAssignmentSubmissionPrefillPayload", {
      state,
      isAssignmentSubmissionDraftEditableState,
      getAssignmentSubmissionDraftKey: () => scenario.draftKey,
      normalizeAssignmentSubmissionPayload: normalizeAssignmentSubmissionPayloadReal,
      readAssignmentSubmissionDraft: () => null,
    });

    const prefillBeforeFieldPack = getPrefill(scenario.assignment, null);
    assert.equal(prefillBeforeFieldPack.verified_answers[0]?.answer, "draft verify");
    assert.equal(prefillBeforeFieldPack.capture_answers[0]?.answer, "draft capture");
    assert.equal(prefillBeforeFieldPack.question_answers[0]?.answer, "draft ask");
    assert.equal(prefillBeforeFieldPack.additional_text, "draft note");

    state.assignments.contextFieldPack = {
      checklists: [
        { checklist_type: "must_verify_fact", item_text: "Verify phone" },
        { checklist_type: "must_capture", item_text: "Storefront shot" },
        { checklist_type: "must_ask_question", item_text: "Ask owner" },
      ],
    };
    const prefillAfterFieldPack = getPrefill(scenario.assignment, state.assignments.contextFieldPack);
    assert.equal(prefillAfterFieldPack.verified_answers[0]?.answer, "draft verify");
    assert.equal(prefillAfterFieldPack.capture_answers[0]?.answer, "draft capture");
    assert.equal(prefillAfterFieldPack.question_answers[0]?.answer, "draft ask");
    assert.equal(prefillAfterFieldPack.additional_text, "draft note");
  }
});

test("submit success cancels pending server draft autosave and flips local state to non-editable immediately", async () => {
  const state = createAssignmentState();
  state.assignments.selectedId = 25;
  state.assignments.serverSubmissionDraftSaveTimers = { 25: 321 };
  state.assignments.handoffSourceSnapshotIds = { 25: 77 };
  const assignment = { id: 25, state: "assigned", revision_round: 0, content_item_id: 501 };
  const timeoutCalls = [];
  const apiCalls = [];
  const clearedTimers = [];
  const deleteCalls = [];
  const locationAssignments = [];
  const windowStub = {
    clearTimeout(timerId) {
      clearedTimers.push(timerId);
    },
    location: {
      pathname: "/collector",
      search: "",
      assign(url) {
        locationAssignments.push(url);
      },
    },
  };
  const createSubmission = loadNamedFunction(appJs, "createAssignmentSubmission", {
    state,
    window: windowStub,
    URLSearchParams,
    isEditorUser: () => false,
    isAssignmentSubmissionDraftEditableState,
    ensureSelectedAssignmentId: () => 25,
    getAssignmentById: () => assignment,
    getAssignmentSubmissionFormConfig: () => ({ captureItems: [] }),
    buildAssignmentSubmissionArticlePayload: () => ({ additional_text: "draft body", verified_answers: [], capture_answers: [], question_answers: [] }),
    syncAssignmentRequestedCheckReturnDraftFromForm: () => null,
    buildAssignmentRequestedCheckReturnPayloadFromDraft: () => null,
    writeAssignmentSubmissionDraft: (_assignmentId, _payload) => {
      timeoutCalls.push("writeDraft");
    },
    buildAssignmentSubmissionServerDraftPayload: (articlePayload, fieldReturnPayload) => ({ article_payload_json: articlePayload, field_return_payload_json: fieldReturnPayload }),
    persistAssignmentSubmissionFailureDraft: async () => null,
    clearServerDraftSaveTimer: (assignmentId) => {
      timeoutCalls.push(`clear:${assignmentId}`);
      const timerId = state.assignments.serverSubmissionDraftSaveTimers[assignmentId];
      if (timerId) {
        windowStub.clearTimeout(timerId);
        delete state.assignments.serverSubmissionDraftSaveTimers[assignmentId];
      }
    },
    assertAssignmentCaptureUploadsComplete: () => {},
    buildAssignmentCaptureFileUploadQueue: () => [],
    buildAssignmentSubmissionGateState: () => ({ canSubmit: true, blockingReasons: [], serverSynced: { assets: [] }, composed: { assets: [], payloadAssets: [], syncKey: "sync-key" } }),
    renderAssignmentSubmissionGatePanel: () => {},
    focusFirstAssignmentSubmissionGateIssue: () => {},
    composeAssignmentSubmissionEffectiveAssets: () => ({ assets: [], payloadAssets: [], syncKey: "sync-key" }),
    getAssignmentCaptureSyncKey: () => "sync-key",
    mergeAssignmentSubmissionMediaAssets: () => [],
    buildAssignmentSubmissionMediaPayload: () => null,
    api: async (url, options = {}) => {
      apiCalls.push({ url, method: options.method || "GET" });
      if (url === "/api/assignments/25/submissions") {
        return { submission: { id: 99 }, assignment: { id: 25, state: "submitted" } };
      }
      return { ok: true, deleted: 1 };
    },
    qs: () => null,
    createAssignmentSubmissionDeliverablesForUploads: async () => {},
    clearAssignmentSubmissionDraft: () => {},
    deleteAssignmentSubmissionServerDraft: async (assignmentId) => {
      deleteCalls.push(assignmentId);
    },
    setLatestUploadedAssetsForSyncKey: () => {},
    setStatus: () => {},
    refreshAssignments: async () => {},
    loadAssignmentDeliverablesBundle: async () => {},
    loadAssignmentAssets: async () => {},
    clearAssignmentCaptureUploads: () => {},
    renderAssignmentDeliverablesSummary: () => {},
    canPatchAssignmentState: () => true,
  });

  await createSubmission();

  assert.deepEqual(timeoutCalls, ["writeDraft", "clear:25", "clear:25"]);
  assert.deepEqual(clearedTimers, [321]);
  assert.deepEqual(deleteCalls, []);
  assert.equal(state.assignments.serverSubmissionDraftSaveTimers[25], undefined);
  assert.equal(assignment.state, "submitted");
  assert.deepEqual(apiCalls.map((call) => call.url), ["/api/assignments/25/submissions"]);
  assert.equal(locationAssignments.length, 1);
});

test("submit gate failure persists latest article and requested-check draft back to server while assignment stays editable", async () => {
  const state = createAssignmentState();
  state.assignments.selectedId = 25;
  state.assignments.handoffSourceSnapshotIds = { 25: 77 };
  state.assignments.serverSubmissionDraftSaveTimers = { 25: 654 };
  const assignment = { id: 25, state: "assigned", revision_round: 0, content_item_id: 501 };
  const persistedPayloads = [];
  const clearCalls = [];
  const createSubmission = loadNamedFunction(appJs, "createAssignmentSubmission", {
    state,
    window: {
      clearTimeout() {},
      location: { pathname: "/collector", search: "", assign() {} },
    },
    URLSearchParams,
    isEditorUser: () => false,
    isAssignmentSubmissionDraftEditableState,
    ensureSelectedAssignmentId: () => 25,
    getAssignmentById: () => assignment,
    getAssignmentSubmissionFormConfig: () => ({ captureItems: [] }),
    buildAssignmentSubmissionArticlePayload: () => ({
      verified_answers: [{ prompt: "Verify", answer: "draft verify" }],
      capture_answers: [],
      question_answers: [],
      additional_text: "draft article",
    }),
    syncAssignmentRequestedCheckReturnDraftFromForm: () => ({
      requested_check_returns: {
        "cta_contact.phone": { checked: false, value: "0800000000", answer_type: "text" },
        "taxonomy.pet_friendly": { checked: false, value: false, answer_type: "boolean" },
      },
    }),
    buildAssignmentRequestedCheckReturnPayloadFromDraft: (draft) => draft,
    buildAssignmentSubmissionServerDraftPayload: (articlePayload, fieldReturnPayload) => ({ article_payload_json: articlePayload, field_return_payload_json: fieldReturnPayload }),
    writeAssignmentSubmissionDraft: () => {},
    clearServerDraftSaveTimer: (assignmentId) => {
      clearCalls.push(assignmentId);
      delete state.assignments.serverSubmissionDraftSaveTimers[assignmentId];
    },
    persistAssignmentSubmissionFailureDraft: async (_assignmentId, _assignment, payload) => {
      persistedPayloads.push(JSON.parse(JSON.stringify(payload)));
    },
    assertAssignmentCaptureUploadsComplete: () => {},
    buildAssignmentCaptureFileUploadQueue: () => [],
    buildAssignmentSubmissionGateState: () => ({ canSubmit: false, blockingReasons: ["gate fail"], serverSynced: { assets: [] }, composed: { assets: [], payloadAssets: [], syncKey: "sync-key" } }),
    renderAssignmentSubmissionGatePanel: () => {},
    focusFirstAssignmentSubmissionGateIssue: () => {},
    composeAssignmentSubmissionEffectiveAssets: () => ({ assets: [], payloadAssets: [], syncKey: "sync-key" }),
    getAssignmentCaptureSyncKey: () => "sync-key",
    mergeAssignmentSubmissionMediaAssets: () => [],
    buildAssignmentSubmissionMediaPayload: () => null,
    api: async () => {
      throw new Error("submission API should not be called when gate fails");
    },
    qs: () => null,
    createAssignmentSubmissionDeliverablesForUploads: async () => {},
    clearAssignmentSubmissionDraft: () => {},
    deleteAssignmentSubmissionServerDraft: async () => {},
    setLatestUploadedAssetsForSyncKey: () => {},
    setStatus: () => {},
    refreshAssignments: async () => {},
    loadAssignmentDeliverablesBundle: async () => {},
    loadAssignmentAssets: async () => {},
    clearAssignmentCaptureUploads: () => {},
    renderAssignmentDeliverablesSummary: () => {},
    canPatchAssignmentState: () => false,
  });

  await assert.rejects(() => createSubmission(), /gate fail/);
  assert.deepEqual(clearCalls, [25]);
  assert.equal(persistedPayloads.length, 1);
  assert.equal(persistedPayloads[0].article_payload_json.additional_text, "draft article");
  assert.equal(persistedPayloads[0].field_return_payload_json.requested_check_returns["cta_contact.phone"].checked, false);
  assert.equal(persistedPayloads[0].field_return_payload_json.requested_check_returns["taxonomy.pet_friendly"].value, false);
  assert.equal(assignment.state, "assigned");
});

test("submit POST failure persists latest requested-check false values back to server while assignment stays editable", async () => {
  const state = createAssignmentState();
  state.assignments.selectedId = 25;
  state.assignments.handoffSourceSnapshotIds = { 25: 77 };
  const assignment = { id: 25, state: "revision_requested", revision_round: 1, content_item_id: 501 };
  const persistedPayloads = [];
  const createSubmission = loadNamedFunction(appJs, "createAssignmentSubmission", {
    state,
    window: {
      clearTimeout() {},
      location: { pathname: "/collector", search: "", assign() {} },
    },
    URLSearchParams,
    isEditorUser: () => false,
    isAssignmentSubmissionDraftEditableState,
    ensureSelectedAssignmentId: () => 25,
    getAssignmentById: () => assignment,
    getAssignmentSubmissionFormConfig: () => ({ captureItems: [] }),
    buildAssignmentSubmissionArticlePayload: () => ({
      verified_answers: [],
      capture_answers: [],
      question_answers: [],
      additional_text: "revision draft",
    }),
    syncAssignmentRequestedCheckReturnDraftFromForm: () => ({
      requested_check_returns: {
        "cta_contact.phone": { checked: false, value: "0811111111", answer_type: "text" },
        "taxonomy.pet_friendly": { checked: false, value: false, answer_type: "boolean" },
      },
    }),
    buildAssignmentRequestedCheckReturnPayloadFromDraft: (draft) => draft,
    buildAssignmentSubmissionServerDraftPayload: (articlePayload, fieldReturnPayload) => ({ article_payload_json: articlePayload, field_return_payload_json: fieldReturnPayload }),
    writeAssignmentSubmissionDraft: () => {},
    clearServerDraftSaveTimer: () => {},
    persistAssignmentSubmissionFailureDraft: async (_assignmentId, _assignment, payload) => {
      persistedPayloads.push(JSON.parse(JSON.stringify(payload)));
    },
    assertAssignmentCaptureUploadsComplete: () => {},
    buildAssignmentCaptureFileUploadQueue: () => [],
    buildAssignmentSubmissionGateState: () => ({ canSubmit: true, blockingReasons: [], serverSynced: { assets: [] }, composed: { assets: [], payloadAssets: [], syncKey: "sync-key" } }),
    renderAssignmentSubmissionGatePanel: () => {},
    focusFirstAssignmentSubmissionGateIssue: () => {},
    composeAssignmentSubmissionEffectiveAssets: () => ({ assets: [], payloadAssets: [], syncKey: "sync-key" }),
    getAssignmentCaptureSyncKey: () => "sync-key",
    mergeAssignmentSubmissionMediaAssets: () => [],
    buildAssignmentSubmissionMediaPayload: () => null,
    api: async (url) => {
      if (url === "/api/assignments/25/submissions") throw new Error("network fail");
      return { ok: true };
    },
    qs: () => null,
    createAssignmentSubmissionDeliverablesForUploads: async () => {},
    clearAssignmentSubmissionDraft: () => {},
    deleteAssignmentSubmissionServerDraft: async () => {},
    setLatestUploadedAssetsForSyncKey: () => {},
    setStatus: () => {},
    refreshAssignments: async () => {},
    loadAssignmentDeliverablesBundle: async () => {},
    loadAssignmentAssets: async () => {},
    clearAssignmentCaptureUploads: () => {},
    renderAssignmentDeliverablesSummary: () => {},
    canPatchAssignmentState: () => false,
  });

  await assert.rejects(() => createSubmission(), /network fail/);
  assert.equal(persistedPayloads.length, 1);
  assert.equal(persistedPayloads[0].field_return_payload_json.requested_check_returns["cta_contact.phone"].checked, false);
  assert.equal(persistedPayloads[0].field_return_payload_json.requested_check_returns["taxonomy.pet_friendly"].checked, false);
  assert.equal(persistedPayloads[0].field_return_payload_json.requested_check_returns["taxonomy.pet_friendly"].value, false);
  assert.equal(assignment.state, "revision_requested");
});

test("server-synced uploaded assets rehydrate after refresh without duplicating local unsynced files", () => {
  const state = createAssignmentState();
  state.assignments.assetLookup = [
    {
      id: 901,
      file_name: "photo-1.jpg",
      mime_type: "image/jpeg",
      public_url: "/media/photo-1.jpg",
      assignment_id: 25,
      assignment_round: 1,
      assignment_surface: "assignment_work",
      assignment_media_type: "image",
      assignment_slot_key: "shot-1-photo--image",
      assignment_sync_batch_id: "batch-1",
      created_at: new Date().toISOString(),
    },
  ];
  const applyServerSynced = loadNamedFunction(appJs, "applyAssignmentServerSyncedAssets", {
    getAssignmentServerSyncedAssetsForCaptureItems: () => ({
      complete: true,
      assets: state.assignments.assetLookup,
      missing: [],
      syncSignature: "server:25:901",
    }),
    buildAssignmentCaptureFileUploadQueue: () => [],
    getAssignmentCaptureSyncStateBucket: () => (state.assignments.captureUploadSyncState[25] ||= {}),
    getAssignmentCaptureSyncKey: () => "25::server:25:901",
    setLatestUploadedAssetsForSyncKey: loadNamedFunction(appJs, "setLatestUploadedAssetsForSyncKey", { state }),
    setStatus: () => {},
  });

  const result = applyServerSynced(25, [], { showStatus: false });
  assert.equal(result.assets.length, 1);
  assert.equal(state.assignments.latestUploadedAssets.length, 1);
  assert.equal(state.assignments.latestUploadedAssetsKey, "25::server:25:901");
});

test("submission text input handlers refresh gate and lower media summary from the same readiness state", () => {
  const assignment = { id: 25, state: "assigned", revision_round: 0, content_item_id: 501 };
  const verifiedNode = createMockDomNode({ value: "" });
  const questionNode = createMockDomNode({ value: "" });
  const additionalNode = createMockDomNode({ value: "" });
  const captureNode = createMockDomNode();
  const expectedNode = createMockDomNode();
  const requestedChecksNode = createMockDomNode();
  const briefLinkNode = createMockDomNode();
  const nodes = new Map([
    ["assignment-submission-verified-fields", verifiedNode],
    ["assignment-submission-question-fields", questionNode],
    ["assignment-submission-additional-text", additionalNode],
    ["assignment-submission-capture-guide", captureNode],
    ["assignment-expected-deliverables", expectedNode],
    ["assignment-submission-requested-checks-fields", requestedChecksNode],
    ["assignment-submission-brief-link", briefLinkNode],
  ]);
  const gateCalls = [];
  const summaryCalls = [];
  let nextGateStateId = 0;
  const sharedState = { assignments: { selectedId: assignment.id, deliverablesBundle: { latest_submission_id: null }, contextFieldPack: { id: 1 } } };
  const getAssignmentSubmissionFormConfig = () => ({ captureItems: [] });
  const buildAssignmentSubmissionGateState = () => ({
    id: ++nextGateStateId,
    canSubmit: Boolean(String(verifiedNode.value || "").trim() && String(questionNode.value || "").trim() && String(additionalNode.value || "").trim()),
    blockingReasons: [],
    warnings: [],
    effectiveAssets: [],
    composed: { retainedAssets: [] },
  });
  const renderAssignmentSubmissionGatePanel = (gateState) => { gateCalls.push(gateState); };
  const renderAssignmentDeliverablesSummary = (bundle, assignmentArg, gateState) => { summaryCalls.push({ bundle, assignment: assignmentArg, gateState }); };
  const refreshAssignmentSubmissionReadinessSurfaces = loadNamedFunction(appJs, "refreshAssignmentSubmissionReadinessSurfaces", {
    state: sharedState,
    getAssignmentById: () => assignment,
    getAssignmentSubmissionFormConfig,
    buildAssignmentCaptureFileUploadQueue: () => [],
    buildAssignmentSubmissionGateState,
    renderAssignmentSubmissionGatePanel,
    renderAssignmentDeliverablesSummary,
  });
  const wireAssignments = loadNamedFunction(appJs, "wireAssignments", {
    qs: (id) => nodes.get(id) || null,
    state: sharedState,
    syncAssignmentSubmissionDraftFromForm: () => {},
    syncAssignmentRequestedCheckReturnDraftFromForm: () => {},
    getAssignmentById: () => assignment,
    getAssignmentSubmissionFormConfig,
    buildAssignmentSubmissionGateState,
    renderAssignmentSubmissionGatePanel,
    renderAssignmentDeliverablesSummary,
    refreshAssignmentSubmissionReadinessSurfaces,
    markAssignmentExpectedDeliverablesTouched: () => {},
    renderAssignmentDeliverableAssetPreview: () => {},
    setAssignmentCaptureLoading: () => {},
    renderAssignmentSubmissionForm: () => {},
    appendAssignmentCaptureFiles: () => {},
    window: { setTimeout() {} },
    removeAssignmentCaptureFile: () => {},
    getAssignmentSubmissionFormAssignment: (row) => row,
    updateAssignmentRequestedCheckReturnRowState: () => {},
    document: { querySelector: () => null },
    withButtonLoading: async () => {},
    executeReferenceCleanup: async () => ({ cleaned: {} }),
    setStatus: () => {},
    refreshAssignments: async () => {},
    syncAssignmentReviewResetReasonUI: () => {},
  });

  wireAssignments();

  verifiedNode.emit("input");
  assert.equal(gateCalls.at(-1)?.canSubmit, false);
  assert.equal(summaryCalls.at(-1)?.gateState, gateCalls.at(-1));
  assert.equal(summaryCalls.at(-1)?.assignment, assignment);

  verifiedNode.value = "verified";
  questionNode.value = "question";
  additionalNode.value = "additional";
  additionalNode.emit("input");
  assert.equal(gateCalls.at(-1)?.canSubmit, true);
  assert.equal(summaryCalls.at(-1)?.gateState, gateCalls.at(-1));

  additionalNode.value = "";
  additionalNode.emit("input");
  assert.equal(gateCalls.at(-1)?.canSubmit, false);
  assert.equal(summaryCalls.at(-1)?.gateState, gateCalls.at(-1));
});

test("local unsynced files are reflected through the lower deliverables summary card", () => {
  const state = createAssignmentState();
  const assignment = { id: 25, state: "assigned", revision_round: 0, content_item_id: 501 };
  const summaryNode = createMockDomNode();
  const metaNode = createMockDomNode();

  const renderSummary = loadNamedFunction(appJs, "renderAssignmentDeliverablesSummary", {
    state,
    qs: (id) => {
      if (id === "assignment-deliverables-summary") return summaryNode;
      if (id === "assignment-deliverables-meta") return metaNode;
      if (id === "btn-assignment-create-deliverable") return createMockDomNode();
      return null;
    },
    escapeHtml,
    buildAssignmentDeliverablesCardState: () => ({
      latestSubmissionId: null,
      expectedTypes: ["photos"],
      fulfilledTypes: [],
      missingTypes: ["photos"],
      rowsByType: { photos: [], videos: [] },
      gateState: {
        canSubmit: false,
        blockingReasons: ["\u0e01\u0e23\u0e38\u0e13\u0e32\u0e2d\u0e31\u0e1b\u0e42\u0e2b\u0e25\u0e14/\u0e0b\u0e34\u0e07\u0e01\u0e4c\u0e44\u0e1f\u0e25\u0e4c\u0e43\u0e2b\u0e49\u0e04\u0e23\u0e1a\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e07\u0e32\u0e19\u0e01\u0e25\u0e31\u0e1a"],
      },
      warningText: "\u0e01\u0e23\u0e38\u0e13\u0e32\u0e2d\u0e31\u0e1b\u0e42\u0e2b\u0e25\u0e14/\u0e0b\u0e34\u0e07\u0e01\u0e4c\u0e44\u0e1f\u0e25\u0e4c\u0e43\u0e2b\u0e49\u0e04\u0e23\u0e1a\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e07\u0e32\u0e19\u0e01\u0e25\u0e31\u0e1a",
      statusLabel: "\u0e22\u0e31\u0e07\u0e2a\u0e48\u0e07\u0e07\u0e32\u0e19\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49",
      sourceLabel: "\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e07\u0e32\u0e19\u0e01\u0e25\u0e31\u0e1a",
    }),
    formatAssignmentBriefExpectedDeliverables: (types = []) => String(types.join("|")),
    renderAssignmentDeliverableMediaCard: (type, rows = [], options = {}) => '<div>' + type + ':' + rows.length + ':' + String(options.statusLabel || '') + '</div>',
    renderAssignmentDeliverableTypeOptions: () => {},
  });

  renderSummary(null, assignment);
  assert.match(summaryNode.innerHTML, /photos:0/);
  assert.ok(summaryNode.innerHTML.includes("videos:0:"));
  assert.ok(summaryNode.innerHTML.includes("photos:0:"));
  assert.ok(summaryNode.innerHTML.includes("\u0e04\u0e23\u0e1a\u0e41\u0e25\u0e49\u0e27 0 \u0e08\u0e32\u0e01 1 \u0e1b\u0e23\u0e30\u0e40\u0e20\u0e17"));
  assert.ok(summaryNode.innerHTML.includes("\u0e22\u0e31\u0e07\u0e02\u0e32\u0e14 1 \u0e1b\u0e23\u0e30\u0e40\u0e20\u0e17"));
  assert.equal(metaNode.textContent, "\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e07\u0e32\u0e19\u0e01\u0e25\u0e31\u0e1a | \u0e20\u0e32\u0e1e\u0e16\u0e48\u0e32\u0e22 0 \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23 | \u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d 0 \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23");
});

test("collector asset version uses millisecond precision and frontend JS/CSS routes revalidate on normal F5", () => {
  const resolveCollectorAssetVersionForFile = loadNamedFunction(indexJs, "resolveCollectorAssetVersionForFile", {
    collectorAssetVersionOverride: "",
    fsSync: {
      statSync() {
        return { mtimeMs: 1712345678123.987 };
      },
    },
    collectorServerBootVersion: "boot-version",
  });
  const setCollectorFrontendAssetRevalidateHeaders = loadNamedFunction(indexJs, "setCollectorFrontendAssetRevalidateHeaders");
  const headers = {};
  setCollectorFrontendAssetRevalidateHeaders({
    setHeader(name, value) {
      headers[name] = value;
    },
  });

  assert.equal(resolveCollectorAssetVersionForFile("D:/UbonCity_Web/collector/server/public/app.js"), "1712345678123");
  assert.equal(headers["Cache-Control"], "no-cache, must-revalidate");
  assert.match(indexJs, /resolveCollectorCssFilePath/);
  assert.match(indexJs, /resolveCollectorJsFilePath/);
});

test("late field-pack load triggers asset reconciliation only for the currently selected assignment item", async () => {
  const state = createAssignmentState();
  state.assignments.selectedId = 25;
  const selectedAssignment = { id: 25, content_item_id: 501 };
  const loadCalls = [];
  const loadAssignmentContextFieldPackStatus = await loadNamedAsyncFunction(appJs, "loadAssignmentContextFieldPackStatus", {
    state,
    parsePositiveInt: (value, fallback = 0) => Number(value || fallback) || 0,
    api: async () => ({ field_pack: { status: "active", checklists: [] } }),
    renderAssignmentHandoffBrief: () => {},
    renderAssignmentSubmissionForm: () => {},
    getAssignmentSubmissionFormAssignment: (assignment) => assignment,
    getAssignmentById: (id) => (Number(id) === 25 ? selectedAssignment : { id, content_item_id: 999 }),
    loadAssignmentAssets: async (...args) => {
      loadCalls.push(args);
      return [];
    },
  });

  await loadAssignmentContextFieldPackStatus(501);
  assert.equal(loadCalls.length, 1);

  state.assignments.selectedId = 26;
  await loadAssignmentContextFieldPackStatus(501);
  assert.equal(loadCalls.length, 1);
});

test("server-synced asset reconciliation is stable across repeated refresh passes", () => {
  const state = createAssignmentState();
  state.assignments.assetLookup = [
    {
      id: 901,
      file_name: "photo-1.jpg",
      mime_type: "image/jpeg",
      public_url: "/media/photo-1.jpg",
      assignment_id: 25,
      assignment_round: 1,
      assignment_surface: "assignment_work",
      assignment_media_type: "image",
      assignment_slot_key: "shot-1-photo--image",
      assignment_sync_batch_id: "batch-1",
      created_at: new Date().toISOString(),
    },
  ];
  const setLatestUploadedAssetsForSyncKey = loadNamedFunction(appJs, "setLatestUploadedAssetsForSyncKey", { state });
  const applyServerSynced = loadNamedFunction(appJs, "applyAssignmentServerSyncedAssets", {
    getAssignmentServerSyncedAssetsForCaptureItems: () => ({
      complete: true,
      assets: state.assignments.assetLookup,
      missing: [],
      syncSignature: "server:25:901",
    }),
    buildAssignmentCaptureFileUploadQueue: () => [],
    getAssignmentCaptureSyncStateBucket: () => (state.assignments.captureUploadSyncState[25] ||= {}),
    getAssignmentCaptureSyncKey: () => "25::server:25:901",
    setLatestUploadedAssetsForSyncKey,
    setStatus: () => {},
  });

  const first = applyServerSynced(25, [], { showStatus: false });
  const second = applyServerSynced(25, [], { showStatus: false });
  assert.deepEqual(first.assets, second.assets);
  assert.deepEqual(state.assignments.latestUploadedAssets, first.assets);
});
