import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = "D:\\UbonCity_Web\\collector";
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const indexServer = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");
const indexHtml = fs.readFileSync(path.join(collectorRoot, "server", "public", "index.html"), "utf8");

test("owner review tracking mode is wired in UI and server", () => {
  const requiredAppSnippets = [
    'function isOwnerReviewTrackingEnabled()',
    'const includeTracking = isOwnerReviewTrackingEnabled() ? "&include_tracking=1" : "";',
    'qs("assignment-review-tracking")?.addEventListener("change", () => {',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `missing app snippet: ${snippet}`);
  }

  const requiredServerSnippets = [
    'function buildReviewAssignmentsForActor(actorUserId, role, limit = 50, options = {}) {',
    '? new Set(["submitted", "resubmitted", "revision_requested", "accepted"])',
    'const includeTracking = authRole === "owner" && String(req.query.include_tracking || "").trim() === "1";',
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `missing server snippet: ${snippet}`);
  }

  const requiredHtmlSnippets = [
    'id="assignment-review-tracking-wrap"',
    'id="assignment-review-tracking"',
    'โหมดติดตาม owner: รวมงานที่ส่งกลับแก้และงานที่ผ่านแล้ว',
  ];
  for (const snippet of requiredHtmlSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `missing html snippet: ${snippet}`);
  }
});
