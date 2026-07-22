import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const schema = fs.readFileSync(path.join(root, "database", "schema.sql"), "utf8");
const repository = fs.readFileSync(path.join(root, "db", "repository.mjs"), "utf8");
const server = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");
const workspace = fs.readFileSync(path.join(root, "server", "public", "article-workspace-page.js"), "utf8");

test("caption is authored on Collector content assets and included in the release manifest", () => {
  assert.match(schema, /content_assets[\s\S]*caption VARCHAR\(255\)/);
  assert.match(repository, /function setContentAssetCaption/);
  assert.match(server, /\/api\/items\/:id\/assets\/:assetId\/caption/);
  assert.match(server, /caption: String\(asset\?\.caption/);
  assert.match(workspace, /data-caption-input/);
  assert.match(workspace, /updateAssetCaption/);
});
