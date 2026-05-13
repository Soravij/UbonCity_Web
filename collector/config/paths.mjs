import path from "path";

export function resolvePaths(baseDir = process.cwd()) {
  const rootDir = path.resolve(baseDir);
  const rawDir = process.env.RAW_DIR ? path.resolve(process.env.RAW_DIR) : path.join(rootDir, "raw");
  const stagingDir = process.env.STAGING_DIR ? path.resolve(process.env.STAGING_DIR) : path.join(rootDir, "staging", "content");
  const exportDir = process.env.EXPORT_DIR ? path.resolve(process.env.EXPORT_DIR) : stagingDir;
  const mediaDir = process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : path.join(rootDir, "media");
  const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(rootDir, "data", "collector.db");

  return {
    rootDir,
    rawDir,
    stagingDir,
    exportDir,
    mediaDir,
    dbPath,
  };
}
