import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Several collector tests (in-flight-items, raw-delete, item-blocker-summary,
// audit-delete-tier-consistency, deleted-item-purge-gate, deleted-item-reference-classification)
// resolve collector/database/schema.sql relative to process.cwd() instead of import.meta.url, so
// running this from anywhere but the repo root silently opens the wrong path. Enforce cwd here
// instead of relying on whoever runs the command to remember.
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaMarker = path.join(repoRoot, "collector", "database", "schema.sql");

function assertRunningFromRepoRoot() {
  const cwd = path.resolve(process.cwd());
  if (cwd !== path.resolve(repoRoot) || !fs.existsSync(schemaMarker)) {
    console.error(
      `test:all must run from the repo root.\n` +
      `  expected cwd: ${repoRoot}\n` +
      `  actual cwd:   ${cwd}\n` +
      `Run: cd "${repoRoot}" && npm run test:all`
    );
    process.exit(1);
  }
}

function collectTestFiles(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .filter((entry) => entry.endsWith(".test.mjs"))
    .map((entry) => path.join(dir, entry))
    .sort();
}

assertRunningFromRepoRoot();

const testFiles = [
  ...collectTestFiles(path.join(repoRoot, "backend", "tests")),
  ...collectTestFiles(path.join(repoRoot, "collector", "tests")),
];

// Explicit file list (not a shell glob) so this behaves the same whether npm invokes cmd.exe,
// PowerShell, or bash. --test-concurrency=1 (still one process per file — this is not
// --test-isolation=none) is the invocation proven deterministic in docs/TEST_SUITE_BASELINE.md.
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--experimental-test-module-mocks", ...testFiles], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
