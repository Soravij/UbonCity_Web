import fs from "fs/promises";
import { imageSize } from "image-size";

const MIN_DIMENSION = 1;
const MAX_DIMENSION = 20000;

export function readImageDimensionsFromBuffer(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return { width: null, height: null };

    const result = imageSize(buffer);
    const width = Math.floor(Number(result?.width));
    const height = Math.floor(Number(result?.height));
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < MIN_DIMENSION ||
      height < MIN_DIMENSION ||
      width > MAX_DIMENSION ||
      height > MAX_DIMENSION
    ) {
      return { width: null, height: null };
    }

    return { width, height };
  } catch {
    return { width: null, height: null };
  }
}

export async function readImageDimensionsFromDiskPath(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    return readImageDimensionsFromBuffer(buffer);
  } catch {
    return { width: null, height: null };
  }
}
