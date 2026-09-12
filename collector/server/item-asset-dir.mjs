import fs from "node:fs";
import path from "node:path";

export function itemAssetDir(mediaDir, contentItemId) {
  return path.join(mediaDir, "itemsAsset", String(contentItemId));
}

export async function placeIntoItemAssetDir(mediaDir, currentAbsPath, contentItemId, fileName) {
  const dir = itemAssetDir(mediaDir, contentItemId);
  await fs.promises.mkdir(dir, { recursive: true });
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let finalName = fileName;
  let n = 2;
  while (fs.existsSync(path.join(dir, finalName))) {
    finalName = `${base}-${n}${ext}`;
    n += 1;
  }
  const target = path.join(dir, finalName);
  await fs.promises.rename(currentAbsPath, target);
  return { absolutePath: target, fileName: finalName };
}
