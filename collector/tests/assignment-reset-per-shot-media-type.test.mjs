import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.resolve(testDir, "..");
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

function buildEnforceResetPerShotRequirements(repo) {
  return new Function(
    "repo",
    `const ASSIGNMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024 * 1024;
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "buildAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(serverIndexJs, "getStructuredFieldPackCaptureItems")}
${extractNamedFunctionSource(serverIndexJs, "resolveAssignmentFieldPackFromBrief")}
${extractNamedFunctionSource(serverIndexJs, "resolveAssignmentSubmissionPromptContext")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentShotPromptList")}
${extractNamedFunctionSource(serverIndexJs, "inferLegacyCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "toCaptureShotSlug")}
${extractNamedFunctionSource(serverIndexJs, "parseCaptureShotSlugFromFileName")}
${extractNamedFunctionSource(serverIndexJs, "enforceResetPerShotRequirements")}
return enforceResetPerShotRequirements;`
  )(repo);
}

const toCaptureShotSlugForTest = new Function(
  `${extractNamedFunctionSource(serverIndexJs, "toCaptureShotSlug")}
return toCaptureShotSlug;`
)();

function makeAssignment(checklists) {
  return {
    image_reset_required: 1,
    video_reset_required: 1,
    content_item_id: 0,
    brief_json: {
      field_pack: { checklists },
    },
  };
}

function makeLegacyAssignment(shotListSuggestions) {
  return {
    image_reset_required: 1,
    video_reset_required: 1,
    content_item_id: 0,
    brief_json: {
      shot_list_suggestions: shotListSuggestions,
    },
  };
}

function makeRepo({ imageAssets = [], videoAssets = [] } = {}) {
  return {
    listAssignmentRoundAssetsByType(_assignmentId, _round, type) {
      return type === "image" ? imageAssets : videoAssets;
    },
  };
}

test("photo-only shot requires image only and does not report missing video", () => {
  const checklists = [
    { checklist_type: "must_capture", item_text: "หน้าร้าน", item_order: 0, capture_type: "photo" },
  ];
  const assignment = makeAssignment(checklists);
  const repo = makeRepo();
  const enforceResetPerShotRequirements = buildEnforceResetPerShotRequirements(repo);

  assert.throws(
    () => enforceResetPerShotRequirements(assignment, 1, 1),
    (error) => {
      assert.match(error.message, /image reset: missing image/);
      assert.doesNotMatch(error.message, /video/);
      return true;
    }
  );
});

test("photo-only shot passes once its image is uploaded, without requiring any video", () => {
  const slug = toCaptureShotSlugForTest("หน้าร้าน", 0);
  const checklists = [
    { checklist_type: "must_capture", item_text: "หน้าร้าน", item_order: 0, capture_type: "photo" },
  ];
  const assignment = makeAssignment(checklists);
  const repo = makeRepo({
    imageAssets: [{ file_name: `${slug}__cover.jpg`, mime_type: "image/jpeg" }],
  });
  const enforceResetPerShotRequirements = buildEnforceResetPerShotRequirements(repo);

  assert.doesNotThrow(() => enforceResetPerShotRequirements(assignment, 1, 1));
});

test("video-only shot requires video only and does not report missing image", () => {
  const checklists = [
    { checklist_type: "must_capture", item_text: "วิดีโอเดินชมร้าน", item_order: 0, capture_type: "video" },
  ];
  const assignment = makeAssignment(checklists);
  const repo = makeRepo();
  const enforceResetPerShotRequirements = buildEnforceResetPerShotRequirements(repo);

  assert.throws(
    () => enforceResetPerShotRequirements(assignment, 1, 1),
    (error) => {
      assert.match(error.message, /video reset: missing video/);
      assert.doesNotMatch(error.message, /image/);
      return true;
    }
  );
});

test("video-only shot passes once its video is uploaded, without requiring any image", () => {
  const slug = toCaptureShotSlugForTest("วิดีโอเดินชมร้าน", 0);
  const checklists = [
    { checklist_type: "must_capture", item_text: "วิดีโอเดินชมร้าน", item_order: 0, capture_type: "video" },
  ];
  const assignment = makeAssignment(checklists);
  const repo = makeRepo({
    videoAssets: [{ file_name: `${slug}__walkthrough.mp4`, mime_type: "video/mp4", size_bytes: 1024 }],
  });
  const enforceResetPerShotRequirements = buildEnforceResetPerShotRequirements(repo);

  assert.doesNotThrow(() => enforceResetPerShotRequirements(assignment, 1, 1));
});

test("both-type shot requires both image and video", () => {
  const slug = toCaptureShotSlugForTest("บรรยากาศรวม", 0);
  const checklists = [
    { checklist_type: "must_capture", item_text: "บรรยากาศรวม", item_order: 0, capture_type: "both" },
  ];
  const assignment = makeAssignment(checklists);

  // Only image uploaded: still blocked on the missing video.
  const repoImageOnly = makeRepo({
    imageAssets: [{ file_name: `${slug}__cover.jpg`, mime_type: "image/jpeg" }],
  });
  const enforceImageOnly = buildEnforceResetPerShotRequirements(repoImageOnly);
  assert.throws(
    () => enforceImageOnly(assignment, 1, 1),
    (error) => {
      assert.match(error.message, /video reset: missing video/);
      assert.doesNotMatch(error.message, /image reset: missing image/);
      return true;
    }
  );

  // Only video uploaded: still blocked on the missing image.
  const repoVideoOnly = makeRepo({
    videoAssets: [{ file_name: `${slug}__clip.mp4`, mime_type: "video/mp4", size_bytes: 1024 }],
  });
  const enforceVideoOnly = buildEnforceResetPerShotRequirements(repoVideoOnly);
  assert.throws(
    () => enforceVideoOnly(assignment, 1, 1),
    (error) => {
      assert.match(error.message, /image reset: missing image/);
      assert.doesNotMatch(error.message, /video reset: missing video/);
      return true;
    }
  );

  // Both uploaded: passes.
  const repoBoth = makeRepo({
    imageAssets: [{ file_name: `${slug}__cover.jpg`, mime_type: "image/jpeg" }],
    videoAssets: [{ file_name: `${slug}__clip.mp4`, mime_type: "video/mp4", size_bytes: 1024 }],
  });
  const enforceBoth = buildEnforceResetPerShotRequirements(repoBoth);
  assert.doesNotThrow(() => enforceBoth(assignment, 1, 1));
});

test("uploaded assets from the wrong slot do not satisfy another shot", () => {
  const slugOne = toCaptureShotSlugForTest("หน้าร้าน", 0);
  const checklists = [
    { checklist_type: "must_capture", item_text: "หน้าร้าน", item_order: 0, capture_type: "photo" },
    { checklist_type: "must_capture", item_text: "ป้ายชื่อร้าน", item_order: 1, capture_type: "photo" },
  ];
  const assignment = makeAssignment(checklists);
  // The only uploaded image belongs to shot 1's slug; shot 2 remains unmatched.
  const repo = makeRepo({
    imageAssets: [{ file_name: `${slugOne}__cover.jpg`, mime_type: "image/jpeg" }],
  });
  const enforceResetPerShotRequirements = buildEnforceResetPerShotRequirements(repo);

  assert.throws(
    () => enforceResetPerShotRequirements(assignment, 1, 1),
    (error) => {
      assert.match(error.message, /missing image in shot "2\. ป้ายชื่อร้าน"/);
      assert.doesNotMatch(error.message, /missing image in shot "1\. หน้าร้าน"/);
      return true;
    }
  );
});

test("enforceResetPerShotRequirements does not mutate assignment or field pack data", () => {
  const checklists = [
    { checklist_type: "must_capture", item_text: "หน้าร้าน", item_order: 0, capture_type: "photo" },
  ];
  const assignment = makeAssignment(checklists);
  const before = JSON.stringify(assignment);
  const repo = makeRepo();
  const enforceResetPerShotRequirements = buildEnforceResetPerShotRequirements(repo);

  assert.throws(() => enforceResetPerShotRequirements(assignment, 1, 1));
  assert.equal(JSON.stringify(assignment), before);
});

test("field pack absent: legacy shot_list_suggestions is used instead of blocking submission outright", () => {
  const shotOneSlug = toCaptureShotSlugForTest("หน้าร้าน", 0);
  const shotTwoSlug = toCaptureShotSlugForTest("ป้ายชื่อร้าน", 1);
  const assignment = makeLegacyAssignment(["หน้าร้าน", "ป้ายชื่อร้าน"]);
  const repo = makeRepo({
    imageAssets: [
      { file_name: `${shotOneSlug}__cover.jpg`, mime_type: "image/jpeg" },
      { file_name: `${shotTwoSlug}__sign.jpg`, mime_type: "image/jpeg" },
    ],
  });
  const enforceResetPerShotRequirements = buildEnforceResetPerShotRequirements(repo);

  assert.doesNotThrow(() => enforceResetPerShotRequirements(assignment, 1, 1));
});

test("legacy fallback infers per-shot media type from prompt text and does not require the other type", () => {
  const photoSlug = toCaptureShotSlugForTest("หน้าร้าน", 0);
  const videoSlug = toCaptureShotSlugForTest("วิดีโอเดินชมร้าน", 1);
  const assignment = makeLegacyAssignment(["หน้าร้าน", "วิดีโอเดินชมร้าน"]);
  // Photo shot only has an image, video shot only has a video - neither shot has its "other" type.
  const repo = makeRepo({
    imageAssets: [{ file_name: `${photoSlug}__cover.jpg`, mime_type: "image/jpeg" }],
    videoAssets: [{ file_name: `${videoSlug}__walkthrough.mp4`, mime_type: "video/mp4", size_bytes: 1024 }],
  });
  const enforceResetPerShotRequirements = buildEnforceResetPerShotRequirements(repo);

  assert.doesNotThrow(() => enforceResetPerShotRequirements(assignment, 1, 1));
});

test("legacy fallback still blocks when a shot's own inferred media type is missing", () => {
  const assignment = makeLegacyAssignment(["หน้าร้าน"]);
  const repo = makeRepo();
  const enforceResetPerShotRequirements = buildEnforceResetPerShotRequirements(repo);

  assert.throws(
    () => enforceResetPerShotRequirements(assignment, 1, 1),
    (error) => {
      assert.match(error.message, /image reset: missing image/);
      assert.doesNotMatch(error.message, /video/);
      return true;
    }
  );
});

test("no capture requirements from either source still throws a descriptive error", () => {
  const assignment = makeLegacyAssignment([]);
  const repo = makeRepo();
  const enforceResetPerShotRequirements = buildEnforceResetPerShotRequirements(repo);

  assert.throws(
    () => enforceResetPerShotRequirements(assignment, 1, 1),
    /must_capture items in the field pack or shot_list_suggestions/
  );
});
