import assert from "node:assert/strict";
import test from "node:test";

import { collectFromManualPayload } from "../collector/sources/adapters/manual.mjs";

const WIKI_URL =
  "https://th.wikipedia.org/wiki/%E0%B8%97%E0%B8%B8%E0%B9%88%E0%B8%87%E0%B8%A8%E0%B8%A3%E0%B8%B5%E0%B9%80%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%87";

const HTML = "<html><head><title>ทุ่งศรีเมือง - วิกิพีเดีย</title></head><body></body></html>";

const API_FIXTURE = {
  query: {
    pages: [
      {
        title: "ทุ่งศรีเมือง",
        extract:
          "ทุ่งศรีเมืองเป็นลานกว้างกลางเมืองอุบลราชธานี ใช้จัดงานประเพณีแห่เทียนพรรษาเป็นประจำทุกปี\n\n" +
          "== สิ่งก่อสร้างภายในทุ่งศรีเมือง ==\n" +
          "ภายในทุ่งศรีเมืองมีอนุสาวรีย์ เสาหลักเมือง และหอพระพุทธรูปสำคัญหลายแห่ง ซึ่งประชาชนเข้ามาสักการะอยู่เสมอ\n\n" +
          "== ดูเพิ่ม ==\n" +
          "รายการสถานที่ท่องเที่ยวในจังหวัดอุบลราชธานีที่เกี่ยวข้องกับทุ่งศรีเมืองและประเพณีของเมือง",
        coordinates: [{ lat: 15.23022222, lon: 104.85730556, primary: true }],
        original: {
          source: "https://upload.wikimedia.org/wikipedia/commons/e/ed/Thung_Si_Muang.jpg?utm_source=x",
        },
      },
    ],
  },
};

function makeFetchMock({ apiStatus, apiBody }) {
  return async (fetchUrl) => {
    const url = String(fetchUrl);
    if (url.includes("/w/api.php")) {
      return {
        ok: apiStatus >= 200 && apiStatus < 300,
        status: apiStatus,
        url,
        headers: { get: (n) => (String(n || "").toLowerCase() === "content-type" ? "application/json" : null) },
        async json() {
          return apiBody;
        },
        async arrayBuffer() {
          return new TextEncoder().encode(JSON.stringify(apiBody)).buffer;
        },
      };
    }
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: (n) => (String(n || "").toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
      async arrayBuffer() {
        return new TextEncoder().encode(HTML).buffer;
      },
    };
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

async function collectOne(fetchImpl) {
  return withFetchMock(fetchImpl, async () => {
    const [row] = await collectFromManualPayload([{ source_url: WIKI_URL }]);
    return row;
  });
}

test("wikipedia api: extract, coordinates and image come from MediaWiki API", async () => {
  const row = await collectOne(makeFetchMock({ apiStatus: 200, apiBody: API_FIXTURE }));
  const payload = row?.payload_json?.payload_json;
  const meta = payload?.extracted_metadata;
  const article = payload?.extracted_article;
  assert.ok(meta, "extracted_metadata should exist");
  assert.equal(meta.title, "ทุ่งศรีเมือง");
  assert.ok(!meta.title.includes("วิกิพีเดีย"), "title must not carry the site suffix");
  assert.equal(meta.latitude, 15.23022222);
  assert.equal(meta.longitude, 104.85730556);
  assert.equal(meta.image, "https://upload.wikimedia.org/wikipedia/commons/e/ed/Thung_Si_Muang.jpg");
  assert.ok(article, "extracted_article should exist");
  assert.ok(
    article.section_texts.some((t) => t.startsWith("สิ่งก่อสร้างภายในทุ่งศรีเมือง:")),
    "body section should be present with its heading prefix"
  );
  for (const t of article.section_texts) {
    assert.ok(!t.includes("ดูเพิ่ม"), `skipped heading leaked: ${t}`);
    assert.ok(!t.includes("รายการสถานที่"), `skipped section body leaked: ${t}`);
  }
});

test("wikipedia api: HTTP 500 does not throw and falls back to generic metadata", async () => {
  const row = await collectOne(makeFetchMock({ apiStatus: 500, apiBody: {} }));
  assert.ok(row, "row should still be returned");
  assert.notEqual(row.source_name, "wikipedia.org");
  assert.notEqual(row?.payload_json?.payload_json?.extracted_metadata?.latitude, 15.23022222);
});
