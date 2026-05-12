import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = "D:\\UbonCity_Web\\collector";
const source = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");

test("article process routes exist with dedicated surface area", () => {
  assert.match(source, /app\.get\("\/api\/items\/:id\/article-process", requireRole\("owner", "admin", "editor", "user"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/article-process\/transition", requireRole\("owner", "admin", "editor", "user"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/article-editorial-assignments", requireRole\("owner", "admin", "user"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/article-editorial-assignments\/:assignmentId\/request-revision", requireRole\("owner", "admin", "user"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/recheck-export-readiness", requireRole\("admin", "owner"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/recover-problem-translations", requireRole\("admin", "owner"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/generate-translations", requireRole\("admin", "owner"\)/);
  assert.match(source, /app\.get\("\/api\/translations", requireRole\("owner", "admin", "editor", "user"\)/);
  assert.match(source, /content_item_id is required/);
  assert.match(source, /app\.get\("\/api\/translation-runs", requireRole\("owner", "admin"\)/);
  assert.match(source, /workflow_transitions:\s*workflowTransitions/);
  assert.match(source, /assignee_user_id or assignee_name is required/);
  assert.match(source, /assignee_name: isExternalAssignee \? externalAssigneeName : null/);
  assert.match(source, /assignee_contact: isExternalAssignee \? externalAssigneeContact : null/);
});

test("article process uses semantic status helpers without mutating legacy assignment routes", () => {
  assert.match(source, /function normalizeArticleProcessStatus\(value, fallback = ""\)/);
  assert.match(source, /function deriveArticleProcessStatus\(item, workflowModel = null\)/);
  assert.match(source, /function mapArticleProcessStatusToWorkflowPatch\(status\)/);
  assert.match(source, /function buildArticleProcessPayload\(req, item\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/assignments", requireRole\("admin", "user"\),/);
});

test("composer media helper no longer emits prep-claim errors before article access fallback", () => {
  assert.match(source, /function hasPrepItemEditAccess\(req, item\)/);
  assert.match(source, /function ensureComposerMediaEditAccess\(req, res, item\) \{\s*if \(hasPrepItemEditAccess\(req, item\)\) \{\s*return true;\s*\}\s*return ensureArticleComposerEditAccess\(req, res, item\);\s*\}/);
  assert.doesNotMatch(source, /function ensureComposerMediaEditAccess\(req, res, item\) \{\s*if \(ensurePrepItemEditAccess\(req, res, item\)\)/);
});

test("collector cors always allows exact same-origin requests before cross-origin allowlist checks", () => {
  assert.match(source, /const forwardedHost = String\(req\.header\("x-forwarded-host"\) \|\| req\.header\("host"\) \|\| ""\)\.trim\(\);/);
  assert.match(source, /const requestOrigin = forwardedHost[\s\S]*normalizeOrigin\(/);
  assert.match(source, /const sameOrigin = origin && requestOrigin && origin === requestOrigin;/);
  assert.match(source, /const ok = sameOrigin \|\| \(allowed\.length \? allowed\.includes\(origin\) : \/\^https\?:\\\/\\\/\(localhost\|127\\\.0\\\.0\\\.1\)\(:\\d\+\)\?\$\/i\.test\(origin\)\);/);
});
