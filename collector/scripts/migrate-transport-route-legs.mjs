import path from "path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

function parseArgs(argv) {
  const dbIndex = argv.indexOf("--db");
  const dbPath = dbIndex >= 0 ? argv[dbIndex + 1] : "";
  if (!dbPath) throw new Error("usage: node scripts/migrate-transport-route-legs.mjs --db <path>");
  return { dbPath: path.resolve(dbPath) };
}

export function migrateTransportRouteLegs(db) {
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(r => r.name === c);
  if (!has('transport_routes_v2','route_kind'))
    db.exec(`ALTER TABLE transport_routes_v2 ADD COLUMN route_kind TEXT NOT NULL DEFAULT 'loop' CHECK (route_kind IN ('loop','out_back'))`);
  if (!has('transport_route_control_points_v2','leg'))
    db.exec(`ALTER TABLE transport_route_control_points_v2 ADD COLUMN leg TEXT CHECK (leg IN ('out','back'))`);
  if (!has('transport_route_stops_v2','leg'))
    db.exec(`ALTER TABLE transport_route_stops_v2 ADD COLUMN leg TEXT CHECK (leg IN ('out','back'))`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { dbPath } = parseArgs(process.argv.slice(2));
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("BEGIN IMMEDIATE;");
  try {
    migrateTransportRouteLegs(db);
    db.exec("COMMIT;");
    console.log(JSON.stringify({ ok: true, db_path: dbPath }));
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  } finally {
    db.close();
  }
}
