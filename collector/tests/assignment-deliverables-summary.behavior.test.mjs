import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");

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
    add(...tokens) {
      tokens.flat().map((token) => String(token || "").trim()).filter(Boolean).forEach((token) => classSet.add(token));
    },
    remove(...tokens) {
      tokens.flat().map((token) => String(token || "").trim()).filter(Boolean).forEach((token) => classSet.delete(token));
    },
    toggle(token, force) {
      const name = String(token || "").trim();
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

const ASSIGNMENT_DELIVERABLE_OPTIONS = loadConstValue(appJs, "ASSIGNMENT_DELIVERABLE_OPTIONS");

const getAssignmentDeliverableLabel = loadNamedFunction(appJs, "getAssignmentDeliverableLabel", {
  ASSIGNMENT_DELIVERABLE_OPTIONS,
});

const summarizeAssignmentAssetOption = loadNamedFunction(appJs, "summarizeAssignmentAssetOption");

function buildHarness({ bundle, assignment, latestSubmission, assets = [] } = {}) {
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
      deliverablesBundle: bundle || null,
      latestSubmissionRows: {
        [Number(assignment?.id || 0) || 0]: latestSubmission || null,
      },
      assets,
      assetLookup: assets,
    },
  };

  const findAssignmentAssetById = loadNamedFunction(appJs, "findAssignmentAssetById", {
    state,
  });
  const formatAssignmentDeliverableSummaryValue = loadNamedFunction(appJs, "formatAssignmentDeliverableSummaryValue", {
    escapeHtml,
    summarizeAssignmentAssetOption,
    findAssignmentAssetById,
  });
  const formatAssignmentDeliverableStatusChip = loadNamedFunction(appJs, "formatAssignmentDeliverableStatusChip", {
    escapeHtml,
    getAssignmentDeliverableLabel,
  });
  const summarizeAssignmentDeliverableList = loadNamedFunction(appJs, "summarizeAssignmentDeliverableList", {
    getAssignmentDeliverableLabel,
    formatAssignmentDeliverableSummaryValue,
  });
  const formatAssignmentDeliverableRowMeta = loadNamedFunction(appJs, "formatAssignmentDeliverableRowMeta");
  const formatAssignmentBriefExpectedDeliverables = loadNamedFunction(appJs, "formatAssignmentBriefExpectedDeliverables", {
    escapeHtml,
    getAssignmentDeliverableLabel,
  });
  const getAssignmentDeliverableOptionList = loadNamedFunction(appJs, "getAssignmentDeliverableOptionList", {
    ASSIGNMENT_DELIVERABLE_OPTIONS,
    normalizeAssignmentBriefExpectedDeliverables() {
      return [];
    },
  });
  const chooseDefaultDeliverableType = loadNamedFunction(appJs, "chooseDefaultDeliverableType", {
    ASSIGNMENT_DELIVERABLE_OPTIONS,
    getAssignmentDeliverableOptionList,
  });
  const renderAssignmentDeliverableTypeOptions = loadNamedFunction(appJs, "renderAssignmentDeliverableTypeOptions", {
    qs,
    escapeHtml,
    getAssignmentDeliverableLabel,
    chooseDefaultDeliverableType,
    getAssignmentDeliverableOptionList,
  });
  const renderAssignmentDeliverablesSummary = loadNamedFunction(appJs, "renderAssignmentDeliverablesSummary", {
    qs,
    escapeHtml,
    formatAssignmentDeliverableStatusChip,
    formatAssignmentBriefExpectedDeliverables,
    summarizeAssignmentDeliverableList,
    formatAssignmentDeliverableRowMeta,
    renderAssignmentDeliverableTypeOptions,
  });
  const getLatestAssignmentSubmissionRow = loadNamedFunction(appJs, "getLatestAssignmentSubmissionRow", {
    state,
  });
  const resolveAssignmentReviewMediaUrl = loadNamedFunction(appJs, "resolveAssignmentReviewMediaUrl", {
    findAssignmentAssetById,
  });
  const summarizeAssignmentReviewMediaLabel = loadNamedFunction(appJs, "summarizeAssignmentReviewMediaLabel", {
    summarizeAssignmentAssetOption,
    findAssignmentAssetById,
  });
  const getAssignmentReviewMediaItems = loadNamedFunction(appJs, "getAssignmentReviewMediaItems", {
    state,
    getLatestAssignmentSubmissionRow,
    resolveAssignmentReviewMediaUrl,
    summarizeAssignmentReviewMediaLabel,
    getAssignmentDeliverableLabel,
  });

  return {
    summaryNode,
    metaNode,
    createBtn,
    renderAssignmentDeliverablesSummary,
    getAssignmentReviewMediaItems,
  };
}

function createBundle() {
  return {
    latest_submission_id: 12,
    expected_deliverables: ["photos", "videos", "caption_draft", "script_draft", "raw_notes"],
    available_deliverable_types: ["photos", "videos", "raw_notes"],
    missing_deliverable_types: ["caption_draft", "script_draft"],
    deliverables_by_type: {
      photos: [
        { id: 1, deliverable_type: "photos", source_asset_id: 101, status: "submitted", created_at: "2026-06-28T10:00:00Z" },
        { id: 2, deliverable_type: "photos", source_asset_id: 102, status: "submitted", created_at: "2026-06-28T10:01:00Z" },
        { id: 3, deliverable_type: "photos", source_asset_id: 103, status: "submitted", created_at: "2026-06-28T10:02:00Z" },
        { id: 4, deliverable_type: "photos", source_asset_id: 104, status: "submitted", created_at: "2026-06-28T10:03:00Z" },
        { id: 5, deliverable_type: "photos", source_asset_id: 105, status: "submitted", created_at: "2026-06-28T10:04:00Z" },
      ],
      videos: [
        { id: 6, deliverable_type: "videos", source_asset_id: 201, status: "submitted", created_at: "2026-06-28T10:05:00Z" },
        { id: 7, deliverable_type: "videos", source_asset_id: 202, status: "submitted", created_at: "2026-06-28T10:06:00Z" },
      ],
      raw_notes: [
        { id: 8, deliverable_type: "raw_notes", text_content: "Observed queue near entrance", status: "submitted", created_at: "2026-06-28T10:07:00Z" },
      ],
      caption_draft: [],
      script_draft: [],
    },
  };
}

function createBundleWithUnexpectedType() {
  return {
    latest_submission_id: 19,
    expected_deliverables: ["photos", "videos", "raw_notes"],
    available_deliverable_types: ["photos", "videos", "raw_notes", "caption_draft"],
    missing_deliverable_types: [],
    deliverables_by_type: {
      photos: [
        { id: 11, deliverable_type: "photos", source_asset_id: 101, status: "submitted", created_at: "2026-06-28T11:00:00Z" },
      ],
      videos: [
        { id: 12, deliverable_type: "videos", source_asset_id: 201, status: "submitted", created_at: "2026-06-28T11:01:00Z" },
      ],
      raw_notes: [
        { id: 13, deliverable_type: "raw_notes", text_content: "note one", status: "submitted", created_at: "2026-06-28T11:02:00Z" },
        { id: 14, deliverable_type: "raw_notes", text_content: "note two", status: "submitted", created_at: "2026-06-28T11:03:00Z" },
      ],
      caption_draft: [
        { id: 15, deliverable_type: "caption_draft", text_content: "unexpected but real", status: "submitted", created_at: "2026-06-28T11:04:00Z" },
      ],
    },
  };
}

const assignmentBase = {
  id: 44,
  latest_submission_id: 12,
};

const assetLookup = [
  { id: 101, file_name: "photo-1.jpg", public_url: "/media/photo-1.jpg" },
  { id: 102, file_name: "photo-2.jpg", public_url: "/media/photo-2.jpg" },
  { id: 103, file_name: "photo-3.jpg", public_url: "/media/photo-3.jpg" },
  { id: 104, file_name: "photo-4.jpg", public_url: "/media/photo-4.jpg" },
  { id: 105, file_name: "photo-5.jpg", public_url: "/media/photo-5.jpg" },
  { id: 201, file_name: "video-1.mp4", public_url: "/media/video-1.mp4" },
  { id: 202, file_name: "video-2.mp4", public_url: "/media/video-2.mp4" },
];

test("deliverables summary uses the same UI behavior across initial submit, revision requested, and resubmit states", () => {
  const bundle = createBundle();
  const states = ["submitted", "revision_requested", "resubmitted"];
  const results = states.map((stateValue) => {
    const harness = buildHarness({
      bundle,
      assignment: { ...assignmentBase, state: stateValue },
      latestSubmission: { id: 12, media_payload_json: { assets: [] } },
      assets: assetLookup,
    });
    harness.renderAssignmentDeliverablesSummary(bundle, { ...assignmentBase, state: stateValue });
    return {
      html: harness.summaryNode.innerHTML,
      meta: harness.metaNode.textContent,
    };
  });

  assert.equal(results[0].html, results[1].html);
  assert.equal(results[1].html, results[2].html);
  assert.equal(results[0].meta, results[1].meta);
  assert.equal(results[1].meta, results[2].meta);
});

test("deliverables summary labels counts as types, skips missing placeholders, and keeps text deliverables with real data", () => {
  const bundle = createBundle();
  const harness = buildHarness({
    bundle,
    assignment: { ...assignmentBase, state: "submitted" },
    latestSubmission: { id: 12, media_payload_json: { assets: [] } },
    assets: assetLookup,
  });

  harness.renderAssignmentDeliverablesSummary(bundle, { ...assignmentBase, state: "submitted" });

  assert.match(harness.metaNode.textContent, /ครบแล้ว 3 จาก 5 ประเภท/);
  assert.match(harness.metaNode.textContent, /ยังขาด 2 ประเภท/);
  assert.match(harness.summaryNode.innerHTML, /ครบแล้ว 3 จาก 5 ประเภท/);
  assert.match(harness.summaryNode.innerHTML, /ยังขาด 2 ประเภท/);
  assert.match(harness.summaryNode.innerHTML, /Observed queue near entrance/);
  assert.doesNotMatch(harness.summaryNode.innerHTML, /ยังไม่มี deliverable ประเภทนี้ในรอบส่งล่าสุด/);
  assert.equal((harness.summaryNode.innerHTML.match(/assignment-deliverable-row"/g) || []).length, 3);
});

test("deliverables summary shows true media counts instead of implying a single representative asset", () => {
  const bundle = createBundle();
  const harness = buildHarness({
    bundle,
    assignment: { ...assignmentBase, state: "submitted" },
    latestSubmission: { id: 12, media_payload_json: { assets: [] } },
    assets: assetLookup,
  });

  harness.renderAssignmentDeliverablesSummary(bundle, { ...assignmentBase, state: "submitted" });

  assert.match(harness.summaryNode.innerHTML, /ภาพถ่าย 5 รายการ/);
  assert.match(harness.summaryNode.innerHTML, /วิดีโอ 2 รายการ/);
  assert.doesNotMatch(harness.summaryNode.innerHTML, /photo-1\.jpg/);
  assert.doesNotMatch(harness.summaryNode.innerHTML, /video-1\.mp4/);
});

test("review media view still returns every actual file for asset-backed deliverables", () => {
  const bundle = createBundle();
  const latestSubmission = {
    id: 12,
    media_payload_json: {
      assets: assetLookup.map((asset) => ({
        id: asset.id,
        file_name: asset.file_name,
        public_url: asset.public_url,
        mime_type: String(asset.file_name).endsWith(".mp4") ? "video/mp4" : "image/jpeg",
      })),
    },
  };
  const harness = buildHarness({
    bundle,
    assignment: { ...assignmentBase, state: "resubmitted" },
    latestSubmission,
    assets: assetLookup,
  });

  const photos = harness.getAssignmentReviewMediaItems({ ...assignmentBase, state: "resubmitted" }, "photos");
  const videos = harness.getAssignmentReviewMediaItems({ ...assignmentBase, state: "resubmitted" }, "videos");

  assert.equal(photos.length, 5);
  assert.equal(videos.length, 2);
});

test("unexpected available type does not inflate fulfilled expected count", () => {
  const bundle = createBundleWithUnexpectedType();
  const harness = buildHarness({
    bundle,
    assignment: { ...assignmentBase, latest_submission_id: 19, state: "submitted" },
    latestSubmission: { id: 19, media_payload_json: { assets: [] } },
    assets: assetLookup,
  });

harness.renderAssignmentDeliverablesSummary(bundle, {
  ...assignmentBase,
  latest_submission_id: 19,
  state: "submitted",
});

assert.match(harness.metaNode.textContent, /ครบแล้ว 3 จาก 3 ประเภท/);
assert.doesNotMatch(harness.metaNode.textContent, /ครบแล้ว 4 จาก 3 ประเภท/);

assert.match(harness.summaryNode.innerHTML, /ครบแล้ว 3 จาก 3 ประเภท/);
assert.match(harness.summaryNode.innerHTML, /ร่างแคปชัน/);
assert.match(harness.summaryNode.innerHTML, /ยังขาด 0 ประเภท/);
assert.doesNotMatch(
  harness.summaryNode.innerHTML,
  /ยังขาด [1-9]\d* ประเภท/
);
});

test("unexpected type does not change missing chips or fulfilled expected chips", () => {
  const bundle = createBundleWithUnexpectedType();
  const harness = buildHarness({
    bundle,
    assignment: { ...assignmentBase, latest_submission_id: 19, state: "submitted" },
    latestSubmission: { id: 19, media_payload_json: { assets: [] } },
    assets: assetLookup,
  });

  harness.renderAssignmentDeliverablesSummary(bundle, { ...assignmentBase, latest_submission_id: 19, state: "submitted" });

  assert.match(harness.summaryNode.innerHTML, /<div class="assignment-brief-label">ครบแล้ว 3 จาก 3 ประเภท<\/div>/);
  assert.match(harness.summaryNode.innerHTML, /<span class="assignment-brief-chip">photos<\/span><span class="assignment-brief-chip">videos<\/span><span class="assignment-brief-chip">raw_notes<\/span>/);
  assert.doesNotMatch(harness.summaryNode.innerHTML, /<div class="assignment-brief-label">ครบแล้ว 3 จาก 3 ประเภท<\/div>[\s\S]*?<span class="assignment-brief-chip">caption_draft<\/span>/);
});

test("review-panel helper appears only for photos and videos when multiple media files exist", () => {
  const bundle = createBundle();
  const harness = buildHarness({
    bundle,
    assignment: { ...assignmentBase, state: "submitted" },
    latestSubmission: { id: 12, media_payload_json: { assets: [] } },
    assets: assetLookup,
  });

  harness.renderAssignmentDeliverablesSummary(bundle, { ...assignmentBase, state: "submitted" });

  assert.match(harness.summaryNode.innerHTML, /ภาพถ่าย 5 รายการ/);
  assert.match(harness.summaryNode.innerHTML, /วิดีโอ 2 รายการ/);
  assert.match(harness.summaryNode.innerHTML, /แสดงครบทุกไฟล์ใน review panel/);
});

test("text deliverables with multiple rows do not mention files or review panel", () => {
  const bundle = createBundleWithUnexpectedType();
  const harness = buildHarness({
    bundle,
    assignment: { ...assignmentBase, latest_submission_id: 19, state: "submitted" },
    latestSubmission: { id: 19, media_payload_json: { assets: [] } },
    assets: assetLookup,
  });

  harness.renderAssignmentDeliverablesSummary(bundle, { ...assignmentBase, latest_submission_id: 19, state: "submitted" });

  assert.match(harness.summaryNode.innerHTML, /บันทึกหน้างาน 2 รายการ/);
  assert.doesNotMatch(harness.summaryNode.innerHTML, /บันทึกหน้างาน 2 รายการ[\s\S]*แสดงครบทุกไฟล์ใน review panel/);
});


