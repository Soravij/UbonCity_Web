import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { itemAssetDir, placeIntoItemAssetDir } from "../server/item-asset-dir.mjs";

test("placeIntoItemAssetDir creates directory and moves file", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "item-asset-dir-"));
  try {
    const srcDir = path.join(tmpDir, "staging");
    fs.mkdirSync(srcDir, { recursive: true });
    const srcFile = path.join(srcDir, "photo.jpg");
    fs.writeFileSync(srcFile, "fake-image-data");

    const result = await placeIntoItemAssetDir(tmpDir, srcFile, 42, "photo.jpg");

    assert.ok(result.absolutePath.endsWith(path.join("itemsAsset", "42", "photo.jpg")), `unexpected path: ${result.absolutePath}`);
    assert.ok(fs.existsSync(result.absolutePath), "target file should exist");
    assert.ok(!fs.existsSync(srcFile), "source file should be removed");
    assert.equal(fs.readFileSync(result.absolutePath, "utf8"), "fake-image-data");
    assert.equal(result.fileName, path.basename(result.absolutePath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("placeIntoItemAssetDir handles filename collision with -2 suffix", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "item-asset-dir-"));
  try {
    const itemDir = path.join(tmpDir, "itemsAsset", "99");
    fs.mkdirSync(itemDir, { recursive: true });
    fs.writeFileSync(path.join(itemDir, "shot__pic-item99-01-20260912.jpg"), "existing");

    const srcDir = path.join(tmpDir, "staging");
    fs.mkdirSync(srcDir, { recursive: true });
    const srcFile = path.join(srcDir, "shot__pic-item99-01-20260912.jpg");
    fs.writeFileSync(srcFile, "new-data");

    const result = await placeIntoItemAssetDir(tmpDir, srcFile, 99, "shot__pic-item99-01-20260912.jpg");

    assert.ok(result.absolutePath.endsWith("-2.jpg"), `expected -2 suffix, got: ${result.absolutePath}`);
    assert.ok(fs.existsSync(result.absolutePath), "collision file should exist");
    assert.equal(fs.readFileSync(result.absolutePath, "utf8"), "new-data");
    assert.equal(fs.readFileSync(path.join(itemDir, "shot__pic-item99-01-20260912.jpg"), "utf8"), "existing");
    assert.equal(result.fileName, path.basename(result.absolutePath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("placeIntoItemAssetDir increments suffix on repeated collisions", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "item-asset-dir-"));
  try {
    const itemDir = path.join(tmpDir, "itemsAsset", "7");
    fs.mkdirSync(itemDir, { recursive: true });
    fs.writeFileSync(path.join(itemDir, "a.jpg"), "v1");
    fs.writeFileSync(path.join(itemDir, "a-2.jpg"), "v2");

    const srcDir = path.join(tmpDir, "staging");
    fs.mkdirSync(srcDir, { recursive: true });
    const srcFile = path.join(srcDir, "a.jpg");
    fs.writeFileSync(srcFile, "v3");

    const result = await placeIntoItemAssetDir(tmpDir, srcFile, 7, "a.jpg");

    assert.ok(result.absolutePath.endsWith("a-3.jpg"), `expected a-3.jpg, got: ${result.absolutePath}`);
    assert.equal(fs.readFileSync(result.absolutePath, "utf8"), "v3");
    assert.equal(result.fileName, path.basename(result.absolutePath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
