import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const indexServer = fs.readFileSync(path.resolve(import.meta.dirname, "..", "server", "index.mjs"), "utf8");

test("server exposes reference media read/write routes", () => {
  assert.equal(indexServer.includes('app.get("/api/items/:id/reference-media"'), true);
  assert.equal(indexServer.includes('app.patch("/api/items/:id/reference-media/:referenceMediaId/selected"'), true);
  assert.equal(indexServer.includes("repo.listReferenceMediaByItem(id)"), true);
  assert.equal(indexServer.includes("repo.setReferenceMediaSelected(id, referenceMediaId, selected)"), true);
});

test("image workflow uses reference media and active routes do not lazily repair imported assets", () => {
  const workflowBlock = indexServer.slice(
    indexServer.indexOf('app.get("/api/items/:id/image-workflow"'),
    indexServer.indexOf('app.post("/api/items/:id/assets/repair-imported-media"')
  );
  assert.equal(workflowBlock.includes("repo.listReferenceMediaByItem(id)"), true);
  assert.equal(workflowBlock.includes("repairImportedReferenceAssetsForItem"), false);

  const assetsBlock = indexServer.slice(
    indexServer.indexOf('app.get("/api/assets"'),
    indexServer.indexOf('app.post("/api/assets/upload"')
  );
  assert.equal(assetsBlock.includes("repairImportedReferenceAssetsForItem"), false);
});

test("/api/assets is filtered to collector-controlled local media", () => {
  const assetsBlock = indexServer.slice(
    indexServer.indexOf('app.get("/api/assets"'),
    indexServer.indexOf('app.post("/api/assets/upload"')
  );
  assert.equal(assetsBlock.includes('.filter((row) => isCollectorControlledLocalAssetRow(row))'), true);
});

test("legacy imported media repair route is deprecated and import flows no longer bridge external media", () => {
  assert.equal(indexServer.includes("bridgeCollectedMediaToAssets"), false);
  assert.equal(indexServer.includes("repairImportedReferenceAssetsForItem"), false);
  assert.equal(indexServer.includes('app.post("/api/items/:id/assets/repair-imported-media"'), true);
  const routeBlock = indexServer.slice(
    indexServer.indexOf('app.post("/api/items/:id/assets/repair-imported-media"'),
    indexServer.indexOf('app.get("/api/items/:id/assets/cleanup-eligibility"')
  );
  assert.equal(routeBlock.includes("status(410)"), true);
  assert.equal(routeBlock.includes("REFERENCE_MEDIA_POLICY_V2"), true);
  assert.equal(indexServer.includes("reference_media_count"), true);
});
