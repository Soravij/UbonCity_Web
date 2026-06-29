import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const indexJs = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

function extractNamedFunctionSource(source, name) {
  const asyncMarker = `async function ${name}`;
  const plainMarker = `function ${name}`;
  const start = source.indexOf(asyncMarker) !== -1
    ? source.indexOf(asyncMarker)
    : source.indexOf(plainMarker);
  assert.notEqual(start, -1, `${name} should exist`);
  const signatureEnd = source.indexOf(")", start);
  assert.notEqual(signatureEnd, -1, `${name} should have a signature`);
  const bodyStart = source.indexOf("{", signatureEnd);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

function extractConstObjectLiteral(source, constName) {
  const marker = `const ${constName} = createRateLimiter(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${constName} should exist`);
  const objectStart = source.indexOf("{", start);
  assert.notEqual(objectStart, -1, `${constName} should include options`);
  let depth = 0;
  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(objectStart, index + 1);
    }
  }
  throw new Error(`Could not extract options for ${constName}`);
}

const createRateLimiterForTest = new Function([
  extractNamedFunctionSource(indexJs, "createRateLimiter"),
  "return createRateLimiter;",
].join("\n"))();

const uploadAssignmentSubmissionFilesForTest = new Function(
  "deps",
  [
    "const File = deps.File;",
    "const FormData = deps.FormData;",
    "const api = deps.api;",
    "const setStatus = deps.setStatus;",
    "const sanitizeUploadFileName = deps.sanitizeUploadFileName;",
    extractNamedFunctionSource(appJs, "uploadAssignmentSubmissionFiles"),
    "return uploadAssignmentSubmissionFiles;",
  ].join("\n")
)({
  File: globalThis.File,
  FormData: globalThis.FormData,
  api: async (...args) => globalThis.__assignmentUploadApi(...args),
  setStatus: () => {},
  sanitizeUploadFileName(name) {
    return String(name || "").trim().replace(/\s+/g, "-");
  },
});

function buildRequestRecorder() {
  const calls = [];
  return {
    calls,
    api(url, options = {}) {
      calls.push({
        url,
        method: String(options?.method || "GET").toUpperCase(),
        body: options?.body || null,
      });
      if (url.includes("/uploads/start")) {
        return Promise.resolve({ upload_id: `upload-${calls.length}` });
      }
      if (url.includes("/finalize")) {
        return Promise.resolve({
          uploaded: [{ id: calls.length, public_url: `/media/${calls.length}` }],
        });
      }
      if (url.includes("/chunks")) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({
        uploaded: [{ id: calls.length, public_url: `/media/${calls.length}` }],
      });
    },
  };
}

function buildFile(name, sizeBytes, mimeType) {
  return new File([new Uint8Array(sizeBytes)], name, { type: mimeType });
}

test("frontend sends one direct assignment upload request per small file", async () => {
  const recorder = buildRequestRecorder();
  globalThis.__assignmentUploadApi = recorder.api;
  const queue = Array.from({ length: 15 }, (_, index) => ({
    file: buildFile(`photo-${index + 1}.jpg`, 1024, "image/jpeg"),
    slug: `photo-${index + 1}`,
    slotKey: `shot-${index + 1}`,
    mediaType: "image",
  }));

  await uploadAssignmentSubmissionFilesForTest(25, queue, { syncBatchId: "batch-direct" });

  const directCalls = recorder.calls.filter((call) => call.url === "/api/assignments/25/assets/upload");
  const chunkCalls = recorder.calls.filter((call) => call.url.includes("/assets/uploads/"));
  assert.equal(directCalls.length, 15);
  assert.equal(chunkCalls.length, 0);
});

test("actual mixed batch uses 13 direct JPG requests and 2 MP4 chunk upload flows", async () => {
  const recorder = buildRequestRecorder();
  globalThis.__assignmentUploadApi = recorder.api;
  const queue = [
    ...Array.from({ length: 13 }, (_, index) => ({
      file: buildFile(`photo-${index + 1}.jpg`, 1024, "image/jpeg"),
      slug: `photo-${index + 1}`,
      slotKey: `shot-${index + 1}`,
      mediaType: "image",
    })),
    {
      file: buildFile("clip-1.mp4", 1024, "video/mp4"),
      slug: "clip-1",
      slotKey: "clip-1",
      mediaType: "video",
    },
    {
      file: buildFile("clip-2.mp4", 1024, "video/mp4"),
      slug: "clip-2",
      slotKey: "clip-2",
      mediaType: "video",
    },
  ];

  await uploadAssignmentSubmissionFilesForTest(25, queue, { syncBatchId: "batch-actual" });

  const directCalls = recorder.calls.filter((call) => call.url === "/api/assignments/25/assets/upload");
  const chunkStartCalls = recorder.calls.filter((call) => call.url === "/api/assignments/25/assets/uploads/start");
  const chunkPartCalls = recorder.calls.filter((call) => /\/api\/assignments\/25\/assets\/uploads\/.+\/chunks$/.test(call.url));
  const chunkFinalizeCalls = recorder.calls.filter((call) => /\/api\/assignments\/25\/assets\/uploads\/.+\/finalize$/.test(call.url));

  assert.equal(directCalls.length, 13);
  assert.equal(chunkStartCalls.length, 2);
  assert.equal(chunkPartCalls.length, 2);
  assert.equal(chunkFinalizeCalls.length, 2);
});

test("frontend switches to chunk upload only for videos or files larger than 20MB", async () => {
  const recorder = buildRequestRecorder();
  globalThis.__assignmentUploadApi = recorder.api;
  const twentyMb = 20 * 1024 * 1024;
  const queue = [
    {
      file: buildFile("small-photo.jpg", 1024, "image/jpeg"),
      slug: "small-photo",
      slotKey: "small-photo",
      mediaType: "image",
    },
    {
      file: buildFile("large-photo.jpg", twentyMb + 1, "image/jpeg"),
      slug: "large-photo",
      slotKey: "large-photo",
      mediaType: "image",
    },
    {
      file: buildFile("clip.mp4", 1024, "video/mp4"),
      slug: "clip",
      slotKey: "clip",
      mediaType: "video",
    },
  ];

  await uploadAssignmentSubmissionFilesForTest(25, queue, { syncBatchId: "batch-mixed" });

  const directCalls = recorder.calls.filter((call) => call.url === "/api/assignments/25/assets/upload");
  const chunkStartCalls = recorder.calls.filter((call) => call.url === "/api/assignments/25/assets/uploads/start");
  assert.equal(directCalls.length, 1);
  assert.equal(chunkStartCalls.length, 2);
});

test("assignment direct upload limiter allows 15 legitimate requests but still blocks abuse", () => {
  const assignmentUploadLimiterOptions = new Function(`return (${extractConstObjectLiteral(indexJs, "assignmentUploadRateLimit")});`)();
  const assignmentLimiter = createRateLimiterForTest(assignmentUploadLimiterOptions);

  assert.deepEqual(assignmentUploadLimiterOptions, {
    windowMs: 30 * 60 * 1000,
    max: 60,
    keyBy: "user",
    message: "Assignment upload rate limit exceeded",
  });
  assert.equal(
    indexJs.includes('app.post("/api/assignments/:id/assets/upload", requireRole("owner", "admin", "editor", "user", "freelance"), assignmentUploadRateLimit, assignmentUpload.array("file", 20), async (req, res) => {'),
    true
  );

  function runRequestSequence(count) {
    let blocked = null;
    for (let index = 0; index < count; index += 1) {
      let nextCalled = false;
      const req = {
        authUser: { id: 7 },
        header() {
          return "";
        },
        ip: "127.0.0.1",
      };
      const res = {
        headers: {},
        statusCode: 200,
        setHeader(name, value) {
          this.headers[name] = value;
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          blocked = { statusCode: this.statusCode, payload, headers: { ...this.headers } };
          return this;
        },
      };
      assignmentLimiter(req, res, () => {
        nextCalled = true;
      });
      if (blocked) return { blocked, passed: index };
      assert.equal(nextCalled, true);
    }
    return { blocked: null, passed: count };
  }

  const firstFifteen = runRequestSequence(15);
  assert.equal(firstFifteen.blocked, null);
  const abuse = runRequestSequence(500);
  assert.ok(abuse.blocked);
  assert.equal(abuse.blocked.statusCode, 429);
  assert.equal(abuse.blocked.payload?.error, "Assignment upload rate limit exceeded");
});

test("old generic upload limiter would block the second 13-JPG retry within the same 10-minute window", () => {
  const genericUploadLimiter = createRateLimiterForTest(
    new Function(`return (${extractConstObjectLiteral(indexJs, "uploadRateLimit")});`)()
  );

  let blocked = null;
  for (let index = 0; index < 26; index += 1) {
    let nextCalled = false;
    const req = {
      authUser: { id: 11 },
      header() {
        return "";
      },
      ip: "127.0.0.1",
    };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        blocked = { statusCode: this.statusCode, payload };
        return this;
      },
    };
    genericUploadLimiter(req, res, () => {
      nextCalled = true;
    });
    if (blocked) break;
    assert.equal(nextCalled, true);
  }

  assert.ok(blocked);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.payload?.error, "Upload rate limit exceeded");
});

test("generic asset upload limiter remains unchanged and chunk routes keep their current limiter", () => {
  const uploadLimiterOptions = new Function(`return (${extractConstObjectLiteral(indexJs, "uploadRateLimit")});`)();
  const assignmentChunkLimiterOptions = new Function(`return (${extractConstObjectLiteral(indexJs, "assignmentChunkUploadRateLimit")});`)();

  assert.deepEqual(uploadLimiterOptions, {
    windowMs: 10 * 60 * 1000,
    max: 25,
    keyBy: "user",
    message: "Upload rate limit exceeded",
  });
  assert.deepEqual(assignmentChunkLimiterOptions, {
    windowMs: 12 * 60 * 60 * 1000,
    max: 2500,
    keyBy: "user",
    message: "Assignment chunk upload rate limit exceeded",
  });

  assert.equal(
    indexJs.includes('app.post("/api/assets/upload", requireRole("owner", "admin", "editor", "user"), uploadRateLimit, upload.array("file", 20), async (req, res) => {'),
    true
  );
  assert.equal(
    indexJs.includes('app.post("/api/assignments/:id/assets/uploads/start", requireRole("owner", "admin", "editor", "user", "freelance"), assignmentChunkUploadRateLimit, async (req, res) => {'),
    true
  );
  assert.equal(
    indexJs.includes('app.post("/api/assignments/:id/assets/uploads/:uploadId/chunks", requireRole("owner", "admin", "editor", "user", "freelance"), assignmentChunkUploadRateLimit, assignmentChunkUpload.single("chunk"), async (req, res) => {'),
    true
  );
  assert.equal(
    indexJs.includes('app.post("/api/assignments/:id/assets/uploads/:uploadId/finalize", requireRole("owner", "admin", "editor", "user", "freelance"), assignmentChunkUploadRateLimit, async (req, res) => {'),
    true
  );
});
