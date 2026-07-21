import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const appSource = fs.readFileSync(path.resolve("D:/UbonCity_Web/collector/server/public/app.js"), "utf8");

function extractFunctionBlock(source, name) {
  const start = [`async function ${name}`, `function ${name}`]
    .map((signature) => source.indexOf(signature))
    .find((index) => index >= 0) ?? -1;
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function block: ${name}`);
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function loadHarness(api) {
  const state = {
    referenceCleanupRequestSeq: 0,
    referenceCleanupSelectedItemId: 0,
    referenceCleanupReferences: null,
    referenceCleanupSelectedGroups: new Set(),
    cleanup: { rows: [] },
    referenceCleanupDeletedItems: [],
  };
  const context = {
    state,
    isOwnerUser: () => true,
    api,
    replaceCleanupRow(item) {
      state.cleanup.rows = state.cleanup.rows.map((row) => (Number(row?.id || 0) === Number(item?.id || 0) ? item : row));
      return item;
    },
    renderDataCleanupPanel() {},
    renderReferenceCleanupPanel() {},
    window: { prompt: () => "race test" },
    REFERENCE_CONFIRM_REQUIRED_KEYS: new Set(),
  };
  context.globalThis = context;
  vm.runInNewContext(`
${extractFunctionBlock(appSource, "beginReferenceCleanupRequest")}
${extractFunctionBlock(appSource, "isCurrentReferenceCleanupRequest")}
${extractFunctionBlock(appSource, "refreshCleanupRow")}
${extractFunctionBlock(appSource, "loadReferencesForItem")}
${extractFunctionBlock(appSource, "refreshReferenceCleanupCheck")}
${extractFunctionBlock(appSource, "executeReferenceCleanup")}
globalThis.__hooks = {
  beginReferenceCleanupRequest,
  refreshReferenceCleanupCheck,
  executeReferenceCleanup,
};
`, context, { filename: "reference-cleanup-ui-race.js" });
  return { state, hooks: context.__hooks };
}

test("checked-item action keeps B after A's stale cleanup-check response returns", async () => {
  const firstCheck = deferred();
  const secondCheck = deferred();
  const secondReferences = deferred();
  const urls = [];
  const { state, hooks } = loadHarness((url) => {
    urls.push(url);
    if (url.endsWith("/1/cleanup-check")) return firstCheck.promise;
    if (url.endsWith("/2/cleanup-check")) return secondCheck.promise;
    if (url.endsWith("/2/references")) return secondReferences.promise;
    throw new Error(`unexpected URL: ${url}`);
  });

  const firstSeq = hooks.beginReferenceCleanupRequest(1);
  const firstRequest = hooks.refreshReferenceCleanupCheck(1, firstSeq);
  const secondSeq = hooks.beginReferenceCleanupRequest(2);
  const secondRequest = hooks.refreshReferenceCleanupCheck(2, secondSeq);
  secondCheck.resolve({ item: { id: 2, title: "B" } });
  await Promise.resolve();
  secondReferences.resolve({ item_id: 2, groups: [{ key: "source_records" }] });
  const secondResult = await secondRequest;
  firstCheck.resolve({ item: { id: 1, title: "A" } });
  const firstResult = await firstRequest;

  assert.equal(secondResult?.item?.id, 2, "B must complete the full refresh then references path");
  assert.equal(firstResult, null, "the stale cleanup-check must stop before references are fetched");
  assert.equal(urls.includes("/api/admin/deleted-items/1/references"), false, "A must not issue the meaningless second request");
  assert.equal(state.referenceCleanupSelectedItemId, 2);
  assert.deepEqual(state.referenceCleanupReferences, { item_id: 2, groups: [{ key: "source_records" }] });
});

test("a successful sweep still uses exactly cleanup, cleanup-check, and references requests", async () => {
  const urls = [];
  const { state, hooks } = loadHarness(async (url) => {
    urls.push(url);
    if (url.endsWith("/references/cleanup")) return { cleaned: { source_records: 1 } };
    if (url.endsWith("/cleanup-check")) return { item: { id: 9, title: "Swept" } };
    if (url.endsWith("/references")) return { item_id: 9, groups: [] };
    throw new Error(`unexpected URL: ${url}`);
  });
  state.referenceCleanupSelectedItemId = 9;
  state.referenceCleanupSelectedGroups = new Set(["source_records"]);

  await hooks.executeReferenceCleanup();

  assert.deepEqual(urls, [
    "/api/admin/deleted-items/9/references/cleanup",
    "/api/admin/deleted-items/9/cleanup-check",
    "/api/admin/deleted-items/9/references",
  ]);
});
