import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const indexJs = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

function extractFunctionSource(source, functionName) {
  const asyncMarker = `async function ${functionName}`;
  const marker = `function ${functionName}`;
  const start = source.indexOf(asyncMarker) >= 0 ? source.indexOf(asyncMarker) : source.indexOf(marker);
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
const setAssignmentRequestedCheckReturnDraftStateFactory = (state) => loadNamedFunction(appJs, "setAssignmentRequestedCheckReturnDraftState", { state });
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
    "assignment-draft-save-status",
  ].forEach((id) => nodes.set(id, createMockDomNode()));

  const qs = (id) => nodes.get(id) || null;
  const getAssignmentRequestedCheckGroupsFromHandoffPackage = (pkg) => Array.isArray(pkg?.requested_check_groups) ? pkg.requested_check_groups : [];
  const getAssignmentRequestedCheckReturnDraftPrefill = loadNamedFunction(appJs, "getAssignmentRequestedCheckReturnDraftPrefill", {
    state,
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
    renderAssignmentSubmissionFileList: () => {},
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
    getLatestAssignmentSubmissionRow: (currentAssignment) => state.assignments.latestSubmissionRows?.[Number(currentAssignment?.id || 0)] || null,
    getAssignmentSubmissionDraftKey,
    normalizeAssignmentRequestedCheckReturnDraft,
    hasUsableAssignmentRequestedCheckReturnRows,
  });

  const loadDraft = await loadNamedAsyncFunction(appJs, "loadAssignmentSubmissionServerDraft", {
    state,
    isEditorUser: () => false,
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

test("local unsynced files are shown as browser-only and not persisted", () => {
  const state = createAssignmentState();
  const assignment = { id: 25, state: "assigned", revision_round: 0, content_item_id: 501 };
  const localFile = new File([new Uint8Array([1, 2, 3])], "fresh.jpg", { type: "image/jpeg" });
  state.assignments.captureUploadDrafts[25] = { shot1: [localFile] };
  const fileListNode = createMockDomNode();

  const renderFileList = loadNamedFunction(appJs, "renderAssignmentSubmissionFileList", {
    state,
    qs: (id) => (id === "assignment-submission-file-list" ? fileListNode : null),
    getAssignmentById: () => assignment,
    getAssignmentSubmissionFormConfig: () => ({ captureItems: [] }),
    getAssignmentCaptureUploadBucket: () => state.assignments.captureUploadDrafts[25],
    buildAssignmentCaptureFileUploadQueue: () => [{ slug: "shot1", file: localFile }],
    composeAssignmentSubmissionEffectiveAssets: () => ({ assets: [], retainedAssets: [], payloadAssets: [], missing: [] }),
    isAssignmentCaptureUploadsSynced: () => false,
    escapeHtml,
  });

  renderFileList();
  assert.match(fileListNode.innerHTML, /browser/i);
  assert.match(fileListNode.innerHTML, /refresh/i);
  assert.doesNotMatch(fileListNode.innerHTML, /อัปโหลดเข้าระบบแล้ว/);
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
