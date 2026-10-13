import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolvePaths } from "../config/paths.mjs";

// Resolve everything from this file's location; no absolute machine paths.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const pathsModuleUrl = pathToFileURL(path.join(collectorRoot, "config", "paths.mjs")).href;
const expectedDefaultDb = path.join(collectorRoot, "data", "collector.db");

// Run resolvePaths(baseDir?) in a fresh node process (module imported fresh => COLLECTOR_ROOT
// is evaluated at import time in that process) with a chosen cwd and env.
function runChild({ cwd, env = {}, baseDirArg = null }) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.DB_PATH;
  const script = `
    const m = await import(${JSON.stringify(pathsModuleUrl)});
    const out = ${baseDirArg === null ? "m.resolvePaths()" : `m.resolvePaths(${JSON.stringify(baseDirArg)})`};
    process.stdout.write(JSON.stringify({ cwd: process.cwd(), ...out }));
  `;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd,
    env: { ...cleanEnv, ...env },
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `child failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test("dbPath is collector/data/collector.db regardless of process cwd", () => {
  const otherCwd = fs.mkdtempSync(path.join(os.tmpdir(), "collector-paths-cwd-"));
  try {
    const cwds = [otherCwd, collectorRoot, path.dirname(collectorRoot), path.parse(otherCwd).root];
    for (const cwd of cwds) {
      const out = runChild({ cwd });
      assert.equal(path.resolve(out.dbPath), path.resolve(expectedDefaultDb), `dbPath wrong for cwd=${cwd}`);
      assert.equal(path.resolve(out.cwd), path.resolve(cwd), "child must really run in the requested cwd");
    }
  } finally {
    fs.rmSync(otherCwd, { recursive: true, force: true });
  }
});

test("dbPath does not follow an explicit baseDir argument (only raw/staging/media do)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "collector-paths-base-"));
  try {
    const out = runChild({ cwd: base, baseDirArg: base });
    assert.equal(path.resolve(out.dbPath), path.resolve(expectedDefaultDb));
    assert.equal(path.resolve(out.rootDir), path.resolve(base));
    assert.equal(path.resolve(out.rawDir), path.join(path.resolve(base), "raw"));
    assert.equal(path.resolve(out.mediaDir), path.join(path.resolve(base), "media"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("DB_PATH env override still wins (absolute path)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-paths-env-"));
  try {
    const override = path.join(dir, "override.sqlite");
    const out = runChild({ cwd: dir, env: { DB_PATH: override } });
    assert.equal(path.resolve(out.dbPath), path.resolve(override));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("relative DB_PATH is resolved against process cwd (paths.mjs:14 uses path.resolve)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-paths-rel-"));
  try {
    const out = runChild({ cwd: dir, env: { DB_PATH: "rel/x.sqlite" } });
    assert.equal(path.resolve(out.dbPath), path.resolve(dir, "rel", "x.sqlite"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DB_PATH is read at call time, not import time", () => {
  const saved = process.env.DB_PATH;
  try {
    delete process.env.DB_PATH;
    assert.equal(path.resolve(resolvePaths().dbPath), path.resolve(expectedDefaultDb));

    const override = path.join(os.tmpdir(), "collector-paths-calltime.sqlite");
    process.env.DB_PATH = override; // set AFTER the module was imported
    assert.equal(path.resolve(resolvePaths().dbPath), path.resolve(override));

    delete process.env.DB_PATH;
    assert.equal(path.resolve(resolvePaths().dbPath), path.resolve(expectedDefaultDb), "unsetting must restore default");
  } finally {
    if (saved === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = saved;
  }
});

test("empty-string DB_PATH falls back to the default", () => {
  const out = runChild({ cwd: os.tmpdir(), env: { DB_PATH: "" } });
  assert.equal(path.resolve(out.dbPath), path.resolve(expectedDefaultDb));
});
