import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
  readImageDimensionsFromBuffer,
  readImageDimensionsFromDiskPath,
} from "../services/imageDimensionsService.js";
import { replaceEntityMediaWithReviewBatch } from "../services/publishedMediaService.js";
import { uploadMediaAsset } from "../controllers/mediaController.js";
import { getPlaceDetail } from "../controllers/placeController.js";
import { getEventDetail } from "../controllers/eventController.js";
import pool from "../config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");

// 1x1 transparent GIF — smallest real, fully valid image file for exercising image-size.
const ONE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7";
const ONE_PIXEL_GIF_BUFFER = Buffer.from(ONE_PIXEL_GIF_BASE64, "base64");

async function writeUploadFixture(relativePath, buffer) {
  const diskPath = path.join(BACKEND_UPLOADS_DIR, relativePath.replace(/^uploads[\\/]/, ""));
  await fs.mkdir(path.dirname(diskPath), { recursive: true });
  await fs.writeFile(diskPath, buffer);
  return diskPath;
}

async function removeUploadFixture(relativePath) {
  const diskPath = path.join(BACKEND_UPLOADS_DIR, relativePath.replace(/^uploads[\\/]/, ""));
  await fs.rm(diskPath, { force: true });
}

function normalizeSql(sql) {
  return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createBaseReq() {
  return {
    headers: {},
    protocol: "https",
    get(name) {
      if (String(name || "").toLowerCase() === "host") return "api.test.local";
      return "";
    },
  };
}

async function withMockedPool(handler, run) {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params = []) => {
    const call = { sql: String(sql || ""), params: Array.isArray(params) ? params : [] };
    calls.push(call);
    return handler(call);
  };
  try {
    return await run(calls);
  } finally {
    pool.query = originalQuery;
  }
}

// Handles the schema-bootstrap chatter (CREATE TABLE IF NOT EXISTS / SHOW COLUMNS / ALTER TABLE /
// legacy-backfill INSERT) that placeController/eventController run before their real query, so tests
// only need to branch on the query that's actually under test.
function schemaBootstrapResponse(sql) {
  const s = normalizeSql(sql);
  if (s.startsWith("create table if not exists")) return [{}];
  if (s.startsWith("show columns from")) return [[{ Field: "ok" }]];
  if (s.startsWith("alter table")) return [{}];
  if (s.startsWith("insert into event_translations")) return [{ affectedRows: 0 }];
  return undefined;
}

test("readImageDimensionsFromBuffer returns real dimensions for a valid image", () => {
  const result = readImageDimensionsFromBuffer(ONE_PIXEL_GIF_BUFFER);
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
});

test("readImageDimensionsFromBuffer returns null/null (no throw) for unreadable bytes", () => {
  const result = readImageDimensionsFromBuffer(Buffer.from("not an image, just plain text bytes"));
  assert.equal(result.width, null);
  assert.equal(result.height, null);
});

test("readImageDimensionsFromDiskPath returns null/null (no throw) for a missing file", async () => {
  const result = await readImageDimensionsFromDiskPath(
    path.join(BACKEND_UPLOADS_DIR, "does-not-exist-media-dimensions-test.gif")
  );
  assert.equal(result.width, null);
  assert.equal(result.height, null);
});

test("uploadMediaAsset measures width/height from the uploaded buffer instead of trusting payload", async () => {
  const req = {
    ...createBaseReq(),
    user: { id: 9 },
    body: {
      dataBase64: ONE_PIXEL_GIF_BASE64,
      mimeType: "image/gif",
      // Deliberately wrong client-supplied dimensions — the measured value must win.
      width: 9999,
      height: 9999,
    },
  };
  const res = createMockRes();
  let insertedFileName = "";

  try {
    await withMockedPool((call) => {
      const bootstrap = schemaBootstrapResponse(call.sql);
      if (bootstrap !== undefined) return bootstrap;

      const sql = normalizeSql(call.sql);
      if (sql.startsWith("insert into media_assets")) {
        insertedFileName = call.params[16];
        assert.equal(call.params[12], 1, "width param should be measured (1), not payload (9999)");
        assert.equal(call.params[13], 1, "height param should be measured (1), not payload (9999)");
        return [{ insertId: 1 }];
      }
      if (sql.startsWith("select * from media_assets where id=?")) {
        return [[{ id: 1, storage_disk: "local", file_name: insertedFileName, width: 1, height: 1 }]];
      }
      throw new Error(`Unexpected SQL in upload test: ${call.sql}`);
    }, async () => {
      await uploadMediaAsset(req, res);
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body?.item?.width, 1);
    assert.equal(res.body?.item?.height, 1);
    assert.notEqual(res.body?.item?.width, null);
  } finally {
    if (insertedFileName) await removeUploadFixture(`uploads/${insertedFileName}`);
  }
});

test("replaceEntityMediaWithReviewBatch measures and inserts real width/height for a promoted asset", async () => {
  process.env.BACKEND_PUBLIC_URL = "https://api-test.uboncity.com";
  await writeUploadFixture("uploads/review-dimensions-fixture.gif", ONE_PIXEL_GIF_BUFFER);

  let insertParams = null;
  const executor = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      if (normalized.includes("from review_content_assets")) {
        return [[
          {
            id: 42,
            usage_type: "cover",
            position: 0,
            source_url: "",
            resolved_source_url: "",
            storage_path: "uploads/review-dimensions-fixture.gif",
            file_name: "review-dimensions-fixture.gif",
            mime_type: "image/gif",
            size_bytes: ONE_PIXEL_GIF_BUFFER.length,
            checksum: "dim-fixture",
          },
        ]];
      }
      if (normalized.includes("from content_image_usages ciu")) return [[]];
      if (normalized.startsWith("delete from content_image_usages")) return [{ affectedRows: 0 }];
      if (normalized.startsWith("insert into media_assets")) {
        insertParams = params;
        return [{ insertId: 900 }];
      }
      if (normalized.startsWith("insert into content_image_usages")) return [{ insertId: 901 }];
      if (normalized.includes("from content_image_usages where asset_id in")) return [[]];
      if (normalized.startsWith("delete from media_assets")) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  try {
    await replaceEntityMediaWithReviewBatch(executor, {
      entityType: "place",
      entityId: 501,
      reviewContentId: 61,
      batchUid: "dim-batch",
      actorUserId: 7,
    });

    assert.ok(insertParams, "expected media_assets insert to run");
    // Column order: ...storage_disk, storage_path, file_name, width, height, created_by...
    assert.equal(insertParams[11], 1, "measured width should be inserted");
    assert.equal(insertParams[12], 1, "measured height should be inserted");
  } finally {
    await removeUploadFixture("uploads/review-dimensions-fixture.gif");
    await removeUploadFixture("uploads/published/places/501/61-dim-batch-cover-0-42.gif");
  }
});

test("getPlaceDetail surfaces real (non-null) width/height on media_gallery_items", async () => {
  const req = {
    ...createBaseReq(),
    params: { category: "cafes", slug: "dimensions-place" },
    query: { lang: "th" },
  };
  const res = createMockRes();

  await withMockedPool((call) => {
    const bootstrap = schemaBootstrapResponse(call.sql);
    if (bootstrap !== undefined) return bootstrap;

    const sql = normalizeSql(call.sql);
    if (sql.includes("from places p") && sql.includes("join categories c")) {
      return [[{ id: 501, category: "cafes", slug: "dimensions-place", title: "Dimensions Place", is_approved: 1 }]];
    }
    if (sql.includes("from content_image_usages ciu") && sql.includes("join media_assets ma")) {
      return [[
        {
          place_id: 501,
          usage_type: "gallery",
          position: 0,
          caption: "Cover shot",
          source_url: null,
          storage_disk: "local",
          file_name: "dimensions-place.jpg",
          storage_path: "uploads/dimensions-place.jpg",
          width: 1600,
          height: 900,
        },
      ]];
    }
    throw new Error(`Unexpected SQL in getPlaceDetail test: ${call.sql}`);
  }, async () => {
    await getPlaceDetail(req, res);
  });

  assert.equal(res.statusCode, 200);
  const item = res.body?.item?.media_gallery_items?.[0];
  assert.ok(item, "expected a gallery item in the response");
  assert.equal(item.width, 1600);
  assert.equal(item.height, 900);
});

test("getEventDetail surfaces real (non-null) width/height on media_gallery_items", async () => {
  const req = {
    ...createBaseReq(),
    params: { id: "77" },
    query: { lang: "th" },
  };
  const res = createMockRes();

  await withMockedPool((call) => {
    const bootstrap = schemaBootstrapResponse(call.sql);
    if (bootstrap !== undefined) return bootstrap;

    const sql = normalizeSql(call.sql);
    if (sql.startsWith("insert into event_translations")) return [{ affectedRows: 0 }];
    if (sql.includes("from events e")) {
      return [[{ id: 77, title: "Dimensions Event", is_approved: 1 }]];
    }
    if (sql.includes("from content_image_usages ciu") && sql.includes("join media_assets ma")) {
      return [[
        {
          event_id: 77,
          usage_type: "gallery",
          position: 0,
          caption: "Event shot",
          source_url: null,
          storage_disk: "local",
          file_name: "dimensions-event.jpg",
          storage_path: "uploads/dimensions-event.jpg",
          width: 1200,
          height: 800,
        },
      ]];
    }
    throw new Error(`Unexpected SQL in getEventDetail test: ${call.sql}`);
  }, async () => {
    await getEventDetail(req, res);
  });

  assert.equal(res.statusCode, 200);
  const item = res.body?.item?.media_gallery_items?.[0];
  assert.ok(item, "expected a gallery item in the response");
  assert.equal(item.width, 1200);
  assert.equal(item.height, 800);
});
