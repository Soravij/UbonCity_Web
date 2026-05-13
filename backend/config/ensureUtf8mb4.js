import pool from "./db.js";

const COLLATION = "utf8mb4_unicode_ci";

function qid(name) {
  return `\`${String(name).replace(/`/g, "``")}\``;
}

async function tableExists(tableName) {
  const [rows] = await pool.query("SHOW TABLES LIKE ?", [tableName]);
  return Array.isArray(rows) && rows.length > 0;
}

export async function ensureUtf8mb4() {
  const [dbRows] = await pool.query("SELECT DATABASE() AS db");
  const dbName = dbRows?.[0]?.db;

  if (dbName) {
    await pool.query(
      `ALTER DATABASE ${qid(dbName)} CHARACTER SET utf8mb4 COLLATE ${COLLATION}`
    );
  }

  const tables = [
    "users",
    "categories",
    "places",
    "place_translations",
    "events",
    "event_translations",
    "transport_routes",
    "transport_route_points",
    "transport_route_stops",
    "transport_route_audit_logs",
    "media_assets",
    "content_image_usages",
  ];

  for (const table of tables) {
    if (!(await tableExists(table))) continue;
    await pool.query(
      `ALTER TABLE ${qid(table)} CONVERT TO CHARACTER SET utf8mb4 COLLATE ${COLLATION}`
    );
  }

  // Ensure connection/session stays utf8mb4.
  await pool.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
}


