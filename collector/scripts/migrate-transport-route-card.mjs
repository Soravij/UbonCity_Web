import path from "path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ROUTE_PALETTE } from "../server/public/transport-v2-palette.js";

function parseArgs(argv) {
  const dbIndex = argv.indexOf("--db");
  const dbPath = dbIndex >= 0 ? argv[dbIndex + 1] : "";
  if (!dbPath) throw new Error("usage: node scripts/migrate-transport-route-card.mjs --db <path> [--recolor]");
  const recolor = argv.includes("--recolor");
  return { dbPath: path.resolve(dbPath), recolor };
}

export function migrateTransportRouteCard(db, { recolor = false } = {}) {
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);
  if (!has("transport_routes_v2", "description_en")) db.exec(`ALTER TABLE transport_routes_v2 ADD COLUMN description_en TEXT NOT NULL DEFAULT ''`);
  if (!has("transport_routes_v2", "fare_baht")) db.exec(`ALTER TABLE transport_routes_v2 ADD COLUMN fare_baht REAL`);
  if (!has("transport_routes_v2", "color_locked")) db.exec(`ALTER TABLE transport_routes_v2 ADD COLUMN color_locked INTEGER NOT NULL DEFAULT 0`);
  if (recolor) {
    const rows = db.prepare("SELECT id, color FROM transport_routes_v2 ORDER BY id ASC").all();
    rows.forEach((r, i) => {
      if (!ROUTE_PALETTE.includes(String(r.color || "").toLowerCase())) {
        db.prepare("UPDATE transport_routes_v2 SET color=?, color_locked=0 WHERE id=?").run(ROUTE_PALETTE[i % ROUTE_PALETTE.length], Number(r.id));
      }
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { dbPath, recolor } = parseArgs(process.argv.slice(2));
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("BEGIN IMMEDIATE;");
  try {
    migrateTransportRouteCard(db, { recolor });
    db.exec("COMMIT;");
    console.log(JSON.stringify({ ok: true, db_path: dbPath, recolor }));
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  } finally {
    db.close();
  }
}
