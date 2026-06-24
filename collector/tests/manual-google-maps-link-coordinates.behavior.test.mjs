import assert from "node:assert/strict";
import test from "node:test";

import { collectFromManualPayload } from "../collector/sources/adapters/manual.mjs";

const SAMPLE_URL =
  "https://www.google.com/maps/place/%E0%B8%99%E0%B9%89%E0%B8%B3%E0%B8%95%E0%B8%81%E0%B8%AB%E0%B9%89%E0%B8%A7%E0%B8%A2%E0%B8%AB%E0%B8%A5%E0%B8%A7%E0%B8%87+%E0%B8%A0%E0%B8%B9%E0%B8%88%E0%B8%AD%E0%B8%87%E0%B8%99%E0%B8%B2%E0%B8%A2%E0%B8%AD%E0%B8%A2/@14.4426651,105.2683356,252m/data=!3m1!1e3!4m6!3m5!1s0x3113f7d313aca491:0xe16a37ad87d1284f!8m2!3d14.4422717!4d105.2741437!16s%2Fg%2F11qh1x72x8!5m1!1e2?authuser=0&entry=ttu";

function createMockResponse({
  url,
  html = "<html><head><title></title></head><body></body></html>",
  contentType = "text/html; charset=utf-8",
} = {}) {
  return {
    ok: true,
    status: 200,
    url,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? contentType : null;
      },
    },
    async arrayBuffer() {
      return new TextEncoder().encode(html).buffer;
    },
  };
}

async function withFetchMock(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function collectOne(sourceUrl, fetchImpl) {
  return withFetchMock(fetchImpl, async () => {
    const [row] = await collectFromManualPayload([{ source_url: sourceUrl }]);
    return row;
  });
}

async function withImmediateTimers(run) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => {
    queueMicrotask(() => {
      if (typeof callback === "function") callback(...args);
    });
    return 1;
  };
  globalThis.clearTimeout = () => {};
  try {
    return await run();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

test("sample Google Maps place URL yields parsed coordinates and map_url", async () => {
  const row = await collectOne(SAMPLE_URL, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.latitude, 14.4422717);
  assert.equal(row.normalized_json.longitude, 105.2741437);
  assert.equal(row.normalized_json.map_url, SAMPLE_URL);
  assert.equal(row.normalized_json.source_url, SAMPLE_URL);
  assert.equal(row.normalized_json.google_place_id, "");
});

test("submitted pin coordinates win over final viewport and preserve source_url versus map_url", async () => {
  const submittedUrl =
    "https://www.google.com/maps/place/%E0%B8%99%E0%B9%89%E0%B8%B3%E0%B8%95%E0%B8%81%E0%B8%AB%E0%B9%89%E0%B8%A7%E0%B8%A2%E0%B8%AB%E0%B8%A5%E0%B8%A7%E0%B8%87/@14.4426651,105.2683356,252m/data=!3m1!1e3!4m6!3m5!1s0x3113f7d313aca491:0xe16a37ad87d1284f!8m2!3d14.4422717!4d105.2741437!16s%2Fg%2F11qh1x72x8!5m1!1e2?authuser=0&entry=ttu";
  const finalUrl = "https://www.google.com/maps/place/Test/@14.111,105.222,12z/data=!3m1!1e3";
  const row = await collectOne(submittedUrl, async () => createMockResponse({ url: finalUrl }));

  assert.equal(row.normalized_json.latitude, 14.4422717);
  assert.equal(row.normalized_json.longitude, 105.2741437);
  assert.equal(row.normalized_json.source_url, submittedUrl);
  assert.equal(row.normalized_json.map_url, finalUrl);
  assert.equal(row.payload_json.payload_json.submitted_url, submittedUrl);
  assert.equal(row.payload_json.payload_json.fetched_url, finalUrl);
});

test("place-pin coordinates win over viewport coordinates", async () => {
  const url =
    "https://www.google.com/maps/place/Test/@14.111,105.222,12z/data=!3m1!1e3!3d14.4422717!4d105.2741437";
  const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.latitude, 14.4422717);
  assert.equal(row.normalized_json.longitude, 105.2741437);
});

test("viewport coordinates work when place-pin coordinates are absent", async () => {
  const url = "https://www.google.com/maps/place/Test/@14.111,105.222,12z/data=!3m1!1e3";
  const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.latitude, 14.111);
  assert.equal(row.normalized_json.longitude, 105.222);
});

test("zero coordinates survive the full manual adapter normalize path", async () => {
  const url = "https://www.google.com/maps/place/Test/@0,0,12z/data=!3m1!1e3!3d0!4d0";
  const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.latitude, 0);
  assert.equal(row.normalized_json.longitude, 0);
  assert.equal(row.normalized_json.map_url, url);
});

test("q query coordinates work", async () => {
  const url = "https://www.google.com/maps/search/?q=14.4422717,105.2741437";
  const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.latitude, 14.4422717);
  assert.equal(row.normalized_json.longitude, 105.2741437);
});

test("maps.google.com query coordinates work", async () => {
  const url = "https://maps.google.com/?q=14.4422717,105.2741437";
  const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.latitude, 14.4422717);
  assert.equal(row.normalized_json.longitude, 105.2741437);
  assert.equal(row.normalized_json.map_url, url);
});

test("query query coordinates work", async () => {
  const url = "https://www.google.com/maps/search/?query=14.4422717,105.2741437";
  const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.latitude, 14.4422717);
  assert.equal(row.normalized_json.longitude, 105.2741437);
});

test("invalid coordinate ranges are rejected", async () => {
  const url = "https://www.google.com/maps/place/Test/@91,181,12z/data=!3m1!1e3";
  const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.latitude, null);
  assert.equal(row.normalized_json.longitude, null);
});

test("missing one coordinate is rejected", async () => {
  const url = "https://www.google.com/maps/place/Test/@14.111,/data=!3m1!1e3";
  const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.latitude, null);
  assert.equal(row.normalized_json.longitude, null);
});

test("encoded place title is decoded", async () => {
  const row = await collectOne(SAMPLE_URL, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.title, "น้ำตกห้วยหลวง ภูจองนายอย");
});

test("user-provided title is not replaced by decoded place title", async () => {
  const row = await withFetchMock(async (requestUrl) => createMockResponse({ url: requestUrl }), async () => {
    const [result] = await collectFromManualPayload([{ source_url: SAMPLE_URL, title: "User Title" }]);
    return result;
  });

  assert.equal(row.normalized_json.title, "User Title");
  assert.equal(row.normalized_json.source_url, SAMPLE_URL);
});

test("reliable fetched metadata title wins over decoded URL fallback", async () => {
  const row = await collectOne(SAMPLE_URL, async (requestUrl) =>
    createMockResponse({
      url: requestUrl,
      html: "<html><head><title>Fetched Title</title></head><body></body></html>",
    })
  );

  assert.equal(row.normalized_json.title, "Fetched Title");
});

test("explicit title equal to decoded place title is preserved even with fetched metadata", async () => {
  const decodedTitle = "น้ำตกห้วยหลวง ภูจองนายอย";
  const row = await withFetchMock(
    async (requestUrl) =>
      createMockResponse({
        url: requestUrl,
        html: "<html><head><title>Different Fetched Title</title></head><body></body></html>",
      }),
    async () => {
      const [result] = await collectFromManualPayload([{ source_url: SAMPLE_URL, title: decodedTitle }]);
      return result;
    }
  );

  assert.equal(row.normalized_json.title, decodedTitle);
});

test("generic fetched Google Maps title falls back to decoded place title", async () => {
  const row = await collectOne(SAMPLE_URL, async (requestUrl) =>
    createMockResponse({
      url: requestUrl,
      html: "<html><head><title>Google Maps</title></head><body></body></html>",
    })
  );

  assert.equal(row.normalized_json.title, "น้ำตกห้วยหลวง ภูจองนายอย");
});

test("malformed percent encoding in place title does not throw", async () => {
  const url = "https://www.google.com/maps/place/%E0%B8%ZZ/@14.111,105.222,12z/data=!3m1!1e3";
  const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));

  assert.equal(row.normalized_json.map_url, url);
  assert.equal(row.normalized_json.latitude, 14.111);
  assert.equal(row.normalized_json.longitude, 105.222);
});

test("non-http Google Maps schemes are rejected", async () => {
  const urls = [
    "ftp://google.com/maps/place/Test/@14.1,105.2",
    "file://google.com/maps/place/Test/@14.1,105.2",
    "javascript://google.com/maps/place/Test/@14.1,105.2",
    "data://google.com/maps/place/Test/@14.1,105.2",
    "custom://google.com/maps/place/Test/@14.1,105.2",
  ];
  for (const url of urls) {
    const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));
    assert.equal(row.normalized_json.map_url, "");
    assert.equal(row.normalized_json.latitude, null);
    assert.equal(row.normalized_json.longitude, null);
  }
});

test("fetch failure still preserves parsed coordinates and map_url", async () => {
  const row = await collectOne(SAMPLE_URL, async () => {
    throw new Error("network blocked");
  });

  assert.equal(row.normalized_json.latitude, 14.4422717);
  assert.equal(row.normalized_json.longitude, 105.2741437);
  assert.equal(row.normalized_json.map_url, SAMPLE_URL);
  assert.equal(row.normalized_json.source_url, SAMPLE_URL);
});

test("recognized short Maps URLs are eligible as map_url", async () => {
  const shortUrls = ["https://goo.gl/maps/example", "https://maps.app.goo.gl/example"];
  for (const url of shortUrls) {
    const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));
    assert.equal(row.normalized_json.map_url, url);
    assert.equal(row.normalized_json.latitude, null);
    assert.equal(row.normalized_json.longitude, null);
  }
});

test("invalid high-priority coordinates block lower-priority viewport coordinates", async () => {
  const urls = [
    "https://www.google.com/maps/place/Test/@14.111,105.222,12z/data=!3m1!1e3!3d91!4d181",
    "https://www.google.com/maps/place/Test/@91,181,12z/data=!3m1!1e3",
  ];
  for (const url of urls) {
    const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));
    assert.equal(row.normalized_json.latitude, null);
    assert.equal(row.normalized_json.longitude, null);
  }
});

test("invalid q or query coordinates block lower-priority viewport coordinates", async () => {
  const urls = [
    "https://www.google.com/maps/search/?q=91,181&@14.111,105.222,12z",
    "https://www.google.com/maps/search/?query=91,181&@14.111,105.222,12z",
  ];
  for (const url of urls) {
    const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));
    assert.equal(row.normalized_json.latitude, null);
    assert.equal(row.normalized_json.longitude, null);
  }
});

test("supported Maps hosts reject unrelated Google and non-Maps URLs", async () => {
  const rejectedUrls = [
    "https://evilgoogle.com/maps/place/Test/@14.1,105.2",
    "https://google.com.evil.example/maps/place/Test/@14.1,105.2",
    "https://www.google.com/search?q=14.1,105.2",
    "https://accounts.google.com/?q=14.1,105.2",
    "https://goo.gl/example",
  ];
  for (const url of rejectedUrls) {
    const row = await collectOne(url, async (requestUrl) => createMockResponse({ url: requestUrl }));
    assert.equal(row.normalized_json.map_url, "");
    assert.equal(row.normalized_json.latitude, null);
    assert.equal(row.normalized_json.longitude, null);
  }
});

test("legacy generated host-path placeholder behavior remains compatible", async () => {
  const row = await withFetchMock(
    async (requestUrl) =>
      createMockResponse({
        url: requestUrl,
        html: "<html><head><title>Fetched Title</title></head><body></body></html>",
      }),
    async () => {
      const [result] = await collectFromManualPayload([{ source_url: "https://example.com/manual/page", title: "example.com/manual/page" }]);
      return result;
    }
  );

  assert.equal(row.normalized_json.title, "Fetched Title");
});

test("outer timeout fallback preserves locally parsed coordinates and map_url", async () => {
  const sourceUrl = SAMPLE_URL;
  const row = await withImmediateTimers(async () =>
    withFetchMock(async () => new Promise(() => {}), async () => {
      const [result] = await collectFromManualPayload([{ source_url: sourceUrl }]);
      return result;
    })
  );

  assert.equal(row.normalized_json.latitude, 14.4422717);
  assert.equal(row.normalized_json.longitude, 105.2741437);
  assert.equal(row.normalized_json.source_url, sourceUrl);
  assert.equal(row.normalized_json.map_url, sourceUrl);
});

test("non-Google URL keeps existing behavior", async () => {
  const url = "https://example.com/article";
  const row = await collectOne(url, async (requestUrl) =>
    createMockResponse({
      url: requestUrl,
      html: "<html><head><title>Example Article</title></head><body></body></html>",
    })
  );

  assert.equal(row.normalized_json.latitude, null);
  assert.equal(row.normalized_json.longitude, null);
  assert.equal(row.normalized_json.map_url, "");
  assert.equal(row.normalized_json.title, "Example Article");
  assert.equal(row.normalized_json.google_place_id, "");
});
