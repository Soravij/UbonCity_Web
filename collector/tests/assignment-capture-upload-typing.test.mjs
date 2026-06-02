import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const serverIndexJs = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

function extractNamedFunctionSource(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
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
});

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

test("normalizeAssignmentCaptureUploadItems preserves capture_type and splits both into two slot keys", () => {
  const normalized = normalizeAssignmentCaptureUploadItemsForTest([
    { item_text: "หน้าร้าน", item_order: 0, capture_type: "photo" },
    { item_text: "Tracking shot", item_order: 1, capture_type: "video" },
    { item_text: "บรรยากาศรวม", item_order: 2, capture_type: "both" },
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
        prompt: "หน้าร้าน",
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
        prompt: "บรรยากาศรวม",
        captureType: "both",
        mediaType: "image",
        displayIndex: 3,
      },
      {
        prompt: "บรรยากาศรวม",
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
    { item_text: "บรรยากาศรวม", item_order: 0, capture_type: "both" },
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
  assert.deepEqual(imageOnlyMissing, ["วิดีโอหัวข้อ 1: บรรยากาศรวม"]);

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

test("backend capture validation accepts structured video payload assets by canonical slot key", () => {
  const trackingSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Tracking shot เดินเข้าหน้าร้าน", 12, "video", "video");
  const pushInSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Push-in shot ไปที่ Barista", 13, "video", "video");
  const missing = findMissingCapturePromptsForBackendTest(
    ["Tracking shot เดินเข้าหน้าร้าน", "Push-in shot ไปที่ Barista"],
    99,
    1,
    {
      structuredItems: [
        { prompt: "Tracking shot เดินเข้าหน้าร้าน", slotKey: trackingSlotKey, mediaType: "video" },
        { prompt: "Push-in shot ไปที่ Barista", slotKey: pushInSlotKey, mediaType: "video" },
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
            prompt: "Tracking shot เดินเข้าหน้าร้าน",
          },
          {
            id: 2,
            file_name: `${pushInSlotKey}__pushin.mp4`,
            mime_type: "video/mp4",
            slotKey: pushInSlotKey,
            mediaType: "video",
            capture_type: "video",
            prompt: "Push-in shot ไปที่ Barista",
          },
        ],
      },
    }
  );
  assert.deepEqual(missing, []);
});

test("backend capture validation reports only the missing structured video slot", () => {
  const trackingSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Tracking shot เดินเข้าหน้าร้าน", 12, "video", "video");
  const pushInSlotKey = buildAssignmentCaptureSlotKeyForBackendTest("Push-in shot ไปที่ Barista", 13, "video", "video");
  const missing = findMissingCapturePromptsForBackendTest(
    ["Tracking shot เดินเข้าหน้าร้าน", "Push-in shot ไปที่ Barista"],
    99,
    1,
    {
      structuredItems: [
        { prompt: "Tracking shot เดินเข้าหน้าร้าน", slotKey: trackingSlotKey, mediaType: "video" },
        { prompt: "Push-in shot ไปที่ Barista", slotKey: pushInSlotKey, mediaType: "video" },
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
            prompt: "Tracking shot เดินเข้าหน้าร้าน",
          },
        ],
      },
    }
  );
  assert.deepEqual(missing, ["Push-in shot ไปที่ Barista"]);
});
