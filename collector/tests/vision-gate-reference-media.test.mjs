import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectVisualImageUrls,
  fetchImageUrlToDataUrl,
  prepareVisualImageInputs,
} from "../services/agent-generation.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const workflowSource = fs.readFileSync(path.join(collectorRoot, "services", "workflow.mjs"), "utf8");
const agentGenSource = fs.readFileSync(path.join(collectorRoot, "services", "agent-generation.mjs"), "utf8");

// ─── งาน 1: gate source-code assertions ───

test("workflow gate source checks reference_media_context.selected_urls", () => {
  assert.match(
    workflowSource,
    /referenceMediaUrls\.length\s*>\s*0/,
    "gate must check referenceMediaUrls.length > 0"
  );
  assert.match(
    workflowSource,
    /const referenceMediaUrls\s*=\s*Array\.isArray\(item\?\.structured_context\?\.reference_media_context\?\.selected_urls\)/,
    "gate must read reference_media_context.selected_urls from item"
  );
});

test("workflow gate source uses OR condition for visual_image_urls and reference_media", () => {
  assert.match(
    workflowSource,
    /\(visualImageUrls\.length\s*>\s*0\s*\|\|\s*referenceMediaUrls\.length\s*>\s*0\)/,
    "gate must pass when either visual_image_urls or reference_media has items"
  );
});

test("visual_context.start trace uses collectVisualImageUrls for image_count", () => {
  const traceMatch = workflowSource.match(
    /traceAiDraft\("visual_context\.start",\s*\{[^}]*image_count:\s*([^}]+)\}\)/
  );
  assert.ok(traceMatch, "visual_context.start trace must exist");
  assert.match(
    traceMatch[1],
    /collectVisualImageUrls\(item/,
    "image_count must use collectVisualImageUrls(item, ...) to include both local and reference-media urls"
  );
  assert.doesNotMatch(
    traceMatch[1],
    /^visualImageUrls\.length$/,
    "image_count must NOT be just visualImageUrls.length (would miss reference-media-only items)"
  );
});

// ─── งาน 1: functional gate test via collectVisualImageUrls ───

test("collectVisualImageUrls includes reference_media_context.selected_urls", () => {
  const item = {
    visual_image_urls: [],
    structured_context: {
      reference_media_context: {
        selected_urls: ["https://example.com/crawl-photo.jpg"],
      },
    },
  };
  const urls = collectVisualImageUrls(item, 5);
  assert.deepEqual(urls, ["https://example.com/crawl-photo.jpg"]);
});

test("collectVisualImageUrls deduplicates urls across both sources", () => {
  const item = {
    visual_image_urls: ["https://example.com/shared.jpg"],
    structured_context: {
      reference_media_context: {
        selected_urls: ["https://example.com/shared.jpg", "https://example.com/other.jpg"],
      },
    },
  };
  const urls = collectVisualImageUrls(item, 5);
  assert.deepEqual(urls, ["https://example.com/shared.jpg", "https://example.com/other.jpg"]);
});

test("collectVisualImageUrls caps at 5 urls total", () => {
  const item = {
    visual_image_urls: [
      "https://example.com/local1.jpg",
      "https://example.com/local2.jpg",
      "https://example.com/local3.jpg",
    ],
    structured_context: {
      reference_media_context: {
        selected_urls: [
          "https://example.com/ref1.jpg",
          "https://example.com/ref2.jpg",
          "https://example.com/ref3.jpg",
        ],
      },
    },
  };
  const urls = collectVisualImageUrls(item, 5);
  assert.equal(urls.length, 5);
});

test("collectVisualImageUrls returns empty when both sources are empty", () => {
  const item = {
    visual_image_urls: [],
    structured_context: {
      reference_media_context: {
        selected_urls: [],
      },
    },
  };
  const urls = collectVisualImageUrls(item, 5);
  assert.deepEqual(urls, []);
});

// ─── งาน 2: timeout source-code assertion ───

test("fetchImageUrlToDataUrl source uses AbortSignal.timeout", () => {
  assert.match(
    agentGenSource,
    /AbortSignal\.timeout\(timeoutMs\)/,
    "fetchImageUrlToDataUrl must use AbortSignal.timeout"
  );
  assert.match(
    agentGenSource,
    /COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS/,
    "fetchImageUrlToDataUrl must read timeout from COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS env"
  );
});

// ─── งาน 2: timeout functional test ───

test("fetchImageUrlToDataUrl times out on slow responses", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS;
  process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS = "50";

  globalThis.fetch = async (_url, options = {}) => {
    const signal = options.signal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(new Response("too-late", {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }));
      }, 5000);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason || new DOMException("The operation was aborted", "AbortError"));
        });
      }
    });
  };

  try {
    await assert.rejects(
      () => fetchImageUrlToDataUrl("https://example.com/slow-image.jpg"),
      (err) => {
        assert.ok(err.name === "AbortError" || err.message.includes("aborted"), `expected AbortError, got: ${err.name}: ${err.message}`);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS;
    } else {
      process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS = originalEnv;
    }
  }
});

test("fetchImageUrlToDataUrl timeout skips silently in prepareVisualImageInputs", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS;
  process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS = "50";

  let fetchCalls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    fetchCalls += 1;
    const signal = options.signal;
    if (_url.includes("slow")) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response("too-late", {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }));
        }, 5000);
        if (signal) {
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason || new DOMException("The operation was aborted", "AbortError"));
          });
        }
      });
    }
    return new Response("fake-image", {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  };

  try {
    const item = {
      visual_image_urls: ["https://example.com/slow.jpg", "https://example.com/fast.jpg"],
      structured_context: {
        reference_media_context: { selected_urls: [] },
      },
    };
    const inputs = await prepareVisualImageInputs(item, 5);
    assert.equal(inputs.length, 1, "slow image should be skipped, fast image should succeed");
    assert.ok(fetchCalls >= 2, "fetch should have been called for both urls");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS;
    } else {
      process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS = originalEnv;
    }
  }
});

test("fetchImageUrlToDataUrl uses default 15s timeout when env is not set", () => {
  const originalEnv = process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS;
  delete process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS;
  try {
    const match = agentGenSource.match(
      /Number\(process\.env\.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS\s*\|\|\s*(\d+)\)/
    );
    assert.ok(match, "source must have default timeout fallback");
    assert.equal(match[1], "15000", "default timeout must be 15000ms");
  } finally {
    if (originalEnv !== undefined) {
      process.env.COLLECTOR_VISUAL_IMAGE_TIMEOUT_MS = originalEnv;
    }
  }
});
