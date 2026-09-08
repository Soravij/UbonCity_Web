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

const TEST_PREFIX = "__test-mutation-access-";

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

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function buildAccessChecker(repo) {
  const ALLOWED_USER_ROLES = new Set(["owner", "admin", "editor", "user", "freelance"]);

  function normalizeUserRole(value, fallback = "user") {
    const role = String(value || "").trim().toLowerCase();
    if (!role) return fallback;
    if (!ALLOWED_USER_ROLES.has(role)) return fallback;
    return role;
  }

  function normalizePolicyRole(value, fallback = "user") {
    return normalizeUserRole(value, fallback);
  }

  function actorPolicyRole(req, fallback = "user") {
    return normalizePolicyRole(req?.authUser?.role, fallback);
  }

  const hasEditorialAssignmentAccessSrc = extractFunction("hasEditorialAssignmentAccess");
  const hasEditorialAssignmentEditAccessSrc = extractFunction("hasEditorialAssignmentEditAccess");
  const ensureItemMutationAccessSrc = extractFunction("ensureItemMutationAccess");

  const context = {
    repo,
    actorPolicyRole,
    hasEditorialAssignmentAccess: null,
    hasEditorialAssignmentEditAccess: null,
    ensureItemMutationAccess: null,
    Set,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Math,
    Date,
    Error,
    TypeError,
    globalThis: null,
  };
  context.globalThis = context;

  const compiled = `
${hasEditorialAssignmentAccessSrc}
${hasEditorialAssignmentEditAccessSrc}
${ensureItemMutationAccessSrc}
`;

  vm.runInNewContext(compiled, context, { filename: "ensureItemMutationAccess-test.js" });

  return {
    ensureItemMutationAccess: context.ensureItemMutationAccess,
    hasEditorialAssignmentEditAccess: context.hasEditorialAssignmentEditAccess,
  };
}

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-mutation-access-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, path.join(root, "database", "schema.sql"));
  const repo = createRepository(db);

  const createdItemIds = [];
  const createdUserIds = [];
  const createdAssignmentIds = [];

  const createUser = (suffix, role = "editor") => {
    const email = `${TEST_PREFIX}${suffix}-${Date.now()}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role)
      VALUES (?, ?, 'hash', ?)
    `).run(email, `Test ${suffix}`, role);
    const id = Number(result.lastInsertRowid || 0);
    createdUserIds.push(id);
    return { id, email };
  };

  const createItem = (title) => {
    const result = repo.createItemWithWorkflowHead({
      type: "place",
      category: "test",
      title: `${TEST_PREFIX}${title}`,
      description_raw: "test",
      source_type: "manual",
      source_name: "test",
    });
    createdItemIds.push(result.item.id);
    return result.item;
  };

  const createEditorialAssignment = (itemId, assigneeUserId, state = "assigned") => {
    const assignment = repo.createAssignment({
      content_item_id: itemId,
      assignee_user_id: assigneeUserId,
      assignment_kind: "editorial",
      state,
    }, assigneeUserId);
    createdAssignmentIds.push(assignment.id);
    return assignment;
  };

  const createFieldAssignment = (itemId, assigneeUserId, state = "assigned") => {
    const assignment = repo.createAssignment({
      content_item_id: itemId,
      assignee_user_id: assigneeUserId,
      assignment_kind: "field",
      state,
    }, assigneeUserId);
    createdAssignmentIds.push(assignment.id);
    return assignment;
  };

  const cleanup = () => {
    for (const id of createdAssignmentIds) {
      db.prepare("DELETE FROM content_workflow_transitions WHERE assignment_id = ?").run(id);
      db.prepare("DELETE FROM content_assignments WHERE id = ?").run(id);
    }
    for (const id of createdItemIds) {
      db.prepare("DELETE FROM content_workflow_transitions WHERE content_item_id = ?").run(id);
      db.prepare("DELETE FROM content_workflow_models WHERE content_item_id = ?").run(id);
      db.prepare("DELETE FROM content_items WHERE id = ?").run(id);
    }
    for (const id of createdUserIds) {
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
    }
    const leftoverAssignments = db.prepare(`SELECT id FROM content_assignments WHERE content_item_id IN (${createdItemIds.length ? createdItemIds.join(",") : "0"}) LIMIT 1`).all();
    const leftoverItems = db.prepare("SELECT id FROM content_items WHERE title LIKE ? ESCAPE '\\' LIMIT 1").get(`${TEST_PREFIX}%`);
    const leftoverUsers = db.prepare("SELECT id FROM users WHERE email LIKE ? ESCAPE '\\' LIMIT 1").get(`${TEST_PREFIX}%`);
    const leftover = (leftoverAssignments.length) + (leftoverItems ? 1 : 0) + (leftoverUsers ? 1 : 0);

    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    return leftover;
  };

  return { repo, createUser, createItem, createEditorialAssignment, createFieldAssignment, cleanup, db };
}

test("ensureItemMutationAccess — allowAssignedSelf", async (t) => {

  await t.test("editor with editorial assignment state=assigned returns true", () => {
    const ctx = createContext();
    try {
      const user = ctx.createUser("editor-ok", "editor");
      const item = ctx.createItem("item-ok");
      ctx.createEditorialAssignment(item.id, user.id, "assigned");

      const { ensureItemMutationAccess } = buildAccessChecker(ctx.repo);
      const req = { authUser: { id: user.id, role: "editor" } };
      const res = makeResponse();
      const result = ensureItemMutationAccess(req, res, item, { allowAssignedSelf: true });

      assert.equal(result, true, "should return true");
      assert.equal(res.statusCode, 200, "should not set error status");
    } finally {
      const leftover = ctx.cleanup();
      assert.equal(leftover, 0, "leftover fixtures must be 0");
    }
  });

  await t.test("editor without assignment returns false + 403", () => {
    const ctx = createContext();
    try {
      const user = ctx.createUser("editor-noassign", "editor");
      const item = ctx.createItem("item-noassign");

      const { ensureItemMutationAccess } = buildAccessChecker(ctx.repo);
      const req = { authUser: { id: user.id, role: "editor" } };
      const res = makeResponse();
      const result = ensureItemMutationAccess(req, res, item, { allowAssignedSelf: true });

      assert.equal(result, false, "should return false");
      assert.equal(res.statusCode, 403, "should return 403");
    } finally {
      const leftover = ctx.cleanup();
      assert.equal(leftover, 0, "leftover fixtures must be 0");
    }
  });

  await t.test("freelance with editorial assignment state=in_progress returns true", () => {
    const ctx = createContext();
    try {
      const user = ctx.createUser("freelance-ok", "freelance");
      const item = ctx.createItem("item-freelance");
      ctx.createEditorialAssignment(item.id, user.id, "in_progress");

      const { ensureItemMutationAccess } = buildAccessChecker(ctx.repo);
      const req = { authUser: { id: user.id, role: "freelance" } };
      const res = makeResponse();
      const result = ensureItemMutationAccess(req, res, item, { allowAssignedSelf: true });

      assert.equal(result, true, "should return true");
      assert.equal(res.statusCode, 200, "should not set error status");
    } finally {
      const leftover = ctx.cleanup();
      assert.equal(leftover, 0, "leftover fixtures must be 0");
    }
  });

  await t.test("editorial assignment state=submitted (outside allowed set) returns false", () => {
    const ctx = createContext();
    try {
      const user = ctx.createUser("editor-submitted", "editor");
      const item = ctx.createItem("item-submitted");
      ctx.createEditorialAssignment(item.id, user.id, "submitted");

      const { ensureItemMutationAccess } = buildAccessChecker(ctx.repo);
      const req = { authUser: { id: user.id, role: "editor" } };
      const res = makeResponse();
      const result = ensureItemMutationAccess(req, res, item, { allowAssignedSelf: true });

      assert.equal(result, false, "should return false");
      assert.equal(res.statusCode, 403, "should return 403");
    } finally {
      const leftover = ctx.cleanup();
      assert.equal(leftover, 0, "leftover fixtures must be 0");
    }
  });

  await t.test("field assignment_kind (not editorial) returns false", () => {
    const ctx = createContext();
    try {
      const user = ctx.createUser("editor-field", "editor");
      const item = ctx.createItem("item-field");
      ctx.createFieldAssignment(item.id, user.id, "assigned");

      const { ensureItemMutationAccess } = buildAccessChecker(ctx.repo);
      const req = { authUser: { id: user.id, role: "editor" } };
      const res = makeResponse();
      const result = ensureItemMutationAccess(req, res, item, { allowAssignedSelf: true });

      assert.equal(result, false, "should return false");
      assert.equal(res.statusCode, 403, "should return 403");
    } finally {
      const leftover = ctx.cleanup();
      assert.equal(leftover, 0, "leftover fixtures must be 0");
    }
  });

  await t.test("editor with revision_requested state returns true (within allowed set)", () => {
    const ctx = createContext();
    try {
      const user = ctx.createUser("editor-revreq", "editor");
      const item = ctx.createItem("item-revreq");
      ctx.createEditorialAssignment(item.id, user.id, "revision_requested");

      const { ensureItemMutationAccess } = buildAccessChecker(ctx.repo);
      const req = { authUser: { id: user.id, role: "editor" } };
      const res = makeResponse();
      const result = ensureItemMutationAccess(req, res, item, { allowAssignedSelf: true });

      assert.equal(result, true, "should return true");
    } finally {
      const leftover = ctx.cleanup();
      assert.equal(leftover, 0, "leftover fixtures must be 0");
    }
  });

  await t.test("editor without allowAssignedSelf option returns false (dead code fix verification)", () => {
    const ctx = createContext();
    try {
      const user = ctx.createUser("editor-noopt", "editor");
      const item = ctx.createItem("item-noopt");
      ctx.createEditorialAssignment(item.id, user.id, "assigned");

      const { ensureItemMutationAccess } = buildAccessChecker(ctx.repo);
      const req = { authUser: { id: user.id, role: "editor" } };
      const res = makeResponse();
      const result = ensureItemMutationAccess(req, res, item);

      assert.equal(result, false, "should return false without option");
      assert.equal(res.statusCode, 403, "should return 403 without option");
    } finally {
      const leftover = ctx.cleanup();
      assert.equal(leftover, 0, "leftover fixtures must be 0");
    }
  });

});
