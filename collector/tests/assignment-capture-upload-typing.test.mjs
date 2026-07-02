import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const serverIndexJs = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

function extractNamedFunctionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const paramsStart = source.indexOf("(", start);
  assert.notEqual(paramsStart, -1, `${name} should have params`);
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
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

const buildAssignmentCaptureSlotKeyForBackendTest = new Function(
  `${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "buildAssignmentCaptureSlotKey")}
return buildAssignmentCaptureSlotKey;`
)();

const findMissingCapturePromptsForBackendTest = new Function(
  "repo",
  `${extractNamedFunctionSource(serverIndexJs, "uniqueAssignmentPromptStrings")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "toCaptureShotSlug")}
${extractNamedFunctionSource(serverIndexJs, "parseCaptureShotSlugFromFileName")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentCaptureAssetSlotTypeKey")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentMediaPayloadAssets")}
${extractNamedFunctionSource(serverIndexJs, "findMissingCapturePrompts")}
return findMissingCapturePrompts;`
)({
  listAssignmentRoundAssetsByType() {
    return [];
  },
  getAssignmentSubmissionById() {
    return null;
  },
});

const resolveAssignmentSubmissionValidationMediaPayloadForBackendTest = new Function(
  "repo",
  `${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentMediaPayloadAssets")}
${extractNamedFunctionSource(serverIndexJs, "resolveAssignmentSubmissionValidationMediaPayload")}
return resolveAssignmentSubmissionValidationMediaPayload;`
);

test("submission required-fields check allows blank capture answers when exact image and video slots are present", () => {
  const assignment = {
    assignment_kind: "field",
    fieldPack: {
      checklists: [
        { checklist_type: "must_verify_fact", item_text: "Confirm opening hours" },
        { checklist_type: "must_ask_question", item_text: "Ask for parking details" },
        { checklist_type: "must_capture", item_text: "Storefront hero", capture_type: "photo", item_order: 0 },
        { checklist_type: "must_capture", item_text: "Walkthrough clip", capture_type: "video", item_order: 1 },
      ],
    },
  };
  const storefrontSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Storefront hero", 0, "image", "photo");
  const walkthroughSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Walkthrough clip", 1, "video", "video");

  assert.doesNotThrow(() => enforceAssignmentSubmissionRequiredFieldsForBackendTest(
    assignment,
    {
      verified_answers: [{ prompt: "Confirm opening hours", answer: "Open daily 09:00-18:00" }],
      question_answers: [{ prompt: "Ask for parking details", answer: "Two shared parking bays" }],
      capture_answers: [
        { prompt: "Storefront hero", answer: "" },
        { prompt: "Walkthrough clip", answer: "" },
      ],
      additional_text: "All required files synced",
    },
    24,
    2,
    {
      assets: [
        {
          id: 101,
          file_name: `${storefrontSlotKey}__storefront.jpg`,
          mime_type: "image/jpeg",
          slotKey: storefrontSlotKey,
          mediaType: "image",
        },
        {
          id: 102,
          file_name: `${walkthroughSlotKey}__walkthrough.mp4`,
          mime_type: "video/mp4",
          slotKey: walkthroughSlotKey,
          mediaType: "video",
        },
      ],
    }
  ));
});

test("submission required-fields check still rejects missing verified or question text answers", () => {
  const assignment = {
    assignment_kind: "field",
    fieldPack: {
      checklists: [
        { checklist_type: "must_verify_fact", item_text: "Confirm opening hours" },
        { checklist_type: "must_ask_question", item_text: "Ask for parking details" },
        { checklist_type: "must_capture", item_text: "Walkthrough clip", capture_type: "video", item_order: 0 },
      ],
    },
  };
  const walkthroughSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Walkthrough clip", 0, "video", "video");

  assert.throws(
    () => enforceAssignmentSubmissionRequiredFieldsForBackendTest(
      assignment,
      {
        verified_answers: [{ prompt: "Confirm opening hours", answer: "" }],
        question_answers: [{ prompt: "Ask for parking details", answer: "" }],
        capture_answers: [{ prompt: "Walkthrough clip", answer: "" }],
        additional_text: "Has synced media only",
      },
      24,
      2,
      {
        assets: [
          {
            id: 102,
            file_name: `${walkthroughSlotKey}__walkthrough.mp4`,
            mime_type: "video/mp4",
            slotKey: walkthroughSlotKey,
            mediaType: "video",
          },
        ],
      }
    ),
    /à¸ªà¸´à¹ˆà¸‡à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸¢à¸·à¸™à¸¢à¸±à¸™|à¸„à¸³à¸•à¸­à¸šà¸ˆà¸²à¸à¸«à¸™à¹‰à¸²à¸‡à¸²à¸™/
  );
});

test("frontend capture validation rejects image uploaded into a video slot", () => {
  const captureItems = [
    { item_text: "Walkthrough clip", item_order: 0, capture_type: "video" },
  ];
  const normalized = normalizeAssignmentCaptureUploadItemsForTest(captureItems);
  const videoSlot = normalized[0];
  const assignment = {
    image_reset_required: 0,
    video_reset_required: 1,
  };

  const missing = validateAssignmentCaptureRequirementsFromAssetsForTest(assignment, captureItems, [
    {
      file_name: `${videoSlot.uploadKey}__wrong-type.jpg`,
      mime_type: "image/jpeg",
    },
  ]);

  assert.deepEqual(missing, ["à¸§à¸´à¸”à¸µà¹‚à¸­à¸«à¸±à¸§à¸‚à¹‰à¸­ 1: Walkthrough clip"]);
});

const enforceAssignmentSubmissionRequiredFieldsForBackendTest = new Function(
  "repo",
  `${extractNamedFunctionSource(serverIndexJs, "uniqueAssignmentPromptStrings")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "buildAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(serverIndexJs, "getFieldPackPromptGroups")}
${extractNamedFunctionSource(serverIndexJs, "getStructuredFieldPackCaptureItems")}
${extractNamedFunctionSource(serverIndexJs, "findMissingPromptAnswers")}
${extractNamedFunctionSource(serverIndexJs, "toCaptureShotSlug")}
${extractNamedFunctionSource(serverIndexJs, "parseCaptureShotSlugFromFileName")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentCaptureAssetSlotTypeKey")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentMediaPayloadAssets")}
${extractNamedFunctionSource(serverIndexJs, "findMissingCapturePrompts")}
${extractNamedFunctionSource(serverIndexJs, "resolveAssignmentSubmissionValidationMediaPayload")}
function resolveAssignmentSubmissionPromptContext(assignment = null) {
  return {
    brief: assignment?.brief_json || null,
    fieldPack: assignment?.fieldPack || null,
  };
}
${extractNamedFunctionSource(serverIndexJs, "enforceAssignmentSubmissionRequiredFields")}
return enforceAssignmentSubmissionRequiredFields;`
)({
  listAssignmentRoundAssetsByType() {
    return [];
  },
  getAssignmentSubmissionById() {
    return null;
  },
});

const enforceResetPerShotRequirementsForBackendTest = new Function(
  "repo",
  `const ASSIGNMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024 * 1024;
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentMediaPayloadAssets")}
${extractNamedFunctionSource(serverIndexJs, "resolveAssignmentSubmissionValidationMediaPayload")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentShotPromptList")}
${extractNamedFunctionSource(serverIndexJs, "toCaptureShotSlug")}
${extractNamedFunctionSource(serverIndexJs, "parseCaptureShotSlugFromFileName")}
${extractNamedFunctionSource(serverIndexJs, "enforceResetPerShotRequirements")}
return enforceResetPerShotRequirements;`
);

const normalizeAssignmentCaptureUploadItemsForTest = new Function(
  `${extractNamedFunctionSource(appJs, "toCaptureSlug")}
${extractNamedFunctionSource(appJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(appJs, "buildAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(appJs, "isVideoCapturePrompt")}
${extractNamedFunctionSource(appJs, "normalizeAssignmentCaptureUploadItems")}
return normalizeAssignmentCaptureUploadItems;`
)();

const validateAssignmentCaptureRequirementsFromAssetsForTest = new Function(
  `${extractNamedFunctionSource(appJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(appJs, "buildAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(appJs, "getAssignmentAssetSlotTypeKeyFromAsset")}
${extractNamedFunctionSource(appJs, "toCaptureSlug")}
${extractNamedFunctionSource(appJs, "isVideoCapturePrompt")}
${extractNamedFunctionSource(appJs, "normalizeAssignmentCaptureUploadItems")}
${extractNamedFunctionSource(appJs, "validateAssignmentCaptureRequirementsFromAssets")}
return validateAssignmentCaptureRequirementsFromAssets;`
)();

const getAssignmentAssetSlotTypeKeyFromAssetForTest = new Function(
  `${extractNamedFunctionSource(appJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(appJs, "buildAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(appJs, "getAssignmentAssetSlotTypeKeyFromAsset")}
return getAssignmentAssetSlotTypeKeyFromAsset;`
)();

const buildAssignmentSubmissionMediaPayloadForTest = new Function(
  `${extractNamedFunctionSource(appJs, "toCaptureSlug")}
${extractNamedFunctionSource(appJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(appJs, "buildAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(appJs, "isVideoCapturePrompt")}
${extractNamedFunctionSource(appJs, "normalizeAssignmentCaptureUploadItems")}
${extractNamedFunctionSource(appJs, "getAssignmentAssetSlotTypeKeyFromAsset")}
${extractNamedFunctionSource(appJs, "buildAssignmentCaptureItemLookup")}
${extractNamedFunctionSource(appJs, "buildAssignmentSubmissionMediaPayload")}
return buildAssignmentSubmissionMediaPayload;`
)();

const getAssignmentServerSyncedAssetsForCaptureItemsForTest = new Function(
  "state",
  "helpers",
  `const ASSIGNMENT_WORK_SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000;
const ASSIGNMENT_CAPTURE_MAX_IMAGES_PER_SLOT = 5;
const ASSIGNMENT_CAPTURE_MAX_VIDEOS_PER_SLOT = 2;
const getAssignmentById = helpers.getAssignmentById;
const getAssignmentCurrentRound = helpers.getAssignmentCurrentRound;
const buildAssignmentServerAssetSyncSignature = helpers.buildAssignmentServerAssetSyncSignature;
${extractNamedFunctionSource(appJs, "toCaptureSlug")}
${extractNamedFunctionSource(appJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(appJs, "buildAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(appJs, "isVideoCapturePrompt")}
${extractNamedFunctionSource(appJs, "normalizeAssignmentCaptureUploadItems")}
${extractNamedFunctionSource(appJs, "getAssignmentAssetSlotTypeKeyFromAsset")}
${extractNamedFunctionSource(appJs, "getAssignmentServerSyncedAssetsForCaptureItems")}
return (assignmentId, captureItems) => getAssignmentServerSyncedAssetsForCaptureItems(assignmentId, captureItems);`
);

test("normalizeAssignmentCaptureUploadItems preserves capture_type and splits both into two slot keys", () => {
  const normalized = normalizeAssignmentCaptureUploadItemsForTest([
    { item_text: "à¸«à¸™à¹‰à¸²à¸£à¹‰à¸²à¸™", item_order: 0, capture_type: "photo" },
    { item_text: "Tracking shot", item_order: 1, capture_type: "video" },
    { item_text: "à¸šà¸£à¸£à¸¢à¸²à¸à¸²à¸¨à¸£à¸§à¸¡", item_order: 2, capture_type: "both" },
  ]);

  assert.equal(normalized.length, 4);

  assert.deepEqual(
    normalized.map((row) => ({
      prompt: row.prompt,
      captureType: row.captureType,
      mediaType: row.mediaType,
      displayIndex: row.displayIndex,
    })),
    [
      {
        prompt: "à¸«à¸™à¹‰à¸²à¸£à¹‰à¸²à¸™",
        captureType: "photo",
        mediaType: "image",
        displayIndex: 1,
      },
      {
        prompt: "Tracking shot",
        captureType: "video",
        mediaType: "video",
        displayIndex: 2,
      },
      {
        prompt: "à¸šà¸£à¸£à¸¢à¸²à¸à¸²à¸¨à¸£à¸§à¸¡",
        captureType: "both",
        mediaType: "image",
        displayIndex: 3,
      },
      {
        prompt: "à¸šà¸£à¸£à¸¢à¸²à¸à¸²à¸¨à¸£à¸§à¸¡",
        captureType: "both",
        mediaType: "video",
        displayIndex: 3,
      },
    ]
  );
  assert.ok(normalized[0].uploadKey.startsWith("shot-1-"));
  assert.ok(normalized[1].uploadKey.startsWith("shot-2-"));
  assert.ok(normalized[2].uploadKey.endsWith("--image"));
  assert.ok(normalized[3].uploadKey.endsWith("--video"));
  assert.notEqual(normalized[2].uploadKey, normalized[3].uploadKey);
});

test("validateAssignmentCaptureRequirementsFromAssets tracks image/video slots separately for capture_type both", () => {
  const captureItems = [
    { item_text: "à¸šà¸£à¸£à¸¢à¸²à¸à¸²à¸¨à¸£à¸§à¸¡", item_order: 0, capture_type: "both" },
  ];
  const normalized = normalizeAssignmentCaptureUploadItemsForTest(captureItems);
  const imageSlot = normalized.find((row) => row.mediaType === "image");
  const videoSlot = normalized.find((row) => row.mediaType === "video");
  const assignment = {
    image_reset_required: 1,
    video_reset_required: 1,
  };

  const imageOnlyAssets = [
    {
      file_name: `${imageSlot.uploadKey}__cover.jpg`,
      mime_type: "image/jpeg",
    },
  ];
  const imageOnlyMissing = validateAssignmentCaptureRequirementsFromAssetsForTest(assignment, captureItems, imageOnlyAssets);
  assert.deepEqual(imageOnlyMissing, ["à¸§à¸´à¸”à¸µà¹‚à¸­à¸«à¸±à¸§à¸‚à¹‰à¸­ 1: à¸šà¸£à¸£à¸¢à¸²à¸à¸²à¸¨à¸£à¸§à¸¡"]);

  const bothAssets = [
    {
      file_name: `${imageSlot.uploadKey}__cover.jpg`,
      mime_type: "image/jpeg",
    },
    {
      file_name: `${videoSlot.uploadKey}__clip.mp4`,
      mime_type: "video/mp4",
    },
  ];
  const completeMissing = validateAssignmentCaptureRequirementsFromAssetsForTest(assignment, captureItems, bothAssets);
  assert.deepEqual(completeMissing, []);
});

test("getAssignmentAssetSlotTypeKeyFromAsset prefers canonical media key from assignment metadata", () => {
  const key = getAssignmentAssetSlotTypeKeyFromAssetForTest({
    file_name: "shot-3-scene__clip.mp4",
    mime_type: "application/octet-stream",
    assignment_media_type: "video",
  });
  assert.equal(key, "shot-3-scene|video");
});

test("submission media payload keeps synced video asset metadata from upload response", () => {
  const captureItems = [
    { item_text: "Walkthrough clip", item_order: 4, capture_type: "video" },
  ];
  const slotKey = buildAssignmentCaptureSlotKeyForBackendTest("Walkthrough clip", 4, "video", "video");

  const payload = buildAssignmentSubmissionMediaPayloadForTest([
    {
      id: 501,
      file_name: "upload.mp4",
      mime_type: "video/mp4",
      slotKey,
      mediaType: "video",
      assignment_media_type: "video",
      assignment_round: 2,
      assignment_surface: "assignment_work",
      assignment_sync_batch_id: "batch-video-1",
    },
  ], captureItems);

  assert.deepEqual(payload, {
    assets: [
      {
        id: 501,
        file_name: "upload.mp4",
        mime_type: "video/mp4",
        public_url: null,
        storage_path: null,
        assignment_id: null,
        assignment_round: 2,
        assignment_surface: "assignment_work",
        assignment_slot_key: slotKey,
        assignment_media_type: "video",
        assignment_sync_batch_id: "batch-video-1",
        slotKey,
        mediaType: "video",
        capture_type: "video",
        prompt: "Walkthrough clip",
      },
    ],
  });
});

test("backend capture validation accepts mixed server and local slot payload and rejects wrong round surface slot and media type boundaries", () => {
  const captureItems = [
    { item_text: "Storefront hero", item_order: 0, capture_type: "photo" },
    { item_text: "Walkthrough clip", item_order: 1, capture_type: "video" },
  ];
  const photoSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Storefront hero", 0, "image", "photo");
  const videoSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Walkthrough clip", 1, "video", "video");
  const validServerAsset = {
    id: 701,
    file_name: "retained-photo.jpg",
    mime_type: "image/jpeg",
    public_url: "/media/retained-photo.jpg",
    assignment_id: 24,
    assignment_round: 2,
    assignment_surface: "assignment_work",
    assignment_media_type: "image",
    assignment_slot_key: photoSlotKey,
    assignment_sync_batch_id: "batch-server-photo",
  };
  const validLocalAsset = {
    id: 702,
    file_name: "new-walkthrough.mp4",
    mime_type: "video/mp4",
    public_url: "/media/new-walkthrough.mp4",
    assignment_id: 24,
    assignment_round: 2,
    assignment_surface: "assignment_work",
    assignment_media_type: "video",
    assignment_slot_key: videoSlotKey,
    assignment_sync_batch_id: "batch-local-video",
  };
  const payload = buildAssignmentSubmissionMediaPayloadForTest([
    validServerAsset,
    validLocalAsset,
    { ...validLocalAsset },
  ], captureItems);
  assert.equal(payload.assets.length, 3);

  const assignment = {
    assignment_kind: "field",
    fieldPack: {
      checklists: [
        { checklist_type: "must_capture", item_text: "Storefront hero", capture_type: "photo", item_order: 0 },
        { checklist_type: "must_capture", item_text: "Walkthrough clip", capture_type: "video", item_order: 1 },
      ],
    },
  };
  assert.doesNotThrow(() => enforceAssignmentSubmissionRequiredFieldsForBackendTest(
    assignment,
    {
      verified_answers: [],
      question_answers: [],
      capture_answers: [],
      additional_text: "ready",
    },
    24,
    2,
    payload
  ));

  const run = getAssignmentServerSyncedAssetsForCaptureItemsForTest({
    assignments: {
      assetLookup: [
        validServerAsset,
        { ...validServerAsset, id: 703, assignment_round: 1 },
        { ...validServerAsset, id: 704, assignment_surface: "article_workspace" },
        { ...validServerAsset, id: 705, assignment_slot_key: "shot-99-wrong-slot" },
        { ...validServerAsset, id: 706, assignment_media_type: "video", mime_type: "video/mp4" },
      ],
    },
  }, {
    getAssignmentById() {
      return { id: 24, image_reset_required: 1, video_reset_required: 1 };
    },
    getAssignmentCurrentRound() {
      return 2;
    },
    buildAssignmentServerAssetSyncSignature() {
      return "sig-boundaries";
    },
  });
  const result = run(24, captureItems);
  assert.deepEqual(result.assets.map((asset) => Number(asset.id || 0)), [701]);
  assert.deepEqual(result.missing, ["à¸§à¸´à¸”à¸µà¹‚à¸­à¸«à¸±à¸§à¸‚à¹‰à¸­ 2: Walkthrough clip"]);
});

test("server-synced asset reload keeps video asset matched by persisted slot metadata", () => {
  const captureItems = [
    { item_text: "Walkthrough clip", item_order: 4, capture_type: "video" },
  ];
  const slotKey = buildAssignmentCaptureSlotKeyForBackendTest("Walkthrough clip", 4, "video", "video");
  const state = {
    assignments: {
      assetLookup: [
        {
          id: 601,
          file_name: "round2-video.mp4",
          mime_type: "video/mp4",
          assignment_id: 24,
          assignment_round: 2,
          assignment_surface: "assignment_work",
          assignment_media_type: "video",
          assignment_slot_key: slotKey,
          assignment_sync_batch_id: "batch-video-reload",
          created_at: new Date().toISOString(),
        },
      ],
    },
  };
  const run = getAssignmentServerSyncedAssetsForCaptureItemsForTest(state, {
    getAssignmentById() {
      return { id: 24, image_reset_required: 0, video_reset_required: 1 };
    },
    getAssignmentCurrentRound() {
      return 2;
    },
    buildAssignmentServerAssetSyncSignature() {
      return "sig-video";
    },
  });

  const result = run(24, captureItems);
  assert.equal(result.complete, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].assignment_slot_key, slotKey);
  assert.equal(result.assets[0].assignment_media_type, "video");

  const payload = buildAssignmentSubmissionMediaPayloadForTest(result.assets, captureItems);
  assert.equal(payload.assets.length, 1);
  assert.equal(payload.assets[0].slotKey, slotKey);
  assert.equal(payload.assets[0].mediaType, "video");
});

test("server validation media helper ignores retained latest submission media during revision_requested even when reset is off", () => {
  const resolveValidationMedia = resolveAssignmentSubmissionValidationMediaPayloadForBackendTest({
    getAssignmentSubmissionById() {
      return {
        id: 12,
        media_payload_json: {
          assets: [
            { id: 201, file_name: "retained-photo.jpg", mime_type: "image/jpeg", public_url: "/media/retained-photo.jpg" },
            { id: 202, file_name: "retained-video.mp4", mime_type: "video/mp4", public_url: "/media/retained-video.mp4" },
          ],
        },
      };
    },
  });

  const result = resolveValidationMedia(
    { state: "revision_requested", latest_submission_id: 12, image_reset_required: 0, video_reset_required: 0 },
    null
  );

  assert.deepEqual(result.assets.map((asset) => asset.id), []);
  assert.deepEqual(result.retainedAssets, []);
});

test("server validation media helper ignores retained assets for all reset configurations during revision_requested", () => {
  const resolveValidationMedia = resolveAssignmentSubmissionValidationMediaPayloadForBackendTest({
    getAssignmentSubmissionById() {
      return {
        id: 12,
        media_payload_json: {
          assets: [
            { id: 201, file_name: "retained-photo.jpg", mime_type: "image/jpeg", public_url: "/media/retained-photo.jpg" },
            { id: 202, file_name: "retained-video.mp4", mime_type: "video/mp4", public_url: "/media/retained-video.mp4" },
          ],
        },
      };
    },
  });

  const imageReset = resolveValidationMedia(
    { state: "revision_requested", latest_submission_id: 12, image_reset_required: 1, video_reset_required: 0 },
    null
  );
  assert.deepEqual(imageReset.assets.map((asset) => asset.id), []);
  assert.deepEqual(imageReset.retainedAssets, []);

  const videoReset = resolveValidationMedia(
    { state: "revision_requested", latest_submission_id: 12, image_reset_required: 0, video_reset_required: 1 },
    null
  );
  assert.deepEqual(videoReset.assets.map((asset) => asset.id), []);
  assert.deepEqual(videoReset.retainedAssets, []);
});

test("normalizeAssignmentMediaPayloadAssets preserves size bytes and stable urls", () => {
  const normalizeMediaPayloadAssets = new Function(
    `${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentMediaPayloadAssets")}
return normalizeAssignmentMediaPayloadAssets;`
  )();

  const [asset] = normalizeMediaPayloadAssets({
    assets: [
      {
        id: 301,
        file_name: "walkthrough.mp4",
        mime_type: "video/mp4",
        size_bytes: "12345",
        public_url: " /media/Walkthrough.mp4 ",
        source_url: " https://cdn.example.com/Walkthrough.mp4 ",
        mediaType: "video",
      },
    ],
  });

  assert.equal(asset.size_bytes, 12345);
  assert.equal(asset.public_url, "/media/Walkthrough.mp4");
  assert.equal(asset.source_url, "https://cdn.example.com/Walkthrough.mp4");
});

test("submission required-fields check blocks revision without current-round replacement media", () => {
  const assignment = {
    state: "revision_requested",
    latest_submission_id: 12,
    assignment_kind: "field",
    image_reset_required: 0,
    video_reset_required: 0,
    fieldPack: {
      checklists: [
        { checklist_type: "must_verify_fact", item_text: "Confirm opening hours" },
        { checklist_type: "must_ask_question", item_text: "Ask for parking details" },
        { checklist_type: "must_capture", item_text: "Storefront hero", capture_type: "photo", item_order: 0 },
        { checklist_type: "must_capture", item_text: "Walkthrough clip", capture_type: "video", item_order: 1 },
      ],
    },
  };
  const storefrontSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Storefront hero", 0, "image", "photo");
  const walkthroughSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Walkthrough clip", 1, "video", "video");
  const run = new Function(
    "repo",
    `${extractNamedFunctionSource(serverIndexJs, "uniqueAssignmentPromptStrings")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "buildAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(serverIndexJs, "getFieldPackPromptGroups")}
${extractNamedFunctionSource(serverIndexJs, "getStructuredFieldPackCaptureItems")}
${extractNamedFunctionSource(serverIndexJs, "findMissingPromptAnswers")}
${extractNamedFunctionSource(serverIndexJs, "toCaptureShotSlug")}
${extractNamedFunctionSource(serverIndexJs, "parseCaptureShotSlugFromFileName")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentCaptureAssetSlotTypeKey")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentMediaPayloadAssets")}
${extractNamedFunctionSource(serverIndexJs, "findMissingCapturePrompts")}
${extractNamedFunctionSource(serverIndexJs, "resolveAssignmentSubmissionValidationMediaPayload")}
function resolveAssignmentSubmissionPromptContext(assignment = null) {
  return {
    brief: assignment?.brief_json || null,
    fieldPack: assignment?.fieldPack || null,
  };
}
${extractNamedFunctionSource(serverIndexJs, "enforceAssignmentSubmissionRequiredFields")}
return enforceAssignmentSubmissionRequiredFields;`
  )({
    listAssignmentRoundAssetsByType() {
      return [];
    },
    getAssignmentSubmissionById() {
      return {
        id: 12,
        media_payload_json: {
          assets: [
            { id: 101, file_name: `${storefrontSlotKey}__storefront.jpg`, mime_type: "image/jpeg", slotKey: storefrontSlotKey, mediaType: "image" },
            { id: 102, file_name: `${walkthroughSlotKey}__walkthrough.mp4`, mime_type: "video/mp4", slotKey: walkthroughSlotKey, mediaType: "video" },
          ],
        },
      };
    },
  });

  assert.throws(() => run(
    assignment,
    {
      verified_answers: [{ prompt: "Confirm opening hours", answer: "Open daily 09:00-18:00" }],
      question_answers: [{ prompt: "Ask for parking details", answer: "Two shared parking bays" }],
      capture_answers: [
        { prompt: "Storefront hero", answer: "" },
        { prompt: "Walkthrough clip", answer: "" },
      ],
      additional_text: "Retained media should not satisfy backend validation",
    },
    24,
    3,
    null
  ), /Storefront hero|Walkthrough clip/);
});

test("reset shot validation blocks only the reset media type when retained latest submission assets lack replacement", () => {
  const run = enforceResetPerShotRequirementsForBackendTest({
    listAssignmentRoundAssetsByType() {
      return [];
    },
    getAssignmentSubmissionById() {
      return {
        id: 12,
        media_payload_json: {
          assets: [
            { id: 201, file_name: "shot-1-storefront-hero__retained-photo.jpg", mime_type: "image/jpeg" },
            { id: 202, file_name: "shot-1-storefront-hero__retained-video.mp4", mime_type: "video/mp4" },
          ],
        },
      };
    },
  });

  assert.throws(
    () => run(
      {
        state: "revision_requested",
        latest_submission_id: 12,
        image_reset_required: 1,
        video_reset_required: 0,
        brief_json: { shot_list_suggestions: ["Storefront hero"] },
      },
      24,
      3,
      null
    ),
    /image reset: missing image/
  );

  assert.doesNotThrow(() => run(
    {
      state: "revision_requested",
      latest_submission_id: 12,
      image_reset_required: 0,
      video_reset_required: 1,
      brief_json: { shot_list_suggestions: ["Storefront hero"] },
    },
    24,
    3,
    {
      assets: [
        { id: 302, file_name: "shot-1-storefront-hero__fresh-video.mp4", mime_type: "video/mp4" },
      ],
    }
  ));
});

test("video reset rejects incoming video larger than 20GB", () => {
  const run = enforceResetPerShotRequirementsForBackendTest({
    listAssignmentRoundAssetsByType() {
      return [];
    },
    getAssignmentSubmissionById() {
      return {
        id: 12,
        media_payload_json: { assets: [] },
      };
    },
  });

  assert.throws(
    () => run(
      {
        state: "revision_requested",
        latest_submission_id: 12,
        image_reset_required: 0,
        video_reset_required: 1,
        brief_json: { shot_list_suggestions: ["Storefront hero"] },
      },
      24,
      3,
      {
        assets: [
          {
            id: 401,
            file_name: "shot-1-storefront-hero__too-large.mp4",
            mime_type: "video/mp4",
            size_bytes: (20 * 1024 * 1024 * 1024) + 1,
          },
        ],
      }
    ),
    /larger than 20GB/
  );
});

test("server validation media helper keeps both assets when filenames match but urls differ", () => {
  const resolveValidationMedia = resolveAssignmentSubmissionValidationMediaPayloadForBackendTest({
    getAssignmentSubmissionById() {
      return null;
    },
  });

  const result = resolveValidationMedia(
    { state: "revision_requested", latest_submission_id: null, image_reset_required: 0, video_reset_required: 0 },
    {
      assets: [
        { file_name: "same-name.jpg", mime_type: "image/jpeg", public_url: "/media/a.jpg" },
        { file_name: "same-name.jpg", mime_type: "image/jpeg", public_url: "/media/b.jpg" },
      ],
    }
  );

  assert.equal(result.assets.length, 2);
});

test("server validation media helper dedupes assets when stable url matches without ids", () => {
  const resolveValidationMedia = resolveAssignmentSubmissionValidationMediaPayloadForBackendTest({
    getAssignmentSubmissionById() {
      return null;
    },
  });

  const result = resolveValidationMedia(
    { state: "revision_requested", latest_submission_id: null, image_reset_required: 0, video_reset_required: 0 },
    {
      assets: [
        { file_name: "same-name-a.jpg", mime_type: "image/jpeg", public_url: "/media/shared.jpg" },
        { file_name: "same-name-b.jpg", mime_type: "image/jpeg", public_url: "/media/shared.jpg" },
      ],
    }
  );

  assert.equal(result.assets.length, 1);
});

test("server validation media helper ignores retained submission media during revision_requested", () => {
  const resolveValidationMedia = resolveAssignmentSubmissionValidationMediaPayloadForBackendTest({
    getAssignmentSubmissionById() {
      return {
        media_payload_json: {
          assets: [
            {
              id: 77,
              file_name: "old-round.mp4",
              mime_type: "video/mp4",
              public_url: "/media/old-round.mp4",
              slotKey: "shot-2-walkthrough",
              mediaType: "video",
            },
          ],
        },
      };
    },
  });

  const result = resolveValidationMedia(
    { state: "revision_requested", latest_submission_id: 55, image_reset_required: 0, video_reset_required: 0 },
    {
      assets: [
        {
          id: 88,
          file_name: "new-round.jpg",
          mime_type: "image/jpeg",
          public_url: "/media/new-round.jpg",
          slotKey: "shot-1-storefront",
          mediaType: "image",
        },
      ],
    }
  );

  assert.deepEqual(result.retainedAssets, []);
  assert.deepEqual(
    result.assets.map((asset) => Number(asset?.id || 0)),
    [88]
  );
});

test("persisted slot metadata beats non-canonical filename and missing metadata does not guess slot", () => {
  const slotKey = "shot-5-walkthrough-clip";

  assert.equal(
    getAssignmentAssetSlotTypeKeyFromAssetForTest({
      file_name: "round2-video.mp4",
      mime_type: "video/mp4",
      assignment_slot_key: slotKey,
      assignment_media_type: "video",
    }),
    `${slotKey}|video`
  );

  assert.equal(
    getAssignmentAssetSlotTypeKeyFromAssetForTest({
      file_name: "round2-video.mp4",
      mime_type: "video/mp4",
    }),
    ""
  );
});

test("backend capture validation accepts structured video payload assets by canonical slot key", () => {
  const trackingSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Tracking shot à¹€à¸”à¸´à¸™à¹€à¸‚à¹‰à¸²à¸«à¸™à¹‰à¸²à¸£à¹‰à¸²à¸™", 12, "video", "video");
  const pushInSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Push-in shot à¹„à¸›à¸—à¸µà¹ˆ Barista", 13, "video", "video");
  const missing = findMissingCapturePromptsForBackendTest(
    ["Tracking shot à¹€à¸”à¸´à¸™à¹€à¸‚à¹‰à¸²à¸«à¸™à¹‰à¸²à¸£à¹‰à¸²à¸™", "Push-in shot à¹„à¸›à¸—à¸µà¹ˆ Barista"],
    99,
    1,
    {
      structuredItems: [
        { prompt: "Tracking shot à¹€à¸”à¸´à¸™à¹€à¸‚à¹‰à¸²à¸«à¸™à¹‰à¸²à¸£à¹‰à¸²à¸™", slotKey: trackingSlotKey, mediaType: "video" },
        { prompt: "Push-in shot à¹„à¸›à¸—à¸µà¹ˆ Barista", slotKey: pushInSlotKey, mediaType: "video" },
      ],
      mediaPayload: {
        assets: [
          {
            id: 1,
            file_name: `${trackingSlotKey}__tracking.mp4`,
            mime_type: "video/mp4",
            slotKey: trackingSlotKey,
            mediaType: "video",
            capture_type: "video",
            prompt: "Tracking shot à¹€à¸”à¸´à¸™à¹€à¸‚à¹‰à¸²à¸«à¸™à¹‰à¸²à¸£à¹‰à¸²à¸™",
          },
          {
            id: 2,
            file_name: `${pushInSlotKey}__pushin.mp4`,
            mime_type: "video/mp4",
            slotKey: pushInSlotKey,
            mediaType: "video",
            capture_type: "video",
            prompt: "Push-in shot à¹„à¸›à¸—à¸µà¹ˆ Barista",
          },
        ],
      },
    }
  );
  assert.deepEqual(missing, []);
});

test("backend capture validation reports only the missing structured video slot", () => {
  const trackingSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Tracking shot à¹€à¸”à¸´à¸™à¹€à¸‚à¹‰à¸²à¸«à¸™à¹‰à¸²à¸£à¹‰à¸²à¸™", 12, "video", "video");
  const pushInSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Push-in shot à¹„à¸›à¸—à¸µà¹ˆ Barista", 13, "video", "video");
  const missing = findMissingCapturePromptsForBackendTest(
    ["Tracking shot à¹€à¸”à¸´à¸™à¹€à¸‚à¹‰à¸²à¸«à¸™à¹‰à¸²à¸£à¹‰à¸²à¸™", "Push-in shot à¹„à¸›à¸—à¸µà¹ˆ Barista"],
    99,
    1,
    {
      structuredItems: [
        { prompt: "Tracking shot à¹€à¸”à¸´à¸™à¹€à¸‚à¹‰à¸²à¸«à¸™à¹‰à¸²à¸£à¹‰à¸²à¸™", slotKey: trackingSlotKey, mediaType: "video" },
        { prompt: "Push-in shot à¹„à¸›à¸—à¸µà¹ˆ Barista", slotKey: pushInSlotKey, mediaType: "video" },
      ],
      mediaPayload: {
        assets: [
          {
            id: 1,
            file_name: `${trackingSlotKey}__tracking.mp4`,
            mime_type: "video/mp4",
            slotKey: trackingSlotKey,
            mediaType: "video",
            capture_type: "video",
            prompt: "Tracking shot à¹€à¸”à¸´à¸™à¹€à¸‚à¹‰à¸²à¸«à¸™à¹‰à¸²à¸£à¹‰à¸²à¸™",
          },
        ],
      },
    }
  );
  assert.deepEqual(missing, ["Push-in shot à¹„à¸›à¸—à¸µà¹ˆ Barista"]);
});


test("capture topic readiness counts fulfilled and missing topics by slot key and media type", () => {
  const evaluateReadiness = new Function(
    "repo",
    `function resolveAssignmentSubmissionPromptContext(assignment = null) {
      return {
        brief: assignment?.brief_json || null,
        fieldPack: assignment?.fieldPack || null,
      };
    }
${extractNamedFunctionSource(serverIndexJs, "uniqueAssignmentPromptStrings")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "buildAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(serverIndexJs, "getFieldPackPromptGroups")}
${extractNamedFunctionSource(serverIndexJs, "getStructuredFieldPackCaptureItems")}
${extractNamedFunctionSource(serverIndexJs, "toCaptureShotSlug")}
${extractNamedFunctionSource(serverIndexJs, "parseCaptureShotSlugFromFileName")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentCaptureAssetSlotTypeKey")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentMediaPayloadAssets")}
${extractNamedFunctionSource(serverIndexJs, "resolveAssignmentSubmissionValidationMediaPayload")}
${extractNamedFunctionSource(serverIndexJs, "resolveSelectedAssignmentMediaAssetIds")}
${extractNamedFunctionSource(serverIndexJs, "resolveCurrentRoundEligibleAssignmentMediaAssets")}
${extractNamedFunctionSource(serverIndexJs, "evaluateAssignmentCaptureTopicReadinessFromAssets")}
${extractNamedFunctionSource(serverIndexJs, "evaluateAssignmentCaptureTopicReadiness")}
const ASSIGNMENT_WORK_SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000;
return evaluateAssignmentCaptureTopicReadiness;`
  )({});

  const assignment = {
    state: "in_progress",
    fieldPack: {
      checklists: [
        { checklist_type: "must_capture", item_text: "Storefront hero", capture_type: "photo", item_order: 0 },
        { checklist_type: "must_capture", item_text: "Walkthrough clip", capture_type: "video", item_order: 1 },
      ],
    },
  };
  const storefrontSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Storefront hero", 0, "image", "photo");
  const result = evaluateReadiness(assignment, 24, 3, {
    assets: Array.from({ length: 100 }, (_value, index) => ({
      id: index + 1,
      file_name: `${storefrontSlotKey}__${index + 1}.jpg`,
      mime_type: "image/jpeg",
      slotKey: storefrontSlotKey,
      mediaType: "image",
    })),
  });

  assert.equal(result.counts.required_topics, 2);
  assert.equal(result.counts.fulfilled_topics, 1);
  assert.equal(result.counts.missing_topics, 1);
  assert.equal(result.can_submit, false);
  assert.deepEqual(result.fulfilled_requirement_ids, [`${storefrontSlotKey}|image`]);
  assert.deepEqual(
    result.missing_requirements.map((row) => ({ slot_key: row.slot_key, media_type: row.media_type, prompt: row.prompt })),
    [{ slot_key: "shot-2-walkthrough-clip", media_type: "video", prompt: "Walkthrough clip" }]
  );
});

test("submission error helper maps incomplete capture requirements to structured 409 response", () => {
  const buildResponse = new Function(
    `${extractNamedFunctionSource(serverIndexJs, "buildSubmissionErrorResponse")}
return buildSubmissionErrorResponse;`
  )();

  const err = new Error("assignment capture requirements incomplete");
  err.code = "ASSIGNMENT_CAPTURE_REQUIREMENTS_INCOMPLETE";
  err.missing_requirements = [
    { requirement_id: "shot-2-walkthrough-clip|video", slot_key: "shot-2-walkthrough-clip", media_type: "video", prompt: "Walkthrough clip" },
  ];

  const result = buildResponse(err);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "assignment_capture_requirements_incomplete");
  assert.deepEqual(result.body.missing_requirements, err.missing_requirements);
});
