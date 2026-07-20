import assert from "node:assert/strict";
import test from "node:test";
import { sweepPurgedDeliverableAssets } from "../services/purge-asset-sweep.mjs";

test("purge asset sweep reports shared skips and counts only removed files", () => {
  const result = sweepPurgedDeliverableAssets([1, 2], (id) => id === 1
    ? { deleted_asset: false, blocked_references: ["content_assets"] }
    : { deleted_asset: true, file_removed: true, file_missing: false });
  assert.equal(result.assets_swept, 1);
  assert.equal(result.rows_removed, 1);
  assert.deepEqual(result.assets_skipped, [{ asset_id: 1, blocked_references: ["content_assets"] }]);
});

test("purge asset sweep continues after a failed asset and records missing files", () => {
  const calls = [];
  const warnings = [];
  const result = sweepPurgedDeliverableAssets([1, 2, 3], (id) => {
    calls.push(id);
    if (id === 2) throw new Error("locked");
    if (id === 3) return { deleted_asset: true, file_removed: false, file_missing: true, file_warning: "file already missing" };
    return { deleted_asset: true, file_removed: true, file_missing: false };
  }, { warn: (message) => warnings.push(message) });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.assets_swept, 1);
  assert.equal(result.rows_removed, 2);
  assert.equal(result.files_missing, 1);
  assert.equal(result.asset_sweep_failures.length, 1);
  assert.ok(warnings.some((message) => message.includes("locked")));
  assert.ok(warnings.some((message) => message.includes("file already missing")));
});
