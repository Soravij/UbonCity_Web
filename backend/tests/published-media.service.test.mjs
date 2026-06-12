import test from "node:test";
import assert from "node:assert/strict";

import { replaceEntityMediaWithReviewBatch } from "../services/publishedMediaService.js";

function createExecutor(reviewAssets, oldUsageRows = []) {
  const calls = [];
  let nextInsertId = 700;
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
      calls.push({ sql: String(sql || ""), params });
      if (normalized.includes("from review_content_assets")) return [reviewAssets];
      if (normalized.includes("from content_image_usages ciu")) return [oldUsageRows];
      if (normalized.startsWith("delete from content_image_usages")) return [{ affectedRows: oldUsageRows.length }];
      if (normalized.startsWith("insert into media_assets")) return [{ insertId: nextInsertId++ }];
      if (normalized.startsWith("insert into content_image_usages")) return [{ insertId: nextInsertId++ }];
      if (normalized.includes("from content_image_usages where asset_id in")) return [[]];
      if (normalized.startsWith("delete from media_assets")) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test("replaceEntityMediaWithReviewBatch prefers storage_path-backed uploads url over file_name", async () => {
  process.env.BACKEND_PUBLIC_URL = "https://api-test.uboncity.com";
  const executor = createExecutor([
    {
      id: 1,
      usage_type: "cover",
      position: 0,
      source_url: "",
      resolved_source_url: "",
      storage_path: "uploads/published/places/place-99/cover.jpg",
      file_name: "cover.jpg",
      mime_type: "image/jpeg",
      size_bytes: 123,
      checksum: "abc",
    },
  ]);

  const result = await replaceEntityMediaWithReviewBatch(executor, {
    entityType: "place",
    entityId: 99,
    reviewContentId: 55,
    batchUid: "batch-1",
    actorUserId: 7,
  });

  assert.equal(result.cover_url, "https://api-test.uboncity.com/uploads/published/places/place-99/cover.jpg");
  assert.equal(result.thumbnail_url, "https://api-test.uboncity.com/uploads/published/places/place-99/cover.jpg");
});

test("replaceEntityMediaWithReviewBatch falls back to file_name when storage_path is missing", async () => {
  process.env.BACKEND_PUBLIC_URL = "https://api-test.uboncity.com";
  const executor = createExecutor([
    {
      id: 2,
      usage_type: "cover",
      position: 0,
      source_url: "",
      resolved_source_url: "",
      storage_path: "",
      file_name: "cover-fallback.jpg",
      mime_type: "image/jpeg",
      size_bytes: 123,
      checksum: "def",
    },
  ]);

  const result = await replaceEntityMediaWithReviewBatch(executor, {
    entityType: "place",
    entityId: 100,
    reviewContentId: 56,
    batchUid: "batch-2",
    actorUserId: 7,
  });

  assert.equal(result.cover_url, "https://api-test.uboncity.com/uploads/cover-fallback.jpg");
});
