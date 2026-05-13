import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readCliOption(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] ?? "").trim();
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const PID_FILE = process.env.BACKEND_PID_FILE
  ? path.resolve(process.env.BACKEND_PID_FILE)
  : path.join(CWD, "runtime", "backend-server.pid");
const DEFAULT_LOG_FILE = process.env.BACKEND_LOG_FILE
  ? path.resolve(process.env.BACKEND_LOG_FILE)
  : path.join(CWD, "runtime", "backend-server.out.log");
const DEFAULT_ERR_FILE = process.env.BACKEND_ERR_FILE
  ? path.resolve(process.env.BACKEND_ERR_FILE)
  : path.join(CWD, "runtime", "backend-server.err.log");

function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

async function readPidInfo() {
  try {
    const raw = await fs.readFile(PID_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function tailLines(filePath, lineCount) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.replace(/\r/g, "").split("\n");
    const filtered = lines.filter((line, idx) => !(idx === lines.length - 1 && line === ""));
    return filtered.slice(-lineCount);
  } catch (err) {
    if (String(err?.code || "") === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function main() {
  const pidInfo = await readPidInfo();
  const lineCount = parsePositiveInt(readCliOption("--lines") || process.env.BACKEND_LOG_LINES || "", 40);
  const logFile = pidInfo?.log_file || DEFAULT_LOG_FILE;
  const errFile = pidInfo?.err_file || DEFAULT_ERR_FILE;
  const stdoutLines = await tailLines(logFile, lineCount);
  const stderrLines = await tailLines(errFile, lineCount);

  console.log(`==> ${logFile}`);
  if (stdoutLines.length === 0) {
    console.log("(no stdout log lines)");
  } else {
    for (const line of stdoutLines) {
      console.log(line);
    }
  }

  console.log(`\n==> ${errFile}`);
  if (stderrLines.length === 0) {
    console.log("(no stderr log lines)");
  } else {
    for (const line of stderrLines) {
      console.log(line);
    }
  }
}

main().catch((err) => {
  console.error(`backend-logs: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
