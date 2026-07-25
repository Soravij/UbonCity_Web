import assert from "node:assert/strict";
import test from "node:test";

import { deleteMediaUsageAndCleanup } from "../controllers/mediaController.js";
import { cleanupUnreferencedMediaAssets, toMediaUploadDiskPath } from "../services/mediaAssetCleanupService.js";
import { cleanupCommonMappings } from "../services/purgeContentService.js";

function createUsageExecutor({ usageRows = [], assetRows = [], remainingUsageAssetIds = [] } = {}) {
  const state = { usageRows: [...usageRows], assetRows: [...assetRows], remainingUsageAssetIds: [...remainingUsageAssetIds] };
  return {
    state,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
      if (normalized.startsWith("select asset_id from content_image_usages where id=")) {
        return [state.usageRows.filter((row) => Number(row.id) === Number(params[0])).map((row) => ({ asset_id: row.asset_id }))];
      }
      if (normalized.startsWith("delete from content_image_usages where id=")) {
        state.usageRows = state.usageRows.filter((row) => Number(row.id) !== Number(params[0]));
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes("from content_image_usages") && normalized.includes("group by asset_id")) {
        const ids = new Set(state.remainingUsageAssetIds);
        for (const row of state.usageRows) ids.add(Number(row.asset_id));
        return [[...ids].filter((id) => params.includes(id)).map((asset_id) => ({ asset_id }))];
      }
      if (normalized.startsWith("select id, storage_path, file_name from media_assets")) {
        return [state.assetRows.filter((row) => params.includes(row.id))];
      }
      if (normalized.startsWith("delete from media_assets where id in")) {
        state.assetRows = state.assetRows.filter((row) => !params.includes(row.id));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test("deleting the last media usage removes its media asset and returns its storage path for unlink", async () => {
  const executor = createUsageExecutor({
    usageRows: [{ id: 1, asset_id: 10 }],
    assetRows: [{ id: 10, storage_path: "uploads/orphan.jpg", file_name: "orphan.jpg" }],
  });

  const result = await deleteMediaUsageAndCleanup(executor, 1);

  assert.equal(result.found, true);
  assert.deepEqual(executor.state.assetRows, []);
  assert.deepEqual(result.cleanupFilePaths, [toMediaUploadDiskPath("uploads/orphan.jpg")]);
});

test("deleting one of several media usages preserves the still-referenced asset", async () => {
  const executor = createUsageExecutor({
    usageRows: [{ id: 1, asset_id: 10 }],
    assetRows: [{ id: 10, storage_path: "uploads/shared.jpg", file_name: "shared.jpg" }],
    remainingUsageAssetIds: [10],
  });

  const result = await deleteMediaUsageAndCleanup(executor, 1);

  assert.equal(result.found, true);
  assert.equal(executor.state.assetRows.length, 1);
  assert.deepEqual(result.cleanupFilePaths, []);
});

test("purging an entity collects review staging paths before review-content cascade", async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) return [[{ storage_path: "uploads/review/place-1/staged.jpg" }]];
      return [{ affectedRows: 1 }];
    },
  };

  const paths = await cleanupCommonMappings(executor, "place", 1);

  assert.match(calls[0].sql, /FROM review_content_assets rca/i);
  assert.match(calls[0].sql, /JOIN review_contents rc/i);
  assert.deepEqual(calls[0].params, ["place", 1]);
  assert.match(calls[1].sql, /DELETE FROM collector_import_reviews/i);
  assert.match(calls[2].sql, /DELETE FROM review_contents/i);
  assert.equal(calls.length, 3, "path collection must precede the cascade delete");
  assert.deepEqual(paths, [toMediaUploadDiskPath("uploads/review/place-1/staged.jpg")]);
});
