import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const source = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (!depth) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed function ${name}`);
}

function extractRouteBody(route) {
  const start = source.indexOf(`app.post("${route}"`);
  if (start < 0) throw new Error(`missing route ${route}`);
  const arrow = source.indexOf("=> {", start);
  const open = source.indexOf("{", arrow);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (!depth) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unclosed route ${route}`);
}

function makeResponse() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function makeHandlers({ repo, fetchImpl }) {
  const context = {
    repo,
    fetch: fetchImpl,
    URLSearchParams,
    Date,
    console,
    backendApiBase: "https://backend.test.local",
    webReviewSyncToken: "test-token",
    hasConfiguredWebReviewToken: () => true,
    isValidWebReviewSyncToken: (value) => value === "test-token",
    isPlaceholderSecret: () => false,
    ensureItemMutationAccess: () => true,
    rejectUnknownWorkflowModelState: () => false,
    buildArticleProcessPayload: (_req, item) => ({ item_id: item.id, workflow_model: repo.ensureWorkflowModel(item.id) }),
  };
  context.globalThis = context;
  const compiled = `
${extractFunction("applyPublishedWebReviewFeedback")}
async function feedback(req, res) {${extractRouteBody("/api/web-review-feedback")}}
async function pull(req, res) {${extractRouteBody("/api/items/:id/pull-web-publication-status")}}
globalThis.handlers = { feedback, pull };
`;
  vm.runInNewContext(compiled, context, { filename: "publish-sync-routes.js" });
  return context.handlers;
}

function createContext() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-publish-sync-"));
  const db = openDatabase(path.join(dir, "test.sqlite"), path.join(root, "database", "schema.sql"));
  const repo = createRepository(db);
  const create = (type) => {
    const item = repo.createItemWithWorkflowHead({ type, category: type === "place" ? "attractions" : "event", title: `${type} publish`, description_raw: "body", source_type: "manual", source_name: "test" }).item;
    db.prepare("UPDATE content_workflow_models SET production_state='submitted_for_admin_review', publication_state='approved' WHERE content_item_id=?").run(item.id);
    return repo.getItem(item.id);
  };
  return { dir, db, repo, create, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function transitions(db, id) {
  return db.prepare("SELECT state_group, from_state, to_state FROM content_workflow_transitions WHERE content_item_id=? ORDER BY id").all(id);
}

test("published feedback transitions place and event once, rejects unsupported status, and is idempotent", () => {
  const ctx = createContext();
  try {
    const { feedback } = makeHandlers({ repo: ctx.repo, fetchImpl: async () => { throw new Error("not used"); } });
    for (const type of ["place", "event"]) {
      const item = ctx.create(type);
      const before = transitions(ctx.db, item.id).length;
      for (let call = 0; call < 3; call += 1) {
        const res = makeResponse();
        feedback({ headers: { "x-review-sync-token": "test-token" }, body: { source_system: "collector-app", source_content_item_id: item.id, content_type: type, status: "published", review_note: "web published" } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.applied, call === 0);
      }
      const model = ctx.repo.ensureWorkflowModel(item.id);
      assert.equal(model.production_state, "completed");
      assert.equal(model.publication_state, "published");
      const added = transitions(ctx.db, item.id).slice(before);
      assert.equal(added.length, 2);
      assert.deepEqual(added.map((row) => [row.state_group, row.to_state]), [["production", "completed"], ["publication", "published"]]);
    }
    const res = makeResponse();
    feedback({ headers: { "x-review-sync-token": "test-token" }, body: { source_system: "collector-app", source_content_item_id: 1, content_type: "place", status: "other" } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /needs_revision or published/);
  } finally { ctx.close(); }
});

test("pull uses the same published transition, is idempotent, and reports backend outcomes without mutation", async () => {
  const ctx = createContext();
  try {
    const item = ctx.create("place");
    let reply = { ok: true, status: 200, json: async () => ({ item: { status: "published", published_at: "2026-07-01T00:00:00.000Z" } }) };
    const calls = [];
    const { pull } = makeHandlers({ repo: ctx.repo, fetchImpl: async (...args) => { calls.push(args); return reply; } });
    const first = makeResponse();
    await pull({ params: { id: String(item.id) } }, first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.status, "published");
    assert.equal(first.body.applied, true);
    const afterPushEquivalent = { ...ctx.repo.ensureWorkflowModel(item.id) };
    const transitionCount = transitions(ctx.db, item.id).length;
    const second = makeResponse();
    await pull({ params: { id: String(item.id) } }, second);
    assert.equal(second.body.applied, false);
    assert.deepEqual(ctx.repo.ensureWorkflowModel(item.id), afterPushEquivalent);
    assert.equal(transitions(ctx.db, item.id).length, transitionCount);
    assert.equal(calls.length, 2);

    const notPublishedItem = ctx.create("event");
    const notPublishedTransitions = transitions(ctx.db, notPublishedItem.id).length;
    reply = { ok: true, status: 200, json: async () => ({ item: { status: "pending_review" } }) };
    const pending = makeResponse();
    await pull({ params: { id: String(notPublishedItem.id) } }, pending);
    assert.equal(pending.body.ok, true);
    assert.equal(pending.body.item_id, notPublishedItem.id);
    assert.equal(pending.body.status, "pending_review");
    assert.equal(pending.body.applied, false);
    assert.equal(transitions(ctx.db, notPublishedItem.id).length, notPublishedTransitions);

    reply = { ok: false, status: 503, json: async () => ({ error: "backend unavailable" }) };
    const unavailable = makeResponse();
    await pull({ params: { id: String(notPublishedItem.id) } }, unavailable);
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.body.error, "backend unavailable");
    assert.equal(transitions(ctx.db, notPublishedItem.id).length, notPublishedTransitions);

    const throwing = makeHandlers({ repo: ctx.repo, fetchImpl: async () => { throw new Error("ECONNREFUSED"); } }).pull;
    const refused = makeResponse();
    await throwing({ params: { id: String(notPublishedItem.id) } }, refused);
    assert.equal(refused.statusCode, 502);
    assert.match(refused.body.error, /ECONNREFUSED/);
  } finally { ctx.close(); }
});

test("route registrations keep push and pull reachable", () => {
  assert.match(source, /app\.post\("\/api\/web-review-feedback"/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/pull-web-publication-status"/);
});
