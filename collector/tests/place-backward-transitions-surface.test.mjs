import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve("collector");
const serverSource = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");
const helperSource = fs.readFileSync(path.join(root, "server", "public", "workflow-backward-transitions.js"), "utf8");

test("backward workflow endpoint requires a reason, uses server direction metadata, and remains place-only", () => {
  assert.match(serverSource, /app\.get\("\/api\/items\/:id\/workflow\/backward-transitions", requireRole\("owner", "admin", "editor", "user"\)/);
  assert.match(serverSource, /app\.post\("\/api\/items\/:id\/workflow\/backward-transitions", requireRole\("owner", "admin", "user"\)/);
  assert.match(serverSource, /backward workflow transitions are available for place items only/);
  assert.match(serverSource, /reason is required for a backward workflow transition/);
  assert.match(serverSource, /listLegalBackwardProductionTransitions\("place", workflowBefore\.production_state, id\)/);
  assert.match(serverSource, /reason_code: target\.reason_code/);
  assert.match(serverSource, /workflow\.backward_transition/);
});

test("all required UI surfaces render server-provided backward controls with a bound click handler", () => {
  const surfaces = [
    ["clean-item.html", "item-editor.js"],
    ["index.html", "app.js"],
    ["article-workspace.html", "article-workspace-page.js"],
    ["article-submit.html", "article-submit-page.js"],
  ];
  for (const [htmlFile, jsFile] of surfaces) {
    const html = fs.readFileSync(path.join(root, "server", "public", htmlFile), "utf8");
    const js = fs.readFileSync(path.join(root, "server", "public", jsFile), "utf8");
    assert.match(html, /id="workflow-backward-controls"/, `${htmlFile} must contain reachable markup`);
    assert.match(js, /renderWorkflowBackwardTransitionControls/, `${jsFile} must render the shared control`);
    assert.match(js, /workflow\/backward-transitions/, `${jsFile} must invoke the actual endpoint`);
  }
  assert.match(helperSource, /data-backward-target/);
  assert.match(helperSource, /addEventListener\("click"/);
  assert.match(helperSource, /ต้องระบุเหตุผลก่อนถอยกลับ/);
  assert.doesNotMatch(helperSource, /brief_generated|field_working|field_review|writing_assigned|ready_for_publish/);
});
