import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const itemEditorJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "item-editor.js"), "utf8");
const itemEditorHtml = fs.readFileSync(path.join(collectorRoot, "server", "public", "item-editor.html"), "utf8");
const cleanItemHtml = fs.readFileSync(path.join(collectorRoot, "server", "public", "clean-item.html"), "utf8");

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const bodyStart = source.indexOf("{", start);
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

function loadNamedFunction(functionName, dependencies = {}) {
  const source = extractFunctionSource(itemEditorJs, functionName);
  const dependencyNames = Object.keys(dependencies);
  const dependencyValues = Object.values(dependencies);
  return Function(...dependencyNames, `return (${source});`)(...dependencyValues);
}

test("step 4 packaging requirements keep must-ask as soft warning", () => {
  assert.equal(
    itemEditorJs.includes('"fp-must-ask-questions"') && itemEditorJs.includes('"soft"'),
    true,
    "must-ask questions should remain a soft warning in step 4"
  );
});

test("step 4 packaging requirements keep references and field notes as soft warnings", () => {
  const requiredSnippets = [
    '"fp-references"',
    '"fp-field-notes"',
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `expected item-editor.js to include: ${snippet}`);
  }
});

test("step 4 readiness summary distinguishes hard blockers from soft warnings", () => {
  const requiredSnippets = [
    "const hardRequirements = requirements.filter",
    "const softRequirements = requirements.filter",
    "พร้อมส่งเข้า handoff ได้ แต่ยังมีข้อแนะนำ",
    "ข้อแนะนำเพิ่มเติม",
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `expected item-editor.js to include: ${snippet}`);
  }
});

test("step 4 renders section warnings for the primary preparation sections", () => {
  const requiredSnippets = [
    "function renderPackagingSectionWarnings(requirements)",
    '"fp-status"',
    '"fp-editor-summary"',
    '"fp-must-verify-facts"',
    '"fp-must-capture-shots"',
    '"fp-must-ask-questions"',
    '"fp-story-angle"',
    '"fp-media-hints-editor"',
    '"fp-references"',
    '"fp-field-notes"',
    'label.insertAdjacentElement("afterend", warning)',
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `expected item-editor.js to include: ${snippet}`);
  }
});

test("step 4 wording uses assignment language instead of legacy handoff wording", () => {
  const forbiddenSnippets = [
    "function getEditorHandoffGuard()",
  ];
  for (const snippet of forbiddenSnippets) {
    assert.equal(itemEditorJs.includes(snippet), false, `expected item-editor.js to drop legacy wording/snippet: ${snippet}`);
  }

  const requiredSnippets = [
    "function getEditorAssignmentGuard()",
    "ยังไม่พร้อมส่งเข้า handoff",
    "ต้องเติมก่อนส่งเข้า handoff",
    "พร้อมส่งเข้า handoff จากชุดลงหน้างานนี้",
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `expected item-editor.js to include: ${snippet}`);
  }
});

test("step 4 next button saves current work without silently promoting the workflow stage", () => {
  assert.equal(
    itemEditorJs.includes('await saveCurrentWork("generated");'),
    false,
    "step 4 next button should not promote workflow_status to generated as a side effect"
  );
  assert.equal(
    itemEditorJs.includes("await saveCurrentWork();"),
    true,
    "step 4 next button should still save current work before navigating"
  );
  assert.equal(
    itemEditorJs.includes('window.location.href = `/?tab=handoff&item_id=${state.itemId}`;'),
    true,
    "step 4 next button should now route into the dedicated handoff view"
  );
});

test("step 4 writer controls are explicitly marked as optional writer preparation", () => {
  const requiredSnippets = [
    "การเตรียมส่งต่อทีมเขียน",
    "ส่วนนี้ไม่บังคับในขั้นนี้",
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(itemEditorHtml.includes(snippet), true, `expected item-editor.html to include: ${snippet}`);
  }
});

test("step 4 prep state UI is reduced to prep-only states", () => {
  const requiredHtmlSnippets = [
    "สถานะการเตรียมมอบหมาย",
  ];
  for (const snippet of requiredHtmlSnippets) {
    assert.equal(itemEditorHtml.includes(snippet), true, `expected item-editor.html to include: ${snippet}`);
  }

  const requiredJsSnippets = [
    'help: "ใช้เมื่อ brief พร้อมแล้วและจบงานใน place step 4 พร้อมส่งต่อไป handoff"',
    'label: "พร้อมส่งเข้า handoff"',
    'label: "ตั้งเป็นพร้อมส่งเข้า handoff"',
    'label: "กลับไปยังจัด brief"',
    'ต้องเปลี่ยนสถานะการเตรียมมอบหมายเป็น \\"พร้อมส่งเข้า handoff\\"',
  ];
  for (const snippet of requiredJsSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `expected item-editor.js to include: ${snippet}`);
  }

  const forbiddenJsSnippets = [
    'label: "เริ่มลงหน้างาน"',
    'label: "ปิดงานภาคสนาม"',
    'label: "เปิดงานภาคสนามอีกครั้ง"',
    'label: "กลับเป็นพร้อมลงหน้างาน"',
    'label: "ตั้งเป็นพร้อมลงหน้างาน"',
    'return value === "ready_for_field" || value === "field_in_progress" || value === "field_done";',
  ];
  for (const snippet of forbiddenJsSnippets) {
    assert.equal(itemEditorJs.includes(snippet), false, `expected item-editor.js to drop prep-irrelevant step 4 snippet: ${snippet}`);
  }

  const readinessRequiredSnippets = [
    'return value === "ready_for_field" || value === "ready_for_handoff";',
    'ยังไปงานมอบหมายไม่ได้: ต้องเปลี่ยนสถานะการเตรียมมอบหมายเป็น \\"พร้อมส่งเข้า handoff\\" ก่อน',
  ];
  for (const snippet of readinessRequiredSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `expected item-editor.js to gate step 5 by prep-ready status: ${snippet}`);
  }

  assert.equal(
    itemEditorJs.includes('setStatus("กำลังบันทึกงานตรวจแก้และเข้าสู่กระบวนการส่งงานไปทำ...");'),
    true,
    "expected item-editor.js to announce the process-2 transition"
  );
  assert.equal(
    itemEditorJs.includes('setStatus(`ยังเข้าสู่กระบวนการส่งงานไปทำไม่ได้: ${err.message}`, true);'),
    true,
    "expected item-editor.js to keep process-2 error wording aligned"
  );
});

test("step 4 assignment navigation no longer depends on legacy workflow stage gating", () => {
  const guardMatch = itemEditorJs.match(/function getEditorAssignmentGuard\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(guardMatch, "getEditorAssignmentGuard should exist");
  const guardBody = guardMatch[1];

  const forbiddenSnippets = [
    "normalizeEditorWorkflowStage",
    'stage === "published"',
    'stage === "raw"',
  ];
  for (const snippet of forbiddenSnippets) {
    assert.equal(guardBody.includes(snippet), false, `step 4 assignment guard should drop legacy workflow-stage gate: ${snippet}`);
  }

  assert.equal(
    guardBody.includes('!isFieldPackReadyForAssignment(fieldPackStatus)'),
    true,
    "step 4 assignment guard should rely on prep-ready status as the primary gate"
  );
});

test("step 4 field-pack input changes refresh both action guards and guides", () => {
  const requiredSnippets = [
    "node.addEventListener(eventName, () => {",
    "applyEditorActionGuards();",
    "renderStepFourGuides();",
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `expected item-editor.js to refresh guards and guides on field-pack changes: ${snippet}`);
  }
});

test("step 4 shows a next-step panel with assignment handoff guidance", () => {
  const requiredHtmlSnippets = [
    'id="step4-next-panel"',
  ];
  for (const snippet of requiredHtmlSnippets) {
    assert.equal(itemEditorHtml.includes(snippet), true, `expected item-editor.html to include: ${snippet}`);
  }

  const requiredJsSnippets = [
    "function renderStepFourNextPanel()",
    "function getStepFourLatestAssignment(",
    "function formatStepFourAssignmentState(",
    "ชุดงานนี้พร้อมส่งเข้า handoff แล้ว แต่ยังไม่ได้สร้างงานมอบหมาย",
    "สร้างงานมอบหมายแล้ว และติดตามงานต่อได้ในขั้นงานมอบหมาย",
    "งานนี้ยังอยู่ระหว่างจัด brief และยังไม่พร้อมส่งเข้า handoff",
    "โหลดข้อมูลงานมอบหมายไม่สำเร็จ จึงยังยืนยันสถานะงานต่อจากขั้นนี้ไม่ได้",
    "มีงานมอบหมายอยู่ในรายการนี้แล้ว แต่ยังไม่ได้ผูกกับชุดงานนี้",
    'actionLabel = "ไปงานมอบหมาย";',
    'actionLabel = "ดูงานมอบหมาย";',
    'qs("btn-next-export")?.click();',
    "state.itemAssignmentsLoadFailed = true;",
    "return null;",
    "latestAssignment?.assignee_display_name",
    "latestAssignment?.assignee_email",
    "user #${Number(latestAssignment.assignee_user_id)}",
  ];
  for (const snippet of requiredJsSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `expected item-editor.js to include: ${snippet}`);
  }

  const forbiddenJsSnippets = [
    "return rows[0] || null;",
  ];
  for (const snippet of forbiddenJsSnippets) {
    assert.equal(itemEditorJs.includes(snippet), false, `expected item-editor.js to avoid stale next-step panel fallback: ${snippet}`);
  }
});

test("internal asset media hints clear payload urls while external hints keep theirs", () => {
  const normalizeMediaHintPayloadUrl = loadNamedFunction("normalizeMediaHintPayloadUrl");

  assert.equal(
    normalizeMediaHintPayloadUrl("/media/items/42/photo.jpg", 17),
    null,
    "internal asset-backed media hints should not send relative URLs back to the API"
  );
  assert.equal(
    normalizeMediaHintPayloadUrl("https://example.com/photo.jpg", 17),
    null,
    "internal asset-backed media hints should rely on content_asset_id instead of URL"
  );
  assert.equal(
    normalizeMediaHintPayloadUrl("https://example.com/photo.jpg", null),
    "https://example.com/photo.jpg",
    "external media hints should preserve their explicit URLs"
  );
});

test("preserveMediaHints strips stale urls from internal asset rows", () => {
  const normalizeMediaHintPayloadUrl = loadNamedFunction("normalizeMediaHintPayloadUrl");
  const preserveMediaHints = loadNamedFunction("preserveMediaHints", { normalizeMediaHintPayloadUrl });

  const rows = preserveMediaHints(
    [
      {
        content_asset_id: 91,
        url: "/media/items/42/stale.jpg",
        kind: "gallery",
        caption: "stale",
        selected: true,
        item_order: 0,
      },
    ],
    [
      {
        content_asset_id: 17,
        url: "/media/items/42/selected-stale.jpg",
        kind: "cover",
        caption: "selected stale",
        selected: true,
      },
    ],
    [
      {
        content_asset_id: null,
        url: "https://cdn.example.com/reference.jpg",
        kind: "reference",
        caption: "external",
        selected: true,
      },
      {
        content_asset_id: 44,
        url: "https://cdn.example.com/mistaken-asset.jpg",
        kind: "reference",
        caption: "mistaken asset id",
        selected: true,
      },
    ],
    [],
    [91]
  );

  assert.deepEqual(rows, [
    {
      content_asset_id: 17,
      url: null,
      kind: "cover",
      caption: "selected stale",
      selected: true,
      item_order: 0,
    },
    {
      content_asset_id: null,
      url: "https://cdn.example.com/reference.jpg",
      kind: "reference",
      caption: "external",
      selected: true,
      item_order: 1,
    },
    {
      content_asset_id: null,
      url: "https://cdn.example.com/mistaken-asset.jpg",
      kind: "reference",
      caption: "mistaken asset id",
      selected: true,
      item_order: 2,
    },
    {
      content_asset_id: 91,
      url: null,
      kind: "gallery",
      caption: "stale",
      selected: true,
      item_order: 0,
    },
  ]);
});

test("hover preview caches failed external images and falls back silently", () => {
  const requiredSnippets = [
    "const failedHoverPreviewUrls = new Set();",
    "failedHoverPreviewUrls.has(safeUrl)",
    "failedHoverPreviewUrls.add(safeUrl);",
    "data-role=\"placeholder\"",
    "hideAssetHoverPreview();",
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `expected item-editor.js to include silent hover preview fallback snippet: ${snippet}`);
  }
});

test("clean asset table uses AI reference wording and removes cover action", () => {
  const requiredSnippets = [
    'selected ? "ไม่ส่งให้ AI" : "ส่งให้ AI ดู"',
    '"ส่งให้ AI"',
    '"reference-only"',
    'Number(row.selected_in_clean || 0) === 1',
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `expected clean asset workflow snippet in item-editor.js: ${snippet}`);
  }

  const forbiddenSnippets = [
    'data-action="set-cover"',
    'if (action === "set-cover")',
    'qs("e-image").value = url;',
  ];
  for (const snippet of forbiddenSnippets) {
    assert.equal(itemEditorJs.includes(snippet), false, `expected clean asset workflow to drop legacy cover snippet: ${snippet}`);
  }
});

test("clean page copy explains AI reference-only image usage", () => {
  const requiredSnippet = "ขั้นนี้เลือกรูปเพื่อให้ AI/Field Pack ใช้เป็นภาพอ้างอิงเท่านั้น รูปปกสำหรับเผยแพร่ให้เลือกใหม่ใน Article Workspace หรือขั้น Publish จากไฟล์ local/backend-controlled media";
  assert.equal(cleanItemHtml.includes(requiredSnippet), true, "clean-item.html should explain reference-only media policy");
});
