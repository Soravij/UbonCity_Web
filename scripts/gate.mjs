import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "testAll.mjs")], {
  cwd: repoRoot,
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "pipe"],
});

const stdout = result.stdout ?? "";
const lines = stdout.split(/\r?\n/);

const testsMatch = stdout.match(/tests\s+(\d+)/);
const passMatch = stdout.match(/pass\s+(\d+)/);
const failMatch = stdout.match(/fail\s+(\d+)/);
const skippedMatch = stdout.match(/skipped\s+(\d+)/);

if (!testsMatch || !passMatch || !failMatch || !skippedMatch) {
  console.error("GATE: could not parse summary line from test output");
  process.exit(1);
}

console.log(`GATE tests=${testsMatch[1]} pass=${passMatch[1]} fail=${failMatch[1]} skipped=${skippedMatch[1]}`);
process.exit(0);
