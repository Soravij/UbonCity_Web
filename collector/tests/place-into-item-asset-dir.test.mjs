import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function itemAssetDir(mediaDir, contentItemId) {
  return path.join(mediaDir, "itemsAsset", String(contentItemId));
}

async function placeIntoItemAssetDir(mediaDir, currentAbsPath, contentItemId, fileName) {
  const dir = itemAssetDir(mediaDir, contentItemId);
  await fs.promises.mkdir(dir, { recursive: true });
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let target = path.join(dir, fileName);
  let n = 2;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${base}-${n}${ext}`);
    n += 1;
  }
  await fs.promises.rename(currentAbsPath, target);
  return target;
}

test("placeIntoItemAssetDir creates directory and moves file", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "item-asset-dir-"));
  try {
    const srcDir = path.join(tmpDir, "staging");
    fs.mkdirSync(srcDir, { recursive: true });
    const srcFile = path.join(srcDir, "photo.jpg");
    fs.writeFileSync(srcFile, "fake-image-data");

    const result = await placeIntoItemAssetDir(tmpDir, srcFile, 42, "photo.jpg");

    assert.ok(result.endsWith(path.join("itemsAsset", "42", "photo.jpg")), `unexpected path: ${result}`);
    assert.ok(fs.existsSync(result), "target file should exist");
    assert.ok(!fs.existsSync(srcFile), "source file should be removed");
    assert.equal(fs.readFileSync(result, "utf8"), "fake-image-data");
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

    assert.ok(result.endsWith("-2.jpg"), `expected -2 suffix, got: ${result}`);
    assert.ok(fs.existsSync(result), "collision file should exist");
    assert.equal(fs.readFileSync(result, "utf8"), "new-data");
    assert.equal(fs.readFileSync(path.join(itemDir, "shot__pic-item99-01-20260912.jpg"), "utf8"), "existing");
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

    assert.ok(result.endsWith("a-3.jpg"), `expected a-3.jpg, got: ${result}`);
    assert.equal(fs.readFileSync(result, "utf8"), "v3");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
