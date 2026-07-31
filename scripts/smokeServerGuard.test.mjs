import assert from "node:assert/strict";
import test from "node:test";
import { assertSmokeServerTargetsAllowed } from "./smokeServerGuard.mjs";

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("target guard rejects a non-test backend before collector or fixture work", async () => {
  const requests = [];
  let wroteFixture = false;
  await assert.rejects(
    async () => {
      await assertSmokeServerTargetsAllowed({
        backendBaseUrl: "http://backend.test",
        collectorBaseUrl: "http://collector.test",
        fetchImpl: async (url) => {
          requests.push(url);
          return response(200, { ok: true, database: { engine: "mysql", name: "uboncity" } });
        },
      });
      wroteFixture = true;
    },
    /refusing backend database uboncity/
  );
  assert.equal(wroteFixture, false);
  assert.deepEqual(requests, ["http://backend.test/api/health"]);
});

test("target guard accepts test backend and temporary collector databases", async () => {
  const result = await assertSmokeServerTargetsAllowed({
    backendBaseUrl: "http://backend.test",
    collectorBaseUrl: "http://collector.test",
    fetchImpl: async (url) => response(200, url.startsWith("http://backend")
      ? { ok: true, database: { engine: "mysql", name: "ubon_stage" } }
      : { ok: true, database: { engine: "sqlite", path: `${process.env.TEMP || "C:\\Temp"}\\collector-smoke\\collector.db` } }),
  });
  assert.equal(result.backend.name, "ubon_stage");
  assert.equal(result.collector.engine, "sqlite");
});
