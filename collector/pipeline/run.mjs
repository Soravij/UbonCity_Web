import path from "path";
import { resolvePaths } from "../config/paths.mjs";
import { collectInput } from "../collector/collect-input.mjs";
import { cleanReviewsAndContent } from "../cleaner/review-cleaner.mjs";
import { generateContentFields } from "../ai/generate-content.mjs";
import { runQualityChecks } from "../quality/checks.mjs";
import { saveStaging } from "../staging/save-staging.mjs";
import { writeCsv, writeJson, writeMarkdown } from "../publisher/exporters.mjs";

export async function runPipeline() {
  const baseDir = path.resolve(process.cwd());
  const dirs = resolvePaths(baseDir);

  const imported = await collectInput(baseDir, dirs.rawDir);
  const cleaned = cleanReviewsAndContent(imported);
  const generated = generateContentFields(cleaned);
  const { accepted, rejected } = runQualityChecks(generated);

  const { outDir, rejectedPath } = await saveStaging(dirs.stagingDir, accepted, rejected);
  const jsonPath = await writeJson(dirs.exportDir, accepted);
  const csvPath = await writeCsv(dirs.exportDir, accepted);
  const mdPath = await writeMarkdown(dirs.exportDir, accepted);

  console.log(`Imported: ${imported.length}`);
  console.log(`Accepted: ${accepted.length}`);
  console.log(`Rejected: ${rejected.length}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`MD: ${mdPath}`);
  console.log(`Rejected report: ${rejectedPath}`);
  console.log(`Staging dir: ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  runPipeline().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
