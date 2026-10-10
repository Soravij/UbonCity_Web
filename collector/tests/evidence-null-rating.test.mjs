import test from "node:test";
import assert from "node:assert/strict";
import { toFiniteNumberOrNull } from "../server/evidence-candidates.mjs";

test("toFiniteNumberOrNull: null, undefined, empty and blank strings become null", () => {
  assert.equal(toFiniteNumberOrNull(null), null);
  assert.equal(toFiniteNumberOrNull(undefined), null);
  assert.equal(toFiniteNumberOrNull(""), null);
  assert.equal(toFiniteNumberOrNull(" "), null);
});

test("toFiniteNumberOrNull: real zero is preserved", () => {
  assert.equal(toFiniteNumberOrNull(0), 0);
  assert.equal(toFiniteNumberOrNull("0"), 0);
});

test("toFiniteNumberOrNull: numeric values pass through", () => {
  assert.equal(toFiniteNumberOrNull(4.5), 4.5);
  assert.equal(toFiniteNumberOrNull("4.5"), 4.5);
});

test("toFiniteNumberOrNull: non-numeric values become null", () => {
  assert.equal(toFiniteNumberOrNull("abc"), null);
  assert.equal(toFiniteNumberOrNull(NaN), null);
});

// ── pickFirstFiniteNumber (server/index.mjs) and the normalizer copy ──
// index.mjs opens its DB at module load, so it is imported in a child process
// against a throwaway DB (same pattern as import-dedupe.behavior.test.mjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toFiniteNumberOrNull as normalizerToNumber } from "../collector/sources/extracted-payload-normalizer.mjs";

const collectorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverModuleUrl = pathToFileURL(path.join(collectorRoot, "server", "index.mjs")).href;

function runPickFirstFiniteNumber(argSets) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-pick-finite-"));
  const runnerPath = path.join(tempDir, "runner.mjs");
  fs.writeFileSync(runnerPath, String.raw`
process.chdir(process.env.COLLECTOR_ROOT);
const { pickFirstFiniteNumber } = await import(process.env.SERVER_MODULE_URL);
const sets = JSON.parse(process.env.ARG_SETS_JSON).map((a) => a.map((v) => (v === "__undefined__" ? undefined : v)));
console.log(JSON.stringify(sets.map((a) => pickFirstFiniteNumber(...a))));
`, "utf8");
  const result = spawnSync(process.execPath, [runnerPath], {
    cwd: collectorRoot,
    env: {
      ...process.env,
      COLLECTOR_ROOT: collectorRoot,
      DB_PATH: path.join(tempDir, "collector.sqlite"),
      SERVER_MODULE_URL: serverModuleUrl,
      ARG_SETS_JSON: JSON.stringify(argSets),
      COLLECTOR_DISABLE_LISTEN: "1",
    },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  try {
    if (result.status !== 0) {
      throw new Error(`pickFirstFiniteNumber runner failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    const lines = String(result.stdout || "").trim().split("\n");
    return JSON.parse(lines[lines.length - 1]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("pickFirstFiniteNumber skips null/blank/undefined and keeps real zero", () => {
  const U = "__undefined__";
  const out = runPickFirstFiniteNumber([
    [null, 4.5],
    ["", U, 12],
    [0, 4.5],
    [null, U],
  ]);
  assert.deepEqual(out, [4.5, 12, 0, null]);
});

test("normalizer toFiniteNumberOrNull: null stays null, numeric string parses", () => {
  assert.equal(normalizerToNumber(null), null);
  assert.equal(normalizerToNumber("3"), 3);
});
