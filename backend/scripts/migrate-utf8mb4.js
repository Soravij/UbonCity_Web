import pool from "../config/db.js";
import { ensureUtf8mb4 } from "../config/ensureUtf8mb4.js";

try {
  await ensureUtf8mb4();
  console.log("utf8mb4 migration completed");
  await pool.end();
} catch (err) {
  console.error("utf8mb4 migration failed:", err.message);
  process.exit(1);
}
