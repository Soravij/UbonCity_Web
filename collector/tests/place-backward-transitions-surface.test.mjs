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

test("every HTML page loading a backward-control renderer contains its container", () => {
  const publicRoot = path.join(root, "server", "public");
  const htmlFiles = fs.readdirSync(publicRoot).filter((file) => file.endsWith(".html"));
  const renderedPages = [];
  for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(path.join(publicRoot, htmlFile), "utf8");
    const scriptSources = [...html.matchAll(/<script[^>]+src="\/?([^"?#]+\.js)(?:\?[^?"]*)?"[^>]*><\/script>/gu)]
      .map((match) => match[1]);
    for (const scriptSource of scriptSources) {
      const scriptPath = path.join(publicRoot, scriptSource);
      if (!fs.existsSync(scriptPath)) continue;
      const js = fs.readFileSync(scriptPath, "utf8");
      const rendersBackwardControls = /\brenderWorkflowBackwardTransitionControls\s*\(/u.test(js);
      if (!rendersBackwardControls) continue;
      renderedPages.push(`${htmlFile} -> ${scriptSource}`);
      assert.match(html, /id="workflow-backward-controls"/, `${htmlFile} loads ${scriptSource}, which renders backward controls, so it must contain reachable markup`);
      assert.match(js, /workflow\/backward-transitions/, `${scriptSource} must invoke the actual endpoint`);
    }
  }
  assert.ok(renderedPages.length > 0, "test discovery must find at least one backward-control UI page");
  assert.match(helperSource, /data-backward-target/);
  assert.match(helperSource, /addEventListener\("click"/);
  assert.match(helperSource, /ต้องระบุเหตุผลก่อนถอยกลับ/);
  assert.doesNotMatch(helperSource, /brief_generated|field_working|field_review|writing_assigned|ready_for_publish/);
});
