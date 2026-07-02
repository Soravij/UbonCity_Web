import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(collectorRoot, "server", "public", "index.html"), "utf8");

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf("(", start);
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
    if (char === "'" || char === '"' || char === "`") {
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
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  return Function(...names, `${source}; return ${functionName};`)(...values);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createMockDomNode(initial = {}) {
  const classSet = new Set();
  const node = {
    innerHTML: "",
    textContent: "",
    value: "",
    disabled: false,
    querySelectorAll: () => [],
  };
  Object.defineProperty(node, "className", {
    get() {
      return [...classSet].join(" ");
    },
    set(value) {
      classSet.clear();
      String(value || "").split(/\s+/).map((token) => token.trim()).filter(Boolean).forEach((token) => classSet.add(token));
    },
  });
  node.classList = {
    add(...tokens) { tokens.flat().forEach((token) => classSet.add(String(token || "").trim())); },
    remove(...tokens) { tokens.flat().forEach((token) => classSet.delete(String(token || "").trim())); },
    toggle(token, force) {
      const name = String(token || "").trim();
      const shouldAdd = force === undefined ? !classSet.has(name) : force === true;
      if (shouldAdd) classSet.add(name); else classSet.delete(name);
      return classSet.has(name);
    },
    contains(token) { return classSet.has(String(token || "").trim()); },
  };
  Object.assign(node, initial);
  return node;
}

const ASSIGNMENT_DELIVERABLE_OPTIONS = loadConstValue(appJs, "ASSIGNMENT_DELIVERABLE_OPTIONS");

function buildHarness({ bundle, assignment, latestSubmission, assets = [], editable = false, gateState = null } = {}) {
  const nodes = new Map();
  const summaryNode = createMockDomNode();
  const metaNode = createMockDomNode();
  const createBtn = createMockDomNode();
  nodes.set("assignment-deliverables-summary", summaryNode);
  nodes.set("assignment-deliverables-meta", metaNode);
  nodes.set("btn-assignment-create-deliverable", createBtn);
  const qs = (id) => nodes.get(id) || null;

  const state = {
    assignments: {
      contextFieldPack: null,
      deliverablesBundle: bundle || null,
      latestSubmissionRows: { [Number(assignment?.id || 0) || 0]: latestSubmission || null },
      submissionRowsByAssignment: { [Number(assignment?.id || 0) || 0]: latestSubmission ? [latestSubmission] : [] },
      deliverableRowsByAssignment: {},
      assetLookup: assets,
      assets,
    },
  };

  const getAssignmentDeliverableLabel = loadNamedFunction(appJs, "getAssignmentDeliverableLabel", { ASSIGNMENT_DELIVERABLE_OPTIONS });
  const summarizeAssignmentAssetOption = loadNamedFunction(appJs, "summarizeAssignmentAssetOption");
  const findAssignmentAssetById = loadNamedFunction(appJs, "findAssignmentAssetById", { state });
  const resolveAssignmentReviewMediaUrl = loadNamedFunction(appJs, "resolveAssignmentReviewMediaUrl", { findAssignmentAssetById });
  const summarizeAssignmentReviewMediaLabel = loadNamedFunction(appJs, "summarizeAssignmentReviewMediaLabel", {
    summarizeAssignmentAssetOption,
    findAssignmentAssetById,
    window: { location: { origin: "https://example.com" } },
  });
  const normalizeAssignmentCaptureMediaType = loadNamedFunction(appJs, "normalizeAssignmentCaptureMediaType");
  const normalizeAssignmentCaptureUploadItems = loadNamedFunction(appJs, "normalizeAssignmentCaptureUploadItems", {
    normalizeAssignmentCaptureMediaType,
    buildAssignmentCaptureSlotKey: (input) => { const source = input && typeof input === "object" ? input : {}; const prompt = String(source.prompt || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); const itemOrder = Number(source.itemOrder || 0) || 0; const mediaType = String(source.mediaType || "").trim().toLowerCase(); const captureType = String(source.captureType || "").trim().toLowerCase(); const baseKey = `shot-${itemOrder + 1}-${prompt || `capture-${itemOrder + 1}`}`.slice(0, 48); return captureType === "both" && mediaType ? `${baseKey}--${mediaType}` : baseKey; },
  });
  const getAssignmentAssetSlotTypeKeyFromAsset = loadNamedFunction(appJs, "getAssignmentAssetSlotTypeKeyFromAsset", {
    normalizeAssignmentCaptureMediaType,
  });
  const getAssignmentSubmissionAssetIdentityKey = loadNamedFunction(appJs, "getAssignmentSubmissionAssetIdentityKey", {
    getAssignmentAssetSlotTypeKeyFromAsset,
  });
  const formatAssignmentDeliverableStatusChip = loadNamedFunction(appJs, "formatAssignmentDeliverableStatusChip", {
    escapeHtml,
    getAssignmentDeliverableLabel,
  });
  const formatAssignmentBriefExpectedDeliverables = loadNamedFunction(appJs, "formatAssignmentBriefExpectedDeliverables", {
    escapeHtml,
    getAssignmentDeliverableLabel,
  });
  const summarizeAssignmentDeliverableList = loadNamedFunction(appJs, "summarizeAssignmentDeliverableList", {
    getAssignmentDeliverableLabel,
  });
  const getLatestAssignmentSubmissionRow = loadNamedFunction(appJs, "getLatestAssignmentSubmissionRow", { state });
  const selectAssignmentReviewMediaBundle = loadNamedFunction(appJs, "selectAssignmentReviewMediaBundle");
  const getAssignmentReviewMediaItems = loadNamedFunction(appJs, "getAssignmentReviewMediaItems", {
    state,
    getLatestAssignmentSubmissionRow,
    resolveAssignmentReviewMediaUrl,
    summarizeAssignmentReviewMediaLabel,
    getAssignmentDeliverableLabel,
    selectAssignmentReviewMediaBundle,
  });
  const getAssignmentDeliverablesExpectedMediaTypes = loadNamedFunction(appJs, "getAssignmentDeliverablesExpectedMediaTypes", {
    normalizeAssignmentCaptureUploadItems,
    normalizeAssignmentCaptureMediaType,
  });
  const buildAssignmentDeliverableMediaRowsFromAssets = loadNamedFunction(appJs, "buildAssignmentDeliverableMediaRowsFromAssets", {
    normalizeAssignmentCaptureMediaType,
    getAssignmentSubmissionAssetIdentityKey,
    summarizeAssignmentAssetOption,
  });
  const buildAssignmentDeliverableMediaRowsFromSubmission = loadNamedFunction(appJs, "buildAssignmentDeliverableMediaRowsFromSubmission", {
    findAssignmentAssetById,
    summarizeAssignmentReviewMediaLabel,
    getAssignmentDeliverableLabel,
    resolveAssignmentReviewMediaUrl,
    getLatestAssignmentSubmissionRow,
    normalizeAssignmentCaptureMediaType,
  });
  const buildAssignmentCaptureTopicReadiness = loadNamedFunction(appJs, "buildAssignmentCaptureTopicReadiness", {
    normalizeAssignmentCaptureUploadItems,
    normalizeAssignmentCaptureMediaType,
    getAssignmentAssetSlotTypeKeyFromAsset,
    ASSIGNMENT_WORK_SYNC_EXPIRY_MS: 24 * 60 * 60 * 1000,
  });
  const buildAssignmentDeliverablesCardState = loadNamedFunction(appJs, "buildAssignmentDeliverablesCardState", {
    state,
    getAssignmentPageMode: () => "work",
    getAssignmentSubmissionFormAssignment: (row) => (editable ? row : null),
    getAssignmentSubmissionFormConfig: () => ({ captureItems: [{ item_text: "Photo topic", prompt: "Photo topic", capture_type: "photo", mediaType: "image" }, { item_text: "Video topic", prompt: "Video topic", capture_type: "video", mediaType: "video" }] }),
    buildAssignmentCaptureFileUploadQueue: () => [],
    buildAssignmentSubmissionGateState: () => gateState || { canSubmit: true, blockingReasons: [], warnings: [], effectiveAssets: [], composed: { retainedAssets: [] }, topicReadiness: { counts: { requiredTopics: 0, fulfilledTopics: 0, missingTopics: 0, photos: 0, videos: 0 }, requirements: [] } },
    getAssignmentDeliverablesExpectedMediaTypes,
    buildAssignmentDeliverableMediaRowsFromAssets,
    buildAssignmentDeliverableMediaRowsFromSubmission,
    buildAssignmentCaptureTopicReadiness,
  });
  const renderAssignmentDeliverableMediaCard = loadNamedFunction(appJs, "renderAssignmentDeliverableMediaCard", {
    escapeHtml,
    summarizeAssignmentDeliverableList,
    formatAssignmentDeliverableStatusChip,
  });
  const renderAssignmentDeliverableTypeOptions = () => {};
  const renderAssignmentDeliverablesSummary = loadNamedFunction(appJs, "renderAssignmentDeliverablesSummary", {
    qs,
    escapeHtml,
    buildAssignmentDeliverablesCardState,
    formatAssignmentBriefExpectedDeliverables,
    renderAssignmentDeliverableMediaCard,
    renderAssignmentDeliverableTypeOptions,
    formatAssignmentDeliverableStatusChip,
  });

  return {
    summaryNode,
    metaNode,
    createBtn,
    renderAssignmentDeliverablesSummary,
    renderAssignmentDeliverableMediaCard,
    getAssignmentReviewMediaItems,
  };
}

const assignmentBase = { id: 44, latest_submission_id: 12, state: "submitted" };
const assetLookup = [
  { id: 101, file_name: "photo-1.jpg", public_url: "/media/photo-1.jpg", mime_type: "image/jpeg", assignment_slot_key: "shot-1-photo-topic", assignment_media_type: "image" },
  { id: 102, file_name: "photo-2.jpg", public_url: "/media/photo-2.jpg", mime_type: "image/jpeg", assignment_slot_key: "shot-1-photo-topic", assignment_media_type: "image" },
  { id: 201, file_name: "video-1.mp4", public_url: "/media/video-1.mp4", mime_type: "video/mp4", assignment_slot_key: "shot-2-video-topic", assignment_media_type: "video" },
];

function createBundle() {
  return {
    latest_submission_id: 12,
    expected_deliverables: ["photos", "videos", "raw_notes"],
    deliverables_by_type: {
      photos: [
        { id: 1, deliverable_type: "photos", source_asset_id: 101, status: "submitted", created_at: "2026-06-28T10:00:00Z" },
        { id: 2, deliverable_type: "photos", source_asset_id: 102, status: "submitted", created_at: "2026-06-28T10:01:00Z" },
      ],
      videos: [
        { id: 3, deliverable_type: "videos", source_asset_id: 201, status: "submitted", created_at: "2026-06-28T10:02:00Z" },
      ],
      raw_notes: [
        { id: 4, deliverable_type: "raw_notes", text_content: "keep outside media card", status: "submitted", created_at: "2026-06-28T10:03:00Z" },
      ],
    },
  };
}

test("submission form removes the top file-summary DOM block and keeps the lower deliverables summary card", () => {
  assert.equal(indexHtml.includes('id="assignment-submission-file-list"'), false);
  assert.equal(indexHtml.includes('id="assignment-submission-files-label"'), false);
  assert.equal(indexHtml.includes('id="assignment-deliverables-summary"'), true);
});

test("latest-submission states render the same media summary card behavior", () => {
  const bundle = createBundle();
  const states = ["submitted", "revision_requested", "resubmitted"];
  const htmls = states.map((stateValue) => {
    const harness = buildHarness({
      bundle,
      assignment: { ...assignmentBase, state: stateValue },
      latestSubmission: { id: 12, media_payload_json: { assets: [] } },
      assets: assetLookup,
    });
    harness.renderAssignmentDeliverablesSummary(bundle, { ...assignmentBase, state: stateValue });
    return { html: harness.summaryNode.innerHTML, meta: harness.metaNode.textContent };
  });
  assert.equal(htmls[0].html, htmls[1].html);
  assert.equal(htmls[1].html, htmls[2].html);
  assert.equal(htmls[0].meta, htmls[1].meta);
  assert.equal(htmls[1].meta, htmls[2].meta);
});

test("latest-submission media summary keeps photos and videos separated with collapsible per-type details", () => {
  const bundle = createBundle();
  const harness = buildHarness({
    bundle,
    assignment: assignmentBase,
    latestSubmission: { id: 12, media_payload_json: { assets: [] } },
    assets: assetLookup,
  });

  harness.renderAssignmentDeliverablesSummary(bundle, assignmentBase);

  assert.match(harness.metaNode.textContent, /Photos 2 items/);
  assert.match(harness.metaNode.textContent, /Videos 1 items/);
  assert.match(harness.summaryNode.innerHTML, /File list/);
  assert.match(harness.summaryNode.innerHTML, /photo-1\.jpg/);
  assert.match(harness.summaryNode.innerHTML, /video-1\.mp4/);
  assert.match(harness.summaryNode.innerHTML, /shot-1-photo-topic/);
  assert.match(harness.summaryNode.innerHTML, /shot-2-video-topic/);
  assert.doesNotMatch(harness.summaryNode.innerHTML, /keep outside media card/);
});

test("fulfilled and missing counts only use expected media types even when unexpected deliverable types are available", () => {
  const bundle = createBundle();
  bundle.deliverables_by_type.caption_draft = [
    { id: 99, deliverable_type: "caption_draft", text_content: "unexpected", status: "submitted", created_at: "2026-06-28T10:04:00Z" },
  ];
  const harness = buildHarness({
    bundle,
    assignment: assignmentBase,
    latestSubmission: { id: 12, media_payload_json: { assets: [] } },
    assets: assetLookup,
  });

  harness.renderAssignmentDeliverablesSummary(bundle, assignmentBase);

  assert.match(harness.summaryNode.innerHTML, /Done 2 of 2 topics/);
  assert.match(harness.summaryNode.innerHTML, /Missing 0 topics/);
  assert.doesNotMatch(harness.summaryNode.innerHTML, /Done 3 of 2 topics/);
  assert.match(harness.summaryNode.innerHTML, /Image topic: Photo topic/);
  assert.match(harness.summaryNode.innerHTML, /Video topic: Video topic/);
  assert.doesNotMatch(harness.summaryNode.innerHTML, /caption_draft/);
});

test("text deliverable media cards do not show media review-panel helper text", () => {
  const harness = buildHarness();
  const html = harness.renderAssignmentDeliverableMediaCard(
    "raw_notes",
    [
      { id: 4, label: "note one", slot: "-", mime: "text/plain", status: "submitted" },
      { id: 5, label: "note two", slot: "-", mime: "text/plain", status: "submitted" },
    ],
    {
      expectedTypes: ["raw_notes"],
      fulfilledTypes: ["raw_notes"],
      sourceLabel: "latest submission #12",
      statusLabel: "latest submission data",
    }
  );

  assert.match(html, /\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e2b\u0e19\u0e49\u0e32\u0e07\u0e32\u0e19 2 \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23/);
  assert.doesNotMatch(html, /\u0e41\u0e2a\u0e14\u0e07\u0e04\u0e23\u0e1a\u0e17\u0e38\u0e01\u0e44\u0e1f\u0e25\u0e4c\u0e43\u0e19 review panel/);
  assert.doesNotMatch(html, /\u0e44\u0e1f\u0e25\u0e4c\u0e08\u0e23\u0e34\u0e07\u0e17\u0e35\u0e48\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e43\u0e0a\u0e49/);
});

test("editable media summary uses effective media and duplicates readiness warning inside type cards", () => {
  const gateState = {
    canSubmit: false,
    blockingReasons: ["upload and sync all required files before submission"],
    warnings: [],
    effectiveAssets: [
      { ...assetLookup[0], assignment_media_type: "image", created_at: "2026-06-28T10:00:00Z" },
    ],
    composed: { retainedAssets: [] },
    topicReadiness: {
      counts: { requiredTopics: 2, fulfilledTopics: 1, missingTopics: 1, photos: 1, videos: 0 },
      blockingReasons: ["Missing required video topic: Video topic"],
      missingRequirements: [{ slotKey: "shot-2-video-topic", mediaType: "video", prompt: "Video topic", status: "missing", eligibleAssets: [], eligibleCount: 0, minFiles: 1 }],
      requirements: [
        {
          requirementId: "shot-1-photo-topic|image",
          slotKey: "shot-1-photo-topic",
          mediaType: "image",
          prompt: "Photo topic",
          required: true,
          minFiles: 1,
          eligibleAssets: [{ ...assetLookup[0], assignment_media_type: "image", created_at: "2026-06-28T10:00:00Z" }],
          eligibleCount: 1,
          status: "fulfilled",
        },
        {
          requirementId: "shot-2-video-topic|video",
          slotKey: "shot-2-video-topic",
          mediaType: "video",
          prompt: "Video topic",
          required: true,
          minFiles: 1,
          eligibleAssets: [],
          eligibleCount: 0,
          status: "missing",
        },
      ],
    },
  };
  const harness = buildHarness({
    bundle: createBundle(),
    assignment: { ...assignmentBase, state: "assigned", latest_submission_id: null },
    latestSubmission: null,
    assets: assetLookup,
    editable: true,
    gateState,
  });

  harness.renderAssignmentDeliverablesSummary(createBundle(), { ...assignmentBase, state: "assigned", latest_submission_id: null });

  assert.match(harness.summaryNode.innerHTML, /upload and sync all required files before submission/);
  assert.match(harness.summaryNode.innerHTML, /Photos 1 items/);
  assert.match(harness.summaryNode.innerHTML, /Videos 0 items/);
  assert.match(harness.summaryNode.innerHTML, /Done 1 of 2 topics/);
  assert.match(harness.summaryNode.innerHTML, /Missing 1 topics/);
  assert.match(harness.summaryNode.innerHTML, /photo-1\.jpg/);
});

test("missing resolvable video stays unready in the media summary", () => {
  const bundle = {
    latest_submission_id: 12,
    expected_deliverables: ["photos", "videos"],
    deliverables_by_type: {
      photos: [{ id: 1, deliverable_type: "photos", source_asset_id: 101, status: "submitted" }],
      videos: [{ id: 2, deliverable_type: "videos", source_asset_id: 9999, status: "submitted" }],
    },
  };
  const harness = buildHarness({
    bundle,
    assignment: assignmentBase,
    latestSubmission: { id: 12, media_payload_json: { assets: [] } },
    assets: assetLookup,
  });

  harness.renderAssignmentDeliverablesSummary(bundle, assignmentBase);

  assert.match(harness.summaryNode.innerHTML, /Videos 0 items/);
  assert.match(harness.summaryNode.innerHTML, /Video topic: Video topic/);
});

test("review media helper still returns every actual file for asset-backed deliverables", () => {
  const bundle = createBundle();
  const latestSubmission = { id: 12, media_payload_json: { assets: [] } };
  const harness = buildHarness({ bundle, assignment: assignmentBase, latestSubmission, assets: assetLookup });
  const photos = harness.getAssignmentReviewMediaItems(assignmentBase, "photos");
  const videos = harness.getAssignmentReviewMediaItems(assignmentBase, "videos");
  assert.equal(photos.length, 2);
  assert.equal(videos.length, 1);
});
