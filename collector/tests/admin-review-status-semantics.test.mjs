import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function extractFunctionBlock(source, name) {
  const signature = `function ${name}`;
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let open = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "(") parenDepth += 1;
    if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        open = source.indexOf("{", i);
        break;
      }
    }
  }
  if (open < 0) throw new Error(`Missing function body: ${name}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function block: ${name}`);
}

function loadArticleIntakeRuntime(options = {}) {
  const source = read("server/public/article-intake.js");
  const context = {
    ARTICLE_FLOW_STATUSES: ["content_in_progress", "needs_revision", "in_review", "approved", "unpublished", "published", "submitted_for_admin_review"],
    ASSIGNMENT_REQUIRED_STATUSES: ["content_in_progress", "needs_revision"],
    state: {
      user: { role: options.role || "editor", id: 7 },
      items: options.items || [],
      processByItemId: options.processByItemId || {},
      editorAssignmentByItemId: options.editorAssignmentByItemId || {},
      itemId: 0,
      scope: options.scope || "place",
    },
    currentRole() {
      return String(context.state.user?.role || "").trim().toLowerCase();
    },
    console,
  };
  const helperSource = `
${extractFunctionBlock(source, "normalizedValue")}
${extractFunctionBlock(source, "isEditorUser")}
${extractFunctionBlock(source, "processForItem")}
${extractFunctionBlock(source, "articleProcessStatusForItem")}
${extractFunctionBlock(source, "isAdminReviewLockedStatus")}
${extractFunctionBlock(source, "isLockedQueueGroup")}
${extractFunctionBlock(source, "derivedArticleWorkflowStatus")}
${extractFunctionBlock(source, "isArticleQueueCandidate")}
${extractFunctionBlock(source, "needsProcessPrefetch")}
${extractFunctionBlock(source, "hasAssignedWriter")}
${extractFunctionBlock(source, "primaryAssignmentForItem")}
${extractFunctionBlock(source, "queueStageMeta")}
${extractFunctionBlock(source, "queueRows")}
${extractFunctionBlock(source, "queueGroupKey")}
${extractFunctionBlock(source, "isEventItem")}
${extractFunctionBlock(source, "isPlaceItem")}
${extractFunctionBlock(source, "workspaceUrl")}
${extractFunctionBlock(source, "reviewUrl")}
${extractFunctionBlock(source, "eventWorkspaceUrl")}
${extractFunctionBlock(source, "eventReviewUrl")}
${extractFunctionBlock(source, "lockedInspectionUrl")}
${extractFunctionBlock(source, "primaryEntryUrl")}
${extractFunctionBlock(source, "queueActionMeta")}
globalThis.__articleIntakeHooks = {
  articleProcessStatusForItem,
  derivedArticleWorkflowStatus,
  isArticleQueueCandidate,
  queueGroupKey,
  queueStageMeta,
  queueRows,
  primaryEntryUrl,
  queueActionMeta,
  lockedInspectionUrl,
};
`;
  context.globalThis = context;
  vm.runInNewContext(helperSource, context, { filename: "article-intake-runtime.js" });
  return context.__articleIntakeHooks;
}

test("article submit locks collector actions after admin-review handoff", () => {
  const source = read("server/public/article-submit-page.js");
  assert.match(source, /function isCollectorLockedAfterAdminReview\(status = getArticleStatus\(\)\)/);
  assert.match(source, /if \(isCollectorLockedAfterAdminReview\(\)\) throw new Error\(lockedCollectorWorkflowMessage\(\)\);/);
  assert.match(source, /if \(isCollectorLockedAfterAdminReview\(\)\) throw new Error\(lockedTranslationMessage\(\)\);/);
  assert.match(source, /ส่งเข้า Admin Review แล้ว - รอการจัดการต่อใน Admin Panel/);
});

test("submitted article routes editors to locked inspection instead of workspace", () => {
  const hooks = loadArticleIntakeRuntime({
    role: "editor",
    processByItemId: {
      51: { status: "submitted_for_admin_review" },
    },
  });
  const url = hooks.primaryEntryUrl({ id: 51, type: "place", title: "Locked article" });
  assert.equal(url, "/article-submit.html?id=51");
  assert.doesNotMatch(url, /article-workspace\.html/);
  assert.doesNotMatch(url, /editor-home\.html/);
});

test("submitted event routes editors to locked inspection instead of workspace", () => {
  const hooks = loadArticleIntakeRuntime({
    role: "editor",
    processByItemId: {
      77: { status: "submitted_for_admin_review" },
    },
  });
  const url = hooks.primaryEntryUrl({ id: 77, type: "event", title: "Locked event" });
  assert.equal(url, "/event-submit.html?id=77");
  assert.doesNotMatch(url, /event-workspace\.html/);
});

test("synced article routes editors to locked inspection instead of workspace", () => {
  const hooks = loadArticleIntakeRuntime({
    role: "editor",
    processByItemId: {
      52: { status: "synced_to_admin" },
    },
  });
  const url = hooks.primaryEntryUrl({ id: 52, type: "place", title: "Published article" });
  assert.equal(url, "/article-submit.html?id=52");
  assert.doesNotMatch(url, /article-workspace\.html/);
  assert.doesNotMatch(url, /editor-home\.html/);
});

test("synced event routes editors to locked inspection instead of workspace", () => {
  const hooks = loadArticleIntakeRuntime({
    role: "editor",
    processByItemId: {
      78: { status: "synced_to_admin" },
    },
  });
  const url = hooks.primaryEntryUrl({ id: 78, type: "event", title: "Published event" });
  assert.equal(url, "/event-submit.html?id=78");
  assert.doesNotMatch(url, /event-workspace\.html/);
});

test("submitted status derivation is preserved and not collapsed to approved", () => {
  const hooks = loadArticleIntakeRuntime({
    processByItemId: {
      91: { status: "submitted_for_admin_review" },
    },
  });
  assert.equal(hooks.articleProcessStatusForItem({ id: 91, type: "place" }), "submitted_for_admin_review");
  assert.equal(hooks.derivedArticleWorkflowStatus({ id: 91, type: "place" }), "submitted_for_admin_review");
});

test("submitted items are not grouped as normal review workflow", () => {
  const hooks = loadArticleIntakeRuntime({
    role: "editor",
    processByItemId: {
      63: { status: "submitted_for_admin_review" },
    },
  });
  const item = { id: 63, type: "place", title: "Locked article" };
  assert.equal(hooks.queueGroupKey(item), "admin_review");
  assert.match(hooks.queueStageMeta(item).stageLabel, /Admin Review/);
  assert.match(hooks.queueActionMeta(item).label, /Admin Review/);
});

test("submitted items remain visible in queue without accepted assignment", () => {
  const item = { id: 66, type: "place", title: "Waiting admin review", assignment_state: "" };
  const hooks = loadArticleIntakeRuntime({
    role: "editor",
    items: [item],
    processByItemId: {
      66: { status: "submitted_for_admin_review" },
    },
    editorAssignmentByItemId: {},
  });
  assert.equal(hooks.isArticleQueueCandidate(item), true);
  const rows = hooks.queueRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 66);
  assert.equal(hooks.queueGroupKey(item), "admin_review");
  assert.equal(hooks.primaryEntryUrl(item), "/article-submit.html?id=66");
  assert.doesNotMatch(hooks.primaryEntryUrl(item), /article-workspace\.html|editor-home\.html/);
});

test("submitted items remain visible in queue for admin role too", () => {
  const item = { id: 166, type: "place", title: "Waiting admin review", assignment_state: "" };
  const hooks = loadArticleIntakeRuntime({
    role: "admin",
    items: [item],
    processByItemId: {
      166: { status: "submitted_for_admin_review" },
    },
  });
  assert.equal(hooks.isArticleQueueCandidate(item), true);
  const rows = hooks.queueRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 166);
  assert.equal(hooks.queueGroupKey(item), "admin_review");
  assert.equal(hooks.primaryEntryUrl(item), "/article-submit.html?id=166");
});

test("synced items are treated as done and not review workflow", () => {
  const hooks = loadArticleIntakeRuntime({
    role: "editor",
    processByItemId: {
      64: { status: "synced_to_admin" },
    },
  });
  const item = { id: 64, type: "place", title: "Published article" };
  assert.equal(hooks.derivedArticleWorkflowStatus(item), "published");
  assert.equal(hooks.queueGroupKey(item), "done");
  assert.doesNotMatch(hooks.queueStageMeta(item).stageLabel, /ตรวจและอนุมัติ/);
  assert.match(hooks.queueStageMeta(item).stageLabel, /เผยแพร่แล้ว|เสร็จสิ้น/);
  assert.doesNotMatch(hooks.queueActionMeta(item).label, /ตรวจ|เขียน/);
  assert.match(hooks.queueActionMeta(item).label, /ดูสถานะ|ดูข้อมูล/);
});

test("synced items remain visible in queue and stay in done group", () => {
  const item = { id: 67, type: "place", title: "Published article", assignment_state: "" };
  const hooks = loadArticleIntakeRuntime({
    role: "editor",
    items: [item],
    processByItemId: {
      67: { status: "synced_to_admin" },
    },
    editorAssignmentByItemId: {},
  });
  assert.equal(hooks.isArticleQueueCandidate(item), true);
  const rows = hooks.queueRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 67);
  assert.equal(hooks.queueGroupKey(item), "done");
  assert.equal(hooks.primaryEntryUrl(item), "/article-submit.html?id=67");
  assert.doesNotMatch(hooks.primaryEntryUrl(item), /article-workspace\.html|editor-home\.html/);
});

test("published fallback state is treated as done and locked", () => {
  const item = { id: 65, type: "event", publication_state: "published", title: "Published event", assignment_state: "" };
  const hooks = loadArticleIntakeRuntime({
    role: "editor",
    items: [item],
    processByItemId: {},
    scope: "event",
    editorAssignmentByItemId: {},
  });
  assert.equal(hooks.derivedArticleWorkflowStatus(item), "published");
  assert.equal(hooks.isArticleQueueCandidate(item), true);
  assert.equal(hooks.queueRows().length, 1);
  assert.equal(hooks.queueGroupKey(item), "done");
  assert.equal(hooks.primaryEntryUrl(item), "/event-submit.html?id=65");
  assert.doesNotMatch(hooks.primaryEntryUrl(item), /event-workspace\.html/);
});

test("normal active editor rows still respect assignment scoping", () => {
  const item = { id: 68, type: "place", title: "Review item", assignment_state: "" };
  const hooks = loadArticleIntakeRuntime({
    role: "editor",
    items: [item],
    processByItemId: {
      68: { status: "ready_for_review" },
    },
    editorAssignmentByItemId: {},
  });
  assert.equal(hooks.isArticleQueueCandidate(item), true);
  assert.equal(hooks.queueRows().length, 0);
});

test("normal ready-for-review and ready-for-sync routing still works", () => {
  const editorHooks = loadArticleIntakeRuntime({
    role: "editor",
    processByItemId: {
      10: { status: "ready_for_review" },
      11: { status: "ready_for_sync" },
    },
  });
  assert.equal(editorHooks.primaryEntryUrl({ id: 10, type: "place" }), "/article-workspace.html?id=10");
  assert.equal(editorHooks.primaryEntryUrl({ id: 11, type: "event" }), "/event-workspace.html?id=11");

  const reviewerHooks = loadArticleIntakeRuntime({
    role: "admin",
    processByItemId: {
      10: { status: "ready_for_review" },
      11: { status: "ready_for_sync" },
    },
  });
  assert.equal(reviewerHooks.primaryEntryUrl({ id: 10, type: "place" }), "/article-submit.html?id=10");
  assert.equal(reviewerHooks.primaryEntryUrl({ id: 11, type: "event" }), "/event-submit.html?id=11");
});

test("event submit locks collector actions after admin-review handoff", () => {
  const source = read("server/public/event-submit-page.js");
  assert.match(source, /function isCollectorLockedAfterAdminReview\(status = getArticleStatus\(\)\)/);
  assert.match(source, /if \(isCollectorLockedAfterAdminReview\(\)\) throw new Error\(lockedCollectorWorkflowMessage\(\)\);/);
  assert.match(source, /if \(isCollectorLockedAfterAdminReview\(\)\) throw new Error\(lockedTranslationMessage\(\)\);/);
  assert.match(source, /ส่งเข้า Admin Review แล้ว - รอการจัดการต่อใน Admin Panel/);
});
