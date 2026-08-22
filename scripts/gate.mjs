import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SUMMARY_PATH = path.join(repoRoot, ".gate-summary.json");

try { fs.unlinkSync(GATE_SUMMARY_PATH); } catch {}

const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "testAll.mjs")], {
  cwd: repoRoot,
  stdio: "inherit",
});

let summary;
try {
  summary = JSON.parse(fs.readFileSync(GATE_SUMMARY_PATH, "utf-8"));
} catch {}

if (!summary || typeof summary.tests !== "number") {
  console.error("GATE: could not parse summary from test output");
  process.exit(1);
}

console.log(`GATE tests=${summary.tests} pass=${summary.pass} fail=${summary.fail} skipped=${summary.skipped}`);
process.exit(result.status ?? 1);
