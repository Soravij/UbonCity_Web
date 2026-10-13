import path from "path";
import { fileURLToPath } from "url";

// Anchor the default DB to collector/data/collector.db regardless of process.cwd().
// Override with DB_PATH. (raw/staging/media still follow baseDir.)
const COLLECTOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolvePaths(baseDir = process.cwd()) {
  const rootDir = path.resolve(baseDir);
  const rawDir = process.env.RAW_DIR ? path.resolve(process.env.RAW_DIR) : path.join(rootDir, "raw");
  const stagingDir = process.env.STAGING_DIR ? path.resolve(process.env.STAGING_DIR) : path.join(rootDir, "staging", "content");
  const exportDir = process.env.EXPORT_DIR ? path.resolve(process.env.EXPORT_DIR) : stagingDir;
  const mediaDir = process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : path.join(rootDir, "media");
  const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(COLLECTOR_ROOT, "data", "collector.db");
  const rawHtmlBufferDir = process.env.RAW_HTML_BUFFER_DIR
    ? path.resolve(process.env.RAW_HTML_BUFFER_DIR)
    : path.join(rootDir, "raw", "html-buffer");

  return {
    rootDir,
    rawDir,
    stagingDir,
    exportDir,
    mediaDir,
    dbPath,
    rawHtmlBufferDir,
  };
}
