import "dotenv/config";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const PID_FILE = process.env.BACKEND_PID_FILE
  ? path.resolve(process.env.BACKEND_PID_FILE)
  : path.join(CWD, "runtime", "backend-server.pid");
const LOG_FILE = process.env.BACKEND_LOG_FILE
  ? path.resolve(process.env.BACKEND_LOG_FILE)
  : path.join(CWD, "runtime", "backend-server.out.log");
const ERR_FILE = process.env.BACKEND_ERR_FILE
  ? path.resolve(process.env.BACKEND_ERR_FILE)
  : path.join(CWD, "runtime", "backend-server.err.log");
const STOP_FILE = process.env.BACKEND_STOP_FILE
  ? path.resolve(process.env.BACKEND_STOP_FILE)
  : `${PID_FILE}.stop`;
const READY_MODE = String(process.env.BACKEND_READY_MODE || "default").trim().toLowerCase();

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function shouldSkipDbInit() {
  return READY_MODE === "non_mutating" || isTruthy(process.env.BACKEND_READY_SKIP_DB_INIT);
}

function shouldSkipComparatorVerify() {
  return isTruthy(process.env.BACKEND_READY_SKIP_COMPARATOR);
}

function runNodeCommand(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: CWD,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", (err) => {
      reject(new Error(`${label} failed to start: ${String(err?.message || err)}`));
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`${label} terminated by signal ${signal}`));
        return;
      }
      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function resolveServerScript(args) {
  const firstArg = Array.isArray(args) ? String(args[0] || "").trim() : "";
  if (!firstArg) return "";
  return path.resolve(CWD, firstArg);
}

async function writePidFile({ pid, args }) {
  const serverScript = resolveServerScript(args);
  await fs.mkdir(path.dirname(PID_FILE), { recursive: true });
  await fs.writeFile(
    PID_FILE,
    JSON.stringify(
      {
        pid: Number(pid || 0),
        port: Number(process.env.PORT || 5060),
        bind_host: String(process.env.COLLECTOR_BIND_HOST || "127.0.0.1").trim() || "127.0.0.1",
        log_file: LOG_FILE,
        err_file: ERR_FILE,
        stop_file: STOP_FILE,
        manager_pid: Number(process.pid || 0),
        management_mode: "backend_ready",
        ready_mode: READY_MODE || "default",
        server_exec_path: process.execPath,
        server_script: serverScript || null,
        server_args: Array.isArray(args) ? args : [],
        started_at: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
}

async function removePidFile() {
  await fs.rm(PID_FILE, { force: true });
}

async function stopRequested() {
  try {
    await fs.access(STOP_FILE);
    return true;
  } catch {
    return false;
  }
}

async function removeStopFile() {
  await fs.rm(STOP_FILE, { force: true });
}

function runServerCommand(args, label) {
  return new Promise((resolve, reject) => {
    const closeStreams = [];
    let stdoutStream = null;
    let stderrStream = null;

    const setupStreams = async () => {
      await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
      await fs.mkdir(path.dirname(ERR_FILE), { recursive: true });
      await fs.writeFile(LOG_FILE, "", "utf8");
      await fs.writeFile(ERR_FILE, "", "utf8");
      stdoutStream = fsSync.createWriteStream(LOG_FILE, { flags: "a" });
      stderrStream = fsSync.createWriteStream(ERR_FILE, { flags: "a" });
      closeStreams.push(() => stdoutStream?.end());
      closeStreams.push(() => stderrStream?.end());
    };

    const cleanup = async () => {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
      for (const close of closeStreams) {
        close();
      }
      await removeStopFile();
      await removePidFile();
    };

    const forwardSignal = (signal) => {
      if (child.exitCode == null) {
        child.kill(signal);
      }
    };

    const handleSigint = () => forwardSignal("SIGINT");
    const handleSigterm = () => forwardSignal("SIGTERM");

    let child;
    Promise.resolve(setupStreams())
      .then(() => {
    const child = spawn(process.execPath, args, {
      cwd: CWD,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
        return child;
      })
      .then((spawnedChild) => {
        child = spawnedChild;

        child.stdout.on("data", (chunk) => {
          process.stdout.write(chunk);
          stdoutStream?.write(chunk);
        });
        child.stderr.on("data", (chunk) => {
          process.stderr.write(chunk);
          stderrStream?.write(chunk);
        });

        process.on("SIGINT", handleSigint);
        process.on("SIGTERM", handleSigterm);

        child.on("error", async (err) => {
          await cleanup();
          reject(new Error(`${label} failed to start: ${String(err?.message || err)}`));
        });

        Promise.resolve(writePidFile({ pid: child.pid, args })).catch(async (err) => {
          if (child.exitCode == null) {
            child.kill("SIGTERM");
          }
          await cleanup();
          reject(new Error(`${label} failed to write pid file: ${String(err?.message || err)}`));
        });

        child.on("exit", async (code, signal) => {
          const externalStopRequested = await stopRequested();
          await cleanup();
          if (code === 0) {
            resolve();
            return;
          }
          if (signal === "SIGTERM" || signal === "SIGINT" || externalStopRequested) {
            resolve();
            return;
          }
          if (signal) {
            reject(new Error(`${label} terminated by signal ${signal}`));
            return;
          }
          reject(new Error(`${label} exited with code ${code}`));
        });
      })
      .catch(async (err) => {
        for (const close of closeStreams) {
          close();
        }
        await removePidFile();
        reject(new Error(`${label} failed before server start: ${String(err?.message || err)}`));
      });
  });
}

async function main() {
  if (shouldSkipDbInit()) {
    console.log(`backend-ready: skipping db:init (mode=${READY_MODE || "default"})`);
  } else {
    console.log("backend-ready: initializing database");
    await runNodeCommand(["scripts/init-db.mjs"], "db:init");
  }

  if (shouldSkipComparatorVerify()) {
    console.log("backend-ready: skipping comparator verification (BACKEND_READY_SKIP_COMPARATOR)");
  } else {
    console.log("backend-ready: running comparator verification");
    await runNodeCommand(["scripts/verify-evaluate-contract.mjs", "--mode", "comparator"], "verify:evaluate-comparator");
  }

  console.log("backend-ready: starting server");
  await runServerCommand(["server/index.mjs"], "start");
}

main().catch((err) => {
  console.error(`backend-ready: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
