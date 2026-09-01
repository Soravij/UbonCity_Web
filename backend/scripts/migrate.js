import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

const DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    VARCHAR(255) NOT NULL PRIMARY KEY,
  checksum    CHAR(64)     NULL,
  source      ENUM('runner','manual','baseline') NOT NULL,
  applied_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note        VARCHAR(255) NULL
) ENGINE=InnoDB;
`;

function createConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    charset: "utf8mb4",
  });
}

export function parseNumber(filename) {
  const m = filename.match(/^(\d+)/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

export function classify(filename) {
  const n = parseNumber(filename);
  if (n === null) return null;
  if (n <= 24) return "baseline";
  if (n === 25 || n === 26) return "manual";
  return "runner";
}

export function checksumOf(text) {
  return createHash("sha256").update(text).digest("hex");
}

function listMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  files.sort();
  return files;
}

async function cmdInit(conn) {
  await conn.query(DDL);

  const files = listMigrationFiles();
  for (const file of files) {
    const n = parseNumber(file);
    if (n === null) continue;

    const src = classify(file);
    let checksum = null;
    let note = "";

    if (src === "baseline") {
      note = "adopted from probe; provenance unproven";
    } else if (src === "manual") {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      checksum = checksumOf(content);
      note = "applied by hand on Runtime";
    } else {
      continue;
    }

    await conn.query(
      "INSERT IGNORE INTO schema_migrations (filename, checksum, source, note) VALUES (?, ?, ?, ?)",
      [file, checksum, src, note]
    );
  }

  console.log("migrate:init done");
}

async function cmdStatus(conn) {
  await conn.query(DDL);

  const [rows] = await conn.query("SELECT filename, source, applied_at, checksum FROM schema_migrations ORDER BY filename");
  const ledger = new Map(rows.map((r) => [r.filename, r]));

  const files = listMigrationFiles();
  const allNames = new Set([...files, ...ledger.keys()]);
  const sorted = [...allNames].sort();

  console.log("filename".padEnd(50) + " | source".padEnd(10) + " | applied_at          | checksum status");
  console.log("-".repeat(110));

  for (const name of sorted) {
    const entry = ledger.get(name);
    const onDisk = files.includes(name);

    if (!entry) {
      console.log(`${name.padEnd(50)} | ${"(missing)".padEnd(8)} | ${"".padEnd(19)} | not in ledger`);
      continue;
    }

    const applied = entry.applied_at
      ? new Date(entry.applied_at).toISOString().replace("T", " ").slice(0, 19)
      : "";

    let checksumStatus = "";
    if (entry.source === "baseline") {
      checksumStatus = "baseline (no check)";
    } else if (!onDisk) {
      checksumStatus = "file missing on disk";
    } else {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
      const diskChecksum = checksumOf(content);
      if (entry.checksum === diskChecksum) {
        checksumStatus = "match";
      } else {
        checksumStatus = "CHANGED";
      }
    }

    console.log(
      `${name.padEnd(50)} | ${entry.source.padEnd(8)} | ${applied.padEnd(19)} | ${checksumStatus}`
    );
  }
}

async function cmdMigrate(conn) {
  const [lockRows] = await conn.query("SELECT GET_LOCK('uboncity_migrate', 10) AS got");
  if (!lockRows[0].got) {
    console.error("Could not acquire lock uboncity_migrate; another migration may be running");
    process.exit(1);
  }

  try {
    const [rows] = await conn.query("SELECT filename, source, checksum FROM schema_migrations");
    const ledger = new Map(rows.map((r) => [r.filename, r]));

    const files = listMigrationFiles();

    for (const file of files) {
      const n = parseNumber(file);
      if (n === null) continue;

      const entry = ledger.get(file);
      if (entry) {
        if (entry.source !== "baseline" && entry.checksum !== null) {
          const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
          const diskChecksum = checksumOf(content);
          if (entry.checksum !== diskChecksum) {
            console.warn(`WARN: checksum mismatch for ${file} (ledger=${entry.checksum} disk=${diskChecksum})`);
          }
        }
        continue;
      }

      if (classify(file) !== "runner") {
        throw new Error(
          `refusing to run ${file}: classified '${classify(file)}', runner only executes 'runner' files. ` +
          `This file is not in schema_migrations, so the ledger has not been seeded. ` +
          `Run "npm run migrate:init" first to record baseline/manual migrations, then re-run "npm run migrate".`
        );
      }

      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const checksum = checksumOf(content);

      console.log(`Running ${file}...`);
      try {
        await conn.query(content);
      } catch (err) {
        throw new Error(`FAILED: ${file}: ${err.message} — ไฟล์นี้อาจ apply ไปแล้วบางส่วน (MySQL DDL ไม่ roll back) ตรวจ schema ด้วยมือก่อนรันซ้ำ`);
      }

      await conn.query(
        "INSERT INTO schema_migrations (filename, checksum, source) VALUES (?, ?, 'runner')",
        [file, checksum]
      );
      console.log(`  -> applied`);
    }

    console.log("migrate done");
  } finally {
    await conn.query("SELECT RELEASE_LOCK('uboncity_migrate')");
  }
}

async function cmdDown() {
  console.error("migrate:down is not supported yet");
  process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMain) {
  const sub = process.argv[2] || "migrate";

  const conn = await createConnection();
  try {
    if (sub === "migrate:init") {
      await cmdInit(conn);
    } else if (sub === "migrate:status") {
      await cmdStatus(conn);
    } else if (sub === "migrate") {
      try {
        await cmdMigrate(conn);
      } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
      }
    } else if (sub === "migrate:down") {
      await cmdDown();
    } else {
      console.error(`Unknown sub-command: ${sub}`);
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}
