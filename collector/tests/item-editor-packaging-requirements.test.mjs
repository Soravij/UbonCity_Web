import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
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

function extractAsyncFunctionSource(source, functionName) {
  const asyncMarker = `async function ${functionName}`;
  const marker = source.includes(asyncMarker) ? asyncMarker : `function ${functionName}`;
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

function loadNamedAsyncFunction(functionName, dependencies = {}) {
  const source = extractAsyncFunctionSource(itemEditorJs, functionName);
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
    'const LEGACY_READY_FOR_HANDOFF_STATUS = "ready_for_handoff";',
    'return value === "ready_for_field" || value === LEGACY_READY_FOR_HANDOFF_STATUS;',
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

test("clean reference media table uses dedicated reference-media routes", () => {
  const renderAssetsTableSource = extractFunctionSource(itemEditorJs, "renderAssetsTable");
  const refreshAssetsSource = extractFunctionSource(itemEditorJs, "refreshAssets");

  assert.equal(renderAssetsTableSource.includes('/reference-media/${encodeURIComponent(referenceMediaId)}/selected'), true);
  assert.equal(renderAssetsTableSource.includes('/assets/${id}/selected'), true, "non-clean asset selection path should still exist");
  assert.equal(renderAssetsTableSource.includes('data-action="set-cover"'), false);
  assert.equal(renderAssetsTableSource.includes("ตั้งเป็นภาพปก"), false);
  assert.equal(refreshAssetsSource.includes("api(`/api/items/${state.itemId}/reference-media`)"), true);
});

test("clean reference badges use workflow badge pattern and always mark reference-only", () => {
  const renderAssetBadgesSource = extractFunctionSource(itemEditorJs, "renderAssetBadges");
  assert.equal(itemEditorJs.includes("workflow-badge workflow-badge-sent"), true);
  assert.equal(itemEditorJs.includes("ส่งให้ Agent"), true);
  assert.equal(itemEditorJs.includes("ยังไม่ถูกเลือกส่งให้ Agent"), true);
  assert.equal(itemEditorJs.includes("ภาพอ้างอิงเท่านั้น"), true);
  assert.equal(itemEditorJs.includes("roleDisplayLabel(role)"), true, "non-clean role badges should still exist");
});

test("clean page source removes cover UI and cover role selector", () => {
  const forbiddenSnippets = [
    "<label>รูปปก</label>",
    "<label>ลิงก์รูปปก</label>",
    'option value="cover"',
  ];
  for (const snippet of forbiddenSnippets) {
    assert.equal(cleanItemHtml.includes(snippet), false, `expected clean-item.html to drop: ${snippet}`);
  }

  const requiredSnippets = [
    "รูปอ้างอิงสำหรับ AI / Field Pack",
    "สถานะ Agent",
    'id="asset-role" type="hidden" value="gallery"',
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(cleanItemHtml.includes(snippet), true, `expected clean-item.html to include: ${snippet}`);
  }
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
    [],
    [],
    [],
    [91]
  );

  assert.deepEqual(rows, [
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

test("clean-item.html has ai-reference-count-hint element", () => {
  assert.match(cleanItemHtml, /id="ai-reference-count-hint"/);
});

test("item-editor.js includes renderAiReferenceCountHint function", () => {
  assert.match(itemEditorJs, /function renderAiReferenceCountHint\(\)/);
});

test("item-editor.js calls renderAiReferenceCountHint after refreshAssets in clean mode", () => {
  const refreshAssetsSource = extractFunctionSource(itemEditorJs, "refreshAssets");
  assert.match(refreshAssetsSource, /renderAiReferenceCountHint\(\)/);
});

test("item-editor.js stores maxReferenceMediaForAi from workflow API response", () => {
  assert.match(itemEditorJs, /state\.maxReferenceMediaForAi = Number\(workflowData\?\.max_reference_media_for_ai/);
});

// --- editor action guards must not go stale after the field pack finishes loading/saving ---
//
// Runtime-confirmed bug: applyEditorActionGuards() read fp-status while the field pack was still
// loading, before fillFieldPackForm() had written the real status into the DOM. Once loaded, nothing
// re-ran the guard, so btn-next-export stayed disabled forever even though the field pack was really
// ready_for_field. These tests execute the real extracted async functions (not just string-match the
// source) to prove the guard now observes the field pack state *after* it actually lands, in the real
// async order, not the state that existed before the load/save started.

test("loadCurrentFieldPack re-applies action guards only after the form reflects the freshly loaded field pack", async () => {
  const callOrder = [];
  let formStatus = "draft";
  let formStatusWhenGuardsRan = null;
  const state = { itemId: 14, fieldPack: null };

  const api = async () => {
    callOrder.push("api:start");
    await new Promise((resolve) => setTimeout(resolve, 5));
    callOrder.push("api:resolve");
    return { field_pack: { id: 14, status: "ready_for_field" } };
  };
  const fillFieldPackForm = (pack) => {
    callOrder.push("fillFieldPackForm");
    formStatus = String(pack?.status || "draft");
  };
  const applyEditorActionGuards = () => {
    callOrder.push("applyEditorActionGuards");
    formStatusWhenGuardsRan = formStatus;
  };

  const loadCurrentFieldPack = loadNamedAsyncFunction("loadCurrentFieldPack", {
    isCleanMode: false,
    api,
    state,
    fillFieldPackForm,
    applyEditorActionGuards,
  });

  await loadCurrentFieldPack();

  assert.deepEqual(
    callOrder,
    ["api:start", "api:resolve", "fillFieldPackForm", "applyEditorActionGuards"],
    "guards must be re-applied after the field pack request resolves and the form is filled, not before"
  );
  assert.equal(
    formStatusWhenGuardsRan,
    "ready_for_field",
    "applyEditorActionGuards must see the just-loaded field pack status, not the stale pre-load form state"
  );
});

test("saveCurrentWork refills the field-pack form before re-applying action guards (closes the save-button load race debt)", async () => {
  const callOrder = [];
  let formStatus = "draft";
  let formStatusWhenGuardsRan = null;
  const state = { itemId: 14, item: {}, fieldPack: { status: "draft" } };

  const api = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { item: {}, field_pack: { status: "ready_for_field" } };
  };
  const fillFieldPackForm = (pack) => {
    callOrder.push("fillFieldPackForm");
    formStatus = String(pack?.status || "draft");
  };
  const applyEditorActionGuards = () => {
    callOrder.push("applyEditorActionGuards");
    formStatusWhenGuardsRan = formStatus;
  };

  const saveCurrentWork = loadNamedAsyncFunction("saveCurrentWork", {
    getEditPermissionGuard: () => ({ allowed: true, reason: "" }),
    isCleanMode: false,
    buildEditorWorkPayload: () => ({ item: {} }),
    api,
    state,
    fillFieldPackForm,
    applyEditorActionGuards,
    renderStepFourGuides: () => callOrder.push("renderStepFourGuides"),
  });

  await saveCurrentWork();

  assert.deepEqual(
    callOrder,
    ["fillFieldPackForm", "applyEditorActionGuards", "renderStepFourGuides"],
    "saveCurrentWork must refill the field-pack form before re-applying guards, not after"
  );
  assert.equal(
    formStatusWhenGuardsRan,
    "ready_for_field",
    "guards must be evaluated against the field pack status returned by the save, not the pre-save status"
  );
});

// --- the step4-next-panel proxy button must never be enabled while its real target is disabled ---

function makeRenderStepFourNextPanelDeps(overrides = {}) {
  let capturedHtml = "";
  const rootNode = {
    set innerHTML(html) {
      capturedHtml = html;
    },
    get innerHTML() {
      return capturedHtml;
    },
    querySelector() {
      return undefined;
    },
  };
  const deps = {
    qs: (id) => (id === "step4-next-panel" ? rootNode : null),
    isCleanMode: false,
    readFieldPackFormState: () => ({ status: "ready_for_field", assignments: [], field_assignment: {} }),
    isFieldPackReadyForAssignment: (status) => status === "ready_for_field",
    state: { itemAssignmentsLoadFailed: false, itemAssignments: [] },
    getStepFourLatestAssignment: () => null,
    formatStepFourAssignmentState: (value) => value,
    getFieldProgressStatusLabel: (value) => value,
    escapeHtml: (value) => String(value ?? ""),
    getEditPermissionGuard: () => ({ allowed: true, reason: "" }),
    getEditorAssignmentGuard: () => ({ allowed: true, reason: "" }),
    ...overrides,
  };
  return { deps, getHtml: () => capturedHtml };
}

test("step4-next-panel proxy button is disabled and explains why when the real assignment guard disallows advancing", () => {
  const { deps, getHtml } = makeRenderStepFourNextPanelDeps({
    getEditorAssignmentGuard: () => ({
      allowed: false,
      reason: "ยังส่งมอบงานไม่ได้: ต้องส่งต่อบทความไปขั้น \"ส่งต่อ handoff\" ก่อน",
    }),
  });
  const renderStepFourNextPanel = loadNamedFunction("renderStepFourNextPanel", deps);

  renderStepFourNextPanel();
  const html = getHtml();

  const buttonTag = html.match(/<button[^>]*id="btn-step4-next-panel"[^>]*>/);
  assert.ok(buttonTag, "expected the step4-next-panel action button to render");
  assert.match(
    buttonTag[0],
    /\bdisabled\b/,
    "proxy button must be disabled whenever the real btn-next-export guard would disallow the click"
  );
  assert.match(html, /ยังส่งมอบงานไม่ได้/, "panel should surface the guard's blocked reason instead of failing silently");
});

test("step4-next-panel proxy button is disabled when the base edit-permission guard disallows advancing", () => {
  const { deps, getHtml } = makeRenderStepFourNextPanelDeps({
    getEditPermissionGuard: () => ({ allowed: false, reason: "รายการนี้ถูก claim โดยผู้ใช้อื่นอยู่" }),
  });
  const renderStepFourNextPanel = loadNamedFunction("renderStepFourNextPanel", deps);

  renderStepFourNextPanel();
  const html = getHtml();

  const buttonTag = html.match(/<button[^>]*id="btn-step4-next-panel"[^>]*>/);
  assert.ok(buttonTag);
  assert.match(buttonTag[0], /\bdisabled\b/);
});

test("step4-next-panel proxy button stays enabled only when both action guards allow advancing", () => {
  const { deps, getHtml } = makeRenderStepFourNextPanelDeps();
  const renderStepFourNextPanel = loadNamedFunction("renderStepFourNextPanel", deps);

  renderStepFourNextPanel();
  const html = getHtml();

  const buttonTag = html.match(/<button[^>]*id="btn-step4-next-panel"[^>]*>/);
  assert.ok(buttonTag);
  assert.doesNotMatch(buttonTag[0], /\bdisabled\b/, "proxy button should be enabled when both guards allow advancing");
});

test("step4-next-panel proxy click handler refuses to forward the click when the real target is disabled", () => {
  const source = extractFunctionSource(itemEditorJs, "renderStepFourNextPanel");
  assert.match(
    source,
    /root\.querySelector\("#btn-step4-next-panel"\)\?\.addEventListener\("click", \(\) => \{\s*if \(qs\("btn-next-export"\)\?\.disabled\) return;/,
    "click handler should bail out before forwarding to btn-next-export when it is disabled"
  );
});
