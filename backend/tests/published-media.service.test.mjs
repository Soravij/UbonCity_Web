import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { replaceEntityMediaWithReviewBatch } from "../services/publishedMediaService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");

async function writeUploadFixture(relativePath, content = "fixture") {
  const diskPath = path.join(BACKEND_UPLOADS_DIR, relativePath.replace(/^uploads[\\/]/, ""));
  await fs.mkdir(path.dirname(diskPath), { recursive: true });
  await fs.writeFile(diskPath, content);
  return diskPath;
}

async function removeUploadFixture(relativePath) {
  const diskPath = path.join(BACKEND_UPLOADS_DIR, relativePath.replace(/^uploads[\\/]/, ""));
  await fs.rm(diskPath, { force: true });
}

function createExecutor(reviewAssets, oldUsageRows = [], overrides = {}) {
  const calls = [];
  let nextInsertId = 700;
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
      calls.push({ sql: String(sql || ""), params });
      if (typeof overrides.query === "function") {
        const handled = await overrides.query({ sql, params, normalized, calls });
        if (handled !== undefined) return handled;
      }
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
  await writeUploadFixture("uploads/published/places/place-99/cover.jpg");
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

  assert.equal(result.cover_url, "https://api-test.uboncity.com/uploads/published/places/99/55-batch-1-cover-0-1.jpg");
  assert.equal(result.thumbnail_url, "https://api-test.uboncity.com/uploads/published/places/99/55-batch-1-cover-0-1.jpg");
  await removeUploadFixture("uploads/published/places/place-99/cover.jpg");
  await removeUploadFixture("uploads/published/places/99/55-batch-1-cover-0-1.jpg");
});

test("replaceEntityMediaWithReviewBatch still assigns published place storage when storage_path is missing", async () => {
  process.env.BACKEND_PUBLIC_URL = "https://api-test.uboncity.com";
  await writeUploadFixture("uploads/cover-fallback.jpg");
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

  assert.equal(result.cover_url, "https://api-test.uboncity.com/uploads/published/places/100/56-batch-2-cover-0-2.jpg");
  await removeUploadFixture("uploads/cover-fallback.jpg");
  await removeUploadFixture("uploads/published/places/100/56-batch-2-cover-0-2.jpg");
});

test("replaceEntityMediaWithReviewBatch promotes review staging storage_path into published place storage", async () => {
  process.env.BACKEND_PUBLIC_URL = "https://api-test.uboncity.com";
  await removeUploadFixture("uploads/published/places/32/57-batch-3-cover-0-3.jpg");
  await writeUploadFixture("uploads/review-item-32-asset-cover.jpg");
  const executor = createExecutor([
    {
      id: 3,
      usage_type: "cover",
      position: 0,
      source_url: "https://api-test.uboncity.com/uploads/review-item-32-asset-cover.jpg",
      resolved_source_url: "https://api-test.uboncity.com/uploads/review-item-32-asset-cover.jpg",
      storage_path: "uploads/review-item-32-asset-cover.jpg",
      file_name: "review-item-32-asset-cover.jpg",
      mime_type: "image/jpeg",
      size_bytes: 456,
      checksum: "ghi",
    },
  ]);

  const result = await replaceEntityMediaWithReviewBatch(executor, {
    entityType: "place",
    entityId: 32,
    reviewContentId: 57,
    batchUid: "batch-3",
    actorUserId: 7,
  });

  assert.equal(result.cover_url, "https://api-test.uboncity.com/uploads/published/places/32/57-batch-3-cover-0-3.jpg");
  assert.equal(result.thumbnail_url, "https://api-test.uboncity.com/uploads/published/places/32/57-batch-3-cover-0-3.jpg");

  const mediaAssetInsert = executor.calls.find((call) =>
    String(call.sql || "").replace(/\s+/g, " ").trim().toLowerCase().startsWith("insert into media_assets")
  );
  assert.ok(mediaAssetInsert, "expected media_assets insert");
  assert.equal(mediaAssetInsert.params[9], "uploads/published/places/32/57-batch-3-cover-0-3.jpg");
  assert.doesNotMatch(String(mediaAssetInsert.params[9] || ""), /uploads\/review-item-/);
  await removeUploadFixture("uploads/review-item-32-asset-cover.jpg");
  await removeUploadFixture("uploads/published/places/32/57-batch-3-cover-0-3.jpg");
});

test("replaceEntityMediaWithReviewBatch rejects when review source file is missing", async () => {
  process.env.BACKEND_PUBLIC_URL = "https://api-test.uboncity.com";
  const executor = createExecutor([
    {
      id: 4,
      usage_type: "cover",
      position: 0,
      source_url: "https://api-test.uboncity.com/uploads/review-item-missing-cover.jpg",
      resolved_source_url: "https://api-test.uboncity.com/uploads/review-item-missing-cover.jpg",
      storage_path: "uploads/review-item-missing-cover.jpg",
      file_name: "review-item-missing-cover.jpg",
      mime_type: "image/jpeg",
      size_bytes: 456,
      checksum: "missing",
    },
  ]);

  await assert.rejects(
    () =>
      replaceEntityMediaWithReviewBatch(executor, {
        entityType: "place",
        entityId: 33,
        reviewContentId: 58,
        batchUid: "batch-missing",
        actorUserId: 7,
      }),
    /enoent|missing/i
  );

  assert.equal(
    executor.calls.filter((call) => String(call.sql || "").replace(/\s+/g, " ").trim().toLowerCase().startsWith("insert into media_assets")).length,
    0
  );
  assert.equal(
    executor.calls.filter((call) => String(call.sql || "").replace(/\s+/g, " ").trim().toLowerCase().startsWith("insert into content_image_usages")).length,
    0
  );
});

test("replaceEntityMediaWithReviewBatch always creates a unique published path and excludes it from cleanup_file_paths", async () => {
  process.env.BACKEND_PUBLIC_URL = "https://api-test.uboncity.com";
  await writeUploadFixture("uploads/published/places/44/old-cover.jpg", "old");
  await writeUploadFixture("uploads/review-item-44-cover.jpg", "new");
  const oldUsageRows = [
    {
      id: 10,
      asset_id: 801,
      usage_type: "cover",
      storage_path: "uploads/published/places/44/old-cover.jpg",
      file_name: "old-cover.jpg",
    },
  ];
  const executor = createExecutor(
    [
      {
        id: 5,
        usage_type: "cover",
        position: 0,
        source_url: "https://api-test.uboncity.com/uploads/review-item-44-cover.jpg",
        resolved_source_url: "https://api-test.uboncity.com/uploads/review-item-44-cover.jpg",
        storage_path: "uploads/published/places/44/old-cover.jpg",
        file_name: "old-cover.jpg",
        mime_type: "image/jpeg",
        size_bytes: 456,
        checksum: "collision",
      },
    ],
    oldUsageRows
  );

  const result = await replaceEntityMediaWithReviewBatch(executor, {
    entityType: "place",
    entityId: 44,
    reviewContentId: 59,
    batchUid: "batch-collision",
    actorUserId: 7,
  });

  const mediaAssetInsert = executor.calls.find((call) =>
    String(call.sql || "").replace(/\s+/g, " ").trim().toLowerCase().startsWith("insert into media_assets")
  );
  assert.ok(mediaAssetInsert, "expected media_assets insert");
  assert.equal(mediaAssetInsert.params[9], "uploads/published/places/44/59-batch-collision-cover-0-5.jpg");
  assert.notEqual(mediaAssetInsert.params[9], "uploads/published/places/44/old-cover.jpg");
  assert.deepEqual(result.cleanup_file_paths, [path.join(BACKEND_UPLOADS_DIR, "published", "places", "44", "old-cover.jpg")]);
  assert.doesNotMatch(String(result.cleanup_file_paths[0] || ""), /59-batch-collision-cover-0-5\.jpg/);

  await removeUploadFixture("uploads/published/places/44/old-cover.jpg");
  await removeUploadFixture("uploads/review-item-44-cover.jpg");
  await removeUploadFixture("uploads/published/places/44/59-batch-collision-cover-0-5.jpg");
});
