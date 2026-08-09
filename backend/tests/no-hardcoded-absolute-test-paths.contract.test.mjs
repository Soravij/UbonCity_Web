import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(__dirname));

// Matches a lone drive letter immediately followed by a colon and a path separator,
// which is how a hardcoded Windows absolute path is shaped. A word boundary before
// the letter keeps multi-letter identifiers like "id:/foo" from matching.
const ABSOLUTE_DRIVE_PATH_PATTERN = /\b[A-Za-z]:[\\/]/;
// A line ending in this marker is a deliberate, reviewed exception (e.g. a mock value
// that only looks like a filesystem path but is never resolved against this checkout).
const ALLOW_MARKER = "path-guard-allow";

function collectTestFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((entry) => entry.endsWith(".test.mjs"))
    .map((entry) => path.join(dir, entry));
}

test("no test file under backend/tests or collector/tests hardcodes an absolute drive-letter path", () => {
  const testFiles = [
    ...collectTestFiles(path.join(repoRoot, "backend", "tests")),
    ...collectTestFiles(path.join(repoRoot, "collector", "tests")),
  ];

  const offenders = [];
  for (const filePath of testFiles) {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (ABSOLUTE_DRIVE_PATH_PATTERN.test(line) && !line.includes(ALLOW_MARKER)) {
        offenders.push(`${path.relative(repoRoot, filePath)}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  assert.equal(
    offenders.length,
    0,
    `Test files must derive paths from import.meta.url, not hardcode an absolute drive path. Offenders:\n${offenders.join("\n")}`
  );
});
