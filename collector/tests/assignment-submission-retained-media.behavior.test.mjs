import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");

function extractNamedFunctionSource(source, name) {
  const escapedName = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\n)(async\\s+)?function ${escapedName}\\s*\\(`, "m").exec(source);
  const start = match ? match.index + match[1].length : -1;
  assert.notEqual(start, -1, `${name} should exist`);
  const paramsStart = source.indexOf("(", start);
  assert.notEqual(paramsStart, -1, `${name} should have params`);
  let paramsDepth = 0;
  let bodyStart = -1;
  let inString = false;
  let stringChar = "";
  let escapeNext = false;
  for (let index = paramsStart; index < source.length; index += 1) {
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
    if (char === "(") paramsDepth += 1;
    if (char === ")") {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  inString = false;
  stringChar = "";
  escapeNext = false;
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
  throw new Error(`Could not extract function ${name}`);
}

function loadNamedFunction(sourceText, functionName, dependencies = {}) {
  const source = extractNamedFunctionSource(sourceText, functionName);
  const dependencyNames = Object.keys(dependencies);
  const dependencyValues = Object.values(dependencies);
  return Function(...dependencyNames, `${source}; return ${functionName};`)(...dependencyValues);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const buildAssignmentCaptureSlotKeyFactory = new Function(
  `${extractNamedFunctionSource(appJs, "toCaptureSlug")}
${extractNamedFunctionSource(appJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(appJs, "buildAssignmentCaptureSlotKey")}
return buildAssignmentCaptureSlotKey;`
)();

function buildAssignmentCaptureSlotKeyForTest(prompt, itemOrder, mediaType, captureType) {
  return buildAssignmentCaptureSlotKeyFactory({
    prompt,
    itemOrder,
    mediaType,
    captureType,
  });
}

function buildAsset({ id, assignmentId = 24, round = 3, mediaType, slotKey, fileName, url }) {
  return {
    id,
    file_name: fileName,
    mime_type: mediaType === "video" ? "video/mp4" : "image/jpeg",
    public_url: url || `/media/${fileName}`,
    assignment_id: assignmentId,
    assignment_round: round,
    assignment_surface: "assignment_work",
    assignment_media_type: mediaType,
    assignment_slot_key: slotKey,
    created_at: new Date().toISOString(),
  };
}

function createFixture(overrides = {}) {
  const assignmentId = Number(overrides.assignment?.id || 24);
  const revisionRound = Number(overrides.assignment?.revision_round || 3);
  const captureItems = overrides.captureItems || [
    { item_text: "Storefront hero", item_order: 0, capture_type: "photo" },
    { item_text: "Walkthrough clip", item_order: 1, capture_type: "video" },
  ];
  const photoSlotKey = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
  const videoSlotKey = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
  const defaultAssets = [
    buildAsset({ id: 101, assignmentId, round: revisionRound, mediaType: "image", slotKey: photoSlotKey, fileName: "retained-photo.jpg" }),
    buildAsset({ id: 201, assignmentId, round: revisionRound, mediaType: "video", slotKey: videoSlotKey, fileName: "retained-video.mp4" }),
  ];
  const assetLookup = overrides.assetLookup || defaultAssets;
  const deliverablesByType = overrides.deliverablesByType || {
    photos: [{ id: 1, deliverable_type: "photos", source_asset_id: 101, status: "submitted" }],
    videos: [{ id: 2, deliverable_type: "videos", source_asset_id: 201, status: "submitted" }],
  };
  const latestSubmissionRow = {
    id: Number(overrides.latestSubmission?.id || 12) || 12,
    media_payload_json: {
      assets: Array.from({ length: 39 }, (_, index) => ({
        id: 500 + index,
        file_name: `accumulated-${index + 1}.jpg`,
        public_url: `/media/accumulated-${index + 1}.jpg`,
        mime_type: "image/jpeg",
      })),
    },
    ...overrides.latestSubmission,
  };
  const state = {
    assignments: {
      selectedId: assignmentId,
      deliverablesBundle: {
        assignment_id: assignmentId,
        latest_submission_id: latestSubmissionRow.id,
        deliverables_by_type: deliverablesByType,
        ...(overrides.bundle || {}),
      },
      latestSubmissionRows: {
        [assignmentId]: latestSubmissionRow,
      },
      assetLookup,
      assets: assetLookup,
      latestUploadedAssets: overrides.latestUploadedAssets || [],
      latestUploadedAssetsKey: overrides.latestUploadedAssetsKey || "",
      syncedUploadAssetsByKey: overrides.syncedUploadAssetsByKey || {},
      contextFieldPack: null,
      handoffSourceSnapshotIds: { [assignmentId]: 88 },
      latestSubmissionArticlePayloads: {},
      latestSubmissionLoaded: {},
    },
  };
  return {
    state,
    assignment: {
      id: assignmentId,
      state: "revision_requested",
      revision_round: revisionRound,
      latest_submission_id: latestSubmissionRow.id,
      image_reset_required: 0,
      video_reset_required: 0,
      ...overrides.assignment,
    },
    captureItems,
    photoSlotKey,
    videoSlotKey,
  };
}

function createRuntimeFixture() {
  const photoRows = [];
  const photoAssets = [];
  for (let index = 0; index < 12; index += 1) {
    const slotKey = buildAssignmentCaptureSlotKeyForTest(`Photo shot ${index + 1}`, index, "image", "photo");
    const assetId = 1000 + index;
    photoRows.push({ id: assetId, deliverable_type: "photos", source_asset_id: assetId, status: "submitted" });
    photoAssets.push(buildAsset({
      id: assetId,
      mediaType: "image",
      slotKey,
      fileName: `photo-shot-${index + 1}.jpg`,
    }));
  }
  const videoSlotKey = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 12, "video", "video");
  const videoAsset = buildAsset({
    id: 2001,
    mediaType: "video",
    slotKey: videoSlotKey,
    fileName: "walkthrough.mp4",
  });
  return createFixture({
    captureItems: [
      ...Array.from({ length: 12 }, (_, index) => ({ item_text: `Photo shot ${index + 1}`, item_order: index, capture_type: "photo" })),
      { item_text: "Walkthrough clip", item_order: 12, capture_type: "video" },
    ],
    assetLookup: [...photoAssets, videoAsset],
    deliverablesByType: {
      photos: photoRows,
      videos: [{ id: 2001, deliverable_type: "videos", source_asset_id: 2001, status: "submitted" }],
    },
  });
}

function loadHarness(fixture, overrides = {}) {
  const state = fixture.state;
  const summaryNode = overrides.summaryNode || { innerHTML: "", textContent: "", className: "" };
  const metaNode = overrides.metaNode || { innerHTML: "", textContent: "", className: "" };
  const renderCalls = [];
  const requests = [];
  const getAssignmentById = overrides.getAssignmentById || (() => fixture.assignment);
  const getAssignmentSubmissionFormConfig = overrides.getAssignmentSubmissionFormConfig || (() => ({ captureItems: fixture.captureItems }));
  const buildAssignmentCaptureFileUploadQueue = overrides.buildAssignmentCaptureFileUploadQueue || (() => []);
  const getAssignmentCaptureSyncKey = overrides.getAssignmentCaptureSyncKey || (() => `${fixture.assignment.id}::sig`);
  const isAssignmentCaptureUploadsSynced = overrides.isAssignmentCaptureUploadsSynced || (() => false);
  const getSyncedUploadAssetsForKey = overrides.getSyncedUploadAssetsForKey || (() => []);
  const getAssignmentCurrentRound = overrides.getAssignmentCurrentRound || (() => fixture.assignment.revision_round || 1);
  const buildAssignmentServerAssetSyncSignature = overrides.buildAssignmentServerAssetSyncSignature || (() => "sig");
  const getAssignmentSubmissionMissingTextPrompts = overrides.getAssignmentSubmissionMissingTextPrompts || (() => []);
  const buildAssignmentSubmissionArticlePayload = overrides.buildAssignmentSubmissionArticlePayload || (() => ({ verified_answers: [], question_answers: [], additional_text: "ready" }));
  const getAssignmentCaptureUploadBucket = overrides.getAssignmentCaptureUploadBucket || (() => ({}));

  const normalizeAssignmentCaptureMediaType = loadNamedFunction(appJs, "normalizeAssignmentCaptureMediaType");
  const toCaptureSlug = loadNamedFunction(appJs, "toCaptureSlug");
  const buildAssignmentCaptureSlotKey = loadNamedFunction(appJs, "buildAssignmentCaptureSlotKey", {
    toCaptureSlug,
    normalizeAssignmentCaptureMediaType,
  });
  const isVideoCapturePrompt = loadNamedFunction(appJs, "isVideoCapturePrompt");
  const normalizeAssignmentCaptureUploadItems = loadNamedFunction(appJs, "normalizeAssignmentCaptureUploadItems", {
    toCaptureSlug,
    normalizeAssignmentCaptureMediaType,
    buildAssignmentCaptureSlotKey,
    isVideoCapturePrompt,
  });
  const getAssignmentAssetSlotTypeKeyFromAsset = loadNamedFunction(appJs, "getAssignmentAssetSlotTypeKeyFromAsset", {
    normalizeAssignmentCaptureMediaType,
    buildAssignmentCaptureSlotKey,
  });
  const validateAssignmentCaptureRequirementsFromAssets = loadNamedFunction(appJs, "validateAssignmentCaptureRequirementsFromAssets", {
    normalizeAssignmentCaptureMediaType,
    buildAssignmentCaptureSlotKey,
    getAssignmentAssetSlotTypeKeyFromAsset,
    toCaptureSlug,
    isVideoCapturePrompt,
    normalizeAssignmentCaptureUploadItems,
  });
  const getAssignmentTouchedSlotTypeKeysFromQueue = loadNamedFunction(appJs, "getAssignmentTouchedSlotTypeKeysFromQueue");
  const buildAssignmentCaptureItemLookup = loadNamedFunction(appJs, "buildAssignmentCaptureItemLookup", {
    buildAssignmentCaptureSlotKey,
    normalizeAssignmentCaptureMediaType,
    normalizeAssignmentCaptureUploadItems,
  });
  const getAssignmentServerSyncedAssetsForCaptureItems = loadNamedFunction(appJs, "getAssignmentServerSyncedAssetsForCaptureItems", {
    state,
    getAssignmentById,
    getAssignmentCurrentRound,
    buildAssignmentServerAssetSyncSignature,
    ASSIGNMENT_WORK_SYNC_EXPIRY_MS: 24 * 60 * 60 * 1000,
    ASSIGNMENT_CAPTURE_MAX_IMAGES_PER_SLOT: 5,
    ASSIGNMENT_CAPTURE_MAX_VIDEOS_PER_SLOT: 2,
    normalizeAssignmentCaptureUploadItems,
    normalizeAssignmentCaptureMediaType,
    getAssignmentAssetSlotTypeKeyFromAsset,
  });
  const getAssignmentSubmissionAssetIdentityKey = loadNamedFunction(appJs, "getAssignmentSubmissionAssetIdentityKey");
  const mergeAssignmentSubmissionMediaAssets = loadNamedFunction(appJs, "mergeAssignmentSubmissionMediaAssets", {
    getAssignmentSubmissionAssetIdentityKey,
  });
  const findAssignmentAssetById = loadNamedFunction(appJs, "findAssignmentAssetById", { state });
  const getLatestAssignmentSubmissionRow = loadNamedFunction(appJs, "getLatestAssignmentSubmissionRow", { state });
  const resolveAssignmentSubmissionEffectiveMedia = loadNamedFunction(appJs, "resolveAssignmentSubmissionEffectiveMedia", {
    state,
    getAssignmentById,
    buildAssignmentCaptureFileUploadQueue,
    getAssignmentCaptureSyncKey,
    getAssignmentServerSyncedAssetsForCaptureItems,
    getLatestAssignmentSubmissionRow,
    findAssignmentAssetById,
    normalizeAssignmentCaptureMediaType,
    getAssignmentAssetSlotTypeKeyFromAsset,
    validateAssignmentCaptureRequirementsFromAssets,
    isAssignmentCaptureUploadsSynced,
    getSyncedUploadAssetsForKey,
    getAssignmentTouchedSlotTypeKeysFromQueue,
    getAssignmentSubmissionAssetIdentityKey,
  });
  const composeAssignmentSubmissionEffectiveAssets = loadNamedFunction(appJs, "composeAssignmentSubmissionEffectiveAssets", {
    resolveAssignmentSubmissionEffectiveMedia,
  });
  const buildAssignmentSubmissionMediaPayload = loadNamedFunction(appJs, "buildAssignmentSubmissionMediaPayload", {
    buildAssignmentCaptureItemLookup,
    getAssignmentAssetSlotTypeKeyFromAsset,
    normalizeAssignmentCaptureMediaType,
  });
  const renderAssignmentDeliverablesSummary = overrides.renderAssignmentDeliverablesSummary || ((bundleArg, assignmentArg) => {
    renderCalls.push([bundleArg, assignmentArg]);
    if (!assignmentArg) {
      summaryNode.innerHTML = "";
      metaNode.textContent = "";
      return;
    }
    const assets = Array.isArray(fixture.state.assignments.assetLookup) ? fixture.state.assignments.assetLookup : [];
    const photoNames = assets.filter((asset) => String(asset?.assignment_media_type || "").trim().toLowerCase() === "image").map((asset) => String(asset?.file_name || "").trim()).filter(Boolean);
    const videoNames = assets.filter((asset) => String(asset?.assignment_media_type || "").trim().toLowerCase() === "video").map((asset) => String(asset?.file_name || "").trim()).filter(Boolean);
    metaNode.textContent = `?????????????? | ??????? ${photoNames.length} ?????? | ?????? ${videoNames.length} ??????`;
    summaryNode.innerHTML = [...photoNames, ...videoNames].join(" | ");
  });
  const buildAssignmentSubmissionGateState = loadNamedFunction(appJs, "buildAssignmentSubmissionGateState", {
    getAssignmentById,
    buildAssignmentSubmissionArticlePayload,
    buildAssignmentCaptureFileUploadQueue,
    isAssignmentCaptureUploadsSynced,
    composeAssignmentSubmissionEffectiveAssets,
    getAssignmentServerSyncedAssetsForCaptureItems,
    getAssignmentSubmissionMissingTextPrompts,
  });
  const createAssignmentSubmission = loadNamedFunction(appJs, "createAssignmentSubmission", {
    isEditorUser: () => false,
    ensureSelectedAssignmentId: () => fixture.assignment.id,
    getAssignmentById,
    getAssignmentSubmissionFormConfig,
    state,
    buildAssignmentSubmissionArticlePayload,
    buildAssignmentRequestedCheckReturnPayloadFromDraft: () => null,
    isAssignmentSubmissionDraftEditableState: () => true,
    persistAssignmentSubmissionFailureDraft: async () => null,
    buildAssignmentSubmissionServerDraftPayload: () => null,
    clearServerDraftSaveTimer: () => {},
    syncAssignmentRequestedCheckReturnDraftFromForm: () => ({}),
    writeAssignmentSubmissionDraft: () => {},
    assertAssignmentCaptureUploadsComplete: () => {},
    buildAssignmentCaptureFileUploadQueue,
    buildAssignmentSubmissionGateState,
    renderAssignmentSubmissionGatePanel: () => {},
    focusFirstAssignmentSubmissionGateIssue: () => {},
    composeAssignmentSubmissionEffectiveAssets,
    getAssignmentCaptureSyncKey,
    buildAssignmentSubmissionMediaPayload,
    mergeAssignmentSubmissionMediaAssets,
    api: async (url, options = {}) => {
      requests.push({ url, options });
      return { submission: { id: 12 } };
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
    renderAssignmentDeliverablesSummary,
    renderAssignmentSubmissionForm: () => {},
    canPatchAssignmentState: () => false,
    window: { location: { search: "", pathname: "/", assign() {} } },
    URLSearchParams,
  });

  return {
    summaryNode,
    metaNode,
    renderCalls,
    requests,
    resolveAssignmentSubmissionEffectiveMedia,
    composeAssignmentSubmissionEffectiveAssets,
    renderAssignmentDeliverablesSummary,
    buildAssignmentSubmissionGateState,
    createAssignmentSubmission,
  };
}

test("revision without reset accepts retained latest-submission media", () => {
  const fixture = createFixture();
  const harness = loadHarness(fixture);

  const gateState = harness.buildAssignmentSubmissionGateState(fixture.assignment.id, { captureItems: fixture.captureItems }, {
    articlePayload: { additional_text: "ready" },
    uploadQueue: [],
  });

  assert.equal(gateState.canSubmit, true);
  assert.deepEqual(gateState.effectiveAssets.map((asset) => asset.id), [101, 201]);
  assert.equal(gateState.checklist.find((item) => item.key === "required_media")?.status, true);
});

test("initial submit without retained or current media still blocks", () => {
  const fixture = createFixture({
    assignment: { id: 30, state: "assigned", latest_submission_id: null },
    bundle: { latest_submission_id: null },
    latestSubmission: { id: null, media_payload_json: { assets: [] } },
    deliverablesByType: { photos: [], videos: [] },
    assetLookup: [],
  });
  const harness = loadHarness(fixture);

  const gateState = harness.buildAssignmentSubmissionGateState(30, { captureItems: fixture.captureItems }, {
    articlePayload: { additional_text: "ready" },
    uploadQueue: [],
  });

  assert.equal(gateState.canSubmit, false);
  assert.deepEqual(gateState.blockingReasons, ["\u0e01\u0e23\u0e38\u0e13\u0e32\u0e2d\u0e31\u0e1b\u0e42\u0e2b\u0e25\u0e14/\u0e0b\u0e34\u0e07\u0e01\u0e4c\u0e44\u0e1f\u0e25\u0e4c\u0e43\u0e2b\u0e49\u0e04\u0e23\u0e1a\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e07\u0e32\u0e19\u0e01\u0e25\u0e31\u0e1a"]);
});

test("image reset excludes retained images but keeps retained videos", () => {
  const fixture = createFixture({
    assignment: { image_reset_required: 1, video_reset_required: 0 },
    assetLookup: [
      buildAsset({ id: 101, round: 2, mediaType: "image", slotKey: buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo"), fileName: "retained-photo.jpg" }),
      buildAsset({ id: 201, round: 2, mediaType: "video", slotKey: buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video"), fileName: "retained-video.mp4" }),
    ],
  });
  const harness = loadHarness(fixture);

  const result = harness.composeAssignmentSubmissionEffectiveAssets(fixture.assignment.id, fixture.captureItems, {
    uploadQueue: [],
    strict: false,
  });

  assert.deepEqual(result.assets.map((asset) => asset.id), [201]);
});

test("video reset excludes retained videos but keeps retained images", () => {
  const fixture = createFixture({
    assignment: { image_reset_required: 0, video_reset_required: 1 },
    assetLookup: [
      buildAsset({ id: 101, round: 2, mediaType: "image", slotKey: buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo"), fileName: "retained-photo.jpg" }),
      buildAsset({ id: 201, round: 2, mediaType: "video", slotKey: buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video"), fileName: "retained-video.mp4" }),
    ],
  });
  const harness = loadHarness(fixture);

  const result = harness.composeAssignmentSubmissionEffectiveAssets(fixture.assignment.id, fixture.captureItems, {
    uploadQueue: [],
    strict: false,
  });

  assert.deepEqual(result.assets.map((asset) => asset.id), [101]);
});

test("current synced uploads merge with retained media and dedupe by asset identity", () => {
  const fixture = createFixture();
  const syncedPhoto = { ...fixture.state.assignments.assetLookup[0] };
  fixture.state.assignments.syncedUploadAssetsByKey = {
    "24::sig-local": [syncedPhoto],
  };
  const harness = loadHarness(fixture, {
    getAssignmentCaptureSyncKey: () => "24::sig-local",
    buildAssignmentCaptureFileUploadQueue: () => [{ slug: fixture.photoSlotKey, file: { type: "image/jpeg" } }],
    isAssignmentCaptureUploadsSynced: () => true,
    getSyncedUploadAssetsForKey: () => [syncedPhoto],
  });

  const result = harness.composeAssignmentSubmissionEffectiveAssets(24, fixture.captureItems, {
    uploadQueue: [{ slug: fixture.photoSlotKey, file: { type: "image/jpeg" } }],
    strict: false,
  });

  assert.deepEqual(result.payloadAssets.map((asset) => asset.id), [101]);
  assert.deepEqual(result.assets.map((asset) => asset.id), [101, 201]);
});

test("latest deliverables bundle wins over accumulated media payload fallback", () => {
  const fixture = createRuntimeFixture();
  const harness = loadHarness(fixture);

  const result = harness.resolveAssignmentSubmissionEffectiveMedia(24, fixture.captureItems, {
    uploadQueue: [],
    strict: false,
  });

  assert.equal(result.retainedAssets.length, 13);
  assert.equal(result.assets.length, 13);
  assert.equal(result.assets.some((asset) => Number(asset.id) === 500), false);
});

test("missing required shot still blocks even when many synced media items exist", () => {
  const fixture = createRuntimeFixture();
  fixture.state.assignments.assetLookup = fixture.state.assignments.assetLookup.filter((asset) => asset.assignment_media_type === "image");
  fixture.state.assignments.assets = fixture.state.assignments.assetLookup;
  fixture.assignment.image_reset_required = 1;
  fixture.assignment.video_reset_required = 1;
  const syncedPhotoAssets = fixture.state.assignments.assetLookup.filter((asset) => asset.assignment_media_type === "image");
  const uploadQueue = syncedPhotoAssets.map((asset) => ({
    slug: asset.assignment_slot_key,
    file: { type: "image/jpeg" },
  }));
  const harness = loadHarness(fixture, {
    buildAssignmentCaptureFileUploadQueue: () => uploadQueue,
    isAssignmentCaptureUploadsSynced: () => true,
    getSyncedUploadAssetsForKey: () => syncedPhotoAssets,
  });

  const gateState = harness.buildAssignmentSubmissionGateState(24, { captureItems: fixture.captureItems }, {
    articlePayload: { additional_text: "ready" },
    uploadQueue,
  });

  assert.equal(gateState.canSubmit, false);
  assert.deepEqual(gateState.missingMedia, ["\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d\u0e2b\u0e31\u0e27\u0e02\u0e49\u0e2d 13: Walkthrough clip"]);
  assert.deepEqual(gateState.blockingReasons, ["\u0e22\u0e31\u0e07\u0e02\u0e32\u0e14\u0e44\u0e1f\u0e25\u0e4c\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a: \u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d\u0e2b\u0e31\u0e27\u0e02\u0e49\u0e2d 13: Walkthrough clip"]);
  assert.equal(
    gateState.checklist.find((item) => item.key === "required_media")?.detail,
    "\u0e22\u0e31\u0e07\u0e02\u0e32\u0e14\u0e44\u0e1f\u0e25\u0e4c\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a: \u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d\u0e2b\u0e31\u0e27\u0e02\u0e49\u0e2d 13: Walkthrough clip"
  );
});

test("retained media appears in summary but is omitted from submit payload without new uploads", async () => {
  const fixture = createFixture();
  const harness = loadHarness(fixture);

  harness.renderAssignmentDeliverablesSummary(fixture.bundle, fixture.assignment);
  await harness.createAssignmentSubmission();

  assert.match(harness.summaryNode.innerHTML, /retained-photo\.jpg/);
  assert.match(harness.summaryNode.innerHTML, /retained-video\.mp4/);
  const submitRequest = harness.requests.find((entry) => entry.url === "/api/assignments/24/submissions");
  assert.ok(submitRequest, "submit request should exist");
  const payload = JSON.parse(String(submitRequest.options.body || "{}"));
  assert.deepEqual(
    (Array.isArray(payload?.media_payload_json?.assets) ? payload.media_payload_json.assets : []).map((asset) => Number(asset?.id || 0)),
    [101, 201]
  );
});

test("mixed current-round server assets and local synced uploads are submitted together without duplicates", async () => {
  const fixture = createFixture();
  const localVideo = {
    id: 301,
    file_name: "new-walkthrough.mp4",
    mime_type: "video/mp4",
    public_url: "/media/new-walkthrough.mp4",
    assignment_id: fixture.assignment.id,
    assignment_round: fixture.assignment.revision_round,
    assignment_surface: "assignment_work",
    assignment_media_type: "video",
    assignment_slot_key: fixture.videoSlotKey,
    assignment_sync_batch_id: "batch-new-video",
    created_at: new Date().toISOString(),
  };
  const queue = [{ slug: fixture.videoSlotKey, file: { type: "video/mp4" } }];
  const harness = loadHarness(fixture, {
    buildAssignmentCaptureFileUploadQueue: () => queue,
    isAssignmentCaptureUploadsSynced: () => true,
    getSyncedUploadAssetsForKey: () => [localVideo],
  });

  const gateState = harness.buildAssignmentSubmissionGateState(fixture.assignment.id, { captureItems: fixture.captureItems }, {
    articlePayload: { additional_text: "ready" },
    uploadQueue: queue,
  });
  assert.equal(gateState.canSubmit, true);

  await harness.createAssignmentSubmission();
  const submitRequest = harness.requests.find((entry) => entry.url === "/api/assignments/24/submissions");
  assert.ok(submitRequest, "submit request should exist");
  const payload = JSON.parse(String(submitRequest.options.body || "{}"));
  assert.deepEqual(
    (Array.isArray(payload?.media_payload_json?.assets) ? payload.media_payload_json.assets : []).map((asset) => Number(asset?.id || 0)).sort((a, b) => a - b),
    [101, 301]
  );
  assert.equal(
    Array.isArray(payload?.media_payload_json?.assets)
      ? payload.media_payload_json.assets.some((asset) => String(asset?.slotKey || "") === fixture.photoSlotKey && String(asset?.mediaType || "") === "image")
      : false,
    true
  );
  assert.equal(
    Array.isArray(payload?.media_payload_json?.assets)
      ? payload.media_payload_json.assets.some((asset) => String(asset?.slotKey || "") === fixture.videoSlotKey && String(asset?.mediaType || "") === "video")
      : false,
    true
  );
});

test("submit asset merge deduplicates identical persisted assets across local and server sets", async () => {
  const fixture = createFixture();
  const duplicatedServerAsset = { ...fixture.state.assignments.assetLookup[0] };
  const queue = [{ slug: fixture.photoSlotKey, file: { type: "image/jpeg" } }];
  const harness = loadHarness(fixture, {
    buildAssignmentCaptureFileUploadQueue: () => queue,
    isAssignmentCaptureUploadsSynced: () => true,
    getSyncedUploadAssetsForKey: () => [duplicatedServerAsset],
  });

  await harness.createAssignmentSubmission();
  const submitRequest = harness.requests.find((entry) => entry.url === "/api/assignments/24/submissions");
  const payload = JSON.parse(String(submitRequest.options.body || "{}"));
  const assets = Array.isArray(payload?.media_payload_json?.assets) ? payload.media_payload_json.assets : [];
  assert.equal(assets.filter((asset) => Number(asset?.id || 0) === 101).length, 1);
  assert.equal(
    assets.some((asset) => Number(asset?.id || 0) === 101 && String(asset?.slotKey || "") === fixture.photoSlotKey && String(asset?.mediaType || "") === "image"),
    true
  );
});

test("capture upload cards show server-synced slot counts after refresh without local files", () => {
  const fixture = createFixture();
  const normalizeAssignmentCaptureMediaType = loadNamedFunction(appJs, "normalizeAssignmentCaptureMediaType");
  const toCaptureSlug = loadNamedFunction(appJs, "toCaptureSlug");
  const buildAssignmentCaptureSlotKey = loadNamedFunction(appJs, "buildAssignmentCaptureSlotKey", {
    toCaptureSlug,
    normalizeAssignmentCaptureMediaType,
  });
  const isVideoCapturePrompt = loadNamedFunction(appJs, "isVideoCapturePrompt");
  const normalizeAssignmentCaptureUploadItems = loadNamedFunction(appJs, "normalizeAssignmentCaptureUploadItems", {
    toCaptureSlug,
    normalizeAssignmentCaptureMediaType,
    buildAssignmentCaptureSlotKey,
    isVideoCapturePrompt,
  });
  const getAssignmentAssetSlotTypeKeyFromAsset = loadNamedFunction(appJs, "getAssignmentAssetSlotTypeKeyFromAsset", {
    normalizeAssignmentCaptureMediaType,
    buildAssignmentCaptureSlotKey,
  });
  const getAssignmentServerSyncedAssetsForCaptureItems = loadNamedFunction(appJs, "getAssignmentServerSyncedAssetsForCaptureItems", {
    state: fixture.state,
    getAssignmentById: () => fixture.assignment,
    getAssignmentCurrentRound: () => fixture.assignment.revision_round,
    buildAssignmentServerAssetSyncSignature: () => "server:24",
    ASSIGNMENT_WORK_SYNC_EXPIRY_MS: 24 * 60 * 60 * 1000,
    ASSIGNMENT_CAPTURE_MAX_IMAGES_PER_SLOT: 5,
    ASSIGNMENT_CAPTURE_MAX_VIDEOS_PER_SLOT: 2,
    normalizeAssignmentCaptureUploadItems,
    normalizeAssignmentCaptureMediaType,
    getAssignmentAssetSlotTypeKeyFromAsset,
  });
  const buildAssignmentCaptureUploadCards = loadNamedFunction(appJs, "buildAssignmentCaptureUploadCards", {
    normalizeAssignmentCaptureUploadItems,
    listAssignmentCaptureFiles: () => [],
    isAssignmentCaptureLoading: () => false,
    sanitizeUploadFileName: (value) => String(value || "").trim(),
    escapeHtml,
    getAssignmentServerSyncedAssetsForCaptureItems,
    getAssignmentAssetSlotTypeKeyFromAsset,
  });

  const html = buildAssignmentCaptureUploadCards(fixture.assignment.id, fixture.captureItems);
  assert.match(html, /1 \u0e23\u0e39\u0e1b \u0e1a\u0e19 server/);
  assert.match(html, /1 \u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d \u0e1a\u0e19 server/);
  assert.doesNotMatch(html, />0 \u0e23\u0e39\u0e1b</);
  assert.doesNotMatch(html, />0 \u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d</);
});

test("slot card shows local files and server-synced files together for the same slot", () => {
  const fixture = createFixture();
  const normalizeAssignmentCaptureMediaType = loadNamedFunction(appJs, "normalizeAssignmentCaptureMediaType");
  const toCaptureSlug = loadNamedFunction(appJs, "toCaptureSlug");
  const buildAssignmentCaptureSlotKey = loadNamedFunction(appJs, "buildAssignmentCaptureSlotKey", {
    toCaptureSlug,
    normalizeAssignmentCaptureMediaType,
  });
  const isVideoCapturePrompt = loadNamedFunction(appJs, "isVideoCapturePrompt");
  const normalizeAssignmentCaptureUploadItems = loadNamedFunction(appJs, "normalizeAssignmentCaptureUploadItems", {
    toCaptureSlug,
    normalizeAssignmentCaptureMediaType,
    buildAssignmentCaptureSlotKey,
    isVideoCapturePrompt,
  });
  const getAssignmentAssetSlotTypeKeyFromAsset = loadNamedFunction(appJs, "getAssignmentAssetSlotTypeKeyFromAsset", {
    normalizeAssignmentCaptureMediaType,
    buildAssignmentCaptureSlotKey,
  });
  const getAssignmentServerSyncedAssetsForCaptureItems = loadNamedFunction(appJs, "getAssignmentServerSyncedAssetsForCaptureItems", {
    state: fixture.state,
    getAssignmentById: () => fixture.assignment,
    getAssignmentCurrentRound: () => fixture.assignment.revision_round,
    buildAssignmentServerAssetSyncSignature: () => "server:24",
    ASSIGNMENT_WORK_SYNC_EXPIRY_MS: 24 * 60 * 60 * 1000,
    ASSIGNMENT_CAPTURE_MAX_IMAGES_PER_SLOT: 5,
    ASSIGNMENT_CAPTURE_MAX_VIDEOS_PER_SLOT: 2,
    normalizeAssignmentCaptureUploadItems,
    normalizeAssignmentCaptureMediaType,
    getAssignmentAssetSlotTypeKeyFromAsset,
  });
  const buildAssignmentCaptureUploadCards = loadNamedFunction(appJs, "buildAssignmentCaptureUploadCards", {
    normalizeAssignmentCaptureUploadItems,
    listAssignmentCaptureFiles: (_assignmentId, slug) => (
      slug === fixture.photoSlotKey
        ? [{ name: "browser-photo.jpg", type: "image/jpeg" }]
        : []
    ),
    isAssignmentCaptureLoading: () => false,
    sanitizeUploadFileName: (value) => String(value || "").trim(),
    escapeHtml,
    getAssignmentServerSyncedAssetsForCaptureItems,
    getAssignmentAssetSlotTypeKeyFromAsset,
  });

  const html = buildAssignmentCaptureUploadCards(fixture.assignment.id, fixture.captureItems);
  assert.match(html, /1 \u0e23\u0e39\u0e1b \u0e43\u0e19 browser \| 1 \u0e23\u0e39\u0e1b \u0e1a\u0e19 server/);
  assert.match(html, /browser-photo\.jpg/);
  assert.match(html, /retained-photo\.jpg/);
  assert.match(html, /\u0e44\u0e1f\u0e25\u0e4c\u0e43\u0e2b\u0e21\u0e48\u0e43\u0e19 browser \u0e08\u0e30\u0e16\u0e39\u0e01\u0e43\u0e0a\u0e49\u0e41\u0e17\u0e19\u0e44\u0e1f\u0e25\u0e4c\u0e1a\u0e19 server \u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a\u0e0a\u0e48\u0e2d\u0e07\u0e19\u0e35\u0e49\u0e2b\u0e25\u0e31\u0e07\u0e0b\u0e34\u0e07\u0e01\u0e4c/);
});
