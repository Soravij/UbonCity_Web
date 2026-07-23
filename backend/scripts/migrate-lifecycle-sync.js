import pool from "../config/db.js";
import { initializeLifecycleInfrastructure } from "../controllers/lifecycleController.js";
import { ensureSharedSchemaBootstrap } from "../config/sharedSchemaBootstrap.js";

async function main() {
  try {
    await ensureSharedSchemaBootstrap();
    await initializeLifecycleInfrastructure();
    console.log("Lifecycle sync infrastructure ready");
    await pool.end();
  } catch (err) {
    console.error("Lifecycle sync migration failed:", err?.message || err);
    process.exit(1);
  }
}

main();
